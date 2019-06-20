const { createMap } = require("./test-utils");


// Internal logic tested because the later tests rely heavily on it.
describe("Internal logic of zoom level normalization", () => {
	it("uses the real zoom level for Finnish layer", async () => {
		map = await createMap({tileLayerName: "taustakartta", zoom: 0});
		await expect(await map.e("map.getZoom()")).toBe(0);
		await expect(await map.e("getNormalizedZoom()")).toBe(0);
	});

	it("uses offset of 3 for world map layer", async () => {
		map = await createMap({tileLayerName: "openStreetMap", zoom: 0});
		await expect(await map.e("map.getZoom()")).toBe(3);
		await expect(await map.e("getNormalizedZoom()")).toBe(0);
	});

	it("getNormalizedZoom() returns updated zoom after changing zoom", async () => {
		map = await createMap({tileLayerName: "taustakartta", zoom: 0});
		await map.e("setNormalizedZoom(2)")
		await expect(await map.e("getNormalizedZoom()")).toBe(2);
	});
	it("getNormalizedZoom() returns updated zoom after changing projection", async () => {
		map = await createMap({tileLayerName: "taustakartta", zoom: 0});
		await map.e("setTileLayerByName(\"openStreetMap\")")
		await expect(await map.e("getNormalizedZoom()")).toBe(0);
	});
});

describe("Initializing", () => {
	describe("default view", () => {

		let map = undefined;
		beforeAll(async () => {
			map = await createMap();
		});

		it("opens with taustakartta", async () => {
			await expect(await map.e("tileLayerName")).toBe("taustakartta");
		});

		it("opens with zoom level 2", async () => {
			await expect(await map.e("getNormalizedZoom()")).toBe(2);
		});
	});

	describe("world map (openStreetMap)", () => {

		let map = undefined;
		beforeAll(async () => {
			map = await createMap({tileLayerName: "openStreetMap"});
		});

		it("opens with openStreetMap", async () => {
			await expect(await map.e("tileLayerName")).toBe("openStreetMap");
		});

		it("opens with zoom level 2", async () => {
			await expect(await map.e("getNormalizedZoom()")).toBe(2);
		});
	});

	it("with location outside Finland using Finnish tilelayer, zoom stays the same after swapping to world map view", async () => {
		const congo =  {
			"lat": 79.3499057749654,
			"lng": 21.160612106323246
		};
		const map = await createMap({tileLayerName: "taustakartta", zoom: 4, center: congo});
		await expect(await map.e("getNormalizedZoom()")).toBe(4);
	});

	it("openStreetMap can have negative zoom level", async () => {
		const map = await createMap({tileLayerName: "openStreetMap", zoom: -3});
		await expect(await map.e("getNormalizedZoom()")).toBe(-3);
	});

	it("taustakartta is zoomed to it's minimum (0) with negative value", async () => {
		const map = await createMap({tileLayerName: "taustakartta", zoom: -3});
		await expect(await map.e("getNormalizedZoom()")).toBe(0);
	});
});

describe("Zooms to data", () => {
	const [lng, lat] = [25, 62];
	let zoom;

	it("when using openStreetMap", async () => {
		const map = await createMap({
			tileLayerName: "openStreetMap",
			zoomToData: true,
			data: {geoData: {type: "Point", coordinates: [lng, lat]}}
		});

		const center = await map.e("map.getCenter()");
		zoom = await map.e("getNormalizedZoom()");
		await expect(center.lat).toBeCloseTo(lat);
		await expect(center.lng).toBeCloseTo(lng);
	});

	it("when using taustakartta", async () => {
		const map = await createMap({
			tileLayerName: "taustakartta",
			zoomToData: true,
			data: {geoData: {type: "Point", coordinates: [lng, lat]}}
		});

		const center = await map.e("map.getCenter()");
		await expect(center.lat).toBeCloseTo(lat);
		await expect(center.lng).toBeCloseTo(lng);

		// Test that zoom is kept the same as with openStreetMap in prev test
		await expect(await map.e("getNormalizedZoom()")).toBeCloseTo(zoom);
	});

	describe("correct when data, draw and lineTransect given", () => {
		let [north, east] = [63, 25];
		const [minNorth, minEast] = [north, east];
		const travelNorth = (val) => {
			if (val < 0) throw "Travel only positive amounts in order to keep minNorth really min";
			north = north + val;
			return north;
		};
		const travelEast = (val) => {
			if (val < 0) throw "Travel only positive amounts in order to keep minEast really min";
			east = east + val;
			return east;
		};
		const data = {geoData: {type: "Point", coordinates: [east, north]}};
		const draw = {geoData: {type: "Point", coordinates: [travelEast(0.005), travelNorth(0.005)]}};
		const lineTransect = {
			feature: {
				type: "Feature",
				properties: {},
				geometry: {
					type: "LineString",
					coordinates: [
						[travelEast(0.005), travelNorth(0.005)],
						[travelEast(0.005), travelNorth(0.005)]
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

		it("when using openStreetMap", async () => {
			const map = await createMap({
				tileLayerName: "openStreetMap",
				...options
			});


			const bounds = await map.e("map.getBounds()");
			await expect(bounds._northEast.lat).toBeGreaterThan(minNorth);
			await expect(bounds._southWest.lat).toBeLessThan(minNorth);
			await expect(bounds._northEast.lat).toBeGreaterThan(north);
			await expect(bounds._southWest.lat).toBeLessThan(north);
			await expect(bounds._northEast.lng).toBeGreaterThan(minEast);
			await expect(bounds._southWest.lng).toBeLessThan(minEast);
			await expect(bounds._northEast.lng).toBeGreaterThan(east);
			await expect(bounds._southWest.lng).toBeLessThan(east);
		});

		it("when using taustakartta", async () => {
			const map = await createMap({
				tileLayerName: "taustakartta",
				...options
			});

			const bounds = await map.e("map.getBounds()");
			await expect(bounds._northEast.lat).toBeGreaterThan(minNorth);
			await expect(bounds._southWest.lat).toBeLessThan(minNorth);
			await expect(bounds._northEast.lat).toBeGreaterThan(north);
			await expect(bounds._southWest.lat).toBeLessThan(north);
			await expect(bounds._northEast.lng).toBeGreaterThan(minEast);
			await expect(bounds._southWest.lng).toBeLessThan(minEast);
			await expect(bounds._northEast.lng).toBeGreaterThan(east);
			await expect(bounds._southWest.lng).toBeLessThan(east);
		});
	});
});

