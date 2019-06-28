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

describe("Control", () => {

	let control;
	beforeAll(async () => {
		control = map.getTileLayersControl();
	});

	it("is rendered", async () => {
		map = await createMap({controls: true});
		await expect(await control.$getElement().isPresent()).toBe(true);
	});

	it("opens on click", async () => {
		map = await createMap({controls: true});
		await expect(await control.$getFinnishList().isDisplayed()).toBe(false);
		await control.$getButton().click();
		await expect(await control.$getFinnishList().isDisplayed()).toBe(true);
	});

	const tests = {
		"works when no finnish layers": {
			options: {
				tileLayerName: "openStreetMap",
				availableTileLayerNamesWhitelist: ["openStreetMap"]
			},
			test: async () => {
				await control.$getButton().click();
				await expect(await control.$getWorldList().isPresent()).toBe(true);
				await expect(await control.$getWorldList().$("legend").isPresent()).toBe(true);
				await expect(await control.$getWorldList().$("legend").getText()).toBe(await map.e("translations.Maps"));
				await expect(await control.$getFinnishList().isPresent()).toBe(false);
			}
		},
		"works when no world layers": {
			options: {
				tileLayerName: "taustakartta",
				availableTileLayerNamesWhitelist: ["taustakartta"]
			},
			test: async () => {
				await control.$getButton().click();
				await expect(await control.$getFinnishList().isPresent()).toBe(true);
				await expect(await control.$getFinnishList().$("legend").getText()).toBe(await map.e("translations.Maps"));
				await expect(await control.$getWorldList().isPresent()).toBe(false);
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
			map = await createMap();
			await map.e(`setOptions(${JSON.stringify(options)})`);
			await test();
		});
	}
});

