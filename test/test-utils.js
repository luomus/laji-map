const {HOST, PORT, VERBOSE, DELAY} = process.env;

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

	async e(path, ...params) {
		return await browser.executeScript(`return window.map.${path}`, ...params);
	}

	getCoordinateControl() {return new CoordinateControlPageObject()};

}
class CoordinateControlPageObject {
	$getButton() {
		return getControlButton("drawUtils.coordinateInput");
	}
	$getContainer() {
		return $(".laji-map-coordinates").element(by.xpath(".."));
	}
	$getCloseButton() {
		return this.$getContainer().$(".close");
	}
	$getLatInput() {
		return $("#laji-map-coordinate-input-lat");
	}
	$getLngInput() {
		return $("#laji-map-coordinate-input-lng");
	}
	$getSubmit() {
		return this.getContainer().$("button[type=\"submit\"]");
	}
}

const createMap = async options => {
	const map = new MapPageObject(options);
	await map.initialize();
	return map;
};

module.exports = {
	createMap
}
