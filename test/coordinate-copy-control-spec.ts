import { createMap, ykjToWgs84, etrsToWgs84 } from "./test-utils";

describe("Draw copy control", () => {

	const [lat, lng] = [60.5, 25.5];

	let map, control;
	beforeAll(async () => {
		map = await createMap({
			draw: {geoData: {type: "Point", coordinates: [lng, lat]}},
			controls: {
				draw: {
					copy: true
				}
			}
		});
		control = map.getCoordinateCopyControl();
	});

	it("opens on click", async () => {
		const $button = control.$getButton();
		await $button.click();
		expect(await control.$getContainer().isPresent()).toBe(true);
	});

	it("closes on close button click", async () => {
		await control.$getCloseButton().click();
		expect(await control.$getContainer().isPresent()).toBe(false);
	});

	describe("converts", () => {
		beforeAll(async () => {
			await control.$getButton().click();
		});

		const formats = [
			{format: "GeoJSON", getLatLng: str => JSON.parse(str).features[0].geometry.coordinates.reverse()},
			{format: "ISO6709", getLatLng: str => str.replace(/\nCRS.*$/, "").match(/[0-9]+\.?[0-9]+/g)},
			{format: "WKT", getLatLng: str => str.replace(/\PROJCS.*$/, "").match(/[0-9]+\.?[0-9]+/g).reverse()}
		];

		const crss = [
			{crs: "WGS84", toWGS84: latLng => latLng},
			{crs: "YKJ", toWGS84: ykjToWgs84},
			{crs: "ETRS", toWGS84: etrsToWgs84}
		];

		for (const {format, getLatLng} of formats) {
			describe(format, () => {
				for (const {crs, toWGS84} of crss) {
					it(crs, async () => {
						await control[format]();
						await control[crs]();
						const latLng = getLatLng(await control.getConverted()).map(c => +c);
						const asWGS84 = toWGS84(latLng);
						await expect(asWGS84[0]).toBeCloseTo(lat);
						await expect(asWGS84[1]).toBeCloseTo(lng);
					});
				}
			});
		}
	});
});
