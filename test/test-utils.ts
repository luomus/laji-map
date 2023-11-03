const {HOST, PORT, VERBOSE, DELAY} = process.env;
import { browser, $, $$, by } from "protractor";
import * as utils from "@luomus/laji-map/lib/utils";
import { Options } from "@luomus/laji-map/lib/map.defs";
import G from "geojson";

const joinParams = (params: Record<string, unknown>) =>
	Object.keys(params).reduce((s, a, i) => `${s}${i === 0 ? "?" : "&"}${a}=${JSON.stringify(params[a])}`, "");
const navigateToMap = async (params = {}) => {
	const url = `http://${HOST}:${PORT}${joinParams({testMode: true, ...params})}`;
	VERBOSE && console.log(url);
	await browser.get(url);
};

function getControlButton(name: string) {
	return $(`.button-${name.replace(/\./g, "_")}`);
}

export class MapPageObject {
	options: Options;

	constructor(options = {}) {
		this.options = options;
	}

	async initialize() {
		await navigateToMap(this.options);
		if (DELAY) {
			await browser.sleep(parseInt(DELAY));
		}
	}

	e<T>(path: string, ...params: any[]): Promise<T> {
		return browser.executeScript(`return window.map.${path}`, ...params) as Promise<T>;
	}

	$getElement() {
		return $(".laji-map");
	}

	mouseMove(x: number, y: number) {
		return browser.actions()
			.mouseMove(this.$getElement().getWebElement(), {x: x + 1, y})
			.mouseMove(this.$getElement().getWebElement(), {x, y})
			.perform();
	}

	async clickAt(x: number, y: number) {
		await this.mouseMove(x, y);
		return browser.actions()
			.click().perform();
	}

	async doubleClickAt(x: number, y: number) {
		await this.mouseMove(x, y);
		await browser.sleep(500);
		return browser.actions()
			.doubleClick().perform();
	}

	async drag([x, y], [x2, y2]) {
		await this.mouseMove(x, y);
		await browser.actions()
			.mouseDown()
			.perform();
		await this.mouseMove(x2, y2);
		return browser.actions()
			.mouseUp()
			.perform();
	}

	async drawMarker(x = 0, y = 0) {
		await this.getDrawControl().$getMarkerButton().click();
		await this.clickAt(x, y);
	}

	async drawRectangle() {
		await this.getDrawControl().$getRectangleButton().click();
		await this.drag([0, 0], [10, 10]);
	}

	getDrawData = () => this.e<G.FeatureCollection>("getDraw().featureCollection");

	getCoordinateInputControl() { return new CoordinateInputControlPageObject(); }
	getCoordinateUploadControl() { return new CoordinateUploadControlPageObject(); }
	getCoordinateCopyControl() { return new CoordinateCopyControlPageObject(); }
	getDrawControl() { return new DrawControlPageObject(); }
	getTileLayersControl() { return new TilelayersControlPageObject(this); }
	getDeleteControl() { return new DeleteControl(); }

}

export class DeleteControl {
	start() {
		return getControlButton("drawUtils.delete").click();
	}
	finish() {
		return $$(".leaflet-draw-actions a").last().click();
	}
}

class CoordinateInputControlPageObject {
	$getButton() {
		return getControlButton("drawUtils.coordinateInput");
	}
	$getContainer() {
		return $(".laji-map-coordinates").element(by.xpath("..")); // eslint-disable-line protractor/no-by-xpath
	}
	$getCloseButton() {
		return this.$getContainer().$(".close");
	}
	async enterLatLng(lat: number, lng: number) {
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
		return $(".laji-map-coordinate-upload").element(by.xpath("..")); // eslint-disable-line protractor/no-by-xpath
	}
	$getCloseButton() {
		return this.$getContainer().$(".close");
	}
	type(text: string) {
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
		return $(".laji-map-draw-copy-table").element(by.xpath("..")); // eslint-disable-line protractor/no-by-xpath
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

export class DrawControlPageObject {
	$getButton(name: string) {
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
	mapPO: MapPageObject;

	constructor(mapPO: MapPageObject) {
		this.mapPO = mapPO;
	}
	$getContainer() {
		return $("div.laji-map-control-layers");
	}
	$getButton() {
		return $(".leaflet-control-layers-toggle");
	}
	showList() {
		return browser.actions().mouseMove(this.$getButton()).perform();
	}
	$getFinnishList() {
		return this.$getContainer().$(".finnish-list");
	}
	$getWorldList() {
		return this.$getContainer().$(".world-list");
	}
	selectFinnishList() {
		return this.$getFinnishList().$("legend").click();
	}
	selectWorldList() {
		return this.$getWorldList().$("legend").click();
	}
	$getOverlayList() {
		return this.$getContainer().$(".overlay-list");
	}
	$getLayerElement(name: string) {
		return this.$getContainer().$(`#${name}`);
	}
}

export const createMap = async (options?: any) => {
	const map = new MapPageObject(options);
	await map.initialize();
	return map;
};

export const ykjToWgs84 = (latLng: [number, number]) => utils.convertLatLng(latLng, "EPSG:2393", "WGS84");
export const etrsToWgs84 = (latLng: [number, number]) => utils.convertLatLng(
	latLng,
	"+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", "WGS84"
);

export class PointTraveller {
	x: number;
	y: number;
	initX: number;
	initY: number;

	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
		this.initX = x;
		this.initY = y;
	}

	travel(xAmount: number, yAmount: number) {
		this.x = this._x(this.x, yAmount);
		this.y = this._y(this.y, xAmount);
		return this.return(this.x, this.y);
	}

	initial() {
		return this.return(this.initX, this.initY);
	}

	protected return(x: number, y: number): [number, number] {
		return [x, y];
	}

	protected _x(curVal: number, amount: number) { return curVal + amount; }
	protected _y(curVal: number, amount: number) { return curVal + amount; }
}

interface LatLngTravellerOptions {
		onlyForward?: boolean;
}

export class LatLngTraveller extends PointTraveller {
	options: LatLngTravellerOptions;
	onlyForward: boolean;

	constructor(lat: number, lng: number, options: LatLngTravellerOptions = {}) {
		super(lng, lat);
		if (options.onlyForward) {
			this.onlyForward = true;
		}
	}

	_y(curVal: number, amount: number) {
		if (this.onlyForward && amount < 0) throw "Can travel only positive amounts if 'onlyForward' true";
		return super._y(curVal, -amount);
	}

	_x(curVal: number, amount: number) {
		if (this.onlyForward && amount < 0) throw "Can travel only positive amounts if 'onlyForward' true";
		return super._x(curVal, amount);
	}

	northEast(north: number, east: number) {
		return this.travel(east, north);
	}

	return(x: number, y: number): [number, number] {
		return [y, x];
	}
}

export const SAFE_CLICK_WAIT = 300;
