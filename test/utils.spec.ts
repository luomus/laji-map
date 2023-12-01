import { test, expect } from "@playwright/test";
import * as utils from "@luomus/laji-map/lib/utils";

test.describe("convertLatLlng()", () => {
	test("convert ykj to wgs84 correct", () => {
		expect(utils.convertLatLng([6666666, 3333333], "EPSG:2393", "WGS84")).toEqual([60.077881, 24.002372]);
	});
});
