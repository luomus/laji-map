import { test, expect } from "@playwright/test";
import { PointTraveller, createMap, MapPageObject, DeleteControl } from "./test-utils";

test.describe.configure({ mode: "serial" });

test.describe("Delete control", () => {

	let map: MapPageObject, control: DeleteControl;
	const traveller = new PointTraveller();
	const interval = 10;

	test.beforeAll(async ({browser}) => {
		const page = await browser.newPage();
		map = await createMap(page, {
			draw: true,
			controls: {
				draw: {
					delete: true
				}
			}
		});
		control = map.getDeleteControl();

		await map.drawMarker(...traveller.initial());
		await map.drawMarker(...traveller.travel(interval, 0));
		await map.drawMarker(...traveller.travel(interval, 0));
	});

	test("opens", async () => {
		await control.start();
		expect(await control.isOpen()).toBe(true);
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
