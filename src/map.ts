import * as L from "leaflet";
import * as G from "geojson";
import "leaflet-draw";
import "proj4leaflet";
import "Leaflet.vector-markers";
import "leaflet.markercluster";
import "./lib/Leaflet.rrose/leaflet.rrose-src";
import "leaflet.smoothwheelzoom";
import "leaflet-contextmenu";
import "leaflet-textpath";
import "leaflet-measure-path";
import { GoogleProvider } from "leaflet-geosearch";
import {
	convertAnyToWGS84GeoJSON, convert, detectCRS, detectFormat, stringifyLajiMapError, isObject,
	combineColors, circleToPolygon, LajiMapError,
	coordinatesAreClockWise, flattenMultiLineStringsAndMultiPolygons, anyToFeatureCollection,
	updateImmutablyRecursivelyWith
} from "./utils";
import { depsProvided, dependsOn, provide, isProvided, reflect } from "./dependency-utils";
import {
	NORMAL_COLOR,
	DATA_LAYER_COLOR,
	EDITABLE_DATA_LAYER_COLOR,
	USER_LOCATION_COLOR,
	ESC,
	FINLAND_BOUNDS,
	EPSG3067String
} from "./globals";
import {
	Data, DataItemType, DataItemLayer, DataOptions, OverlayName, IdxTuple, DrawHistoryEntry,
	Lang, Options, Draw, LajiMapFitBoundsOptions, TileLayerName, DrawOptions, LajiMapEvent, CustomPolylineOptions,
	GetFeatureStyleOptions, ZoomToDataOptions, TileLayersOptions, InternalTileLayersOptions,
	UserLocationOptions, LajiMapEditEvent, OnChangeCoordinateSystem, LayerNames, WorldLayerNames, FinnishLayerNames,
	OverlayNames, ShowMeasurementsOptions
} from "./map.defs";

import translations from "./translations";
import { CustomControl, ControlOptions, InternalControlsOptions } from "./controls.defs";
import { LineTransectEvent, LineTransectGeometry, SegmentIdxTuple, LineTransectFeature, PointIdxTuple,
	LineTransectOptions, LineTransectHistoryEntry, SegmentLayer, TooltipMessages } from "./line-transect.defs";

function capitalizeFirstLetter(s: string) {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isPolyline(layer: DataItemLayer): boolean {
	return layer instanceof L.Polyline && ["Rectangle", "Polygon"].every(type => !(layer instanceof L[type]));
}

const DEFAULT_LAYER_NAME = TileLayerName.taustakartta;

// Override the tooltip to turn when it overflows.
const tooltipOrigPrototype = L.Draw.Tooltip.prototype;
L.Draw.Tooltip = L.Draw.Tooltip.extend({
	updatePosition(latlng) {
		tooltipOrigPrototype.updatePosition.call(this, latlng);
		const {width, x} = this._container.getBoundingClientRect();
		const {width: mapWidth, x: mapX} = this._map._container.getBoundingClientRect();
		if (width + x > mapWidth + mapX) {
			const {x: _x, y: _y} = this._map.latLngToLayerPoint(latlng);
			L.DomUtil.setPosition(this._container, new L.Point(_x - width - 30, _y));
			if (this._container.className.indexOf(" reversed") === -1) {
				this._container.className += " reversed";
			}
		} else if (this._container.className.indexOf(" reversed") !== -1) {
			this._container.className = this._container.className.replace(" reversed", "");
		}
		return this;
	}
});

const _initIcon = (L.Marker.prototype as any)._initIcon;
L.Marker.include({
	_initIcon() {
		_initIcon.call(this);
		if (this._initStyle) {
			this._setIconStyle(this._initStyle);
		}
	},
	setStyle(style: L.PathOptions) {
		// Ran into a bug? See known issues section of README.
		if ((<any> this)._icon) {
			this._setIconStyle(style);
		} else {
			this._initStyle = style;
		}
	},
	_setIconStyle(style: L.PathOptions) {
		if ((<any> this)._icon) {
			(<any> this)._icon.firstChild.firstChild.style.fill = style.color;
			(<any> this)._icon.firstChild.firstChild.style.opacity = style.opacity || 2;
		}
	}
});

interface ContextmenuItemOptions {
	text: string;
	iconCls: string;
	callback: () => void;
}

interface ContextmenuOptions {
	contextmenu?: boolean;
	contextmenuInheritItems?: boolean;
	contextmenuItems?: ContextmenuItemOptions[];
	contextmenuWidth?: number;
}

export class ContextmenuItem {
}

interface Contextmenu { // eslint-disable-line @typescript-eslint/no-unused-vars
	addItem(options: ContextmenuItemOptions | "-"): HTMLElement;
	removeAllItems(): void;
	setDisabled(elem: HTMLElement | number, disabled: boolean): this;
	isVisible(): boolean;
}

declare module "leaflet" {
	interface MapOptions extends ContextmenuOptions { }

	interface Path {
		bindContextMenu(options: ContextmenuOptions): Path;
		unbindContextMenu();
	}

	interface Marker {
		bindContextMenu(options: ContextmenuOptions): Marker;
		unbindContextMenu();
		setStyle: (style: L.PathOptions) => void;
	}

	interface Map {
		contextmenu: Contextmenu;
	}

	namespace Contextmenu { // eslint-disable-line @typescript-eslint/no-namespace
		interface Options extends ContextmenuOptions {}
		interface ItemOptions extends ContextmenuItemOptions {}
	}
}

export default class LajiMap {
	googleApiKey: string;
	container: HTMLElement;
	mapElem: HTMLElement;
	blockerElem: HTMLElement;
	rootElem: HTMLElement;
	translations: any;
	data: Data[] = [];
	map: L.Map;
	_onDrawReverse: (layer: DataItemLayer) => void;
	_onDrawRemove: (layer: DataItemLayer) => void;
	idxsToIds: {[dataIdx: number]: {[featureIdx: number]: number}} = [];
	idsToIdxs: {[dataIdx: number]: {[id: number]: number}} = [];
	idsToIdxTuples: {[id: number]: IdxTuple} = {};
	editIdxTuple: IdxTuple;
	drawing: boolean;
	_drawHistoryPointer: number;
	_drawHistory: DrawHistoryEntry[];
	polyline: L.Polyline;
	userLocation: {latlng: L.LatLng, accuracy: number};
	userLocationMarker: L.CircleMarker;
	userLocationRadiusMarker: L.Circle;
	userLocationLayer: L.LayerGroup;
	popup: any;
	featurePopupOffset: number;
	markerPopupOffset: number;
	lang: Lang;
	tileLayerOpacity: number;
	onSetLangHooks: (() => void)[] = [];
	options: Options;
	_dialogRoot: HTMLElement;
	_openDialogs = [];
	_closeDialog: (e?: Event) => void;
	draw: Draw;
	drawIdx: number;
	_draftDrawLayer: DataItemLayer;
	_idxsToHovered: {[dataIdx: number]: {[featureIdx: number]: boolean}} = {};
	_idxsToContextMenuOpen: {[dataIdx: number]: {[id: number]: boolean}} = {};
	locate: [(event: L.LocationEvent) => void, (error: L.ErrorEvent) => void] | boolean;
	_located: boolean;
	popupOnHover: boolean;
	popupCounter: number;
	onPopupClose: () => void;
	_drawReverseLayers: L.Polyline[];
	_drawRemoveLayers: DataItemLayer[];
	_zoomToData: LajiMapFitBoundsOptions | boolean;
	_disableDblClickZoom: boolean;
	dictionary: {[lang: string]: any};
	_domCleaners: (() => void)[] = [];
	_documentEvents: {[eventName: string]: EventListener[]} = {};
	zoom: number;
	center: L.LatLngExpression;
	tileLayer: L.TileLayer;
	overlaysByNames: {[name: string]: L.TileLayer};
	availableOverlaysByNames: {[name: string]: L.TileLayer};
	overlays: L.TileLayer[];
	finnishTileLayers: {[name in (FinnishLayerNames | Extract<OverlayNames, "ykjGrid" | "ykjGridLabels">)]?: L.TileLayer};
	worldTileLayers: {[name in WorldLayerNames]?: L.TileLayer};
	tileLayers: {[name in LayerNames]?: L.TileLayer};
	tileLayerName: TileLayerName;
	_tileLayers: InternalTileLayersOptions;
	availableTileLayers: {[name: string]: L.TileLayer};
	_listenedEvents: L.LeafletEventHandlerFnMap;
	_keyListeners: {[eventName: string]: {[key: string]: ((e: Event) => boolean | void)[]}} = {};
	_swapToWorldFlag: boolean;
	_mouseLatLng: L.LatLng;
	_contextMenuLayer: L.Layer;
	_preventScrollDomCleaner: () => void;
	_onDrawStopPreventScrolling: () => void;
	_onDrawStartPreventScrolling: () => void;
	_preventScroll: boolean;
	_scrollPreventElem: HTMLElement;
	_scrollPreventTextElemContainer: HTMLElement;
	_scrollPreventTextElem: HTMLElement;
	_scrollPreventScrollListeners: ([string, EventListener])[];
	_startPreventScrollingTimeout: () => void;
	_onControlClickPreventScrolling: () => boolean;
	_onMouseDownPreventScrolling: EventListener;
	_onTouchPreventScrolling: EventListener;
	_preventScrolling: () => void;
	_showPreventAnimationTimeout: any;
	_showPreventShowTimeout: any;
	_showPreventHideTimeout: any;
	_showingPreventScroll: boolean;
	_LTEditPointIdxTuple: IdxTuple;
	_clickBeforeZoomAndPan: boolean;
	_origLatLngs: {[id: string]: L.LatLng[]};
	_tooltip: L.Draw.Tooltip;
	_tooltipTranslationHook: () =>  void;
	_onMouseMove: (e: any) => void;
	provider: GoogleProvider;
	leafletOptions: L.MapOptions;
	_viewCriticalSection = 0;
	_tileLayersSet: boolean;
	activeProjName: TileLayersOptions["active"];
	_tileLayerOrder = [
		"taustakartta",
		"maastokartta",
		"laser",
		"ortokuva",
		"ykjGrid",
		"ykjGridLabels",
		"openStreetMap",
		"googleSatellite",
		"geobiologicalProvinces",
		"geobiologicalProvinceBorders",
		"municipalities",
		"counties",
		"ely",
		"forestVegetationZones",
		"mireVegetationZones",
		"threatenedSpeciesEvaluationZones",
		"biodiversityForestZones",
	];
	viewLocked: boolean;
	_locateParam: UserLocationOptions | boolean;
	locateOptions: UserLocationOptions;
	availableTileLayersWhitelist: TileLayerName[];
	availableTileLayersBlacklist: TileLayerName[];
	_initialized = false;
	mmlProj: L.Proj.CRS;
	_trySwapToFinnishOnInitialization = true;
	_fullscreen = false;
	_fullscreenElem: HTMLElement;
	_beforeFullscreen: {
		rootElem: HTMLElement;
		bodyAsDialogRoot: boolean;
		clickBeforeZoomAndPan: boolean;
		bodyOverflowY: string;
	};

	controls: L.Control[];
	_customControls: CustomControl[];
	layerControl: L.Control.Layers;
	controlItems: ControlOptions[];
	_controlItemsByName: {[controlName: string]: ControlOptions};
	activeControl: L.Control;
	controlSettings: InternalControlsOptions;
	drawControl: L.Control.Draw;
	_locateOn: boolean;
	_controlButtons: {[controlName: string]: HTMLElement};
	_opacitySetBySlide: boolean;
	_slider: any;
	_contextMenuItems: {[buttonName: string]: HTMLElement};
	_internalTileLayersUpdate: boolean;


	_allPoints: L.CircleMarker[];
	_hoveredIdxTuple: SegmentIdxTuple;
	LTFeature: LineTransectFeature;
	_splitIdxTuple: PointIdxTuple;
	_splitPoint: L.LatLng;
	_lineLayers: L.Polyline<G.LineString>[][];
	_pointLayers: L.CircleMarker[][];
	_pointIdsToIdxTuples: {[id: number]: PointIdxTuple};
	_corridorLayers: L.Polygon<G.Polygon>[][];
	_allSegments: L.Polyline<G.LineString>[];
	_allCorridors: L.Polygon<G.Polygon>[];
	_lineSplitFn: (idxTuple: SegmentIdxTuple, splitPoint: L.LatLng) => void;
	_selectLTMode: "segment" | "line";
	_LTActiveIdx: number;
	_onLTChange: LineTransectOptions["onChange"];
	_LTDragging: boolean;
	_getLTFeatureStyle: LineTransectOptions["getFeatureStyle"];
	_getLTTooltip: LineTransectOptions["getTooltip"];
	_LTHistory: LineTransectHistoryEntry[];
	_LTHistoryPointer: number;
	_LTPrintMode: boolean;
	_LTEditable: boolean;
	_pointDragSnapMode = false;
	_dragCorridor: L.Polygon<G.Polygon>;
	_origLineTransect: L.FeatureGroup;
	_pointLayerGroup: L.FeatureGroup;
	_lineLayerGroup: L.FeatureGroup;
	_corridorLayerGroup: L.FeatureGroup;
	_overlappingNonadjacentPointIdxTuples: {[idxTupleString: string]: PointIdxTuple};
	_overlappingAdjacentPointIdxTuples: {[idxTupleString: string]: PointIdxTuple};
	_lineIdxsTupleStringsToLineGroupIdxs: {[idxTupleString: string]: number};
	_groupIdxsToLineIdxs: {[groupIdx: number]: number[]};
	_LTStartText: L.Polyline;
	_LTGroups: L.FeatureGroup[];
	_tooltipIdx: number;
	_overlappingPointDialogSegmentIdxTuple: SegmentIdxTuple;
	leafletIdsToCorridorLineIdxs: {[id: string]: number};
	leafletIdsToCorridorSegmentIdxs: {[id: string]: number};
	leafletIdsToFlatCorridorSegmentIdxs: {[id: string]: number};
	leafletIdsToFlatPointIdxs: {[id: string]: number};
	lineIdsToCorridorIds: {[id: string]: number};
	corridorFlatIdxsToLeafletIds: {[id: string]: number};
	_hoveredType: "point" | "corridor";
	_LTClickTimeout: number;
	_closebyPointIdxTuple: PointIdxTuple;
	_pointLTShiftMode: boolean;
	_onSelectLT: (idxTuple: SegmentIdxTuple) => void;
	_firstLTSegmentToRemoveIdx: SegmentIdxTuple;
	_LTPointExpander: L.CircleMarker;
	_LTdragPoint: L.CircleMarker;
	_LTContextMenuLayer: SegmentLayer;
	_featureBeforePointDrag: LineTransectFeature;
	_LTPointLatLngBeforeDrag: L.LatLng;
	_hoveringDragPoint: boolean;
	_dragPointStart: L.LatLng;
	_dragMouseStart: L.LatLng;
	_cutLine: L.Polygon;
	_lineCutIdx: SegmentIdxTuple;
	_ltTooltip: L.Draw.Tooltip;
	messages: TooltipMessages;


	constructor(props: Options) {
		this._constructDictionary();

		const options: Options = {
			tileLayerName: DEFAULT_LAYER_NAME,
			lang: Lang.en,
			data: [],
			locate: false,
			center:  [65, 26],
			zoom: 2,
			zoomToData: false,
			popupOnHover: false,
			draw: false,
			bodyAsDialogRoot: true,
			clickBeforeZoomAndPan: false,
			viewLocked: false
		};

		this.options = {...options, ...props};
		this.leafletOptions = {};
		this.setOptions(this.options);
		this._initializeMap();
		this._initializeView();
		this.setGeocodingProvider();
		this._stopDrawRemove = this._stopDrawRemove.bind(this);
		this._stopDrawReverse = this._stopDrawReverse.bind(this);
		this._onDrawReverseHandler = this._onDrawReverseHandler.bind(this);
		this.abortDrawing = this.abortDrawing.bind(this);
		this.setFullscreenOff = this.setFullscreenOff.bind(this);
		this._initialized = true;
	}

	getOptionKeys(): any {
		return {
			rootElem: "setRootElem",
			lang: "setLang",
			data: ["setData", () => this.getData()],
			draw: ["setDraw", () => this.getDraw()],
			tileLayerName: "setTileLayerByName",
			availableTileLayerNamesBlacklist: "setAvailableTileLayerBlacklist",
			availableTileLayerNamesWhitelist: "setAvailableTileLayerWhitelist",
			overlayNames: ["_setOverlaysByName", () => this.getOverlaysByName()],
			availableOverlayNameBlacklist: "setAvailableOverlaysBlacklist",
			availableOverlayNameWhitelist: "setAvailableOverlaysWhitelist",
			tileLayerOpacity: "setTileLayerOpacity",
			tileLayers: ["setTileLayers", () => this.getTileLayers()],
			center: ["setCenter", () => this.map.getCenter()],
			zoom: ["initZoom", () => this.getNormalizedZoom()],
			zoomToData: ["zoomToData", "_zoomToData"],
			locate: ["setLocate", "locate"],
			onPopupClose: true,
			markerPopupOffset: true,
			featurePopupOffset: true,
			popupOnHover: true,
			on: ["setEventListeners", "_listenedEvent"],
			polyline: true,
			polygon: true,
			rectangle: true,
			circle: true,
			marker: true,
			bodyAsDialogRoot: ["setBodyAsDialogRoot", () => this._dialogRoot === document.body],
			clickBeforeZoomAndPan: ["setClickBeforeZoomAndPan", "_clickBeforeZoomAndPan"],
			googleApiKey: "setGoogleApiKey",
			viewLocked: "setViewLocked"
		};
	}

	setOptions(options: Options = {}) {
		Object.keys(options).forEach((option: keyof Options) => {
			this.setOption(option, options[option]);
		});
	}

	setOption(option: keyof Options, value) {
		const optionKeys = this.getOptionKeys();

		if (!optionKeys.hasOwnProperty(option)) {
			if (!this._initialized) {
				this.leafletOptions[option] = value;
			} else {
				console.warn(`setting leaflet options works only during initialization. '${option}' isn't a LajiMap option.`);
			}
			return;
		}

		const optionKey = Array.isArray(optionKeys[option]) ? optionKeys[option][0] : optionKeys[option];

		if (optionKey === true) {
			this[option] = value;
		} else {
			this[optionKey](value);
		}
	}

	getOption(option: keyof Options) {
		const optionKeys = this.getOptionKeys();

		if (Array.isArray(optionKeys[option])) {
			const getter = optionKeys[option][1];
			return typeof getter === "function" ? getter() : this[getter];
		} else if (option in this) {
			return this[option];
		}
	}

	getOptions(): Options {
		const optionKeys = this.getOptionKeys();

		return Object.keys(optionKeys).reduce((options, key: keyof Options) => {
			options[key] = this.getOption(key);
			return options;
		}, {});
	}

	setRootElem(rootElem: HTMLElement) {
		const oldContainer = this.container;
		const {children} = oldContainer || {};

		this.mapElem = this.mapElem || document.createElement("div");
		this.blockerElem = this.blockerElem || document.createElement("div");

		const oldActive = document.activeElement;
		const isFocused = this.map?.getContainer() && this.map.getContainer().contains(document.activeElement);
		if (!isFocused) {
			this.map?.fire("blur");
		}

		this.container = document.createElement("div");
		this.container.className = "laji-map";

		this.blockerElem.className = "laji-map-blocker";

		if (children) {
			for (let child of Array.from(children)) {
				this.container.appendChild(child);
			}
		} else {
			this.container.appendChild(this.mapElem);
		}

		const shouldSetZoomAndPan = this._clickBeforeZoomAndPan;
		shouldSetZoomAndPan && this.setClickBeforeZoomAndPan(false);

		this.rootElem = rootElem;
		this.rootElem.appendChild(this.container);
		if (oldContainer && oldContainer !== this.container) {
			oldContainer.parentElement.removeChild(oldContainer);
		}

		shouldSetZoomAndPan && this.setClickBeforeZoomAndPan(true);

		this._dialogRoot && this.setBodyAsDialogRoot(this._dialogRoot === document.body);

		this.map && this.map.invalidateSize();
		if (isFocused && oldActive && document.activeElement !== oldActive) {
			(oldActive as HTMLElement).focus?.();
		}

		provide(this, "rootElem");
	}

	@dependsOn("rootElem")
	setBodyAsDialogRoot(value = true) {
		if (!depsProvided(this, "setBodyAsDialogRoot", arguments)) return;
		const prevBodyRoot = this._dialogRoot;
		if (value) {
			this._dialogRoot = document.body;
		} else {
			this._dialogRoot = this.container;
		}
		if (prevBodyRoot) {
			if (this.blockerElem.parentNode === prevBodyRoot) prevBodyRoot.removeChild(this.blockerElem);
			if (this.blockerElem.className.indexOf("fixed") !== -1) {
				this.blockerElem.className = this.blockerElem.className.replace(" fixed", "");
			}
			this._openDialogs?.forEach(elem => {
				this._dialogRoot.appendChild(elem);
			});
		}
		this._dialogRoot.appendChild(this.blockerElem);
		if (value) this.blockerElem.className = `${this.blockerElem.className} fixed`;
	}

	shouldNotPreventScrolling(): boolean {
		return !!(this.drawing || this._LTEditPointIdxTuple);
	}

	@dependsOn("rootElem", "map", "translations", "viewLocked")
	setClickBeforeZoomAndPan(value = true) {
		if (!depsProvided(this, "setClickBeforeZoomAndPan", arguments)) return;

		if (this.viewLocked && value) {
			return;
		}

		const valueWas = this._clickBeforeZoomAndPan;
		this._clickBeforeZoomAndPan = value;

		const isOutsideLajiMap = elem =>
			document.body.contains(elem)
			&& !this.container.contains(elem)
			&& elem !== this.blockerElem
			&& (!this._openDialogs.length || this._openDialogs.every(dialog => !dialog.contains(elem)));

		let translationHook = undefined;

		this._scrollPreventElem = this._scrollPreventElem || document.createElement("div");
		this._scrollPreventTextElemContainer = this._scrollPreventTextElemContainer || document.createElement("div");
		this._scrollPreventTextElem = this._scrollPreventTextElem || document.createElement("span");
		this._scrollPreventTextElemContainer.appendChild(this._scrollPreventTextElem);
		this._scrollPreventElem.className = "laji-map-scroll-prevent left";
		this._scrollPreventTextElemContainer.className = "laji-map-scroll-prevent text-container left";
		translationHook = this.addTranslationHook(this._scrollPreventTextElem, "ClickBeforeZoom");
		this._showingPreventScroll = false;

		if (!this._preventScrolling) {
			this._preventScrolling = () => {
				if (this.shouldNotPreventScrolling()) return;
				this.map.smoothWheelZoom.disable();
				this.map.dragging.disable();
				this._preventScroll = true;
			};
		}

		if (!this._startPreventScrollingTimeout) {
			this._startPreventScrollingTimeout = () => {
				clearTimeout(this._showPreventShowTimeout);
				this._showPreventShowTimeout = setTimeout(() => {
					this._preventScrolling();
				}, 10000);
			};
		}

		const showPreventElem = () => {
			const showingAlready = this._showingPreventScroll;

			this._showingPreventScroll = true;
			if (!showingAlready) {
				[].forEach.call(
					document.querySelectorAll(".laji-map-scroll-prevent"),
					elem => elem.className = elem.className.replace("left", "enter")
				);
				setTimeout(() => {
					[].forEach.call(
						document.querySelectorAll(".laji-map-scroll-prevent"),
						elem => elem.className = elem.className.replace(" enter", "")
					);
				});
			}

			clearTimeout(this._showPreventHideTimeout);
			clearTimeout(this._showPreventShowTimeout);
			clearTimeout(this._showPreventAnimationTimeout);

			this._showPreventHideTimeout = setTimeout(() => {
				if (!document.body.contains(this._scrollPreventElem)) return;
				hidePreventElem();
			}, 2000);

			[].forEach.call(document.querySelectorAll(".laji-map-scroll-prevent"), elem => elem.style.display = "block");
		};

		const hidePreventElem = () => {
			if (!this._showingPreventScroll) return;

			clearTimeout(this._showPreventHideTimeout);
			clearTimeout(this._showPreventShowTimeout);
			clearTimeout(this._showPreventAnimationTimeout);

			[].forEach.call(
				document.querySelectorAll(".laji-map-scroll-prevent"),
				elem => elem.className = `${elem.className} leaving`
			);
			this._showPreventAnimationTimeout = setTimeout(() => {
				this._showingPreventScroll = false;
				[].forEach.call(
					document.querySelectorAll(".laji-map-scroll-prevent"),
					elem => elem.className = elem.className.replace("leaving", "left")
				);
				this._startPreventScrollingTimeout();
			}, 200); // Should match transition time in css
		};

		const _onTouchOrMouseEventAgnostic = (isOutside: boolean) => {
			this._startPreventScrollingTimeout();
			if (!this._preventScroll && isOutside) {
				this._preventScrolling();
			} else if (this._preventScroll && !isOutside && !this.viewLocked) {
				this.map.smoothWheelZoom.enable();
				this.map.dragging.enable();
				hidePreventElem();
				this._preventScroll = false;
				return true;
			}
		};

		const onTouchOrMouse = (touch: boolean) => (e: Event) => {
			if (touch) e.stopPropagation();
			const enabled = _onTouchOrMouseEventAgnostic(isOutsideLajiMap(e.target));
			if (enabled && !touch) {
				(<any> this.map.dragging)._draggable._onDown(e);
			}
		};

		if (!this._onTouchPreventScrolling) {
			this._onTouchPreventScrolling = onTouchOrMouse(!!"touch");
			this._onMouseDownPreventScrolling = onTouchOrMouse(!"mouse");
			this._onControlClickPreventScrolling = () => _onTouchOrMouseEventAgnostic(false);
			this._onDrawStartPreventScrolling = () => !this.viewLocked && this.map.dragging.disable();
			this._onDrawStopPreventScrolling = () => !this.viewLocked && this.map.dragging.enable();
		}

		if (this._preventScrollDomCleaner) {
			this._removeDomCleaner(this._preventScrollDomCleaner);
		}
		this._preventScrollDomCleaner = () => {
			if (this._preventScrollDomCleaner) {
				this._removeDomCleaner(this._preventScrollDomCleaner);
			}
			this._preventScrollDomCleaner = undefined;

			clearTimeout(this._showPreventHideTimeout);
			clearTimeout(this._showPreventShowTimeout);
			clearTimeout(this._showPreventAnimationTimeout);
			document.removeEventListener("touch", this._onTouchPreventScrolling);
			document.removeEventListener("mousedown", this._onMouseDownPreventScrolling);
			this.map.removeEventListener("zoomstart", this._startPreventScrollingTimeout);
			this.map.removeEventListener("controlClick", this._onControlClickPreventScrolling);
			this.map.removeEventListener("draw:drawstart", this._onDrawStartPreventScrolling);
			this.map.removeEventListener("draw:drawstop", this._onDrawStopPreventScrolling);
			const scrollPreventElemParent = this._scrollPreventElem.parentNode;
			if (scrollPreventElemParent) scrollPreventElemParent.removeChild(this._scrollPreventElem);
			this._scrollPreventElem = undefined;
			const scrollPreventTextElemContainerParent = this._scrollPreventTextElemContainer.parentNode;
			if (scrollPreventTextElemContainerParent) {
				scrollPreventTextElemContainerParent.removeChild(this._scrollPreventTextElemContainer);
			}
			this._scrollPreventTextElemContainer = undefined;
			(this._scrollPreventScrollListeners || []).forEach(([name, fn]) => window.removeEventListener(name, fn));
			this._scrollPreventScrollListeners = undefined;
			!this.viewLocked && this.map.smoothWheelZoom.enable();
			!this.viewLocked && this.map.dragging.enable();
		};

		if (value && !valueWas) {
			this._preventScrolling();

			document.addEventListener("touch", this._onTouchPreventScrolling);
			document.addEventListener("mousedown", this._onMouseDownPreventScrolling);
			this.map.addEventListener("controlClick", this._onControlClickPreventScrolling);

			this._scrollPreventScrollListeners = [];
			"wheel touchstart".split(" ").forEach(eventName => {
				const eventListener = (e) => {
					const coordinatesSource = eventName === "touchstart" ? e.touches[0] : e;
					const pointedElem = document.elementFromPoint(coordinatesSource.clientX, coordinatesSource.clientY);
					const isOutside = isOutsideLajiMap(pointedElem);
					if (this._preventScroll && !isOutside) {
						this.removeTranslationHook(translationHook);
						translationHook = this.addTranslationHook(
							this._scrollPreventTextElem,
							`ClickBefore${eventName === "wheel" ? "Zoom" : "Pan"}`
						);
						showPreventElem();
					} else {
						this._startPreventScrollingTimeout();
					}
				};
				window.addEventListener(eventName, eventListener);
				this._scrollPreventScrollListeners.push([eventName, eventListener]);

				this.map.addEventListener("zoomstart", this._startPreventScrollingTimeout);
			});

			this.container.appendChild(this._scrollPreventElem);
			this.container.appendChild(this._scrollPreventTextElemContainer);
			this.map.addEventListener("draw:drawstart", this._onDrawStartPreventScrolling);
			this.map.addEventListener("draw:drawstop", this._onDrawStopPreventScrolling);
			this._addDomCleaner(this._preventScrollDomCleaner);
		} else if (!value && valueWas) {
			if (this._preventScrollDomCleaner) this._preventScrollDomCleaner();
		}
	}

	getMMLProj(): L.CRS {
		return this.mmlProj;
	}

	@dependsOn("rootElem", "center", "zoom")
	_initializeMap() {
		try {
			if (!depsProvided(this, "_initializeMap", arguments)) return;
			L.Icon.Default.imagePath = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

			this.map = L.map(this.mapElem, {
				contextmenu: true,
				contextmenuItems: [],
				zoomControl: false,
				attributionControl: false,
				doubleClickZoom: false,
				zoomSnap: 0,
				maxZoom: 19,
				zoom: this.zoom,
				center: this.center,
				scrollWheelZoom: false,
				smoothWheelZoom: true,
				smoothSensitivity: 3,
				...this.leafletOptions
			});

			this. mmlProj = new L.Proj.CRS(
				"EPSG:3067",
				EPSG3067String,
				{
					origin: [-548576, 8388608],
					bounds: L.bounds([-548576, 8388608], [1548576, 6291456]),
					resolutions: [
						8192, 4096, 2048, 1024, 512, 256,
						128, 64, 32, 16, 8, 4, 2, 1, 0.5,
						0.25, 0.125, 0.0625, 0.03125, 0.015625
					],
				}
			);
			// Scale controller won't work without this hack.
			// Fixes also circle projection.
			this.mmlProj.distance =  L.CRS.Earth.distance;
			(<any> this.mmlProj).R = 6378137;

			const getAttribution = (link, text) => `<a href="${link}" target="_blank" rel="noopener noreferrer">&copy; ${text}</a>`;
			const mmlAttribution = getAttribution("https://www.maanmittauslaitos.fi/avoindata_lisenssi_versio1_20120501", "Maanmittauslaitos");
			const sykeAttribution = getAttribution("https://www.syke.fi/fi-FI/Avoin_tieto/Kayttolupa_ja_vastuut", "SYKE");

			const getMMLLayer = (name, options: L.TileLayerOptions = {format: "png"}) =>
				L.tileLayer(`https://proxy.laji.fi/mml_wmts/maasto/wmts/1.0.0/${name}/default/ETRS-TM35FIN/{z}/{y}/{x}.${options.format}`, {
					...options,
					style: "default",
					minZoom: 0,
					maxZoom: 15,
					version: "1.0.0",
					format: `image/${options.format}`,
					transparent: false,
					attribution : mmlAttribution
				});

			this.finnishTileLayers = {
				taustakartta: getMMLLayer("taustakartta"),
				maastokartta: getMMLLayer("maastokartta"),
				ortokuva: getMMLLayer("ortokuva", {format: "jpg", maxZoom: 14}),
				laser: L.tileLayer("https://proxy.laji.fi/mapant/wmts.php?z={z}&x={x}&y={y}", {
					maxZoom: 19,
					minZoom: 0,
					tileSize: 256,
					attribution : `${mmlAttribution}, ${getAttribution("https://www.mapant.fi", "Mapant")}`
				}),
				ykjGrid: L.tileLayer.wms("https://maps.luomus.fi/geoserver/atlas/wms", {
					maxZoom: 15,
					layers: "atlas:YKJ_ETRS_LINE100,atlas:YKJ_ETRS_LINE1000,atlas:YKJ_ETRS_LINE10000,atlas:YKJ_ETRS_LINE100000",
					format: "image/png",
					transparent: true,
					version: "1.1.0",
				}),
				ykjGridLabels: L.tileLayer.wms("https://maps.luomus.fi/geoserver/atlas/wms", {
					maxZoom: 15,
					layers: "atlas:YKJ_ETRS_LABEL1000,atlas:YKJ_ETRS_LABEL10000,atlas:YKJ_ETRS_LABEL100000",
					format: "image/png",
					transparent: true,
					version: "1.1.0",
				})
			};

			this.worldTileLayers = {
				openStreetMap: L.tileLayer("https://proxy.laji.fi/osm/{z}/{x}/{y}.png", {
					attribution: getAttribution("https://osm.org/copyright", "OpenStreetMap contributors")
				}),
				googleSatellite: L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
					subdomains: ["mt0", "mt1", "mt2", "mt3"],
					attribution: getAttribution("https://developers.google.com/maps/terms", "Google")
				})
			};

			this.tileLayers = {
				...this.finnishTileLayers,
				...this.worldTileLayers
			};

			this.availableTileLayers = this.tileLayers;

			this.overlaysByNames = {
				geobiologicalProvinces: L.tileLayer.wms(
					"https://maps.luomus.fi/geoserver/ows", {
						maxZoom: 15,
						layers: "INSPIRE:fi_fmnh_br_extended",
						format: "image/png",
						transparent: true,
						version: "1.3.0",
						defaultOpacity: 0.5
					}),
				geobiologicalProvinceBorders: L.tileLayer.wms(
					"https://maps.luomus.fi/geoserver/INSPIRE/wms", {
						maxZoom: 15,
						layers: "INSPIRE:fi_fmnh_br",
						styles: "harmaaviiva",
						format: "image/png",
						transparent: true,
						version: "1.1.0",
					}),
				municipalities: L.tileLayer.wms(
					"https://geo.stat.fi/geoserver/tilastointialueet/wms", {
						layers: "kunta1000k",
						transparent: true,
						format: "image/png",
						attribution: getAttribution( "https://www.stat.fi/org/lainsaadanto/copyright.html", "Tilastokeskus")
					}),
				counties: L.tileLayer.wms(
					"https://geo.stat.fi/geoserver/tilastointialueet/wms", {
						layers: "maakunta1000k",
						transparent: true,
						format: "image/png",
						attribution: getAttribution( "https://www.stat.fi/org/lainsaadanto/copyright.html", "Tilastokeskus")
					}),
				ely: L.tileLayer.wms(
					"https://geo.stat.fi/geoserver/tilastointialueet/wms", {
						layers: "ely1000k",
						transparent: true,
						format: "image/png",
						attribution: getAttribution( "https://www.stat.fi/org/lainsaadanto/copyright.html", "Tilastokeskus")
					}),
				forestVegetationZones: L.tileLayer.wms(
					"https://paikkatieto.ymparisto.fi/arcgis/services/INSPIRE/SYKE_EliomaantieteellisetAlueet/MapServer/WmsServer", {
						maxZoom: 15,
						layers: "br.Metsakasvillisuusvyohykkeet",
						format: "image/png",
						transparent: true,
						version: "1.3.0",
						defaultOpacity: 0.5,
						attribution: sykeAttribution
					}),
				mireVegetationZones: L.tileLayer.wms(
					"https://paikkatieto.ymparisto.fi/arcgis/services/INSPIRE/SYKE_EliomaantieteellisetAlueet/MapServer/WmsServer", {
						maxZoom: 15,
						layers: "br.Suokasvillisuusvyohykkeet",
						format: "image/png",
						transparent: true,
						version: "1.3.0",
						defaultOpacity: 0.5,
						attribution: sykeAttribution
					}),
				threatenedSpeciesEvaluationZones: L.tileLayer.wms(
					"https://maps.luomus.fi/geoserver/Vyohykejaot/wms", {
						maxZoom: 15,
						layers: "Vyohykejaot:Metsakasvillisuusvyohykkeet_Uhanalaisarviointi",
						format: "image/png",
						transparent: true,
						version: "1.1.0",
						attribution: sykeAttribution
					}),
				biodiversityForestZones: L.tileLayer.wms(
					"https://paikkatieto.ymparisto.fi/arcgis/services/SYKE/SYKE_MonimuotoisuudelleTarkeatMetsaalueetZonation/MapServer/WmsServer", {
						maxZoom: 15,
						layers: "8",
						defaultOpacity: 0.5,
						attribution: sykeAttribution
					})
			};

			const combined = {...this.tileLayers, ...this.overlaysByNames};
			Object.keys(combined).forEach(name => {
				combined[name].setZIndex(this._tileLayerOrder.indexOf(name));
			});

			this.availableOverlaysByNames = this.overlaysByNames;

			if (this.locateOptions && this.locateOptions.on) {
				this._setLocateOn();
			}

			this._initializeMapEvents();

			provide(this, "map");
		} catch (e) {
			if (e._lajiMapError) {
				this._showError(e);
			} else {
				throw e;
			}
		}
	}

	@dependsOn("map")
	_initializeView() {
		if (!depsProvided(this, "_initializeView", arguments)) return;
		this._viewCriticalSection++;

		let tileLayerOptions;
		if (this.options.tileLayers) {
			tileLayerOptions = this.options.tileLayers;
		} else if (this.options.tileLayerName) {
			tileLayerOptions = {layers: {[this.options.tileLayerName]: true}};
		} else {
			tileLayerOptions = {layers: {[DEFAULT_LAYER_NAME]: true}};
		}
		tileLayerOptions = this._getInternalTileLayerOptions(tileLayerOptions);
		let center, bounds;
		if (this.options.zoomToData) {
			bounds = this.getBoundsForZoomToDataOptions(this.options.zoomToData);
			if (bounds.isValid()) {
				center = bounds.getCenter();
			} else {
				bounds = undefined;
			}
		}
		if (!center) {
			center = this.options.center;
		}

		if (tileLayerOptions.active === "finnish" && this._isOutsideFinland(center)) {
			tileLayerOptions.active = "world";
		}

		this._trySwapToFinnishOnInitialization = this._isOutsideFinland(center);
		this.setTileLayers(tileLayerOptions);

		if (bounds) {
			this.zoomToData(this.options.zoomToData);
		} else {
			this.map.setView(
				this.center,
				this.getDenormalizedZoom(this.zoom),
				{animate: false}
			);
		}

		provide(this, "view");
		this.reorderData();

		this._viewCriticalSection--;
	}

	_isOutsideFinland(latLng: L.LatLngExpression) {
		return !L.latLngBounds(FINLAND_BOUNDS).contains(latLng);
	}

	@dependsOn("tileLayer")
	_swapToWorldOutsideFinland(latLng: L.LatLngExpression) {
		if (!depsProvided(this, "_swapToWorldOutsideFinland", arguments)) return;

		if (Object.keys(this.worldTileLayers).some(name => !!this.availableTileLayers[name])
			&& this._isOutsideFinland(latLng)
		) {
			this._swapToWorldFlag = true;
			let options;
			const someWorldMapVisible = Object.keys(this.worldTileLayers).some(name =>
				!!this._tileLayers.layers[name].visible
			);
			if (someWorldMapVisible) {
				options = {...this._tileLayers, active: "world"};
			} else {
				options = {...this._tileLayers, layers: {...this._tileLayers.layers, openStreetMap: true}, active: "world"};
			}
			this.setTileLayers(options);
		}
	}

	@dependsOn("map")
	_initializeMapEvents() {
		if (!depsProvided(this, "_initializeMapEvents", arguments)) return;

		this.map.addEventListener({
			 // We have to handle dblclick zoom manually, since the default event can't be cancelled.
			"dblclick": (e: L.LeafletMouseEvent) => {
				setTimeout(() => {
					if (this._disableDblClickZoom) return;
					const oldZoom = this.map.getZoom();
					const delta = this.map.options.zoomDelta;
					const zoom = e.originalEvent.shiftKey ? oldZoom - delta : oldZoom + delta;
					this.map.setZoomAround(e.containerPoint, zoom);
				});
			},
			"click": () => this._interceptClick(),
			"mousemove": ({latlng}: L.LeafletMouseEvent) => {
				this._mouseLatLng = latlng;
			},
			"draw:created": ({layer}: L.DrawEvents.Created) => this._onAdd(this.drawIdx, <DataItemLayer> layer),
			"draw:drawstart": () => {
				this.drawing = true;
				this.map.fire("controlClick", {name: "draw"});
			},
			"draw:drawstop": () => { this.drawing = false; },
			"draw:drawvertex": (e: L.DrawEvents.Edited) => {
				const layers = e.layers.getLayers();
				const keys = Object.keys(layers);
				const latlng = layers[keys[keys.length - 1]].getLatLng();

				const {x, y} = this.map.latLngToContainerPoint(latlng);
				const {width, height} = this.rootElem.getBoundingClientRect();
				const treshold = Math.min(width, height) / 4;
				if ([y, y - height, x, x - width].some(dist => Math.abs(dist) < treshold)) {
					this.map.panTo(latlng);
				}
			},
			"locationfound": (e: L.LocationEvent) => this._onLocationFound(e),
			"locationerror": (e: L.ErrorEvent) => this._onLocationNotFound(e),
			"contextmenu.show": (e: any) => {
				if (e.relatedTarget) {
					this._contextMenuLayer = e.relatedTarget;
					const tuple = this._getIdxTupleByLayer(this._contextMenuLayer);
					if (tuple) {
						const [dataIdx, featureIdx] = tuple;
						if (this.data[dataIdx] && this.data[dataIdx].editable) {
							this._idxsToContextMenuOpen[dataIdx][featureIdx] = true;
							this.updateLayerStyle(e.relatedTarget);
						}
					}
				}
				this._interceptClick();
			},
			"contextmenu.hide": () => {
				const contextMenuLayer = this._contextMenuLayer;
				this._contextMenuLayer = undefined;
				if (!contextMenuLayer) return;
				const tuple = this._getIdxTupleByLayer(contextMenuLayer);
				if (tuple) {
					const [dataIdx, featureIdx] = tuple;
					if (this.data[dataIdx] && this.data[dataIdx].editable) {
						this._idxsToContextMenuOpen[dataIdx][featureIdx] = false;
						this.updateLayerStyle(<DataItemLayer> contextMenuLayer);
					}
				}
				this.map.fire("mousemove", {latlng: this._mouseLatLng});
			},
			"moveend": () => {
				if (!this.map) {
					return;
				}
				if (this._viewCriticalSection) {
					return;
				}
				if (this._swapToWorldFlag) {
					this._swapToWorldFlag = false;
					return;
				}
				this._swapToWorldOutsideFinland(this.map.getCenter());
			}
		});

		this._addDocumentEventListener("click",  (e: MouseEvent) => {
			if (e.target !== this.rootElem && !this.rootElem.contains(<Element> e.target)) {
				this._interceptClick();
			}
		}, true); // useCapture flag to make sure that this runs before other targets beneath in the DOM tree.

		this._addDocumentEventListener("keydown", e => this.keyHandlerForType("keydown", e));
		this._addDocumentEventListener("keyup", e => this.keyHandlerForType("keyup", e));
	}

	keyHandlerForType(type: string, e) {
		e = e || window.event;
		let key = "key" in e ? e.key : e.keyCode;
		const isEscape = ["Escape", "Esc", 27].includes(key);
		if (isEscape) {
			key = ESC;
		}
		if (this._triggerKeyEvent(key.toLowerCase(), e, type)) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			return true;
		}
	}

	_addDocumentEventListener(type: string, fn: EventListener, useCapture?: boolean) {
		if (!this._documentEvents[type]) {
			this._documentEvents[type] = [];
		}
		this._documentEvents[type].push(fn);
		document.addEventListener(type, fn, useCapture);
	}

	_removeDocumentEventListener(type: string, fn: EventListener) {
		if (!this._documentEvents[type]) {
			return;
		}
		this._documentEvents[type] = this._documentEvents[type].filter(_fn => _fn !== fn);
		document.removeEventListener(type, fn);
	}

	_addKeyListener(key: string, fn: (e?: Event) => boolean | void,  type = "keydown") {
		if (!this._keyListeners[type]) this._keyListeners[type] = {};
		if (!this._keyListeners[type][key]) this._keyListeners[type][key] = [];
		this._keyListeners[type][key] = [fn, ...this._keyListeners[type][key]];
	}

	_removeKeyListener(key: string, fn: (e?: Event) => boolean | void, type = "keydown") {
		const index = this._keyListeners[type]?.[key]?.indexOf(fn);
		if (index >= 0) {
			this._keyListeners[type][key].splice(index, 1);
		}
	}

	_triggerKeyEvent(key: string, e: Event, type: string) {
		for (let fn of this._keyListeners[type]?.[key] || []) {
			const result = fn(e);
			if (result !== false) {
				return true;
			}
		}
	}

	@dependsOn("map")
	setEventListeners(eventListeners: L.LeafletEventHandlerFnMap) {
		if (!depsProvided(this, "setEventListeners", arguments)) return;
		if (!eventListeners) return;

		Object.keys(this._listenedEvents || {}).forEach(name => {
			this.map.removeEventListener(name, this._listenedEvents[name]);
		});

		this._listenedEvents = eventListeners;
		this.map.addEventListener(eventListeners);
	}

	_getDefaultCRSLayers(): L.TileLayer[] {
		return [
			this.tileLayers.openStreetMap,
			this.tileLayers.googleSatellite,
		];
	}

	_getMMLCRSLayers(): L.TileLayer[] {
		return [
			this.tileLayers.maastokartta,
			this.tileLayers.taustakartta,
			this.tileLayers.ortokuva,
			this.tileLayers.laser
		];
	}

	@dependsOn("map")
	setTileLayerByName(name: TileLayerName) {
		if (!depsProvided(this, "setTileLayerByName", arguments)) return;
		if (!this._initialized && this._tileLayersSet) {
			return;
		}
		this.setTileLayer(this.tileLayers[name]);
	}

	_getListForAvailableTileLayer(names: TileLayerName[], condition, _tileLayers?: {[name: string]: L.TileLayer}) {
		const list = names.reduce((_list, name) => {
			_list[name] = true;
			return _list;
		}, {});
		return Object.keys(_tileLayers || this.tileLayers).reduce((tileLayers, name) => {
			if (name in list === condition) tileLayers[name] = this.tileLayers[name];
			return tileLayers;
		}, {});
	}

	@dependsOn("map")
	setAvailableTileLayers(names: TileLayerName[], condition: boolean, _tileLayers?: {[name: string]: L.TileLayer}) {
		if (!depsProvided(this, "setAvailableTileLayers", arguments)) return;

		this.availableTileLayers = this._getListForAvailableTileLayer(names, condition, _tileLayers);
		!isProvided(this, "availableTileLayers") && provide(this, "availableTileLayers");
		isProvided(this, "tileLayer") && this.setTileLayers(this._tileLayers);
	}

	getDefaultTileLayerBlacklist(): TileLayerName[] { return  []; }
	getDefaultTileLayerWhitelist(): TileLayerName[] { return <TileLayerName[]> Object.keys(this.tileLayers); }

	@dependsOn("map")
	setAvailableTileLayerBlacklist(names: TileLayerName[]) {
		if (!depsProvided(this, "setAvailableTileLayerBlacklist", arguments)) return;
		if (!names) {
			names = this.getDefaultTileLayerBlacklist();
		}
		this.availableTileLayersBlacklist = names;
		const layers = this._getListForAvailableTileLayer(this.availableTileLayersWhitelist || this.getDefaultTileLayerWhitelist(), true);
		this.setAvailableTileLayers(names, false, layers);
	}

	@dependsOn("map")
	setAvailableTileLayerWhitelist(names: TileLayerName[]) {
		if (!depsProvided(this, "setAvailableTileLayerWhitelist", arguments)) return;
		if (!names) {
			names = this.getDefaultTileLayerWhitelist();
		}
		this.availableTileLayersWhitelist = names;
		const layers = this._getListForAvailableTileLayer(this.availableTileLayersBlacklist || this.getDefaultTileLayerBlacklist(), false);
		this.setAvailableTileLayers(names, true, layers);
	}

	getAvailableOverlaysByNames(): {[name: string]: L.TileLayer[]} {
		return this.getAvailableLayersFor(this.overlaysByNames, this.availableOverlaysByNames);
	}
	getAvailableWorldTileLayers(): {[name: string]: L.TileLayer[]} {
		return this.getAvailableLayersFor(this.worldTileLayers, this.availableTileLayers);
	}
	getAvailableFinnishTileLayers(): {[name: string]: L.TileLayer[]} {
		return this.getAvailableLayersFor(this.finnishTileLayers, this.availableTileLayers);
	}
	getAvailableLayersFor(_layers, availables): {[name: string]: L.TileLayer[]} {
		return Object.keys(_layers).reduce((layers, name) => {
			if (availables[name]) {
				layers[name] = _layers[name];
			}
			return layers;
		}, {});
	}

	setTileLayer(layer: L.TileLayer) {
		const name = Object.keys(this.tileLayers).find(_name => {
			if (this.tileLayers[_name] === layer) {
				return !!_name;
			}
		});
		const overlays = this.getOverlaysByName().reduce((_overlays, _name) => {
			_overlays[_name] = this._tileLayers.layers[_name];
			return _overlays;
		}, {});
		this.setTileLayers({layers: {[name]: {opacity: 1, visible: true}, ...overlays}});
	}

	getActiveLayers(options: InternalTileLayersOptions): InternalTileLayersOptions["layers"] {
		let {layers, active} = options;
		if (!active) {
			let useFinnishProj;
			let foundMultiple = false;
			Object.keys(layers).some(name => {
				if (foundMultiple) {
					return true;
				}
				const layerOptions = layers[name];
				if (!layerOptions.visible) {
					return;
				}
				if (useFinnishProj === undefined) {
					useFinnishProj = this.finnishTileLayers[name];
				} else if (useFinnishProj && this.worldTileLayers[name] || !useFinnishProj && !this.finnishTileLayers[name]) {
					useFinnishProj = true;
					foundMultiple = true;
				}
			});
			active = useFinnishProj ? "finnish" : "world";
		}
		return Object.keys(layers).reduce((_layers, name) => {
			if (layers[name].visible
				&& (
					this.overlaysByNames[name]
					|| active === "finnish" && this.finnishTileLayers[name]
					|| active === "world" && this.worldTileLayers[name]
				)) {
				_layers[name] = layers[name];
			}
			return _layers;
		}, {});
	}

	_getInternalTileLayerOptions(options: TileLayersOptions): InternalTileLayersOptions {
		const combinedLayers = {...this.availableTileLayers, ...this.availableOverlaysByNames};
		const newOptions = {
			...options,
			layers: Object.keys(combinedLayers).reduce((_layers, name) => {
				const layerOptions = options.layers[name];
				_layers[name] = typeof layerOptions === "boolean" || layerOptions === undefined
					? {opacity: layerOptions ? (combinedLayers[name].options.defaultOpacity || 1) : 0, visible: !!layerOptions}
					: {
						opacity: layerOptions.opacity,
						visible: layerOptions.hasOwnProperty("visible")  ? layerOptions.visible : !!layerOptions.opacity
					};
				return _layers;
			}, {})
		};
		const activeLayers = this.getActiveLayers(newOptions);
		newOptions.active = options.active
			|| (Object.keys(activeLayers).length === 0 || this.finnishTileLayers[Object.keys(activeLayers)[0]]
				? "finnish"
				: "world");
		return newOptions;
	}

	@dependsOn("map", "view")
	setTileLayers(options: TileLayersOptions) {
		this._tileLayersSet = true;
		if (!depsProvided(this, "setTileLayers", arguments)) return;

		const newOptions = this._getInternalTileLayerOptions(options);

		const defaultCRSLayers = this._getDefaultCRSLayers();
		const mmlCRSLayers = this._getMMLCRSLayers();

		const combinedLayers = {...this.availableTileLayers, ...this.availableOverlaysByNames};
		const prevActiveLayers = this._tileLayers && this.getActiveLayers(this._tileLayers);
		const activeLayers = this.getActiveLayers(newOptions);
		const oldActive = this.activeProjName;
		newOptions.active = options.active
			|| (Object.keys(activeLayers).length === 0 || this.finnishTileLayers[Object.keys(activeLayers)[0]]
				? "finnish"
				: "world");

		const findNonOverlay = name => !!this.finnishTileLayers[name] || !!this.worldTileLayers[name];

		const layer = this.tileLayers[Object.keys(activeLayers).find(findNonOverlay)];

		// For BW compatibility.
		this.tileLayer = layer;
		const existingLayer = this._tileLayers && this.tileLayers[Object.keys(this.getActiveLayers(this._tileLayers)).find(findNonOverlay)];

		const center = this.map.getCenter();
		this.map.options.crs = defaultCRSLayers.indexOf(layer) !== -1 ? L.CRS.EPSG3857 : this.mmlProj;

		let zoom = this.map.getZoom();

		if (this.activeProjName && newOptions.active !== this.activeProjName
			&& this.activeProjName !== "finnish"
			&& (!layer
				|| (mmlCRSLayers.indexOf(layer) !== -1 && mmlCRSLayers.indexOf(existingLayer) === -1))
		) {
			if (isProvided(this, "tileLayer")) {
				zoom = zoom - 3;
			}
		} else if (newOptions.active !== this.activeProjName
			&& this.activeProjName !== "world"
			&& (!layer
				|| (defaultCRSLayers.indexOf(layer) !== -1 && defaultCRSLayers.indexOf(existingLayer) === -1))
		) {
			zoom = zoom + 3;
		}
		this.activeProjName = newOptions.active;

		const prevOptions = this._tileLayers;
		this._tileLayers = newOptions;
		const changedLayers = Object.keys(this._tileLayers.layers).reduce((changed, name) => {
			const activeLayer = activeLayers[name] || {visible: false, opacity: 0};
			const prevActiveLayer = (prevActiveLayers || {})[name] || {visible: false, opacity: 0};
			if (!prevActiveLayers
				|| activeLayer.visible !== prevActiveLayer.visible
				|| activeLayer.opacity !== prevActiveLayer.opacity
				|| (oldActive && oldActive !== newOptions.active && this.overlaysByNames[name])) {
				changed[name] = true;
			}
			return changed;
		}, {});

		Object.keys(changedLayers).forEach(name => {
			const _layer = combinedLayers[name];
			const {opacity, visible} = this._tileLayers.layers[name];
			prevOptions && (!visible || !activeLayers[name]) && this.map.hasLayer(_layer) && _layer.setOpacity(0);
			// Overlays must be reapplied if projection changed.
			oldActive && oldActive !== newOptions.active && this.overlaysByNames[name] && this.map.removeLayer(_layer);
			visible && activeLayers[name] && !this.map.hasLayer(_layer) && this.map.addLayer(_layer);
			visible && activeLayers[name] && _layer.setOpacity(opacity);
		});

		// Zoom levels behave differently on different projections.
		// We bypass the default max zoom behaviour and handle it manually
		// below.
		const maxZoom = Object.keys(activeLayers).reduce((_maxZoom, name) => {
			if (!activeLayers[name]) {
				return;
			}
			const _layer = this.tileLayers[name];
			return _layer && _layer.options.maxZoom < _maxZoom
				? _layer.options.maxZoom
				: _maxZoom;
		}, 19);
		this.map.setMaxZoom(19);
		if (this.activeProjName !== oldActive) {
			// Prevent moveend event triggering layer swap, since view reset below must be ran sequentially.
			this._viewCriticalSection++;
			 // Redraw all layers according to new projection.
			(<any> this.map)._resetView(this.map.getCenter(), this.map.getZoom(), true);
			this.map.setView(center, zoom, {animate: false});
			this.recluster();
			this._viewCriticalSection--;
			this.map.fire("projectionChange", newOptions.active);
		}
		this.map.setMaxZoom(maxZoom);

		let currentLayerName = undefined;
		for (let tileLayerName in this.tileLayers) {
			if (this.tileLayer === this.tileLayers[tileLayerName]) {
				currentLayerName = tileLayerName;
				this.tileLayerName = currentLayerName;
			}
		}

		if (isProvided(this, "tileLayer")) {
			this.map.fire("tileLayerChange", {tileLayerName: currentLayerName});
			this.map.fire("tileLayersChange", {tileLayers: this._tileLayers});
			this.map.fire("overlaysChange", {overlayNames: this.getOverlaysByName()});
		}

		// We need to provide before swapping, or else swapping causes callback loop since it might call this function.
		const _isProvided = isProvided(this, "tileLayer");
		if (!_isProvided) {
			provide(this, "tileLayer");
			this._trySwapToFinnishOnInitialization && this._swapToWorldOutsideFinland(this.map.getCenter());
		}
	}

	getTileLayers(): TileLayersOptions {
		return this._tileLayers;
	}

	@dependsOn("tileLayer")
	setTileLayerOpacity(val, triggerEvent = true) {
		if (!depsProvided(this, "setTileLayerOpacity", arguments)) return;
		if (val === undefined) return;

		if (!this._initialized && this.options.tileLayers) {
			return;
		}

		let initialCall = this.tileLayerOpacity === undefined;

		this.tileLayerOpacity = val;
		if (this.tileLayerName) {
			this.setTileLayers({
				...this._tileLayers,
				layers: {
					...this._tileLayers.layers,
					[this.tileLayerName]: {...this._tileLayers.layers[this.tileLayerName], opacity: val}
				}
			});
		}
		if (!initialCall && triggerEvent) this.map.fire("tileLayerOpacityChange", {tileLayerOpacity: val});
	}

	setOverlays(overlays: L.TileLayer[] = []) {
		if (!this._initialized && this.options.tileLayers) {
			return;
		}
		const bwCompatibleOverlays = {
			...this.overlaysByNames,
			ykjGrid: this.tileLayers.ykjGrid,
			ykjGridLabels: this.tileLayers.ykjGridLabels
		};
		const uniq = (layer) => layer._url + JSON.stringify(layer.options) + JSON.stringify(layer.wmsParams);
		const urlsToNames = Object.keys(bwCompatibleOverlays).reduce((_map, name) => {
			_map[uniq(bwCompatibleOverlays[name])] = name;
			return _map;
		}, {});
		const names = overlays.reduce((_names, layer) => {
			_names[urlsToNames[uniq(layer)]] = true;
			return _names;
		}, {});

		const changes = Object.keys(bwCompatibleOverlays).reduce((_names, name) => {
			_names[name] = {visible: !!names[name], opacity: names[name] ? bwCompatibleOverlays[name].defaultOpacity || 1 : 0};
			return _names;
		}, {});

		this.setTileLayers({...this._tileLayers, layers: {...this._tileLayers.layers, ...changes}});

		provide(this, "overlays");
	}

	// Wrapper that prevents overlay event triggering on initial call.
	_setOverlaysByName(overlayNames: OverlayName[]) {
		this.setOverlaysByName(overlayNames);
	}

	getOverlaysByName(): OverlayName[] {
		return this._tileLayers ? Object.keys(this._tileLayers.layers).reduce((names, name) => {
			if (!this.overlaysByNames[name]) {
				return names;
			}
			const {visible, opacity} = this._tileLayers.layers[name];
			if (visible && opacity) {
				names.push(name);
			}
			return names;
		}, []) : [];
	}

	@dependsOn("tileLayer")
	setOverlaysByName(overlayNames: OverlayName[] = []) {
		if (!depsProvided(this, "setOverlaysByName", arguments)) return;
		this.setOverlays(overlayNames.map(name => this.overlaysByNames[name] || this.tileLayers[name]));
	}

	setAvailableOverlaysBlacklist(overlayNames: OverlayName[]) {
		if (!overlayNames) {
			overlayNames = [];
		}
		this.setAvailableOverlays(overlayNames, false);
	}

	@dependsOn("map")
	setAvailableOverlaysWhitelist(overlayNames: OverlayName[]) {
		if (!depsProvided(this, "setAvailableOverlaysWhitelist", arguments)) return;
		if (!overlayNames) {
			overlayNames = <OverlayName[]> Object.keys(this.overlaysByNames);
		}
		this.setAvailableOverlays(overlayNames, true);
	}

	@dependsOn("map")
	setAvailableOverlays(overlayNames: OverlayName[] = [], condition) {
		if (!depsProvided(this, "setAvailableOverlays", arguments)) return;
		const list = overlayNames.reduce((_list, name) => {
			_list[name] = true;
			return _list;
		}, {});
		this.availableOverlaysByNames = Object.keys(this.overlaysByNames).reduce((overlaysByNames, name) => {
			if (name in list === condition) overlaysByNames[name] = this.overlaysByNames[name];
			return overlaysByNames;
		}, {});
		!isProvided(this, "availableOverlays") && provide(this, "availableOverlays");
		isProvided(this, "tileLayer") && this.setTileLayers(this._tileLayers);
	}

	getNormalizedZoom(zoom?: number, tileLayer?: L.TileLayer): number {
		if (!zoom) {
			zoom = this.map.getZoom();
		}
		return (this._getMMLCRSLayers().indexOf(tileLayer || this.tileLayer) !== -1) ? zoom : zoom - 3;
	}

	getDenormalizedZoom(zoom?: number, tileLayer?: L.TileLayer): number {
		if (typeof zoom !== "number" || isNaN(zoom)) {
			zoom = this.map.getZoom();
		}
		return this._getDefaultCRSLayers().indexOf(tileLayer || this.tileLayer) !== -1 ? zoom + 3 : zoom;
	}

	initZoom(zoom) {
		this.setNormalizedZoom(zoom);
	}

	@dependsOn("map", "view")
	setNormalizedZoom(zoom, options = {animate: false}) {
		this.zoom = zoom;

		if (!depsProvided(this, "setNormalizedZoom", arguments)) {
			provide(this, "zoom");
			return;
		}

		if (this.map) {
			this.map.setZoom(this.getDenormalizedZoom(this.zoom), options);
		}
		if (!isProvided(this, "zoom")) provide(this, "zoom");
	}

	@dependsOn("zoom", "view")
	setCenter(center: L.LatLngExpression) {
		this.center = center;

		if (!depsProvided(this, "setCenter", arguments)) {
			provide(this, "center");
			return;
		}

		if (this.map) {
			this.map.setView(center, this.getDenormalizedZoom(this.zoom), {animate: false});
		}
		if (!isProvided(this, "center")) provide(this, "center");
	}

	destroy() {
		this.cleanDOM();
		this.map && this.map.remove();
		this.map = null;
		Object.keys(this._documentEvents).forEach(type => this._documentEvents[type].forEach(fn => document.removeEventListener(type, fn)));
	}

	cleanDOM() {
		const safeRemove = (from, elem) => from && elem && from.contains(elem) && from.removeChild(elem);
		safeRemove(this.rootElem, this.container);
		safeRemove(this._dialogRoot, this.blockerElem);
		if (this._closeDialog) this._closeDialog();
		this._domCleaners.forEach(cleaner => cleaner());
		this._domCleaners = [];
	}

	_addDomCleaner(fn: () => void) {
		this._domCleaners.push(fn);
	}

	_removeDomCleaner(fn: () => void) {
		this._domCleaners = this._domCleaners.filter(_fn => _fn !== fn);
	}

	_constructDictionary() {
		function decapitalizeFirstLetter(s) {
			return s.charAt(0).toLowerCase() + s.slice(1);
		}

		let dictionaries = {};
		for (let word in translations) {
			for (let lang in translations[word]) {
				const translation = translations[word][lang];
				if (!dictionaries.hasOwnProperty(lang)) {
					dictionaries[lang] = {};
				}
				dictionaries[lang][decapitalizeFirstLetter(word)] = decapitalizeFirstLetter(translation);
				dictionaries[lang][capitalizeFirstLetter(word)] = capitalizeFirstLetter(translation);
			}
		}

		for (let lang in dictionaries) {
			const dictionary = dictionaries[lang];
			for (let key in dictionary) {
				while (dictionary[key].indexOf("$") !== -1) {
					const keyToReplace = dictionary[key].match(/\$\w+/)[0];
					const replaceKey = keyToReplace.substring(1);
					dictionary[key] = dictionary[key].replace(keyToReplace, dictionary[replaceKey]);
				}
			}
		}
		this.dictionary = dictionaries;
	}

	@dependsOn("map")
	setLang(lang: Lang, shouldProvide = true) {
		if (!depsProvided(this, "setLang", arguments)) return;

		if (!this.translations || this.lang !== lang) {
			this.lang = lang;
			this.translations = this.dictionary[this.lang];
			this.onSetLangHooks.forEach(hook => hook());

			shouldProvide && provide(this, "translations");
		}
	}

	formatFeatureOut(feature: G.Feature, layer?: DataItemLayer): G.Feature {
		if (layer && layer instanceof L.Circle) {
			// GeoJSON circles doesn't have radius, so we extend GeoJSON.
			(<any> feature.geometry).radius = layer.getRadius();
		} else if  (feature.geometry.type === "Polygon") {
			// If the coordinates are ordered counterclockwise, reverse them.
			const coordinates = feature.geometry.coordinates[0].slice(0);
			const isClockwise = !coordinatesAreClockWise(coordinates);

			if (!isClockwise) {
				feature = {...feature, geometry: {...feature.geometry, coordinates: [coordinates.reverse()]}};
			}
		}

		const normalizeCoordinates = c => {
			if (typeof c[0] === "number" ) {
				return this.wrapGeoJSONCoordinate(c).map(_c => +_c.toFixed(6));
			} else {
				return c.map(normalizeCoordinates);
			}
		};
		feature = updateImmutablyRecursivelyWith(feature, (key, value) => {
			if (key === "coordinates") {
				value = normalizeCoordinates(value);
			}
			return value;
		});

		const {lajiMapIdx, ...properties} = feature.properties; // eslint-disable-line
		return {...feature, properties};
	}

	formatFeatureIn(feature: G.Feature, idx: number): G.Feature {
		return {...feature, properties: {...feature.properties, lajiMapIdx: idx}};
	}

	cloneFeatures(features: G.Feature[]): G.Feature[] {
		const featuresClone = [];
		for (let i = 0; i < features.length; i++) {
			const feature = features[i];
			featuresClone[i] = this.formatFeatureIn(feature, i);
		}
		return featuresClone;
	}

	initializeDataItem(options: DataOptions, dataIdx?: number) {
		dataIdx = dataIdx === undefined ? this.data.length : dataIdx;

		let item = <Data> (options || {});
		let {geoData, ..._item} = item;
		let format: OnChangeCoordinateSystem = item.format || geoData ? detectFormat(geoData) : undefined;
		const crs = item.crs || (geoData || item.featureCollection) ? detectCRS(geoData || item.featureCollection) : "WGS84";
		if ("geoData" in item) {
			const detectedFormat = detectFormat(geoData);
			format = detectedFormat;
			if (detectedFormat === "GeoJSON") {
				const {type} = (geoData as G.GeoJsonObject);
				if (type === "FeatureCollection" || type === "Feature") {
					format = "GeoJSONFeatureCollection";
				} else {
					format = "GeoJSONGeometryCollection";
				}
			}
			const geoJSON = convertAnyToWGS84GeoJSON(geoData);
			try {
				item = {
					..._item,
					featureCollection: {
						type: "FeatureCollection",
						features: this.cloneFeatures(flattenMultiLineStringsAndMultiPolygons(anyToFeatureCollection(geoJSON).features))
					},
					format, crs
				};
			} catch (e) {
				throw new Error(`Invalid geoJSON type in data[${dataIdx}]`);
			}
			this.initializeDataItem(item, dataIdx);
			return;
		// Flatten features which have a geometry collection a geometry to features of the featureCollection
		} else if (
			item.featureCollection && item.featureCollection.features.some(feature =>
				feature.geometry && feature.geometry.type === "GeometryCollection"
			)
		) {
			const {geometry, ..._featureCollection} = item.featureCollection; // eslint-disable-line @typescript-eslint/no-unused-vars
			item = {
				...item,
				featureCollection: {
					..._featureCollection,
					features: _featureCollection.features.reduce((features, f) => {
						if (f.geometry.type === "GeometryCollection") {
							f.geometry.geometries.forEach(g => {
								features.push({type: "Feature", geometry: g, properties: f.properties});
							});
						} else {
							features.push(f);
						}
						return features;
					}, [])
				}
			};
			this.initializeDataItem(item, dataIdx);
			return;
		}

		const features = item.featureCollection && item.featureCollection.features ?
			item.featureCollection.features :
			[] ;

		item = {
			getFeatureStyle: () => this._getDefaultDataStyle(item)(),
			getClusterStyle: () => this._getDefaultDataClusterStyle(item)(),
			getDraftStyle: (_dataIdx) => this._getDefaultDraftStyle(_dataIdx),
			...item,
			featureCollection: {
				type: "FeatureCollection",
				features: this.cloneFeatures(features)
			},
			hasCustomGetFeatureStyle: item.hasOwnProperty("hasCustomGetFeatureStyle")
				? item.hasCustomGetFeatureStyle
				: !!item.getFeatureStyle,
			idx: dataIdx
		};

		item.hasActive = ("activeIdx" in item);

		this.idxsToIds[dataIdx] = {};
		this.idsToIdxs[dataIdx] = {};
		this._idxsToHovered[dataIdx] = [];
		this._idxsToContextMenuOpen[dataIdx] = [];

		if (this.data[dataIdx] && this.data[dataIdx].groupContainer) {
			this.data[dataIdx].groupContainer.clearLayers();
		}

		this._setOnChangeForItem(item, item.format, item.crs);

		this.data[dataIdx] = item;

		const layer = L.geoJSON(
			convertAnyToWGS84GeoJSON(item.featureCollection),
			{
				pointToLayer: this._featureToLayer(item.getFeatureStyle, dataIdx),
				style: (feature: G.Feature) => {
					return this._getStyleForType([dataIdx, feature.properties.lajiMapIdx]);
				},
				onEachFeature: (feature: G.Feature, _layer: DataItemLayer) => {
					this._initializeLayer(_layer, [dataIdx, feature.properties.lajiMapIdx]);
				}
			}
		);

		item.group = layer;
		item.groupContainer = layer;
		if (item.cluster) {
			item.groupContainer = L.markerClusterGroup(this.getClusterOptionsFor(item));
			item.group.addTo(item.groupContainer);
		}
		item.groupContainer.addTo(this.map);

		if (item.on) Object.keys(item.on).forEach(eventName => {
			item.group.on(eventName, (e: any) => {
				const {layer: _layer} = e;
				const {feature} = _layer;
				const idx = feature.properties.lajiMapIdx;
				if (eventName === "click" && this._interceptClick()) return;
				item.on[eventName](e, {
					idx, // for bw compatibility
					featureIdx: idx,
					dataIdx,
					layer: _layer,
					feature: feature && _layer
						? this.formatFeatureOut(feature, _layer)
						: undefined
				});
			});
		});

		item.group.on("click", (e: L.LayerEvent) => {
			const {feature: {properties: {lajiMapIdx}}} = <any> e.layer;
			if (!this._interceptClick()) this._onActiveChange([item.idx, lajiMapIdx]);
		});

		item.group.on("dblclick", (e: L.LayerEvent) => {
			this._disableDblClickZoom = true;
			const _layer = <DataItemLayer> e.layer;
			this._setEditable(_layer);
			setTimeout(() => {
				this._disableDblClickZoom = false;
			}, 10);
		});

		item.group.on("mouseover", (e: L.LayerEvent) => {
			const _layer = <DataItemLayer> e.layer;
			if (item.editable || item.hasActive || item.highlightOnHover) {
				const [_dataIdx, _featureIdx] = this._getIdxTupleByLayer(_layer);
				this._idxsToHovered[_dataIdx][_featureIdx] = true;
				this.updateLayerStyle(_layer);
			}
			if (isObject(item.showMeasurements) && (item.showMeasurements as ShowMeasurementsOptions).showOnHover) {
				(_layer as any).showMeasurements?.();
			}
		});

		item.group.on("mouseout", (e: L.LayerEvent) => {
			const _layer = <DataItemLayer> e.layer;
			if (item.editable || item.hasActive || item.highlightOnHover) {
				const [_dataIdx, _featureIdx] = this._getIdxTupleByLayer(_layer);
				this._idxsToHovered[_dataIdx][_featureIdx] = false;
				this.updateLayerStyle(_layer);
			}
			if (isObject(item.showMeasurements) && (item.showMeasurements as ShowMeasurementsOptions).showOnHover) {
				(_layer as any).hideMeasurements?.();
			}
		});

		item.group.on("layeradd", (e: L.LayerEvent) => {
			const _layer = <DataItemLayer> e.layer;
			const {featureCollection: {features: _features}} = item;
			const featureIdx = _features.length - 1;
			const feature = this.formatFeatureOut(_layer.toGeoJSON(), _layer);

			feature.properties.lajiMapIdx = featureIdx;
			(<any> _layer).feature = feature;

			if (item.cluster) {
				item.groupContainer.addLayer(_layer);
			}

			this._initializeLayer(_layer, [dataIdx, featureIdx]);
			this.updateLayerStyle(_layer);
		});

		item.group.on("layerremove", (e: L.LayerEvent) => {
			const _layer = <DataItemLayer> e.layer;
			const [_dataIdx, _featureIdx] = this._getIdxTupleByLayer(_layer);
			this._idxsToContextMenuOpen[_dataIdx][_featureIdx] = false;
			this._idxsToHovered[_dataIdx][_featureIdx] = false;
		});
	}

	_getAllData(): {group: L.FeatureGroup}[] {
		const data = [...this.data];
		const draw = this.getDraw();
		if (draw) {
			data.push(draw);
		}
		return data;
	}

	@dependsOn("data", "draw", "view")
	zoomToData(options: ZoomToDataOptions | boolean = {}) {
		if (!depsProvided(this, "zoomToData", arguments)) return;

		if (!options) return;

		if (options && !isObject(options)) {
			options = {};
		}

		const bounds = this.getBoundsForZoomToDataOptions(options);

		if (!bounds.isValid()) return;

		this.fitBounds(bounds, <LajiMapFitBoundsOptions> options);
	}

	getBoundsForZoomToDataOptions(options: ZoomToDataOptions | boolean = {}) {
		if (options && !isObject(options)) {
			options = {};
		}

		const {dataIdxs, draw} = <ZoomToDataOptions> options;
		const datasToZoom = dataIdxs || draw
			? [...(dataIdxs || []), ...(draw ? [this.drawIdx] : [])]
			: undefined;

		return datasToZoom
			? this.getBoundsForIdxs(datasToZoom)
			: this.getBoundsForData();
	}

	getBoundsForDraw() {
		return this.getBoundsForIdxs(this.drawIdx);
	}

	getBoundsForIdxs(...idxs) {
		return this.getBoundsForData(idxs.map(i => this.data[i]));
	}

	getBoundsForData(datas?: {group: L.FeatureGroup}[]): L.LatLngBounds {
		if (!datas) {
			datas = this._getAllData();
		}
		const featureGroup = L.featureGroup(datas.filter(item => item).reduce((layers, item) => {
			const newLayers = this._mapLayersToBoundableLayers(item.group.getLayers());
			layers = [...layers, ...newLayers];
			return layers;
		}, []));
		return featureGroup.getBounds();
	}

	getBoundsForLayers(layers: L.Layer[]) {
		return L.featureGroup(this._mapLayersToBoundableLayers(layers)).getBounds();
	}

	_mapLayersToBoundableLayers(layers: L.Layer[]) {
		return layers.map(layer => {
			if (layer instanceof L.Circle) {  // getBounds fails for circles
				const {lat, lng} = layer.getLatLng();
				const polygonGeoJSON = circleToPolygon([lng, lat], layer.getRadius(), 4);
				return L.polygon(polygonGeoJSON.coordinates[0].map(c => c.slice(0).reverse()));
			}
			return layer;
		});
	}

	_initializeLayer(layer: DataItemLayer, idxTuple: IdxTuple) {
		this._setIdForLayer(layer, idxTuple);
		this._initializePopup(layer);
		this._initializeTooltip(layer);
		this._updateContextMenuForLayer(layer);

		if (isPolyline(layer)) this._decoratePolyline(<L.Polyline> layer);

		const item = this.data[idxTuple[0]];
		if (item.showMeasurements
			&& !(isObject(item.showMeasurements) && (item.showMeasurements as any).showOnHover)) {
			layer.options.showMeasurements = true;
		}
	}

	fitBounds(_bounds: L.LatLngBoundsExpression, options: LajiMapFitBoundsOptions = {}) {
		let bounds = L.latLngBounds((<any> _bounds));
		if (!bounds.isValid()) return;

		const {paddingInMeters} = options;
		if (paddingInMeters) {
			bounds = L.latLngBounds(
				bounds.getSouthWest().toBounds(paddingInMeters).getSouthWest(),
				bounds.getNorthEast().toBounds(paddingInMeters).getNorthEast()
			);
		}
		const {minZoom, maxZoom, ..._options} = options;
		this._swapToWorldOutsideFinland(bounds.getCenter());
		this.map.fitBounds(bounds, <L.FitBoundsOptions> _options);
		if (options.hasOwnProperty("maxZoom")) {
			if (this.getNormalizedZoom() > maxZoom) this.setNormalizedZoom(maxZoom);
		}
		if (options.hasOwnProperty("minZoom")) {
			if (this.getNormalizedZoom() < minZoom) this.setNormalizedZoom(minZoom);
		}
	}

	@dependsOn("map", "translations")
	setData(data: Data[] | Data) {
		if (!depsProvided(this, "setData", arguments)) return;

		this.data.forEach((item, idx) => {
			(idx !== this.drawIdx && item) && item.groupContainer.clearLayers();
		});
		const draw = this.getDraw();
		this.data = [];
		if (draw) {
			this.data[this.drawIdx] = draw;
		}
		if (!Array.isArray(data)) data = [data];
		data.forEach((item, idx) => (idx !== this.drawIdx) && this.updateData(idx, item));
		this.reorderData();
		provide(this, "data");
	}

	getData = () => {
		const data = [...this.data];
		delete data[this.drawIdx];
		return data;
	}

	addData(items: DataOptions[]) {
		if (!items) return;
		if (!Array.isArray(items)) items = [items];
		items.forEach(item => this.initializeDataItem(item));
	}

	updateData(dataIdx, item: DataOptions) {
		this.initializeDataItem(item, dataIdx);
	}

	updateDrawData(item: DrawOptions) {
		this.updateData(this.drawIdx, <DataOptions> this.getDrawOptions(item));
	}

	removeData(dataIdx: number) {
		if (this.data[dataIdx]) {
			this.data[dataIdx].groupContainer.clearLayers();
			delete this.data[dataIdx];
		}
	}

	getDrawOptions(options: DrawOptions | boolean): DrawOptions {
		const drawAllowed = options !== false;

		let draw = {
			...this.getFeatureTypes().reduce((_options, key) => {
				let optionValue = {};
				if (options === false || isObject(options) && options[key] === false) optionValue = false;
				else if (isObject(options) && isObject(options[key])) optionValue = options[key];
				_options[key] = optionValue;
				return _options;
			}, {})
		};
		draw = {
			...draw,
			...{
				...(drawAllowed ? (isObject(options) ? <DrawOptions> options : {}) : {})
			}
		};

		if ((<any> options).data) {
			console.warn("laji-map warning: draw.data is deprecated and HAS BEEN REMOVED! Please move it's content to draw");
		}

		draw = {
			getFeatureStyle: () => this._getDefaultDrawStyle(),
			getClusterStyle: () => this._getDefaultDrawClusterStyle(),
			getDraftStyle: () => this._getDefaultDrawDraftStyle(),
			hasCustomGetFeatureStyle: !!(<any> draw).getFeatureStyle,
			editable: true,
			...draw,
		};

		return draw;
	}

	@dependsOn("map", "data")
	setDraw(options: DrawOptions) {
		if (!depsProvided(this, "setDraw", arguments)) return;

		 // Using a negative idx lets us keep the original data indices.
		if (this.drawIdx === undefined) this.drawIdx = -1;

		this.updateDrawData(options);

		this.resetDrawUndoStack();
		this.reorderData();

		provide(this, "draw");
	}

	getDraw(): Draw {
		return this.data[this.drawIdx];
	}

	drawIsAllowed(): boolean {
		const draw = this.getDraw();
		return this.getFeatureTypes().some(type => draw[type]);
	}

	drawIsEditable(): boolean {
		const draw = this.getDraw();
		return this.drawIsAllowed && draw.editable;
	}

	resetDrawUndoStack() {
		this._drawHistory = [{featureCollection: {
			type: "FeatureCollection",
			features: this.cloneFeatures(this.getDraw().featureCollection.features)
		}}];
		this._drawHistoryPointer = 0;
	}

	drawUndo() {
		if (this._drawHistoryPointer <= 0) return;
		const {undoEvents: events} = this._drawHistory[this._drawHistoryPointer];
		this._drawHistoryPointer--;
		const {featureCollection} = this._drawHistory[this._drawHistoryPointer];
		this.updateData(this.drawIdx, <Data> {...this.getDraw(), featureCollection});
		if (events) {
			events.some(e => {
				if (e.type === "active") {
					this.setActive(this._getLayerByIdxTuple([this.drawIdx, e.idx]));
					return true;
				}
			});
			this._triggerEvent(events, this.getDraw().onChange);
		}
	}

	drawRedo() {
		if (this._drawHistoryPointer >= this._drawHistory.length - 1) return;
		this._drawHistoryPointer++;
		const {featureCollection, redoEvents: events} = this._drawHistory[this._drawHistoryPointer];
		this.updateData(this.drawIdx, <Data> {...this.getDraw(), featureCollection});
		if (events) {
			events.some(e => {
				if (e.type === "active") {
					this.setActive(this._getLayerByIdxTuple([this.drawIdx, e.idx]));
					return true;
				}
			});
			this._triggerEvent(events, this.getDraw().onChange);
		}
	}

	wrapGeoJSONCoordinate([lng, lat]: G.Position): G.Position {
		const wrapped = this.map.wrapLatLng([lat, lng]);
		return [wrapped.lng, wrapped.lat];
	}

	@dependsOn("data")
	_setOnChangeForItem(item, format: OnChangeCoordinateSystem = "GeoJSON", crs = "WGS84") {
		if (!depsProvided(this, "_setOnChangeForItem", arguments)) return;

		const convertCoordinateSystem =
			format === "GeoJSONFeatureCollection" || format === "GeoJSONGeometryCollection"
				? "GeoJSON"
				: format;
		const onChange = item.onChange;
		let converted: G.GeoJSON;
		item.onChange = events => {
			const _events = events.map(e => {
				switch (e.type) {
				case "create":
				case "insert":
					converted = convert(e.feature, convertCoordinateSystem, crs);
					if (converted.type === "FeatureCollection" && format === "GeoJSONGeometryCollection") {
						converted = {
							type: "GeometryCollection",
							geometries: converted.features.map(f => f.geometry)
						};
					}
					e.geoData = converted;
					break;
				case "edit":
					e.geoData = Object.keys(e.features).reduce((_converted, idx) => {
						_converted[idx] = convert(e.features[idx], convertCoordinateSystem, crs);
						if (_converted[idx].type === "FeatureCollection" && format === "GeoJSONGeometryCollection") {
							_converted[idx] = _converted[idx].geometry;
						}
						return _converted;
					}, {});
					break;
				}
				return e;
			});
			onChange && onChange(_events);
		};
	}

	clearItemData(item: Data, commit = true) {
		const prevFeatureCollection = {
			type: "FeatureCollection",
			features: this.cloneFeatures(this.data[item.idx].featureCollection.features)
		};
		const event: LajiMapEvent = {
			type: "delete",
			idxs: Object.keys(this.idxsToIds[item.idx]).map(idx => parseInt(idx)),
			features: this.cloneFeatures(this.data[item.idx].featureCollection.features)
		};
		commit && this._triggerEvent(event, item.onChange);

		this.updateData(item.idx, <DataOptions> {
			...item,
			geoData: undefined,
			featureCollection: {type: "FeatureCollection", features: []}
		});
		this._resetIds(item.idx);
		if (commit && item.idx === this.drawIdx) this._updateDrawUndoStack(event, prevFeatureCollection);
	}

	clearDrawData() {
		this.clearItemData(this.getDraw());
	}

	_startDrawRemove() {
		if (this._onDrawRemove) return;
		this._createTooltip("RemoveFeatureOnClick");

		this._drawRemoveLayers = [];
		this._onDrawRemove = (layer) => {
			this._drawRemoveLayers.push(layer);
			this._removeLayerFromItem(this.getDraw(), layer);
		};
		this.getDraw().group.on("click", ({layer}: L.GeoJSONEvent) => this._onDrawRemove(<DataItemLayer> layer));

		this._addKeyListener(ESC, this._stopDrawRemove);
	}

	_stopDrawRemove() {
		this.getDraw().group.removeEventListener( "click",
			({layer}: L.GeoJSONEvent) => this._onDrawRemove(<DataItemLayer> layer));
		this._onDrawRemove = undefined;
		this._disposeTooltip();
		this._drawRemoveLayers = undefined;
		this._removeKeyListener(ESC, this._stopDrawRemove);
		return true;
	}

	_finishDrawRemove() {
		const layers = this._drawRemoveLayers;
		this._stopDrawRemove();
		if (layers && layers.length) this._onDelete(this.drawIdx, layers.map(layer => L.Util.stamp(layer)));
	}

	_cancelDrawRemove() {
		const layers = this._drawRemoveLayers;
		this._stopDrawRemove();
		if (layers) {
			layers.forEach(layer => {
				this.getDraw().group.addLayer(layer);
				this.updateLayerStyle(layer);
			});
			return true;
		}
		return false;
	}

	_onDrawReverseHandler({layer}: L.GeoJSONEvent) {
		this._onDrawReverse(<DataItemLayer> layer);
	}

	_startDrawReverse() {
		if (this._onDrawReverse) return;
		this._createTooltip("ReverseLineOnClick");
		this._drawReverseLayers = [];
		this._onDrawReverse = (layer) => {
			if (!isPolyline(layer)) return;
			this._drawReverseLayers.push(<L.Polyline> layer);
			this._reversePolyline(layer);
		};
		this.getDraw().group.on("click", this._onDrawReverseHandler);
		this._addKeyListener(ESC, this._stopDrawReverse);
	}

	_stopDrawReverse() {
		if (!this._onDrawReverse) return;
		this.getDraw().group.removeEventListener("click", this._onDrawReverseHandler);
		this._onDrawReverse = undefined;
		this._drawReverseLayers = undefined;
		this._disposeTooltip();
		this._removeKeyListener(ESC, this._stopDrawReverse);
	}

	_finishDrawReverse() {
		const layers = this._drawReverseLayers;
		this._stopDrawReverse();
		if (!layers || !layers.length) return;
		const editData = layers.reduce((idToLayer, layer) => {
			idToLayer[L.Util.stamp(layer)] = {layer};
			return idToLayer;
		}, {});
		this._onEdit(this.drawIdx, editData);
	}

	_cancelDrawReverse() {
		const layers = this._drawReverseLayers;
		this._stopDrawReverse();
		if (!layers) return;
		layers.forEach(layer => {
			layer.setLatLngs(this._origLatLngs[L.Util.stamp(layer)]);
			this._decoratePolyline(layer);
		}, {});
		this._origLatLngs = undefined;
	}

	_createIcon(options: L.PathOptions = {}): L.Icon {
		const markerColor = options.color || NORMAL_COLOR;
		const opacity = options.opacity || 1;
		return new L.VectorMarkers.Icon({
			prefix: "glyphicon",
			icon: "record",
			markerColor,
			opacity
		});
	}

	_getClusterIcon(data: Data): (cluster: L.MarkerCluster) => L.DivIcon {
		return (cluster) => {
			const childCount = cluster.getChildCount();

			let className = " marker-cluster-";
			if (childCount < 10) {
				className += "small";
			} else if (childCount < 100) {
				className += "medium";
			} else {
				className += "large";
			}

			let color =  NORMAL_COLOR;
			let opacity = 0.5;
			if (data.getClusterStyle) {
				const featureStyle = data.getClusterStyle(
					childCount,
					cluster.getAllChildMarkers().map(marker => marker.feature.properties.lajiMapIdx),
					cluster
				);
				if (featureStyle.color) color = featureStyle.color;
				if (featureStyle.opacity) opacity = featureStyle.opacity;
			}

			const styleObject = {
				"background-color": color,
				opacity
			};
			const styleString = Object.keys(styleObject)
				.reduce((style, key) => {
					style += `${key}:${styleObject[key]};`;
					return style;
				}, "");

			return L.divIcon({
				html: `<div style="${styleString}"><span>${childCount}</span></div>`,
				className: `marker-cluster${className}`,
				iconSize: new L.Point(40, 40)
			});
		};
	}

	setActive(layer: DataItemLayer) {
		const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);
		const item = this.data[dataIdx];
		if (!item.hasActive) return;
		const prevActiveIdx = item.activeIdx;
		item.activeIdx = featureIdx;
		const prevActiveLayer =  this._getLayerByIdxTuple([dataIdx, prevActiveIdx]);
		prevActiveLayer && this.updateLayerStyle(prevActiveLayer);
		this.updateLayerStyle(layer);
	}

	_resetIds(dataIdx: number) {
		// Maps item indices to internal ids and the other way around.
		// We use leaflet ids as internal ids.
		this.idxsToIds[dataIdx] = {};
		this.idsToIdxs[dataIdx] = {};

		let counter = 0;
		if (this.data[dataIdx].group) this.data[dataIdx].group.eachLayer((layer: DataItemLayer) => {
			this._setIdForLayer(layer, [dataIdx, counter]);
			counter++;
		});
	}

	_setIdForLayer(layer: DataItemLayer, idxTuple: IdxTuple) {
		const [dataIdx, featureIdx] = idxTuple;
		if (!this.idxsToIds[dataIdx]) {
			this.idxsToIds[dataIdx] = {};
			this.idsToIdxs[dataIdx] = {};
		}
		const id = L.Util.stamp(layer);
		this.idxsToIds[dataIdx][featureIdx] = id;
		this.idsToIdxs[dataIdx][id] = featureIdx;
		this.idsToIdxTuples[id] = [dataIdx, featureIdx];
	}

	recluster() {
		this._reclusterData();
		this._reclusterDrawData();
	}

	_reclusterDrawData() {
		this._reclusterDataItem(this.getDraw());
	}

	_reclusterData() {
		if (this.data) this.data.forEach(item => this._reclusterDataItem(item));
	}

	getClusterOptionsFor(item: Data) {
		return {
			iconCreateFunction: this._getClusterIcon(item),
			...(isObject(item.cluster) ? <L.MarkerClusterGroupOptions> item.cluster : {})
		};
	}

	_reclusterDataItem(item: Data) {
		if (item.cluster) {
			this.map.removeLayer(item.groupContainer);
			item.groupContainer = L.markerClusterGroup(this.getClusterOptionsFor(item)).addTo(this.map);
			item.groupContainer.addLayer(item.group);
		}
	}

	reorderData() {
		this._getAllData().forEach(i => i && i.group.bringToFront());
	}

	redrawDrawData() {
		this.redrawDataItem(this.drawIdx);
	}

	redrawDataItem(idx: number) {
		const dataItem = this.data[idx];
		if (!dataItem || !dataItem.group) return;

		this._updateDataLayerGroupStyle(idx);

		dataItem.group.eachLayer((layer: DataItemLayer) => {
			this._initializePopup(layer);
			this._initializeTooltip(layer);
		});
	}

	redrawData() {
		this.data.forEach((dataItem, idx) => {
			this.redrawDataItem(idx);
		});
	}

	redraw() {
		this.redrawData();
		this.redrawDrawData();
	}

	_initializePopup(layer: DataItemLayer) {
		const [dataIdx] = this._getIdxTupleByLayer(layer);

		const item = this.data[dataIdx];
		if (!item.getPopup) return;

		const that = this;

		let latlng = undefined;

		function openPopup(content) {
			const [, featureIdx] = that._getIdxTupleByLayer(layer);
			if (!latlng) return;
			if (that.editIdxTuple && that.editIdxTuple[0] === dataIdx && that.editIdxTuple[1] ===  featureIdx) return;

			const {markerPopupOffset = 40, featurePopupOffset = 5} = that;
			const offset = (layer instanceof L.Marker) ? (-markerPopupOffset  || 0) : (-featurePopupOffset || 0);

			that.popup = new (<any> L).Rrose({offset: new L.Point(0, offset), closeButton: !that.popupOnHover, autoPan: false, y_bound: 80 - offset})
				.setContent(content)
				.setLatLng(latlng)
				.openOn(that.map);
		}

		function closePopup() {
			if (latlng) that.map.closePopup();
			if (that.onPopupClose) that.onPopupClose();
			latlng = undefined;
		}

		function getContentAndOpenPopup(_latlng) {
			const [, featureIdx] = that._getIdxTupleByLayer(layer);
			if (!that.popupCounter) that.popupCounter = 0;
			that.popupCounter++;

			latlng = _latlng;

			let {popupCounter} = that;

			// Allow either returning content or firing a callback with content.

			const content = item.getPopup({dataIdx, featureIdx, feature: that.formatFeatureOut(layer.toGeoJSON(), layer), item},
				callbackContent => that.popupCounter === popupCounter && openPopup(callbackContent)
			);
			content !== undefined && typeof content !== "function" && openPopup(content);
		}

		if (this.popupOnHover) {
			layer.on("mousemove", (e: L.LeafletMouseEvent) => {
				latlng = e.latlng;
				if (that.popup) that.popup.setLatLng(latlng);
			});
			layer.on("mouseover", (e: L.LeafletMouseEvent) => {
				getContentAndOpenPopup(e.latlng);
			});
			layer.on("mouseout", () => {
				closePopup();
			});
			layer.on("remove", () => {
				closePopup();
			});
		} else {
			layer.on("click", (e: L.LeafletMouseEvent) => {
				if (item.getPopup) {
					closePopup();
					getContentAndOpenPopup(e.latlng);
				}
			});
		}
	}

	_initializeTooltip(layer: DataItemLayer) {
		const openTooltip = () => {
			const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);

			const item = this.data[dataIdx];
			if (!item.getTooltip) return;

			function _openTooltip(content) {
				layer.bindTooltip(content, item.tooltipOptions).openTooltip();
			}

			// Allow either returning content or firing a callback with content.
			const content = item.getTooltip(
				{dataIdx, featureIdx, feature: this.formatFeatureOut(layer.toGeoJSON(), layer), item},
				callbackContent => _openTooltip(callbackContent)
			);
			if (content !== undefined && typeof content !== "function") _openTooltip(content);
		};

		const closeTooltip = () =>  {
			layer.unbindTooltip();
		};

		layer.on("mouseover", () => {
			openTooltip();
		});
		layer.on("mouseout", () => {
			closeTooltip();
		});
	}

	@dependsOn("translations")
	_updateContextMenuForLayer(layer: DataItemLayer) {
		if (!depsProvided(this, "_updateContextMenuForLayer", arguments)) return;

		const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);

		const { translations } = this;
		layer.unbindContextMenu();

		let contextmenuItems = [];

		if (this.data[dataIdx] && this.data[dataIdx].editable) {
			contextmenuItems = [
				{
					text: translations.EditFeature,
					callback: () => this._setEditable(layer),
					iconCls: "glyphicon glyphicon-pencil"
				},
				{
					text: translations.DeleteFeature,
					callback: () => this._onDelete(dataIdx, this.idxsToIds[dataIdx][featureIdx]),
					iconCls: "glyphicon glyphicon-trash"
				},
			];
			if (isPolyline(layer)) {
				contextmenuItems.push({
					text: translations.ReverseFeature,
					callback: () => {
						this._reversePolyline(layer);
						const id = this.idxsToIds[dataIdx][featureIdx];
						this._onEdit(dataIdx, {[id]: {layer}});
					},
					iconCls: "glyphicon glyphicon-sort"
				});
			}
		}

		layer.bindContextMenu({
			contextmenuInheritItems: false,
			contextmenuItems
		});
	}

	setLocate(locate: UserLocationOptions | boolean = false) {
		const defaultOptions: UserLocationOptions = {
			on: true,
			onLocationFound: undefined,
			onLocationError: undefined,
			userLocation: undefined,
			panOnFound: true
		};
		let options = defaultOptions;
		if (isObject(locate)) {
			options = {...defaultOptions, ...(<UserLocationOptions> locate)};
		} else if (typeof locate === "boolean") {
			options = {...defaultOptions, on: !!locate};
		} else if (Array.isArray(locate)) {
			console.warn("laji-map warning: locate signature has changed, read the README. Options in array format will be removed in the future!");
			options = {
				...defaultOptions,
				onLocationFound: locate[0],
				onLocationError: locate[1],
				userLocation: locate[2]
			};
		}
		const locateOn = locate
			? options.on
			: !!locate;
		this.locateOptions = options;
		this._locateParam = locate;
		locateOn
			? this._setLocateOn()
			: this.userLocationMarker
				? this.userLocationMarker.remove() && this.userLocationRadiusMarker.remove()
				: undefined;
	}

	@dependsOn("map")
	_setLocateOn(triggerEvent = false) {
		if (!depsProvided(this, "_setLocateOn", arguments)) return;

		const {on, userLocation} = this.locateOptions;
		if (on && this._located === undefined && userLocation) {
			this._onLocationFound(<L.LocationEvent> userLocation);
		}
		this.map.locate({watch: true, enableHighAccuracy: true});
		triggerEvent && this.map.fire("locateToggle", {locate: typeof this._locateParam === "boolean"
			? true
			: {...this.locateOptions, on: true}
		});
	}

	@dependsOn("map")
	_setLocateOff() {
		if (!depsProvided(this, "_setLocateOff", arguments)) return;
		this.map.stopLocate();
		if (this.userLocationLayer) {
			this.userLocationLayer.remove();
			this.userLocationLayer = undefined;
			this.userLocationMarker = undefined;
			this.userLocationRadiusMarker = undefined;
		}
		const {on, onLocationFound} = this.locateOptions;
		if (on && onLocationFound) onLocationFound(undefined);
		this._located = false;
		this.map.fire("locateToggle", {locate: typeof this._locateParam === "boolean"
			? false
			: {...this.locateOptions, on: false}
		});
	}

	@dependsOn("map")
	_onLocationFound({latlng, accuracy, bounds}: L.LocationEvent) {
		if (!depsProvided(this, "_onLocationFound", arguments)) return;

		if (!this._located && bounds && this.locateOptions.panOnFound) this.map.fitBounds(bounds);
		this._located = true;

		if (this.userLocationLayer) {
			this.userLocationRadiusMarker.setLatLng(latlng).setRadius(accuracy);
			this.userLocationMarker.setLatLng(latlng);
		} else {
			const {layerGroup, markerLayer, radiusLayer} = this.createUserLocationLayer(latlng, accuracy);
			this.userLocationLayer = layerGroup;
			this.userLocationRadiusMarker = radiusLayer;
			this.userLocationMarker = markerLayer;

			layerGroup.addTo(this.map);
		}

		this.userLocation = {latlng, accuracy};
		if (this.locateOptions.onLocationFound) this.locateOptions.onLocationFound(latlng, accuracy);
	}

	createUserLocationLayer(latlng: L.LatLng, accuracy: number): {layerGroup: L.LayerGroup, markerLayer: L.CircleMarker, radiusLayer: L.Circle} {
		const layerGroup = L.layerGroup();
		const radiusLayer = L.circle(latlng,
			{
				radius: accuracy,
				color: USER_LOCATION_COLOR,
				fillColor: USER_LOCATION_COLOR,
				opacity: 0
			}).addTo(layerGroup);
		const markerLayer = L.circleMarker(latlng,
			{
				color: USER_LOCATION_COLOR,
				fillColor: USER_LOCATION_COLOR,
				fillOpacity: 0.7
			}).addTo(layerGroup);
		markerLayer.on("click", () => {
			!this._interceptClick() && this.map.fitBounds(radiusLayer.getBounds());
		});

		return {layerGroup, markerLayer, radiusLayer};
	}

	_onLocationNotFound(e: L.ErrorEvent) {
		const {onLocationError} = this.locateOptions;
		if (onLocationError) onLocationError(e);
	}

	getDrawLayerByIdx(idx: number) {
		return this._getLayerByIdxTuple([this.drawIdx, idx]);
	}

	_getLayerByIdxTuple = this.getLayerByIdxTuple;

	getLayerByIdxTuple(idxTuple: IdxTuple): DataItemLayer {
		const [dataIdx, featureIdx] = idxTuple;
		const item = this.data[dataIdx];
		const id = this.idxsToIds[dataIdx][featureIdx];
		return item.group ? <DataItemLayer> item.group.getLayer(id) : undefined;
	}

	_getLayerById(id: number): DataItemLayer {
		const [dataIdx] = this.idsToIdxTuples[id];
		return <DataItemLayer> this.data[dataIdx].group.getLayer(id);
	}

	_getIdxTupleByLayer(layer) {
		return this.idsToIdxTuples[layer._leaflet_id];
	}

	_getDrawLayerById(id) {
		return this._getLayerById(id);
	}

	_triggerEvent(e, handler) {
		if (!Array.isArray(e)) e = [e];
		if (handler) handler(e);
	}

	_decoratePolyline(layer: L.Polyline) {
		if (!isPolyline(layer)) return;

		const idxTuple =  this._getIdxTupleByLayer(layer);

		const {showStart, showDirection = true}: CustomPolylineOptions = this._fillStyleWithGlobals(idxTuple);

		function warn() {
			console.warn("Failed to add a starting point to line");
		}

		const typelessLayer = <any> layer;

		if (showDirection !== false) {
			const {clickable} = typelessLayer;
			typelessLayer.options.clickable = false;
			try {
				layer.setText(null).setText("→", {repeat: true, attributes: {"dy": 5, "font-size": 18}});
			} catch (e) {
				console.warn("laji-map polyline text decorating failed");
			}
			typelessLayer.options.clickable = clickable;
		}

		if (!showStart) return;

		let firstPoint = undefined;

		if (!layer.feature.geometry.type) {
			warn();
			return;
		}

		switch (layer.feature.geometry.type) {
		case "MultiLineString":
			firstPoint = layer.getLatLngs()[0][0];
			break;
		case "LineString":
			firstPoint = layer.getLatLngs()[0];
			break;
		default:
			throw new Error("Tried to decorate a line layer but wasn't a line");
		}

		if (!firstPoint) {
			warn();
			return;
		}

		if (typelessLayer._startCircle) {
			typelessLayer._startCircle.remove();
		}
		typelessLayer._startCircle = L.circleMarker(firstPoint, this._getStartCircleStyle(layer)).addTo(this.map);
		layer.on("editdrag", () => {
			typelessLayer._startCircle.setLatLng(layer.getLatLngs()[0]);
		});
		layer.on("remove", () => {
			typelessLayer._startCircle.remove();
		});
		layer.on("add", () => {
			typelessLayer._startCircle.addTo(this.map);
		});

		const {bringToFront} = typelessLayer.__proto__;
		typelessLayer.__proto__.bringToFront = () => {
			bringToFront.call(typelessLayer);
			typelessLayer._startCircle.bringToFront();
		};
	}

	_reversePolyline(layer) {
		const {type} = layer.feature.geometry;

		if (type === "LineString") {
			if (!this._origLatLngs) {
				this._origLatLngs = {};
			}
			const id = L.Util.stamp(layer);
			if (!this._origLatLngs[id]) this._origLatLngs[id] = layer.getLatLngs();
			layer.setLatLngs(layer.getLatLngs().slice(0).reverse());
			this._decoratePolyline(layer);
		}
	}

	_getStartCircleStyle(lineLayer): L.PathOptions {
		let options = {
			...(this.polyline || {}),
			...lineLayer.options,
		};

		return {
			...options,
			weight: 0,
			radius: options.weight + 1,
			fill: true,
			fillOpacity: 1,
		};
	}

	_updateDrawUndoStack(events: LajiMapEvent[] | LajiMapEvent, prevFeatureCollection, prevActiveIdx?) {
		if (this._drawHistoryPointer < this._drawHistory.length - 1) {
			this._drawHistory = this._drawHistory.splice(0).splice(0, this._drawHistoryPointer + 1);
		}

		const featureCollection: G.FeatureCollection = {
			type: "FeatureCollection",
			features: this.cloneFeatures(this.getDraw().featureCollection.features)
		};

		let reverseEvents = [];
		(Array.isArray(events) ? events : [events]).forEach(e => {
			switch (e.type) {
			case "create":
				reverseEvents.push({
					type: "delete",
					idxs: [featureCollection.features.length - 1]
				});
				break;
			case "edit":
				reverseEvents.push({
					type: "edit",
					features: Object.keys(e.features).reduce((features, idx) => {
						features[idx] = prevFeatureCollection.features[idx];
						return features;
					}, {}),
					idxs: [featureCollection.features.length - 1]
				});
				break;
			case "delete":
				e.idxs.sort().reverse().forEach(idx => reverseEvents.push({
					type: "insert",
					idx,
					feature: prevFeatureCollection.features[idx]
				}));
				break;
			case "active":
				reverseEvents.push({
					type: "active",
					idx: prevActiveIdx
				});
				break;
			}
		});

		this._drawHistory.push({
			featureCollection,
			undoEvents: reverseEvents,
			redoEvents: Array.isArray(events) ? events : [events]
		});
		this._drawHistoryPointer++;
	}

	_onAdd(dataIdx: number, layer: DataItemLayer, coordinateVerbatim?: string) {
		if (isPolyline(layer) && (<L.Polyline> layer).getLatLngs().length < 2) return;

		const prevActiveIdx = this.data[dataIdx].activeIdx;

		let item = this.data[dataIdx];
		const {single, featureCollection: {features}} = item;
		const feature = this.formatFeatureOut((<any> layer).toGeoJSON(), layer);

		if (coordinateVerbatim && feature.geometry) {
			(<any> feature.geometry).coordinateVerbatim = coordinateVerbatim;
		}

		if (single && features.length > 0) {
			this.clearItemData(item, !"commit");
			item = this.data[dataIdx];
			item.featureCollection.features = [features[features.length - 1]];
			item.group.addLayer(layer);
			this._onEdit(dataIdx, {[L.Util.stamp(layer)]: {layer, coordinateVerbatim}});
			return;
		}

		features.push(feature);

		item.group.addLayer(layer);

		if (item.showMeasurements
			&& !(isObject(item.showMeasurements) && (item.showMeasurements as any).showOnHover)) {
			layer.showMeasurements?.();
		}

		const events: LajiMapEvent[] = [
			{
				type: "create",
				feature
			},
		];
		if (item.hasActive) {
			events.push({type: "active", idx: features.length - 1});
		}

		this._triggerEvent(events, item.onChange);

		if (dataIdx === this.drawIdx) {
			this._updateDrawUndoStack(events, undefined, prevActiveIdx);
		}

		if (item.hasActive) {
			this.setActive(this._getLayerByIdxTuple([dataIdx, features.length - 1]));
		}
	}

	_onEdit(dataIdx, data) {
		// Fix bug:
		// 1. Circle in edit mode
		// 2. Move the circle
		// 3. Open context menu for it
		// 4. Click outside circle to stop editing
		// 5. If draw onChange resets draw data, contextmenu crashes
		if (this._contextMenuLayer) {
			(this.map.contextmenu as any).hide();
		}

		const eventData = {};

		const prevFeatureCollection = {
			type: "FeatureCollection",
			features: this.cloneFeatures(this.data[dataIdx].featureCollection.features)
		};

		for (let id in data) {
			const {layer, coordinateVerbatim} = data[id];
			const feature = this.formatFeatureOut(layer.toGeoJSON(), layer);
			if (coordinateVerbatim && feature.geometry) {
				(<any> feature.geometry).coordinateVerbatim = coordinateVerbatim;
			}
			const idx = this.idsToIdxs[dataIdx][id];
			eventData[idx] = feature;
			this.data[dataIdx].featureCollection.features[idx] = this.formatFeatureIn(feature, idx);
		}

		for (let id in data) {
			const layer = this._getLayerById(+id);

			if (layer) {
				layer.closePopup().closeTooltip();
			}
		}

		const item = this.data[dataIdx];

		const event = {
			type: "edit",
			features: eventData
		} as LajiMapEditEvent;

		this._triggerEvent(event, item.onChange);

		if (dataIdx === this.drawIdx) {
			this._updateDrawUndoStack(event, prevFeatureCollection);
		}
	}

	_onDelete(dataIdx, deleteIds) {
		this._clearEditable();

		const prevFeatureCollection = {
			type: "FeatureCollection",
			features: this.cloneFeatures(this.data[dataIdx].featureCollection.features)
		};

		if (!Array.isArray(deleteIds)) deleteIds = [deleteIds];
		const deleteIdxs = deleteIds.map(id => this.idsToIdxs[dataIdx][id]);

		const item = this.data[dataIdx];
		const activeIdx = item.activeIdx;

		const {featureCollection: {features}} = item;

		const survivingIds = Object.keys(this.idsToIdxs[dataIdx])
			.map(id => parseInt(id)).filter(id => deleteIds.indexOf(id) === -1);

		let changeActive = false;
		let newActiveId = undefined;
		const activeId = this.idxsToIds[dataIdx][activeIdx];
		if (item.hasActive) {
			if (features && survivingIds.length === 0) {
				changeActive = true;
			} else if (activeIdx !== undefined && deleteIds.indexOf(activeId) !== -1) {
				changeActive = true;

				let closestSmallerId = undefined;
				let closestGreaterId = undefined;
				let closestDistance = undefined;
				let closestNegDistance = undefined;

				survivingIds.forEach(id => {
					const dist = activeIdx - this.idsToIdxs[dataIdx][id];
					if (dist > 0 && (closestDistance === undefined || dist < closestDistance)) {
						closestDistance = dist;
						closestSmallerId = id;
					} else if (dist < 0 && (closestNegDistance === undefined || dist > closestNegDistance)) {
						closestNegDistance = dist;
						closestGreaterId = id;
					}
				});

				if (closestGreaterId !== undefined) newActiveId = closestGreaterId;
				else if (closestSmallerId !== undefined) newActiveId = closestSmallerId;
			} else {
				newActiveId = activeId;
				changeActive = true;
			}
		}

		const deletedFeatures = [];
		item.featureCollection.features = features.filter((feature, i) => {
			const filter = deleteIdxs.indexOf(i) === -1;
			if (!filter) {
				deletedFeatures.push(feature);
			}
			return filter;
		});

		deleteIds.forEach(id => {
			this._removeLayerFromItem(item, this._getLayerById(id));
		});

		this._resetIds(dataIdx);

		item.group.eachLayer((layer: DataItemLayer) => {
			this._updateContextMenuForLayer(layer);
		});

		this._reclusterDataItem(dataIdx);

		const events: LajiMapEvent[] = [{
			type: "delete",
			idxs: deleteIdxs,
			features: deletedFeatures
		}];

		if (changeActive) {
			events.push({type: "active", idx: this.idsToIdxs[dataIdx][newActiveId]});
		}

		this._triggerEvent(events, item.onChange);

		if (dataIdx === this.drawIdx) {
			this._updateDrawUndoStack(events, prevFeatureCollection, newActiveId ? activeIdx : undefined);
		}

		if (changeActive) {
			this.setActive(this._getLayerByIdxTuple([dataIdx, this.idsToIdxs[dataIdx][newActiveId]]));
		}

	}

	_removeLayerFromItem(item: Data, layer: DataItemLayer) {
		if (item.group !== item.groupContainer && item.groupContainer.hasLayer(layer)) {
			item.groupContainer.removeLayer(layer);
		}
		if (item.group.hasLayer(layer)) {
			item.group.removeLayer(layer);
		}
	}

	_onActiveChange(idxTuple: IdxTuple) {
		const [dataIdx, featureIdx] = idxTuple;
		const item = this.data[dataIdx];
		if (item.hasActive) {
			this._triggerEvent({type: "active", idx: featureIdx}, item.onChange);
			this.setActive(this._getLayerByIdxTuple(idxTuple));
		}
	}

	focusToLayerByIdxs(idxTuple: IdxTuple) {
		const [dataIdx, featureIdx] = idxTuple;
		const id = this.idxsToIds[dataIdx][featureIdx];

		if (featureIdx === undefined) {
			return;
		}

		let layer = this._getDrawLayerById(id);
		if (!layer) return;

		if (layer instanceof L.Marker) {
			this.map.panTo(layer.getLatLng(), {animate: false});
		} else	{
			this.map.fitBounds((<any> layer).getBounds());
		}

		this._onActiveChange(idxTuple);
	}

	focusToDrawLayer(idx: number) {
		this.focusToLayerByIdxs([this.drawIdx, idx]);
	}

	_setEditable(layer: DataItemLayer) {
		const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);
		const item = this.data[dataIdx];
		if (!item.editable || this._onDrawRemove || this._onDrawReverse) return;
		this._clearEditable();
		this.editIdxTuple = [dataIdx, featureIdx];
		const editLayer = this._getLayerByIdxTuple(this.editIdxTuple);
		if (item.cluster) {
			item.groupContainer.removeLayer(editLayer);
			this.map.addLayer(editLayer);
		}
		const layerOptions: any = (<any> editLayer).options;
		layerOptions.editing || (layerOptions.editing = {}); // See https://github.com/Leaflet/Leaflet.draw/issues/804
		(<any> layer).editing.enable();
		if (!(<any> this.map)._editTooltip) {
			 // For some reason editing circle radius fails without this
			(<any> this.map)._editTooltip = {updateContent: () => { /* empty */ }};
		}
		editLayer.closePopup();
		this.updateLayerStyle(editLayer);
	}

	_clearEditable() {
		if (this.editIdxTuple === undefined) return;
		const editLayer = this._getLayerByIdxTuple(this.editIdxTuple);
		(<any> editLayer).editing.disable();
		const item = this.data[this.editIdxTuple[0]];
		if (item.cluster) {
			this.map.removeLayer(editLayer);
			item.groupContainer.addLayer(editLayer);
		}
		this._reclusterDataItem(item);
		this.editIdxTuple = undefined;
	}

	_commitEdit() {
		const {editIdxTuple} = this;
		const [dataIdx, featureIdx] = editIdxTuple;
		const editId = this.idxsToIds[dataIdx][featureIdx];
		this._clearEditable();
		const editLayer = this._getLayerByIdxTuple(editIdxTuple);
		this.updateLayerStyle(editLayer);
		this._onEdit(dataIdx, {[editId]: {layer: editLayer}});
	}

	// Returns true if click was intercepted
	_interceptClick(): boolean {
		if (this._onDrawRemove || this._onDrawReverse || this.drawing) return true;
		if (this.editIdxTuple !== undefined) {
			this._commitEdit();
			return true;
		}
		return false;
	}

	setLayerStyle(layer: DataItemLayer | L.FeatureGroup, style: L.PathOptions) {
		if (!layer) return;

		layer.setStyle(style);
		if ((<any> layer)._startCircle) (<any> layer)._startCircle.setStyle(this._getStartCircleStyle(layer));
	}

	_featureToLayer(getFeatureStyle: (options: GetFeatureStyleOptions) => L.PathOptions, dataIdx?: number) {
		function reversePointCoords(coords: L.LatLngExpression): L.LatLngExpression {
			return [coords[1], coords[0]];
		}
		return (feature) => {
			let layer;
			if (feature.geometry.type === "Point") {
				const latLng = reversePointCoords(feature.geometry.coordinates);
				const params = {feature, featureIdx: feature.properties.lajiMapIdx};
				if (dataIdx !== undefined) params[dataIdx] = dataIdx;
				layer = (feature.geometry.radius)
					? new L.Circle(latLng, feature.geometry.radius)
					: L.marker(latLng, {
						icon: this._createIcon(getFeatureStyle(params))
					});
			} else {
				layer = L.GeoJSON.geometryToLayer(feature);
			}
			return layer;
		};
	}

	_getDefaultDrawDraftStyle(): L.PathOptions {
		return this._getStyleForType(
			[this.drawIdx, undefined],
			{color: EDITABLE_DATA_LAYER_COLOR, fillColor: EDITABLE_DATA_LAYER_COLOR, opacity: 0.8}
		);
	}

	_fillStyleWithGlobals<T extends L.PathOptions> (idxTuple: IdxTuple): T {
		const [dataIdx, featureIdx] = idxTuple;
		const layer = this._getLayerByIdxTuple(idxTuple);
		const item = this.data[dataIdx];
		const feature = item.featureCollection.features[featureIdx];
		const dataStyles = item.getFeatureStyle({
			dataIdx,
			featureIdx,
			feature,
			item
		});

		const mergeOptions = (type: DataItemType) => {
			return {...(this[type] || {}), ...(item[type] || {})};
		};

		let featureTypeStyle = undefined;
		if (layer) {
			if (layer instanceof L.Marker) {
				featureTypeStyle = mergeOptions("marker");
			} else if (isPolyline(layer)) {
				featureTypeStyle = mergeOptions("polyline");
			} else if (layer instanceof L.Rectangle) {
				featureTypeStyle = mergeOptions("rectangle");
			} else if (layer instanceof L.Polygon) {
				featureTypeStyle = mergeOptions("polygon");
			} else if (layer instanceof L.Circle) {
				featureTypeStyle = mergeOptions("circle");
			}
		} else {
			switch (feature.geometry.type) {
			case "LineString":
			case "MultiLineString":
				featureTypeStyle = mergeOptions("polyline");
				break;
			case "Polygon":
				featureTypeStyle = mergeOptions("polygon");
				break;
			case "Point":
				featureTypeStyle = ((<any> feature.geometry).radius) ? mergeOptions("circle") : mergeOptions("marker");
				break;
			}
		}

		return {...(featureTypeStyle || {}), ...(dataStyles || {})};
	}

	_getStyleForType(idx: IdxTuple | number, overrideStyles: L.PathOptions = {}): L.PathOptions {
		let dataIdx, featureIdx;
		if (typeof idx === "number") {
			dataIdx = idx;
		} else {
			[dataIdx, featureIdx] = idx;
		}
		const item = this.data[dataIdx];
		const feature = item.featureCollection.features[featureIdx];
		const active = item.activeIdx === featureIdx;
		let editing = false;
		if (this.editIdxTuple) {
			const [_dataIdx, _featureIdx] = this.editIdxTuple;

			if (_dataIdx === dataIdx && _featureIdx === featureIdx) {
				editing = true;
			}
		}
		const hovered = (
			dataIdx !== undefined &&
			featureIdx !== undefined &&
			this._idxsToHovered[dataIdx][featureIdx]
		);

		let dataStyles = undefined;
		if (item.getFeatureStyle) {
			dataStyles = item.getFeatureStyle({
				dataIdx,
				featureIdx,
				feature,
				item,
				active,
				editing,
				hovered
			});
			if (dataStyles.color && !dataStyles.fillColor) {
				dataStyles.fillColor = dataStyles.color;
			}
		} else {
			dataStyles = this._fillStyleWithGlobals([dataIdx, featureIdx]);
		}

		let layer = undefined;
		if (this.idxsToIds[dataIdx]) layer = this._getLayerByIdxTuple([dataIdx, featureIdx]);

		const isLine = (
			layer && isPolyline(layer)
			||
			feature && (feature.geometry.type === "LineString" || feature.geometry.type === "MultiLineString")
		);

		let style: L.PathOptions = {
			opacity: 1,
			fillOpacity: 0.4,
			color: NORMAL_COLOR,
			fillColor: NORMAL_COLOR,
		};
		if (isLine) {
			style.weight = 10;
		}
		style = {
			...style,
			...dataStyles,
			...overrideStyles
		};

		const colors = [];

		if (!item.hasCustomGetFeatureStyle && active) {
			colors.push(["#00ff00", 80]);
		}

		if (!item.hasCustomGetFeatureStyle && editing) {
			const r = active ? "--" : "00";
			const b = r;
			colors.push([`#${r}ff${b}`, 30]);
		}

		if (!item.hasCustomGetFeatureStyle && hovered) {
			colors.push(["#ffffff", 30]);
		}

		if (colors.length || this._idxsToContextMenuOpen[dataIdx][featureIdx]) {
			style = {...style};
			["color", "fillColor"].forEach(prop => {
				if (style[prop]) {
					let finalColor = undefined;
					if (
						this._idxsToContextMenuOpen[dataIdx][featureIdx]
						|| hovered && (this._onDrawRemove || (this._onDrawReverse && isLine))
					) {
						finalColor = "#ff0000";
					} else {
						finalColor = colors.reduce((combined, [color, amount]) => combineColors(combined, color, amount), style[prop]);
					}
					style[prop] = finalColor;
				}
			});
		}
		return style;
	}

	_getStyleForLayer(layer: DataItemLayer, overrideStyles?): L.PathOptions {
		const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);
		return this._getStyleForType([dataIdx, featureIdx], overrideStyles);
	}

	updateLayerStyle(layer: DataItemLayer) {
		if (!layer) return;
		this.setLayerStyle(layer, this._getStyleForLayer(layer));
	}

	_getDefaultDrawStyle(): L.PathOptions {
		return {color: NORMAL_COLOR, fillColor: NORMAL_COLOR, opacity: 1, fillOpacity: 0.7};
	}

	_getDefaultDrawClusterStyle(): L.PathOptions {
		return {color: this.getDraw().getFeatureStyle({}).color, opacity: 1};
	}

	_getDefaultDataStyle(item: Data): () => L.PathOptions {return () => {
		const color = (item && item.editable) ?
			EDITABLE_DATA_LAYER_COLOR :
			DATA_LAYER_COLOR;
		return {color, fillColor: color, opacity: 1, fillOpacity: 0.7};
	}; }

	_getDefaultDataClusterStyle = (item) => () => {
		let color = item.editable ? EDITABLE_DATA_LAYER_COLOR : DATA_LAYER_COLOR;
		if (item.getFeatureStyle) {
			const style = item.getFeatureStyle({});
			if (style.color) color = style.color;
		}
		return {color, opacity: 1};
	}

	_getDefaultDraftStyle(dataIdx: number): L.PathOptions {
		return this._getStyleForType(
			dataIdx,
			{color: EDITABLE_DATA_LAYER_COLOR, fillColor: EDITABLE_DATA_LAYER_COLOR, opacity: 0.8}
		);
	}

	_updateDataLayerGroupStyle(idx: number) {
		const item = this.data[idx];
		if (!item) return;

		item.group.eachLayer((layer: DataItemLayer) => {
			this.updateLayerStyle(layer);
		});
	}

	addTranslationHook(
		elemOrFn: HTMLElement | (() => void),
		translationKey?: string | (() => string),
		attr = "innerHTML"): () => void {
		const that = this;

		function translate() {
			if (typeof elemOrFn === "function") {
				const fn = elemOrFn;
				fn();
			} else {
				const elem = elemOrFn;
				const translation = (typeof translationKey === "function") ? translationKey() : that.translations[translationKey];

				if (typeof elem[attr] === "function") {
					elem[attr](translation);
				} else {
					elem[attr] = translation;
				}
			}
		}

		translate();
		this.onSetLangHooks.push(translate);
		return translate;
	}

	removeTranslationHook(hook: () => void) {
		const index = this.onSetLangHooks.indexOf(hook);
		if (index >= 0) {
			this.onSetLangHooks.splice(index, 1);
		}
	}

	_getDrawOptionsForType<T extends L.PathOptions> (featureType: DataItemType): T  {
		const baseStyle = this.getDraw().getDraftStyle();

		interface AdditionalOptions {
			shapeOptions?: any;
			allowIntersection?: boolean;
			icon?: any;
		}
		let additionalOptions: AdditionalOptions = {};

		switch (featureType) {
		case "marker":
			additionalOptions = {
				icon: this._createIcon({...this.getDraw().getDraftStyle()})
			};
			break;
		case "polygon":
			additionalOptions = {
				allowIntersection: false
			};
			break;
		}

		const _userDefined = this.getDraw()[featureType];
		const userDefined = isObject(_userDefined) ? <any> _userDefined : {};

		return {
			metric: true,
			showLength: true,
			showRadius: true,
			...additionalOptions,
			...userDefined,
			shapeOptions: {
				showArea: true,
				poly: {
					allowIntersection: false
				},
				...baseStyle,
				...(additionalOptions.shapeOptions || {}),
				...userDefined
			}
		};
	}

	abortDrawing(e?: Event) {
		if (e.preventDefault) {
			e.preventDefault();
			e.stopPropagation();
		}
		if (this._draftDrawLayer) (<any> this._draftDrawLayer).disable();
		this._draftDrawLayer = undefined;
		this._removeKeyListener(ESC, this.abortDrawing);
		this.map.off("controlClick", this.abortDrawing);
		this.map.removeEventListener("draw:created", this.abortDrawing);
	}

	addDrawAbortListeners() {
		this.map.on("draw:created", this.abortDrawing);
		this.map.on("controlClick", this.abortDrawing);
		this._addKeyListener(ESC, this.abortDrawing);
	}

	triggerDrawing(featureType: DataItemType) {
		this._draftDrawLayer = new L.Draw[capitalizeFirstLetter(featureType)](
			this.map,
			this._getDrawOptionsForType(featureType)
		);
		(<any> this._draftDrawLayer).enable();

		this.addDrawAbortListeners();
	}

	addFeatureToDraw(feature: G.Feature) {
		this.addFeatureToData(feature, this.drawIdx);
	}

	addFeatureToData(feature: G.Feature, dataIdx: number) {
		const layer = this._featureToLayer(this.data[dataIdx].getFeatureStyle)(feature);
		this._onAdd(dataIdx, layer);
	}

	getFeatureTypes(): DataItemType[] {
		return ["rectangle", "polyline", "polygon", "circle", "marker"];
	}

	_showError(e: Error) {
		const alert = document.createElement("div");
		alert.style.display = "block";
		alert.className = "laji-map-popup alert alert-danger";
		const lajiMapError = ((<any> e)._lajiMapError) ? <LajiMapError> e : undefined;
		const message = () => `${translations.errorHTML} ` + lajiMapError
			? stringifyLajiMapError(lajiMapError, this.translations)
			: e.message;
		const translationHook = this.addTranslationHook(alert, message);

		this.showClosableElement(alert, () => {
			this.removeTranslationHook(translationHook);
		});
	}

	showClosableElement(
		elem: HTMLElement,
		onClose: (e: Event) => void,
		blocker = false,
		getContainer = () => this.container) {

		const closeButton = document.createElement("button");
		closeButton.setAttribute("type", "button");
		closeButton.className = "close";
		closeButton.innerHTML = "✖";
		closeButton.addEventListener("click", close);

		elem.insertBefore(closeButton, elem.firstChild);

		const that = this;
		function close(e) {
			if (e) e.preventDefault();
			that._removeKeyListener(ESC, close);
			getContainer().removeChild(elem);
			if (blocker) {
				that.blockerElem.style.display = "";
				that.blockerElem.removeEventListener("click", close);
			}
			if (onClose) onClose(e);
			that._closeDialog = undefined;
			that._openDialogs = that._openDialogs.filter(dialog => dialog !== elem);
			return true;
		}

		this._addKeyListener(ESC, close);

		getContainer().appendChild(elem);

		if (blocker) {
			this.blockerElem.addEventListener("click", close);
			this.blockerElem.style.display = "block";
		}

		this._closeDialog = close;
		if (getContainer() === this._dialogRoot) {
			this._openDialogs.push(elem);
		}
	}

	_createTooltip(translationKey: string, error = false): L.Draw.Tooltip {
		if (this._tooltip && this._tooltipTranslationHook) {
			this.removeTranslationHook(this._tooltipTranslationHook);
		} else {
			if (this._tooltip) this._disposeTooltip();
			this._tooltip = new L.Draw.Tooltip(this.map);
			this._onMouseMove = ({latlng}) => this._tooltip.updatePosition(latlng);
			["mousemove", "touchmove", "MSPointerMove"].forEach(eType => this.map.on(eType, this._onMouseMove));
			if (this._mouseLatLng) this._onMouseMove({latlng: this._mouseLatLng});
		}
		if (translationKey in this.translations) {
			this._tooltipTranslationHook = this.addTranslationHook(
				() => this._tooltip.updateContent({text: this.translations[translationKey]})
			);
		} else {
			this._tooltip.updateContent({text: translationKey});
		}
		if (error) this._tooltip.showAsError();
		else this._tooltip.removeError();
		return this._tooltip;
	}

	_disposeTooltip() {
		if (this._onMouseMove) ["mousemove", "touchmove", "MSPointerMove"].forEach(
			eType => this.map.off(eType, this._onMouseMove)
		);
		this._onMouseMove = undefined;
		if (this._tooltip) this._tooltip.dispose();
		this._tooltipTranslationHook && this.removeTranslationHook(this._tooltipTranslationHook);
		this._tooltip = undefined;
	}

	_showDialog(container: HTMLElement, onClose?: (e: Event) => void) {
		const _container = document.createElement("div");
		_container.className = "laji-map-dialog panel panel-default panel-body";
		if (this._dialogRoot === document.body) {
			_container.className += " fixed";
		}
		_container.appendChild(container);

		function close(e) {
			if (onClose) onClose(e);
		}

		this.showClosableElement(_container, close, !!"showBlocker", () => this._dialogRoot);
	}

	setLineTransectGeometry(geometry: LineTransectGeometry, events?: LineTransectEvent[]) { // eslint-disable-line @typescript-eslint/no-unused-vars
		console.warn("line transect mixin not included!");
	}

	setGoogleApiKey(googleApiKey: string) {
		this.googleApiKey = googleApiKey;
		provide(this, "googleApiKey");
	}

	@reflect()
	@dependsOn("translations", "googleApiKey")
	setGeocodingProvider() {
		if (!depsProvided(this, "setGeocodingProvider", arguments)) return;
		this.provider = new GoogleProvider({params: {key: this.googleApiKey, language: this.lang, region: "fi"}});
		provide(this, "geocodingProvider");
	}

	geocode(query: string, additional?: any, zoom?: number) {
		if (!this.provider) {
			console.warn("googleApiKey not provided for geocode");
			return;
		}
		this.provider.search({query, ...(additional || {})}).then((results = []) => {
			if (!this.map || !results.length) return;
			const [first] = results;
			const {x, y} = first;
			this.map.panTo([y, x], {animate: false});
			if (zoom) {
				this.setNormalizedZoom(zoom);
			}
		});
	}

	@dependsOn("map")
	setViewLocked(value) {
		if (!depsProvided(this, "setViewLocked", arguments)) return;
		const method = value ? "disable" : "enable";
		this.map.dragging[method]();
		this.map.touchZoom[method]();
		this.map.smoothWheelZoom[method]();
		this.map.boxZoom[method]();
		this.map.keyboard[method]();
		if (this.map.tap) {
			this.map.tap[method]();
		}
		this._disableDblClickZoom = value;
		this.viewLocked = value;
		if (isProvided(this, "viewLocked")) {
			this.setClickBeforeZoomAndPan(this._clickBeforeZoomAndPan);
		}
		provide(this, "viewLocked");
	}

	toggleFullscreen() {
		this._fullscreen ? this.setFullscreenOff() : this.setFullscreenOn();
	}

	setFullscreenOn() {
		this._fullscreen = true;
		this._fullscreenElem = document.createElement("div");
		this._fullscreenElem.className = "laji-map-fullscreen";
		document.body.appendChild(this._fullscreenElem);
		this._beforeFullscreen = {
			rootElem: this.rootElem,
			bodyAsDialogRoot: this._dialogRoot === document.body,
			clickBeforeZoomAndPan: this._clickBeforeZoomAndPan,
			bodyOverflowY: document.body.style.overflowY
		};
		this.setRootElem(this._fullscreenElem);
		this.map.getContainer().focus();
		this.setBodyAsDialogRoot(false);
		this.setClickBeforeZoomAndPan(false);
		document.body.style.overflowY = "hidden";
		this._addKeyListener(ESC, this.setFullscreenOff);
	}

	setFullscreenOff() {
		this._fullscreen = false;
		const {rootElem, bodyAsDialogRoot, clickBeforeZoomAndPan, bodyOverflowY} = this._beforeFullscreen;
		this.setRootElem(rootElem);
		this.setBodyAsDialogRoot(bodyAsDialogRoot);
		this.setClickBeforeZoomAndPan(clickBeforeZoomAndPan);
		document.body.style.overflowY = bodyOverflowY;
		document.body.removeChild(this._fullscreenElem);
		this._removeKeyListener(ESC, this.setFullscreenOff);
	}
}
