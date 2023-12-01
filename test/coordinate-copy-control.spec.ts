import { test, expect } from "@playwright/test";
import { createMap, ykjToWgs84, etrsToWgs84, MapPageObject, CoordinateCopyControlPageObject } from "./test-utils";

test.describe.configure({ mode: "serial" });

test.describe("Draw copy control", () => {

	const [lat, lng] = [60.5, 25.5];

	let map: MapPageObject;
	let control: CoordinateCopyControlPageObject;
	test.beforeAll(async ({browser}) => {
		const page = await browser.newPage();
		map = await createMap(page, {
			draw: {geoData: {type: "Point", coordinates: [lng, lat]}},
			controls: {
				draw: {
					copy: true
				}
			}
		});
		control = map.getCoordinateCopyControl();
	});

	test.beforeEach("open control", async () => {
		await control.$getButton().click();
	});

	test.afterEach("close control", async () => {
		await control.$getCloseButton().click();
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
		for (const {crs, toWGS84} of crss) {
			test(`${format} ${crs}`, async () => {
				await control[format]();
				await control[crs]();
				const latLng = getLatLng(await control.getConverted()).map(c => +c);
				const asWGS84 = toWGS84(latLng);
				expect(asWGS84[0]).toBeCloseTo(lat);
				expect(asWGS84[1]).toBeCloseTo(lng);
			});
		}
	}

});
