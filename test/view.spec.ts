import { test, expect } from "@playwright/test";
import { createMap, LatLngTraveller, MapPageObject } from "./test-utils";

// Internal logic tested because the later tests rely heavily on it.
test.describe("Internal logic of zoom level normalization", () => {
	test("uses the real zoom level for Finnish layer", async ({page}) => {
		const map = await createMap(page, {tileLayerName: "taustakartta", zoom: 0});
		expect(await map.e("map.getZoom()")).toBe(0);
		expect(await map.e("getNormalizedZoom()")).toBe(0);
	});

	test("uses offset of 3 for world map layer", async ({page}) => {
		const map = await createMap(page, {tileLayerName: "openStreetMap", zoom: 0});
		expect(await map.e("map.getZoom()")).toBe(3);
		expect(await map.e("getNormalizedZoom()")).toBe(0);
	});

	test("getNormalizedZoom() returns updated zoom after changing zoom", async ({page}) => {
		const map = await createMap(page, {tileLayerName: "taustakartta", zoom: 0});
		map.e("setNormalizedZoom(2)");
		expect(await map.e("getNormalizedZoom()")).toBe(2);
	});
	test("getNormalizedZoom() returns updated zoom after changing projection", async ({page}) => {
		const map = await createMap(page, {tileLayerName: "taustakartta", zoom: 0});
		map.e("setTileLayerByName(\"openStreetMap\")");
		expect(await map.e("getNormalizedZoom()")).toBe(0);
	});
});

test.describe("Initializing", () => {

	test.describe("default view", () => {

		test.describe.configure({ mode: "serial" });

		let map: MapPageObject;
		test.beforeAll(async ({browser}) => {
			const page = await browser.newPage();
			map = await createMap(page);
		});

		test("opens with taustakartta", async () => {
			expect(await map.e("tileLayerName")).toBe("taustakartta");
		});

		test("opens with zoom level 2", async () => {
			expect(await map.e("getNormalizedZoom()")).toBe(2);
		});
	});

	test.describe("world map (openStreetMap)", () => {

		let map: MapPageObject;
		test.beforeAll(async ({browser}) => {
			const page = await browser.newPage();
			map = await createMap(page, {tileLayerName: "openStreetMap"});
		});

		test("opens with openStreetMap", async () => {
			expect(await map.e("tileLayerName")).toBe("openStreetMap");
		});

		test("opens with zoom level 2", async () => {
			expect(await map.e("getNormalizedZoom()")).toBe(2);
		});
	});

	test("with location outside Finland using Finnish tilelayer, zoom stays the same after swapping to world map view", async ({page}) => {
		const congo =  {
			lat: 79.3499057749654,
			lng: 21.160612106323246
		};
		const map = await createMap(page, {tileLayerName: "taustakartta", zoom: 4, center: congo});
		expect(await map.e("getNormalizedZoom()")).toBe(4);
	});

	test("openStreetMap can have negative zoom level", async ({page}) => {
		const map = await createMap(page, {tileLayerName: "openStreetMap", zoom: -3});
		expect(await map.e("getNormalizedZoom()")).toBe(-3);
	});

	test("taustakartta is zoomed to it's minimum (0) with negative value", async ({page}) => {
		const map = await createMap(page, {tileLayerName: "taustakartta", zoom: -3});
		expect(await map.e("getNormalizedZoom()")).toBe(0);
	});
});

test.describe("Zooms to data", () => {
	const [lng, lat] = [25, 62];
	let zoom: number;

	test.describe.configure({ mode: "serial" });

	test("when using openStreetMap", async ({page}) => {
		const map = await createMap(page, {
			tileLayerName: "openStreetMap",
			zoomToData: true,
			data: {geoData: {type: "Point", coordinates: [lng, lat]}}
		});

		const center = await map.e("map.getCenter()") as any;
		zoom = await map.e("getNormalizedZoom()");
		expect(center.lat).toBeCloseTo(lat);
		expect(center.lng).toBeCloseTo(lng);
	});

	test("when using taustakartta", async ({page}) => {
		const map = await createMap(page, {
			tileLayerName: "taustakartta",
			zoomToData: true,
			data: {geoData: {type: "Point", coordinates: [lng, lat]}}
		});

		const center = await map.e("map.getCenter()") as any;
		expect(center.lat).toBeCloseTo(lat);
		expect(center.lng).toBeCloseTo(lng);

		// Test that zoom is kept the same as with openStreetMap in prev test.
		expect(await map.e("getNormalizedZoom()")).toBeCloseTo(zoom);
	});

	test.describe("correct when data, draw and lineTransect given", () => {
		let [north, east] = [63, 25];
		const [minNorth, minEast] = [north, east];
		const travel = new LatLngTraveller(north, east, {onlyForward: true});
		const data = {geoData: {type: "Point", coordinates: [east, north]}};
		const draw = {geoData: {type: "Point", coordinates: travel.northEast(0.005, 0.005)}};
		const lineTransect = {
			feature: {
				type: "Feature",
				properties: {},
				geometry: {
					type: "LineString",
					coordinates: [
						travel.northEast(0.005, 0.005),
						travel.northEast(0.005, 0.005)
					]
				}
			}
		};
		const options = {
			zoomToData: true,
			draw,
			data,
			lineTransect
		};

		test("when using openStreetMap", async ({page}) => {
			const map = await createMap(page, {
				tileLayerName: "openStreetMap",
				...options
			});

			const bounds = await map.e("map.getBounds()") as any;
			expect(bounds._northEast.lat).toBeGreaterThan(minNorth - 0.01); // 0.01 for Firefox inaccuracy
			expect(bounds._southWest.lat).toBeLessThan(minNorth);
			expect(bounds._northEast.lat).toBeGreaterThan(north - 0.01); // 0.01 for Firefox inaccuracy
			expect(bounds._southWest.lat).toBeLessThan(north);
			expect(bounds._northEast.lng).toBeGreaterThan(minEast);
			expect(bounds._southWest.lng).toBeLessThan(minEast);
			expect(bounds._northEast.lng).toBeGreaterThan(east);
			expect(bounds._southWest.lng).toBeLessThan(east);
		});

		test("when using taustakartta", async ({page}) => {
			const map = await createMap(page, {
				tileLayerName: "taustakartta",
				...options
			});

			const bounds = await map.e("map.getBounds()") as any;
			expect(bounds._northEast.lat).toBeGreaterThan(minNorth - 0.01); // 0.01 for Firefox inaccuracy
			expect(bounds._southWest.lat).toBeLessThan(minNorth);
			expect(bounds._northEast.lat).toBeGreaterThan(north - 0.01); // 0.01 for Firefox inaccuracy
			expect(bounds._southWest.lat).toBeLessThan(north);
			expect(bounds._northEast.lng).toBeGreaterThan(minEast);
			expect(bounds._southWest.lng).toBeLessThan(minEast);
			expect(bounds._northEast.lng).toBeGreaterThan(east);
			expect(bounds._southWest.lng).toBeLessThan(east);
		});
	});
});

test("Falls back to center when no data and zoomToData given", async ({page}) => {
	const latLng = {lat: 25, lng: 60};
	const options = {
		center: latLng,
		zoomToData: true,
		data: {type: "FeatureCollection", features: []}
	};

	const map = await createMap(page, {
		...options
	});

	const center = await map.e("map.getCenter()") as any;
	expect(center.lat).toBe(latLng.lat);
	expect(center.lng).toBe(latLng.lng);
});

test("Falls back to center when no zoomToData given", async ({page}) => {
	const latLng = {lat: 25, lng: 60};
	const options = {
		center: latLng,
		data: {geoData: {type: "Point", coordinates: [45, 70]}}
	};

	const map = await createMap(page, {
		...options
	});

	const center = await map.e("map.getCenter()") as any;
	expect(center.lat).toBe(latLng.lat);
	expect(center.lng).toBe(latLng.lng);
});

test("keeps finnish tileLayer if center is outside Finland but zoomToData causes view to initialize into Finland", async ({page}) => {
	const congo =  {
		lat: 79.3499057749654,
		lng: 21.160612106323246
	};
	const data = {geoData: {type: "Point", coordinates: [25, 60]}};
	const map = await createMap(page, {tileLayerName: "taustakartta", zoom: 4, center: congo, data, zoomToData: true});
	expect(await map.e("tileLayerName")).toBe("taustakartta");
});
