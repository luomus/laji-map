const { createMap, ykjToWgs84, etrsToWgs84 } = require("./test-utils");

describe("Coordinate control", () => {

	let map, control;
	beforeAll(async () => {
		map = await createMap({
			draw: true,
			controls: true
		});
		control = map.getCoordinateInputControl();
	});

	it("opens on click", async () => {
		const $button = control.$getButton();
		await $button.click();
		await expect((await control.$getContainer()).isPresent()).toBe(true);
	});

	it("is disabled when no latlng", async () => {
		const $submit = control.$getSubmit();
		await expect(await $submit.isEnabled()).toBe(false);
	});

	it("is disabled with invalid latlng", async () => {
		const $submit = control.$getSubmit();
		await control.enterLatLng(1231231231, 123092834);
		await expect(await $submit.isEnabled()).toBe(false);
	});

	it("closes on close button click", async () => {
		await control.$getCloseButton().click();
		await expect((await control.$getContainer()).isPresent()).toBe(false);
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

		const getGeometry = () => map.e(
			"getDraw().featureCollection.features[map.getDraw().featureCollection.features.length - 1].geometry"
		);

		it("WGS84 point", async () => {
			const [lat, lng] = [60, 25];
			await control.enterLatLng(lat, lng);
			await expect(await control.getCRS()).toBe("WGS84");
			await control.$getSubmit().click();
			const mapCoordinates = (await getGeometry()).coordinates;
			expect(mapCoordinates[0]).toBe(lng);
			expect(mapCoordinates[1]).toBe(lat);
		});

		it("WGS84 point with decimal", async () => {
			const [lat, lng] = [60.5, 25.5];
			await control.enterLatLng(lat, lng);
			await expect(await control.getCRS()).toBe("WGS84");
			await control.$getSubmit().click();
			const mapCoordinates = (await getGeometry()).coordinates;
			expect(mapCoordinates[0]).toBe(lng);
			expect(mapCoordinates[1]).toBe(lat);
		});

		it("YKJ point", async () => {
			const [lat, lng] = [6666666, 3333333];
			const converted = ykjToWgs84(lat, lng);
			await control.enterLatLng(lat, lng);
			await expect(await control.getCRS()).toBe("YKJ");
			await control.$getSubmit().click();
			const geometry = await getGeometry();
			expect(geometry.type).toBe("Point");
			expect(geometry.coordinates).toEqual(converted);
			expect(geometry.coordinateVerbatim).toBe(`${lat}:${lng}`);
		});

		it("YKJ grid", async () => {
			const [lat, lng] = [666666, 333333];
			const converted = [
				[6666660, 3333330],
				[6666660, 3333340],
				[6666670, 3333340],
				[6666670, 3333330],
			].map(latLng => ykjToWgs84(...latLng));
			await control.enterLatLng(lat, lng);
			await expect(await control.getCRS()).toBe("YKJ");
			await control.$getSubmit().click();
			const geometry = await getGeometry();
			expect(geometry.type).toBe("Polygon");
			expect(geometry.coordinates[0].length).toBe(5);
			expect(geometry.coordinates[0][0]).toEqual(converted[0]);
			expect(geometry.coordinates[0][1]).toEqual(converted[1]);
			expect(geometry.coordinates[0][2]).toEqual(converted[2]);
			expect(geometry.coordinates[0][3]).toEqual(converted[3]);
			expect(geometry.coordinates[0][4]).toEqual(converted[0]);
			expect(geometry.coordinateVerbatim).toBe(`${lat}:${lng}`);
		});

		it("ETRS point", async () => {
			const [lat, lng] = [6666666, 333333];
			const converted = etrsToWgs84(lat, lng);
			await control.enterLatLng(lat, lng);
			await expect(await control.getCRS()).toBe("ETRS-TM35FIN");
			await control.$getSubmit().click();
			const geometry = await getGeometry();
			expect(geometry.type).toBe("Point");
			expect(geometry.coordinates).toEqual(converted);
			expect(geometry.coordinateVerbatim).toBe(`${lat}:${lng}`);
		});
	});
});
