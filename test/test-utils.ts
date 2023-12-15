const { VERBOSE, DELAY } = process.env;
import { Locator, Page } from "@playwright/test";
import * as utils from "@luomus/laji-map/lib/utils";
import { Options } from "@luomus/laji-map/lib/map.defs";
import G from "geojson";

const joinParams = (params: Record<string, unknown>) =>
	Object.keys(params).reduce((s, a, i) => `${s}${i === 0 ? "?" : "&"}${a}=${JSON.stringify(params[a])}`, "");

const navigateToMap = async (page: Page, params = {}) => {
	const url = `/${joinParams({testMode: true, ...params})}`;
	VERBOSE && console.log(url);
	await page.goto(url);
};

function getControlButton(page: Page, name: string) {
	return page.locator(`.button-${name.replace(/\./g, "_")}`);
}

export class MapPageObject {
	constructor(private page: Page, private locator: Locator) { }

	e<T = any>(path: string, ...params: any[]) {
		return this.page.evaluate<T>(`window.map.${path}`, ...params);
	}

	/** Moves mouse on page relative to the center of the viewport **/
	async mouseMove(x: number, y: number) {
		return this.page.mouse.move(...(await this.relativeToCenter(x, y)));
	}

	private async relativeToCenter(x: number, y: number): Promise<[number, number]> {
		const elem = await this.locator.boundingBox();
		// const size = this.page.viewportSize();
		if (!elem) {
			throw new Error("Couldn't get MapPageObject viewport. Did you pass a valid locator?");
		}
		const relativeX = elem.x + elem.width / 2 + x;
		const relativeY = elem.y + elem.height / 2 + y;
		return [relativeX, relativeY];
	}

	/** Clicks at a point on page relative to the center of the map element **/
	async clickAt(x: number, y: number) {
		await this.mouseMove(x, y);
		return this.page.mouse.click(...(await this.relativeToCenter(x, y)));
	}

	/**
	 * Double clicks at a point on page relative to the center of the viewport.
	 *
	 * WARNING: For some reason clicks three times in headless firefox / webkit.
	 * **/
	async doubleClickAt(x: number, y: number) {
		await this.page.mouse.click(...(await this.relativeToCenter(x, y)));
		return this.page.mouse.dblclick(...(await this.relativeToCenter(x, y)));
	}

	async drag([x, y], [x2, y2]) {
		await this.mouseMove(x, y);
		await this.page.mouse.down();
		await this.mouseMove(x2, y2);
		await this.page.mouse.up();
	}

	/** Draws a marker at given pixel coordinates. Draw control must be visible o the page. */
	async drawMarker(x = 0, y = 0) {
		await this.controls.draw.$markerButton.click();
		await this.clickAt(x, y);
	}

	/** Draws a line at given pixel coordinates. Draw control must be visible o the page. */
	async drawLine(...lineCoordinates: [number, number][]) {
		await this.controls.draw.$polylineButton.click();
		for (const coordinates of lineCoordinates) {
			await this.clickAt(...coordinates);
			await this.page.waitForTimeout(SAFE_CLICK_WAIT);
		}
		await this.clickAt(...lineCoordinates[lineCoordinates.length - 1]);
		return this.page.mouse.move(1, 1);
	}

	/** Draws a rectangle at given pixel coordinates. Draw control must be visible o the page. */
	async drawRectangle(coordinates: [[number, number], [number, number]] = [[0, 0], [10, 10]]) {
		await this.controls.draw.$rectangleButton.click();
		await this.drag(...coordinates);
	}

	/** Draws a polygon at given pixel coordinates. Draw control must be visible o the page. */
	async drawPolygon(...polyCoordinates: [number, number][]) {
		await this.controls.draw.$polygonButton.click();
		for (const coordinates of polyCoordinates) {
			await this.clickAt(...coordinates);
			await this.page.waitForTimeout(SAFE_CLICK_WAIT);
		}
		await this.clickAt(...polyCoordinates[0]);
	}

	private $coordinateInputControlContainer = this.page.locator(".laji-map-coordinates").locator("xpath=..");
	private $coordinateUploadControlContainer = this.page.locator(".laji-map-coordinate-upload").locator("xpath=..");
	private $coordinateCopyControlContainer = this.page.locator(".laji-map-draw-copy-table").locator("xpath=..");
	private $layerControlContainer = this.page.locator("div.laji-map-control-layers");
	private $getDrawButton = (name: string) => this.page.locator(`.leaflet-draw-draw-${name}`);

	controls = {
		coordinateInput: {
			$container: this.$coordinateInputControlContainer,
			$button: getControlButton(this.page, "drawUtils.coordinateInput"),
			$closeButton: this.$coordinateInputControlContainer.locator(".close"),
			enterLatLng: async (lat: number, lng: number) => {
				await this.page.locator("#laji-map-coordinate-input-lat").fill("" +lat);
				return this.page.locator("#laji-map-coordinate-input-lng").fill("" + lng);
			},
			getCRS: async () => this.$coordinateInputControlContainer.locator(".crs-info span").last().textContent(),
			$submit: this.$coordinateInputControlContainer.locator("button[type=\"submit\"]")
		},
		coordinateUpload: {
			$button: getControlButton(this.page, "drawUtils.upload"),
			$container: this.$coordinateUploadControlContainer,
			$closeButton: this.$coordinateUploadControlContainer.locator(".close"),
			type: (text: string) => this.$coordinateUploadControlContainer.locator("textarea").fill(text),
			getCRS: () => this.$coordinateUploadControlContainer.locator(".crs-info span").last().textContent(),
			getFormat: () => this.$coordinateUploadControlContainer.locator(".format-info span").last().textContent(),
			$submit: this.$coordinateUploadControlContainer.locator("button[type=\"submit\"]")
		},
		coordinateCopy: {
			$container: this.$coordinateCopyControlContainer,
			$button: getControlButton(this.page, "drawUtils.copy"),
			$closeButton: this.$coordinateCopyControlContainer.locator(".close"),
			getConverted: () => this.$coordinateCopyControlContainer.locator("textarea").inputValue(),
			GeoJSON: () => this.$coordinateCopyControlContainer.locator("text=GeoJSON").click(),
			ISO6709: () => this.$coordinateCopyControlContainer.locator("text=ISO 6709").click(),
			WKT: () => this.$coordinateCopyControlContainer.locator("text=WKT").click(),
			WGS84:() => this.$coordinateCopyControlContainer.locator("text=WGS84").click(),
			YKJ: () => this.$coordinateCopyControlContainer.locator("text=YKJ").click(),
			ETRS: () => this.$coordinateCopyControlContainer.locator("text=ETRS-TM35FIN").click()
		},
		layer: {
			$container: this.$layerControlContainer,
			$button: this.page.locator(".leaflet-control-layers-toggle"),
			showList: async () => {
				const {x, y} = (await this.page.locator(".leaflet-control-layers-toggle").boundingBox() as any);
				return this.page.mouse.move(x, y);
			},
			$finnishList: this.$layerControlContainer.locator(".finnish-list"),
			$worldList: this.$layerControlContainer.locator(".world-list"),
			selectFinnishList: () => this.$layerControlContainer.locator(".finnish-list").locator("legend").click(),
			selectWorldList: () => this.$layerControlContainer.locator(".world-list").locator("legend").click(),
			$overlayList: this.$layerControlContainer.locator(".overlay-list"),
			$getLayerElement: (name: string) => this.$layerControlContainer.locator(`#${name}`)
		},
		delete: {
			start: () => (getControlButton(this.page, "drawUtils.delete"))?.click(),
			$finish: this.page.locator(".leaflet-draw-actions.laji-map-subcontrol-drawUtils\\.delete a"),
			finish: () => this.page.locator(".leaflet-draw-actions a").last().click()
		},
		draw: {
			$markerButton: this.$getDrawButton("marker"),
			$polygonButton: this.$getDrawButton("polygon"),
			$rectangleButton: this.$getDrawButton("rectangle"),
			$circleButton: this.$getDrawButton("circle"),
			$polylineButton: this.$getDrawButton("polyline")
		}
	}

	$getEditableMarkers() {
		return this.page.locator(".leaflet-marker-draggable");
	}
}

/** Page object in laji-map's local playground page */
export class DemoPageMapPageObject extends MapPageObject {
	getDrawData = () => this.e<G.FeatureCollection>("getDraw().featureCollection");
}

export const navigateToMapPage = async (page: Page, options?: Options) => {
	await navigateToMap(page, options);
	if (DELAY) {
		await page.waitForTimeout(parseInt(DELAY));
	}
	return new DemoPageMapPageObject(page, page.locator("#root .laji-map"));
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
