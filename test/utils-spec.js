const utils = require("../lib/utils");

describe("convertLatLlng()", () => {
	it("convert ykj to wgs84 correct", () => {
			expect(utils.convertLatLng([6666666, 3333333], "EPSG:2393", "WGS84")).toEqual([60.077881, 24.002372]);
		//60.07788303974093
		//24.002383748198636
	});
});