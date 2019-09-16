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

	$getElement() {
		return $(".laji-map");
	}

	mouseMove(x, y) {
		return browser.actions({bridge: true})
			.move({origin: this.$getElement().getWebElement(), x, y})
			.perform();
	}

	async clickAt(x, y) {
		await this.mouseMove(x, y);
		return browser.actions({bridge: true})
			.click().perform();
	}

	async doubleClickAt(x, y) {
		await this.mouseMove(x, y);
		await browser.sleep(500);
		return browser.actions({bridge: true})
			.doubleClick().perform();
	}

	async drag([x, y], [x2, y2]) {
		await this.mouseMove(x, y);
		await browser.actions({bridge: true})
			.press()
			.perform();
		await this.mouseMove(x2, y2);
		return browser.actions({bridge: true})
			.release()
			.perform();
	}

	getCoordinateInputControl() {return new CoordinateInputControlPageObject()};
	getCoordinateUploadControl() {return new CoordinateUploadControlPageObject()};
	getCoordinateCopyControl() {return new CoordinateCopyControlPageObject()};
	getDrawControl() {return new DrawControlPageObject()};
	getTileLayersControl() {return new TilelayersControlPageObject(this)};
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

class CoordinateCopyControlPageObject {
	$getButton() {
		return getControlButton("drawUtils.copy");
	}
	$getContainer() {
		return $(".laji-map-draw-copy-table").element(by.xpath(".."));
	}
	$getCloseButton() {
		return this.$getContainer().$(".close");
	}
	getConverted() {
		return this.$getContainer().$("textarea").getAttribute("value");
	}
	GeoJSON() {
		return this.$getContainer().element(by.cssContainingText("a", "GeoJSON")).click();
	}
	ISO6709() {
		return this.$getContainer().element(by.cssContainingText("a", "ISO 6709")).click();
	}
	WKT() {
		return this.$getContainer().element(by.cssContainingText("a", "WKT")).click();
	}
	WGS84() {
		return this.$getContainer().element(by.cssContainingText("a", "WGS84")).click();
	}
	YKJ() {
		return this.$getContainer().element(by.cssContainingText("a", "YKJ")).click();
	}
	ETRS() {
		return this.$getContainer().element(by.cssContainingText("a", "ETRS-TM35FIN")).click();
	}
}

class DrawControlPageObject {
	$getButton(name) {
		return $(`.leaflet-draw-draw-${name}`);
	}
	$getMarkerButton() {
		return this.$getButton("marker");
	}
	$getPolygonButton() {
		return this.$getButton("polygon");
	}
	$getRectangleButton() {
		return this.$getButton("rectangle");
	}
	$getCircleButton() {
		return this.$getButton("circle");
	}
	$getPolylineButton() {
		return this.$getButton("polyline");
	}
}

class TilelayersControlPageObject {
	constructor(mapPO) {
		this.mapPO = mapPO;
	}
	$getContainer() {
		return $("div.laji-map-control-layers");
	}
	$getButton() {
		return $(".leaflet-control-layers-toggle");
	}
	$getFinnishList() {
		return this.$getContainer().$(".finnish-list");
	}
	$getWorldList() {
		return this.$getContainer().$(".world-list");
	}
	$getOverlayList() {
		return this.$getContainer().$(".overlay-list");
	}
	async $getLayerElement(name) {
		const label = await this.mapPO.e(`translations.${utils.capitalizeFirstLetter(name)}`);
		return this.$getContainer().element(by.cssContainingText("span", label)).element(by.xpath(".."));
	}
}

const createMap = async options => {
	const map = new MapPageObject(options);
	await map.initialize();
	return map;
};

const ykjToWgs84 = (latLng) => utils.convertLatLng(latLng, "EPSG:2393", "WGS84");
const etrsToWgs84 = (latLng) => utils.convertLatLng(latLng, "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", "WGS84");

class PointTraveller {
	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
		this.initX = x;
		this.initY = y;
	}

	travel(xAmount, yAmount) {
		this.x = this._x(this.x, yAmount);
		this.y = this._y(this.y, xAmount);
		return this.return(this.x, this.y);
	}

	return(x, y) {
		return [x, y];
	}

	initial() {
		return this.return(this.initX, this.initY);
	}

	_x(curVal, amount) {return curVal + amount;}
	_y(curVal, amount) {return curVal + amount;}
}

class LatLngTraveller extends PointTraveller {
	constructor(lat, lng, options = {}) {
		super(lng, lat, options);
		if (options.onlyForward) {
			this.onlyForward = true;
		}
	}

	_y(curVal, amount) {
		if (this.onlyForward && amount < 0) throw "Can travel only positive amounts if 'onlyForward' true";
		return super._y(curVal, -amount);
	}

	_x(curVal, amount) {
		if (this.onlyForward && amount < 0) throw "Can travel only positive amounts if 'onlyForward' true";
		return super._x(curVal, amount);
	}

	northEast(north, east) {
		return this.travel(east, north);
	}

	return() {
		return [this.y, this.x];
	}
}

module.exports = {
	createMap,
	ykjToWgs84,
	etrsToWgs84,
	PointTraveller,
	LatLngTraveller
};
