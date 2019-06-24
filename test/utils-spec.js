const utils = require("../lib/utils");

describe("convertLatLlng()", () => {
	it("convert ykj to wgs84 correct", () => {
			expect(utils.convertLatLng([6666666, 3333333], "EPSG:2393", "WGS84")).toEqual([24.002371586293936, 60.07788132554008]);
	});
});
