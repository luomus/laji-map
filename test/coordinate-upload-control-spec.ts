import { createMap, ykjToWgs84, etrsToWgs84 } from "./test-utils";
import { reverseCoordinate } from "../src/utils";
import { EPSG2393String } from "../src/globals";

describe("Draw upload control", () => {

	let map, control;
	beforeAll(async () => {
		map = await createMap({
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

	it("opens on click", async () => {
		const $button = control.$getButton();
		await $button.click();
		expect(await control.$getContainer().isPresent()).toBe(true);
	});

	it("is disabled when no input", async () => {
		const $submit = control.$getSubmit();
		expect(await $submit.isEnabled()).toBe(false);
	});

	it("is disabled with invalid latlng", async () => {
		const $submit = control.$getSubmit();
		await control.type("sdfsdf");
		expect(await $submit.isEnabled()).toBe(false);
	});

	it("closes on close button click", async () => {
		await control.$getCloseButton().click();
		expect(await control.$getContainer().isPresent()).toBe(false);
	});

	describe("accepts", () => {

		beforeEach(async () => {
			const $button = control.$getButton();
			await $button.click();
		});

		afterEach(async () => {
			if (await control.$getContainer().isPresent()) {
				await control.$getCloseButton().click();
			}
		});

		for (const {name, latLngToFormat} of pointTestsDescriptions) {
			describe(name, () => {
				it("WGS84 point", async () => {
					const [lat, lng] = [60, 25];
					await control.type(latLngToFormat(lat, lng));
					expect(await control.getCRS()).toBe("WGS84");
					expect(await control.getFormat()).toBe(name);
					await control.$getSubmit().click();
					const mapCoordinates = (await getGeometry()).coordinates;
					expect(mapCoordinates[0]).toBe(lng);
					expect(mapCoordinates[1]).toBe(lat);
				});

				it("YKJ point", async () => {
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

				it("ETRS point", async () => {
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

		it("GeoJSON YKJ point when CRS marked", async () => {
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

		it("ISO6709 point with CRS on same line", async () => {
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

		it("ISO6709 points with CRS on own line", async () => {
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
