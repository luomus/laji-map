const {HOST, PORT, VERBOSE, DELAY} = process.env;
const proj4 = require("proj4");
const utils = require("../lib/utils");

const joinParams = params => Object.keys(params).reduce((s, a, i) => `${s}${i === 0 ? "?" : "&"}${a}=${JSON.stringify(params[a])}`, "");
const navigateToMap = async (params = "") => {
	const url =`http://${HOST}:${PORT}${joinParams({testMode: true, ...params})}`
	VERBOSE && console.log(url);
	await browser.get(url);
}

function getControlButton(name) {
	return $(`.button-${name.replace(/\./g, "_")}`)
}

class MapPageObject {
	constructor(options) {
		this.options = options;
	}

	async initialize() {
		await navigateToMap(this.options);
		if (DELAY) {
			await browser.sleep(parseInt(DELAY));
		}
	}

	e(path, ...params) {
		return browser.executeScript(`return window.map.${path}`, ...params);
	}

	getCoordinateInputControl() {return new CoordinateInputControlPageObject()};
	getCoordinateUploadControl() {return new CoordinateUploadControlPageObject()};
}

class CoordinateInputControlPageObject {
	$getButton() {
		return getControlButton("drawUtils.coordinateInput");
	}
	$getContainer() {
		return $(".laji-map-coordinates").element(by.xpath(".."));
	}
	$getCloseButton() {
		return this.$getContainer().$(".close");
	}
	async enterLatLng(lat, lng) {
		await $("#laji-map-coordinate-input-lat").sendKeys(lat);
		return $("#laji-map-coordinate-input-lng").sendKeys(lng);
	}
	getCRS() {
		return this.$getContainer().$(".crs-info span:last-child").getText();
	}
	$getSubmit() {
		return this.$getContainer().$("button[type=\"submit\"]");
	}
}

class CoordinateUploadControlPageObject {
	$getButton() {
		return getControlButton("drawUtils.upload");
	}
	$getContainer() {
		return $(".laji-map-coordinate-upload").element(by.xpath(".."));
	}
	$getCloseButton() {
		return this.$getContainer().$(".close");
	}
	type(text) {
		return this.$getContainer().$("textarea").sendKeys(text);
	}
	getCRS() {
		return this.$getContainer().$(".crs-info span:last-child").getText();
	}
	getFormat() {
		return this.$getContainer().$(".format-info span:last-child").getText();
	}
	$getSubmit() {
		return this.$getContainer().$("button[type=\"submit\"]");
	}
}

const createMap = async options => {
	const map = new MapPageObject(options);
	await map.initialize();
	return map;
};

const ykjToWgs84 = (lat, lng) => utils.convertLatLng([lat, lng], "EPSG:2393", "WGS84").map(c => +c.toFixed(6));
const etrsToWgs84 = (lat, lng) => utils.convertLatLng([lat, lng], "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", "WGS84").map(c => +c.toFixed(6));

module.exports = {
	createMap,
	ykjToWgs84,
	etrsToWgs84,
}
