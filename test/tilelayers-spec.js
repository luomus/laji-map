const { createMap } = require("./test-utils");
const translations = require("../lib/translations");

let map;
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

describe("Tile layers control", () => {

	let control;
	beforeAll(async () => {
		control = map.getTileLayersControl();
	});

	it("is rendered", async () => {
		map = await createMap({controls: true});
		expect(await control.$getContainer().isPresent()).toBe(true);
	});

	it("opens on click", async () => {
		map = await createMap({controls: true});
		expect(await control.$getFinnishList().isDisplayed()).toBe(false);
		await control.$getButton().click();
		expect(await control.$getFinnishList().isDisplayed()).toBe(true);
	});

	const tests = {
		"doesn't render finnish layers when not available": {
			options: {
				tileLayerName: "openStreetMap",
				availableTileLayerNamesWhitelist: ["openStreetMap"]
			},
			test: async () => {
				await control.$getButton().click();
				expect(await control.$getWorldList().isPresent()).toBe(true);
				expect(await control.$getWorldList().$("legend").isPresent()).toBe(true);
				expect(await control.$getWorldList().$("legend").getText()).toBe(await map.e("translations.Maps"));
				expect(await control.$getFinnishList().isPresent()).toBe(false);
			}
		},
		"doesn't render world layers when not available": {
			options: {
				tileLayerName: "taustakartta",
				availableTileLayerNamesWhitelist: ["taustakartta"]
			},
			test: async () => {
				await control.$getButton().click();
				expect(await control.$getFinnishList().isPresent()).toBe(true);
				expect(await control.$getFinnishList().$("legend").getText()).toBe(await map.e("translations.Maps"));
				expect(await control.$getWorldList().isPresent()).toBe(false);
			}
		},
		"doesn't render overlays when not available": {
			options: {
				availableOverlayNameWhitelist: []
			},
			test: async () => {
				await control.$getButton().click();
				expect(await control.$getOverlayList().isPresent()).toBe(false);
			}
		}
	};

	for (const name of Object.keys(tests)) {
		let {options, test} = tests[name];

		options = {
			controls: true,
			...options
		};

		it(`${name} after initialization`, async () => {
			map = await createMap(options);
			await test();
		});

		it(`${name} when set after initialization`, async () => {
			map = await createMap({controls: true});
			await map.e(`setOptions(${JSON.stringify(options)})`);
			await test();
		});
	}

	it("adds layer when added to options after control initialization", async () => {
		map = await createMap({controls: true, availableTileLayerNamesBlacklist: ["maastokartta"]});
		await control.$getButton().click();
		expect(await (await control.$getLayerElement("maastokartta")).isDisplayed()).toBe(false);
		await map.e("setOption('availableTileLayerNamesBlacklist', [])");
		await expect(await (await control.$getLayerElement("maastokartta")).isDisplayed()).toBe(true);
	});

	it("removes layer when removed from options after control initialization", async () => {
		map = await createMap({controls: true, availableTileLayerNamesBlacklist: []});
		await control.$getButton().click();
		expect(await (await control.$getLayerElement("maastokartta")).isDisplayed()).toBe(true);
		await map.e("setOption('availableTileLayerNamesBlacklist', ['maastokartta'])");
		expect(await (await control.$getLayerElement("maastokartta")).isDisplayed()).toBe(false);
	});
});
