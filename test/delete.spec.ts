import { test, expect } from "@playwright/test";
import { PointTraveller, navigateToMapPage, DemoPageMapPageObject } from "./test-utils";

test.describe.configure({ mode: "serial" });

test.describe("Delete control", () => {

	let map: DemoPageMapPageObject;
	let control: DemoPageMapPageObject["controls"]["delete"];
	const traveller = new PointTraveller();
	const interval = 10;

	test.beforeAll(async ({browser}) => {
		const page = await browser.newPage();
		map = await navigateToMapPage(page, {
			draw: true,
			controls: {
				draw: {
					delete: true
				}
			}
		});
		control = map.controls.delete;

		await map.drawMarker(...traveller.initial());
		await map.drawMarker(...traveller.travel(interval, 0));
		await map.drawMarker(...traveller.travel(interval, 0));
	});

	test("opens", async () => {
		await control.start();
		await expect(control.$finish).toBeVisible();
	});

	test("deletes items", async () => {
		const dataBefore = await map.getDrawData();
		await control.start();

		await map.clickAt(...traveller.travel(-5, 0)); // -5 so that we click more towards the center of the marker - FireFox doesn't like clicking at the very bottom.
		await map.clickAt(...traveller.travel(-interval, 0));

		await control.finish();
		const dataAfter = await map.getDrawData();

		expect(dataAfter.features.length).toBe(dataBefore.features.length - 2);
	});
});
