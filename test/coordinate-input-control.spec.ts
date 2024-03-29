import { test, expect } from "@playwright/test";
import { navigateToMapPage, ykjToWgs84, etrsToWgs84, MapPageObject  } from "./test-utils";
import { reverseCoordinate } from "@luomus/laji-map/lib/utils";

test.describe.configure({ mode: "serial" });

test.describe("Coordinate input control", () => {

	let map: MapPageObject;
	let control: MapPageObject["controls"]["coordinateInput"];
	test.beforeAll(async ({browser}) => {
		const page = await browser.newPage();
		map = await navigateToMapPage(page, {
			draw: true,
			controls: true
		});
		control = map.controls.coordinateInput;
	});

	test("opens on click", async () => {
		const $button = control.$button;
		await $button.click();
		await expect(control.$container).toBeVisible();
	});

	test("is disabled when no latlng", async () => {
		await expect(control.$submit).toBeDisabled();
	});

	test("is disabled with invalid latlng", async () => {
		const $submit = control.$submit;
		await control.enterLatLng(1231231231, 123092834);
		await expect($submit).toBeDisabled();
	});

	test("closes on close button click", async () => {
		await control.$closeButton.click();
		await expect(control.$container).not.toBeVisible();
	});

	test.describe("accepts", async () => {

		test.beforeEach(async () => {
			await control.$button.click();
		});

		const getGeometry = () => map.e(
			"getDraw().featureCollection.features[map.getDraw().featureCollection.features.length - 1].geometry"
		);

		test("WGS84 point", async () => {
			const [lat, lng] = [60, 25];
			await control.enterLatLng(lat, lng);
			expect(await control.getCRS()).toBe("WGS84");
			await control.$submit.click();
			const mapCoordinates = (await getGeometry()).coordinates;
			expect(mapCoordinates[0]).toBe(lng);
			expect(mapCoordinates[1]).toBe(lat);
		});

		test("WGS84 point with decimal", async () => {
			const [lat, lng] = [60.5, 25.5];
			await control.enterLatLng(lat, lng);
			expect(await control.getCRS()).toBe("WGS84");
			await control.$submit.click();
			const mapCoordinates = (await getGeometry()).coordinates;
			expect(mapCoordinates[0]).toBe(lng);
			expect(mapCoordinates[1]).toBe(lat);
		});

		test("WGS84 point with negative lng", async () => {
			const [lat, lng] = [50, -3];
			await control.enterLatLng(lat, lng);
			expect(await control.getCRS()).toBe("WGS84");
			await control.$submit.click();
			const mapCoordinates = (await getGeometry()).coordinates;
			expect(mapCoordinates[0]).toBe(lng);
			expect(mapCoordinates[1]).toBe(lat);
		});

		test("YKJ point", async () => {
			const [lat, lng] = [6666666, 3333333];
			await control.enterLatLng(lat, lng);
			expect(await control.getCRS()).toBe("YKJ");
			await control.$submit.click();
			const geometry = await getGeometry();
			expect(geometry.type).toBe("Point");
			expect(reverseCoordinate(geometry.coordinates)).toEqual(ykjToWgs84([lat, lng]));
			expect(geometry.coordinateVerbatim).toBe(`${lat}:${lng}`);
		});

		test("YKJ grid", async () => {
			const [lat, lng] = [666666, 333333];
			const wgs84LatLngs = [
				[6666660, 3333330],
				[6666660, 3333340],
				[6666670, 3333340],
				[6666670, 3333330],
			].map((latLng: [number, number]) => ykjToWgs84(latLng));
			await control.enterLatLng(lat, lng);
			expect(await control.getCRS()).toBe("YKJ");
			await control.$submit.click();
			const geometry = await getGeometry();
			expect(geometry.type).toBe("Polygon");
			expect(geometry.coordinates[0].length).toBe(5);
			expect(reverseCoordinate(geometry.coordinates[0][0])).toEqual(wgs84LatLngs[0]);
			expect(reverseCoordinate(geometry.coordinates[0][1])).toEqual(wgs84LatLngs[1]);
			expect(reverseCoordinate(geometry.coordinates[0][2])).toEqual(wgs84LatLngs[2]);
			expect(reverseCoordinate(geometry.coordinates[0][3])).toEqual(wgs84LatLngs[3]);
			expect(reverseCoordinate(geometry.coordinates[0][4])).toEqual(wgs84LatLngs[0]);
			expect(geometry.coordinateVerbatim).toBe(`${lat}:${lng}`);
		});

		test("ETRS point", async () => {
			const [lat, lng] = [6666666, 333333];
			await control.enterLatLng(lat, lng);
			expect(await control.getCRS()).toBe("ETRS-TM35FIN");
			await control.$submit.click();
			const geometry = await getGeometry();
			expect(geometry.type).toBe("Point");
			expect(reverseCoordinate(geometry.coordinates)).toEqual(etrsToWgs84([lat, lng]));
			expect(geometry.coordinateVerbatim).toBe(`${lat}:${lng}`);
		});
	});
});
