const {HOST, PORT, VERBOSE, DELAY} = process.env;

const joinParams = params => Object.keys(params).reduce((s, a, i) => `${s}${i === 0 ? "?" : "&"}${a}=${JSON.stringify(params[a])}`, "");
const navigateToMap = async (params = "") => {
	const url =`http://${HOST}:${PORT}${joinParams({testMode: true, ...params})}`
	VERBOSE && console.log(url);
	await browser.get(url);
}

const initializeMap = async options => navigateToMap(options);

class MapObject {
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
}

const createMap = async options => {
	const map = new MapObject(options);
	await map.initialize();
	return map;
};

module.exports = {
	createMap
}
