const { HOST = "localhost", PORT = 4000, VERBOSE, DELAY } = process.env;
import { Page } from "@playwright/test";
import * as utils from "@luomus/laji-map/lib/utils";
import { Options } from "@luomus/laji-map/lib/map.defs";
import G from "geojson";

const joinParams = (params: Record<string, unknown>) =>
	Object.keys(params).reduce((s, a, i) => `${s}${i === 0 ? "?" : "&"}${a}=${JSON.stringify(params[a])}`, "");

const navigateToMap = async (page: Page, params = {}) => {
	const url = `http://${HOST}:${PORT}${joinParams({testMode: true, ...params})}`;
	VERBOSE && console.log(url);
	await page.goto(url);
};

function getControlButton(page: Page, name: string) {
	return page.locator(`.button-${name.replace(/\./g, "_")}`);
}

export class MapPageObject {
	private page: Page;
	options: Options;

	constructor(page: Page, options = {}) {
		this.page = page;
		this.options = options;
	}

	async initialize() {
		// await this.page.route("**/*.{png,jpg,jpeg}", route => route.abort()); // Don't load tilelayers, should speed up?
		await navigateToMap(this.page, this.options);
		if (DELAY) {
			await this.page.waitForTimeout(parseInt(DELAY));
		}
	}

	e<T = any>(path: string, ...params: any[]) {
		return this.page.evaluate<T>(`window.map.${path}`, ...params);
	}

	$getElement() {
		return this.page.locator(".laji-map");
	}

	/** Moves mouse on page relative to the center of the viewport **/
	mouseMove(x: number, y: number) {
		return this.page.mouse.move(...this.relativeToCenter(x, y));
	}

	private relativeToCenter(x: number, y: number): [number, number] {
		const size = this.page.viewportSize();
		if (!size) {
			throw new Error("Couldn't get viewport");
		}
		const relativeX = size.width / 2 + x;
		const relativeY = size.height / 2 + y;
		return [relativeX, relativeY];
	}

	/** Clicks at a point on page relative to the center of the viewport **/
	async clickAt(x: number, y: number) {
		await this.mouseMove(x, y);
		return this.page.mouse.click(...this.relativeToCenter(x, y));
	}

	/** Double clicks at a point on page relative to the center of the viewport **/
	async doubleClickAt(x: number, y: number) {
		// await this.mouseMove(x, y);
		await this.page.mouse.click(...this.relativeToCenter(x, y));
		// return this.page.mouse.click(...this.relativeToCenter(x, y));
		return this.page.mouse.dblclick(...this.relativeToCenter(x, y));
		// await this.mouseMove(x, y);
		// await browser.sleep(500);
		// return browser.actions()
		// 	.doubleClick().perform();
	}

	async drag([x, y], [x2, y2]) {
		await this.mouseMove(x, y);
		await this.page.mouse.down();
		await this.mouseMove(x2, y2);
		await this.page.mouse.up();
	}

	async drawMarker(x = 0, y = 0) {
		await this.getDrawControl().$getMarkerButton().click();
		await this.clickAt(x, y);
	}

	async drawLine(...lineCoordinates: [number, number][]) {
		await this.getDrawControl().$getPolylineButton().click();
		for (const coordinates of lineCoordinates) {
			await this.clickAt(...coordinates);
			await this.page.waitForTimeout(SAFE_CLICK_WAIT);
		}
		await this.clickAt(...lineCoordinates[lineCoordinates.length - 1]);
		return this.page.mouse.move(1, 1);
	}

	async drawRectangle() {
		await this.getDrawControl().$getRectangleButton().click();
		await this.drag([0, 0], [10, 10]);
	}

	async drawPolygon(...polyCoordinates: [number, number][]) {
		await this.getDrawControl().$getPolygonButton().click();
		for (const coordinates of polyCoordinates) {
			await this.clickAt(...coordinates);
			await this.page.waitForTimeout(SAFE_CLICK_WAIT);
		}
		await this.clickAt(...polyCoordinates[0]);
	}

	getDrawData = () => this.e<G.FeatureCollection>("getDraw().featureCollection");

	getCoordinateInputControl() { return new CoordinateInputControlPageObject(this.page); }
	getCoordinateUploadControl() { return new CoordinateUploadControlPageObject(this.page); }
	getCoordinateCopyControl() { return new CoordinateCopyControlPageObject(this.page); }
	getDrawControl() { return new DrawControlPageObject(this.page); }
	getTileLayersControl() { return new TilelayersControlPageObject(this.page); }
	getDeleteControl() { return new DeleteControl(this.page); }

	$getEditableMarkers() {
		return this.page.locator(".leaflet-marker-draggable");
	}

}

export class DeleteControl {
	page: Page
	constructor(page: Page) {
		this.page = page;
	}

	start() {
		return (getControlButton(this.page, "drawUtils.delete"))?.click();
	}

	isOpen() {
		return getControlButton(this.page, "drawUtils.delete").locator(".glyphicon-remove-sign").isVisible();
	}

	finish() {
		return this.page.locator(".leaflet-draw-actions a").last().click();
	}
}

export class CoordinateInputControlPageObject {
	private page: Page
	constructor(page: Page) {
		this.page = page;
	}

	$getButton() {
		return getControlButton(this.page, "drawUtils.coordinateInput");
	}
	$getContainer() {
		return this.page.locator(".laji-map-coordinates").locator("xpath=..");
	}
	$getCloseButton() {
		return this.$getContainer().locator(".close");
	}
	async enterLatLng(lat: number, lng: number) {
		await this.page.locator("#laji-map-coordinate-input-lat").type("" +lat);
		return this.page.locator("#laji-map-coordinate-input-lng").type("" + lng);
	}
	async getCRS() {
		return this.$getContainer().locator(".crs-info span").last().textContent();
	}
	$getSubmit() {
		return this.$getContainer().locator("button[type=\"submit\"]");
	}
}

export class CoordinateUploadControlPageObject {
	private page: Page
	constructor(page: Page) {
		this.page = page;
	}

	$getButton() {
		return getControlButton(this.page, "drawUtils.upload");
	}
	$getContainer() {
		return this.page.locator(".laji-map-coordinate-upload").locator("xpath=..");
	}
	$getCloseButton() {
		return this.$getContainer().locator(".close");
	}
	type(text: string) {
		return this.$getContainer().locator("textarea").type(text);
	}
	getCRS() {
		return this.$getContainer().locator(".crs-info span").last().textContent();
	}
	getFormat() {
		return this.$getContainer().locator(".format-info span").last().textContent();
	}
	$getSubmit() {
		return this.$getContainer().locator("button[type=\"submit\"]");
	}
}

export class CoordinateCopyControlPageObject {
	private page: Page
	constructor(page: Page) {
		this.page = page;
	}

	$getButton() {
		return getControlButton(this.page, "drawUtils.copy");
	}
	$getContainer() {
		return this.page.locator(".laji-map-draw-copy-table").locator("xpath=..");
	}
	$getCloseButton() {
		return this.$getContainer().locator(".close");
	}
	getConverted() {
		return this.$getContainer().locator("textarea").inputValue();
	}
	GeoJSON() {
		return this.$getContainer().locator("text=GeoJSON").click();
	}
	ISO6709() {
		return this.$getContainer().locator("text=ISO 6709").click();
	}
	WKT() {
		return this.$getContainer().locator("text=WKT").click();
	}
	WGS84() {
		return this.$getContainer().locator("text=WGS84").click();
	}
	YKJ() {
		return this.$getContainer().locator("text=YKJ").click();
	}
	ETRS() {
		return this.$getContainer().locator("text=ETRS-TM35FIN").click();
	}
}

export class DrawControlPageObject {
	private page: Page;
	constructor(page: Page) {
		this.page = page;
	}

	$getButton(name: string) {
		return this.page.locator(`.leaflet-draw-draw-${name}`);
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

export class TilelayersControlPageObject {
	page: Page;

	constructor(page: Page) {
		this.page = page;
	}
	$getContainer() {
		return this.page.locator("div.laji-map-control-layers");
	}
	$getButton() {
		return this.page.locator(".leaflet-control-layers-toggle");
	}
	async showList() {
		const {x, y} = (await this.$getButton().boundingBox() as any);
		return this.page.mouse.move(x, y);
	}
	$getFinnishList() {
		return this.$getContainer().locator(".finnish-list");
	}
	$getWorldList() {
		return this.$getContainer().locator(".world-list");
	}
	selectFinnishList() {
		return this.$getFinnishList().locator("legend").click();
	}
	selectWorldList() {
		return this.$getWorldList().locator("legend").click();
	}
	$getOverlayList() {
		return this.$getContainer().locator(".overlay-list");
	}
	$getLayerElement(name: string) {
		return this.$getContainer().locator(`#${name}`);
	}
}

export const createMap = async (page: Page, options?: any) => {
	const map = new MapPageObject(page, options);
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
