import { test, expect } from "@playwright/test";
import { TileLayerName } from "../lib/map.defs";
import { MapPageObject, navigateToMapPage } from "./test-utils";

test.describe("Initializing", () => {
	test("tileLayers overrides tileLayerName", async ({page}) => {
		const map = await navigateToMapPage(page, {
			tileLayerName: TileLayerName.ortokuva,
			tileLayers: {
				layers: {
					maastokartta: true
				}
			}
		});

		expect(await map.e("tileLayerName")).toBe("maastokartta");
	});

	test("with tileLayerName work", async ({page}) => {
		const map = await navigateToMapPage(page, {
			tileLayerName: TileLayerName.maastokartta,
		});

		expect(await map.e("tileLayerName")).toBe("maastokartta");
	});

	test("with finnish tilelayer and view outside Finland swaps to world map", async ({page}) => {
		const congo =  {
			lat: 79.3499057749654,
			lng: 21.160612106323246
		};

		const map = await navigateToMapPage(page, {
			tileLayerName: TileLayerName.taustakartta,
			center: congo
		});

		expect(await map.e("tileLayerName")).toBe("openStreetMap");
	});
});

test.describe("Tile layers control", () => {

	test("is rendered", async ({page}) => {
		const map = await navigateToMapPage(page, {controls: true});
		await expect(map.controls.layer.$container).toBeVisible();
	});

	test("opens on click", async ({page}) => {
		const map = await navigateToMapPage(page, {controls: true});
		const control = map.controls.layer;
		await expect(control.$finnishList).not.toBeVisible();
		await control.showList();
		await expect(control.$finnishList).toBeVisible();
	});

	const tests = {
		"doesn't render finnish layers when not available": {
			options: {
				tileLayerName: "openStreetMap",
				availableTileLayerNamesWhitelist: ["openStreetMap"]
			},
			testCase: async (map: MapPageObject) => {
				const control = map.controls.layer;
				await control.showList();
				await expect(control.$worldList).toBeVisible();
				await expect(control.$worldList.locator("legend")).toBeVisible();
				expect(await control.$worldList.locator("legend").textContent()).toBe(await map.e("translations.Maps"));
				await expect(control.$finnishList).not.toBeVisible();
			}
		},
		"doesn't render world layers when not available": {
			options: {
				tileLayerName: "taustakartta",
				availableTileLayerNamesWhitelist: ["taustakartta"]
			},
			testCase: async (map: MapPageObject) => {
				const control = map.controls.layer;
				await control.showList();
				await expect(control.$finnishList).toBeVisible();
				expect(await control.$finnishList.locator("legend").textContent()).toBe(await map.e("translations.Maps"));
				await expect(control.$worldList).not.toBeVisible();
			}
		},
		"doesn't render overlays when not available": {
			options: {
				availableOverlayNameWhitelist: []
			},
			testCase: async (map: MapPageObject) => {
				const control = map.controls.layer;
				await control.showList();
				await expect(control.$overlayList).not.toBeVisible();
			}
		}
	};

	for (const name of Object.keys(tests)) {
		let {options, testCase} = tests[name];

		options = {
			controls: true,
			...options
		};

		test(`${name} after initialization`, async ({page}) => {
			const map = await navigateToMapPage(page, options);
			await testCase(map);
		});

		test(`${name} when set after initialization`, async ({page}) => {
			const map = await navigateToMapPage(page, {controls: true});
			await map.e(`setOptions(${JSON.stringify(options)})`);
			await testCase(map);
		});
	}

	test("adds layer when added to options after control initialization", async ({page}) => {
		const map = await navigateToMapPage(page, {controls: true, availableTileLayerNamesBlacklist: ["maastokartta"]});
		const control = map.controls.layer;
		await control.showList();
		await expect(control.$getLayerElement("maastokartta")).not.toBeVisible();
		await map.e("setOption('availableTileLayerNamesBlacklist', [])");
		await expect(control.$getLayerElement("maastokartta")).toBeVisible();
	});

	test("removes layer when removed from options after control initialization", async ({page}) => {
		const map = await navigateToMapPage(page, {controls: true, availableTileLayerNamesBlacklist: []});
		const control = map.controls.layer;
		await control.showList();
		await expect(control.$getLayerElement("maastokartta")).toBeVisible();
		await map.e("setOption('availableTileLayerNamesBlacklist', ['maastokartta'])");
		await expect(control.$getLayerElement("maastokartta")).not.toBeVisible();
	});

	test("Sets openStreetMap as active when changing to world projection and there are no visible world layers", async ({page}) => {
		const map = await navigateToMapPage(page, {controls: true, tileLayerName: "taustakartta"});
		const control = map.controls.layer;
		await control.showList();
		await control.selectWorldList();
		const layerOptions = await map.e("getTileLayers()");
		expect(layerOptions.layers.openStreetMap.visible).toBe(true);
	});

	test("Sets taustakartta as active when changing to finnish projection and there are no visible finnish layers", async ({page}) => {
		const map = await navigateToMapPage(page, {controls: true, tileLayerName: "openStreetMap"});
		const control = map.controls.layer;
		await control.showList();
		await control.selectFinnishList();
		const layerOptions = await map.e("getTileLayers()");
		expect(layerOptions.layers.taustakartta.visible).toBe(true);
	});
});
