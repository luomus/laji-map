import { test, expect } from "@playwright/test";
import { createMap, ykjToWgs84, etrsToWgs84, CoordinateUploadControlPageObject, MapPageObject } from "./test-utils";
import { reverseCoordinate } from "@luomus/laji-map/lib/utils";
import { EPSG2393String } from "@luomus/laji-map/lib/globals";

test.describe.configure({ mode: "serial" });

test.describe("Draw upload control", () => {

	let map: MapPageObject;
	let control: CoordinateUploadControlPageObject;
	test.beforeAll(async ({browser}) => {
		const page = await browser.newPage();
		map = await createMap(page, {
			draw: true,
			controls: {
				draw: {
					upload: true
				}
			}
		});
		control = map.getCoordinateUploadControl();
	});

	const getGeometry = () => map.e(
		"getDraw().featureCollection.features[0].geometry"
	);

	const asGeoJSON = (lat, lng) => JSON.stringify({type: "Point", coordinates: [lng, lat]});
	const asISO6709 = (lat, lng) => `${lat}:${lng}/`;
	const asWKT = (lat, lng) => `POINT(${lng} ${lat})`;

	const pointTestsDescriptions = [
		{name: "GeoJSON", latLngToFormat: asGeoJSON},
		{name: "ISO 6709", latLngToFormat: asISO6709},
		{name: "WKT", latLngToFormat: asWKT}
	];

	test("opens on click", async () => {
		const $button = control.$getButton();
		await $button.click();
		await expect(control.$getContainer()).toBeVisible();
	});

	test("is disabled when no input", async () => {
		const $submit = control.$getSubmit();
		await expect($submit).toBeDisabled();
	});

	test("is disabled with invalid latlng", async () => {
		const $submit = control.$getSubmit();
		await control.type("sdfsdf");
		await expect($submit).toBeDisabled();
	});

	test("closes on close button click", async () => {
		await control.$getCloseButton().click();
		await expect(control.$getContainer()).not.toBeVisible();
	});

	test.describe("accepts", () => {

		test.beforeEach(async () => {
			const $button = control.$getButton();
			await $button.click();
		});

		for (const {name, latLngToFormat} of pointTestsDescriptions) {
			test.describe(name, () => {
				test("WGS84 point", async () => {
					const [lat, lng] = [60, 25];
					await control.type(latLngToFormat(lat, lng));
					expect(await control.getCRS()).toBe("WGS84");
					expect(await control.getFormat()).toBe(name);
					await control.$getSubmit().click();
					const mapCoordinates = (await getGeometry()).coordinates;
					expect(mapCoordinates[0]).toBe(lng);
					expect(mapCoordinates[1]).toBe(lat);
				});

				test("YKJ point", async () => {
					const [lat, lng] = [6666666, 3333333];
					const wgs84LatLng = ykjToWgs84([lat, lng]);
					await control.type(latLngToFormat(lat, lng));
					expect(await control.getCRS()).toBe("YKJ");
					expect(await control.getFormat()).toBe(name);
					await control.$getSubmit().click();
					const geometry = await getGeometry();
					expect(geometry.type).toBe("Point");
					expect(reverseCoordinate(geometry.coordinates)).toEqual(wgs84LatLng);
				});

				test("ETRS point", async () => {
					const [lat, lng] = [6666666, 333333];
					const wgs84LatLng = etrsToWgs84([lat, lng]);
					await control.type(latLngToFormat(lat, lng));
					expect(await control.getCRS()).toBe("ETRS-TM35FIN");
					expect(await control.getFormat()).toBe(name);
					await control.$getSubmit().click();
					const geometry = await getGeometry();
					expect(geometry.type).toBe("Point");
					expect(reverseCoordinate(geometry.coordinates)).toEqual(wgs84LatLng);
				});
			});
		}

		test("GeoJSON YKJ point when CRS marked", async () => {
			const [lat, lng] = [6666666, 3333333];
			const wgs84LatLng = ykjToWgs84([lat, lng]);
			const geoJSON = JSON.parse(asGeoJSON(lat, lng));
			geoJSON.crs = {
				type: "name",
				properties: {
					name: EPSG2393String
				}
			};
			await control.type(JSON.stringify(geoJSON));
			expect(await control.getCRS()).toBe("YKJ");
			expect(await control.getFormat()).toBe("GeoJSON");
			await control.$getSubmit().click();
			const geometry = await getGeometry();
			expect(geometry.type).toBe("Point");
			expect(reverseCoordinate(geometry.coordinates)).toEqual(wgs84LatLng);
		});

		test("ISO6709 point with CRS on same line", async () => {
			const [lat, lng] = [6666666, 333333];
			const wgs84LatLng = etrsToWgs84([lat, lng]);
			await control.type(`${asISO6709(lat, lng)}CRSEPSG:3067`);
			expect(await control.getCRS()).toBe("ETRS-TM35FIN");
			expect(await control.getFormat()).toBe("ISO 6709");
			await control.$getSubmit().click();
			const geometry = await getGeometry();
			expect(geometry.type).toBe("Point");
			expect(reverseCoordinate(geometry.coordinates)).toEqual(wgs84LatLng);
		});

		test("ISO6709 points with CRS on own line", async () => {
			const [lat, lng] = [6666666, 333333];
			const wgs84LatLng = etrsToWgs84([lat, lng]);
			await control.type(`${asISO6709(lat, lng)}\nCRSEPSG:3067`);
			expect(await control.getCRS()).toBe("ETRS-TM35FIN");
			expect(await control.getFormat()).toBe("ISO 6709");
			await control.$getSubmit().click();
			const geometry = await getGeometry();
			expect(geometry.type).toBe("Point");
			expect(reverseCoordinate(geometry.coordinates)).toEqual(wgs84LatLng);
		});
	});
});
