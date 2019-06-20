const { createMap } = require("./test-utils");

describe("Initializing", () => {
	it("tileLayers overrides tileLayerName", async () => {
		map = await createMap({
			tileLayerName: "ortokuva",
			tileLayers: {
				layers: {
					"maastokartta": true
				}
			}
		});

		await expect(await map.e("tileLayerName")).toBe("maastokartta");
	});

	it("with tileLayerName work", async () => {
		map = await createMap({
			tileLayerName: "maastokartta",
		});

		await expect(await map.e("tileLayerName")).toBe("maastokartta");
	});

	it("with finnish tilelayer and view outside Finland swaps to world map", async () => {
		const congo =  {
			"lat": 79.3499057749654,
			"lng": 21.160612106323246
		};

		map = await createMap({
			tileLayerName: "taustakartta",
			center: congo
		});

		await expect(await map.e("tileLayerName")).toBe("openStreetMap");
	});
});

