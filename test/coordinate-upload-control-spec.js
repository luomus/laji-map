
const { createMap, ykjToWgs84, etrsToWgs84 } = require("./test-utils");

describe("Coordinate control", () => {

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

	it("opens on click", async () => {
		const $button = control.$getButton();
		await $button.click();
		await expect((await control.$getContainer()).isPresent()).toBe(true);
	});

	it("is disabled when no input", async () => {
		const $submit = control.$getSubmit();
		await expect(await $submit.isEnabled()).toBe(false);
	});

	it("is disabled with invalid latlng", async () => {
		const $submit = control.$getSubmit();
		await control.type("sdfsdf");
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
			"getDraw().featureCollection.features[0].geometry"
		);

		describe("ISO 6709", () => {
			it("WGS84 point", async () => {
				const [lat, lng] = [60, 25];
				await control.type(`${lat}:${lng}/`);
				await expect(await control.getCRS()).toBe("WGS84");
				await expect(await control.getFormat()).toBe("ISO 6709");
				await control.$getSubmit().click();
				const mapCoordinates = (await getGeometry()).coordinates;
				expect(mapCoordinates[0]).toBe(lng);
				expect(mapCoordinates[1]).toBe(lat);
			});

			it("YKJ point", async () => {
				const [lat, lng] = [6666666, 3333333];
				const converted = ykjToWgs84(lat, lng);
				await control.type(`${lat}:${lng}/`);
				await expect(await control.getCRS()).toBe("YKJ");
				await expect(await control.getFormat()).toBe("ISO 6709");
				await control.$getSubmit().click();
				const geometry = await getGeometry();
				expect(geometry.type).toBe("Point");
				expect(geometry.coordinates).toEqual(converted);
			});

			it("ETRS point", async () => {
				const [lat, lng] = [6666666, 333333];
				const converted = etrsToWgs84(lat, lng);
				await control.type(`${lat}:${lng}/`);
				await expect(await control.getCRS()).toBe("ETRS-TM35FIN");
				await expect(await control.getFormat()).toBe("ISO 6709");
				await control.$getSubmit().click();
				const geometry = await getGeometry();
				expect(geometry.type).toBe("Point");
				expect(geometry.coordinates).toEqual(converted);
			});
		});
	});
});
