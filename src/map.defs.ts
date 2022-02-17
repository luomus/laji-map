import * as G from "geojson";
import {FitBoundsOptions, PolylineOptions, MarkerClusterGroupOptions, PathOptions, LeafletEvent, GeoJSON, FeatureGroup,
	Polygon, Polyline, Marker, Circle, LatLngExpression, LeafletEventHandlerFnMap, DrawOptions, MapOptions, LatLng,
	ErrorEvent, MarkerCluster } from "leaflet";
import { ControlsOptions, CustomControl } from "./controls.defs";
import { LineTransectOptions } from "./line-transect.defs";

export interface LajiMapFitBoundsOptions extends FitBoundsOptions {
	paddingInMeters?: number;
	minZoom?: number;
}
import { CoordinateSystem } from "./utils";

export interface ZoomToDataOptions extends LajiMapFitBoundsOptions {
	dataIdxs?: number[];
	draw?: boolean;
}

export interface LajiMapCreateEvent {
	type: "create";
	feature: G.Feature;
}
export interface LajiMapEditEvent {
	type: "edit";
	features: {[idx: number]: G.Feature};
}
export interface LajiMapDeleteEvent {
	type: "delete";
	idxs: number[];
	features: G.Feature[];
}
export interface LajiMapInsertEvent {
	type: "insert";
	idx: number;
	feature: G.Feature;
}
export interface LajiMapActivateEvent {
	type: "active";
	idx: number;
}

export type LajiMapEvent = LajiMapCreateEvent | LajiMapEditEvent | LajiMapDeleteEvent | LajiMapInsertEvent | LajiMapActivateEvent;

export interface GetPopupOptions {
	dataIdx?: number;
	featureIdx?: number;
	feature?: G.Feature;
	item?: Data;
}

export interface GetFeatureStyleOptions extends GetPopupOptions {
	active?: boolean;
	editing?: boolean;
	hovered?: boolean;
}

export interface CustomPolylineOptions extends PolylineOptions {
	showStart?: boolean;
	showDirection?: boolean;
}

export interface ShowMeasurementsOptions {
	showOnHover: boolean;
}

export interface DataOptions {
	featureCollection?: any;
	geoData?: G.GeoJSON | string;
	cluster?: boolean | MarkerClusterGroupOptions;
	activeIdx?: number;
	editable?: boolean;
	hasActive?: boolean;
	getClusterStyle?: (childCount: number, featureIdxs: number[], cluster: MarkerCluster) => PathOptions;
	tooltipOptions?: any;
	on?: {[type: string]: (
		e: LeafletEvent,
		data: {
			feature?: G.Feature,
			layer?: DataItemLayer,
			idx?: number,
			dataIdx?: number,
			featureIdx?: number
		}
	) => void};
	highlightOnHover?: boolean;
	onChange?(events: LajiMapEvent[]): void;
	getFeatureStyle?(options: GetFeatureStyleOptions): PathOptions;
	getDraftStyle?(dataIdx?: number): PathOptions;
	getTooltip?(options: GetPopupOptions, callback: (content: string | HTMLElement) => void): string;
	getPopup?(options: GetPopupOptions, callback: (content: string | HTMLElement) => void): string;
	single?: boolean;
	showMeasurements?: boolean | ShowMeasurementsOptions;
}

export type OnChangeCoordinateSystem = CoordinateSystem | "GeoJSONFeatureCollection" | "GeoJSONGeometryCollection";

export interface Data extends DataOptions {
	group: GeoJSON;
	groupContainer: FeatureGroup;
	idx: number;
	hasCustomGetFeatureStyle: boolean;
	format: OnChangeCoordinateSystem;
	crs: string;
}

export interface DrawOptions extends DataOptions {
	rectangle?: boolean;
	polygon?: boolean;
	polyline?: boolean;
	circle?: boolean;
	marker?: boolean;
}

export interface Draw extends Data {
	rectangle?: boolean;
	polygon?: boolean;
	polyline?: boolean;
	circle?: boolean;
	marker?: boolean;
}

export type IdxTuple = [number, number];
export type DataItemLayer = Polygon | Polyline | Marker | Circle;
export type DataItemType = "polygon" | "polyline" | "marker" | "circle" | "rectangle";

export interface DrawHistoryEntry {
	featureCollection: G.FeatureCollection;
	undoEvents?: LajiMapEvent[];
	redoEvents?: LajiMapEvent[];
}

export enum Lang {
	fi = "fi",
	en = "en",
	sv = "sv"
}

export enum TileLayerName {
	maastokartta = "maastokartta",
	taustakartta = "taustakartta",
	ortokuva = "ortokuva",
	laser = "laser",
	openStreetMap = "openStreetMap",
	googleSatellite = "googleSatellite",
	afeGrid = "afeGrid",
	cgrsGrid = "cgrsGrid",
	atlasGrid = "atlasGrid",
}

export enum OverlayName {
	geobiologicalProvinces = "geobiologicalProvinces",
	geobiologicalProvinceBorders = "geobiologicalProvinceBorders",
	municipalities = "municipalities",
	counties = "counties",
	ely = "ely",
	forestVegetationZones = "forestVegetationZones",
	mireVegetationZones = "mireVegetationZones",
	threatenedSpeciesEvaluationZones = "threatenedSpeciesEvaluationZones",
	biodiversityForestZones = "biodiversityForestZones",
	ykjGrid = "ykjGrid",
	ykjGridLabels = "ykjGridLabels",
	kiinteistojaotus = "kiinteistojaotus",
	kiinteistotunnukset = "kiinteistotunnukset",
	currentProtectedAreas = "currentProtectedAreas",
	plannedProtectedAreas = "plannedProtectedAreas",
	flyingSquirrelPredictionModel = "flyingSquirrelPredictionModel",
}

export interface TileLayerOptions {
	opacity: number;
	visible: boolean;
}

export type TileLayerNames = keyof typeof TileLayerName;
export type OverlayNames = keyof typeof OverlayName;
export type LayerNames = TileLayerNames | OverlayNames;
export type WorldLayerNames = Extract<TileLayerNames, "openStreetMap" | "googleSatellite" | "cgrsGrid">;
export type FinnishLayerNames = Exclude<TileLayerNames, "openStreetMap" | "googleSatellite" | "cgrsGrid">;
type ActiveProj = "finnish" | "world";

export interface TileLayersOptions {
	layers: {
		[layerName in LayerNames]?: TileLayerOptions | boolean
	};
	active?: ActiveProj;
}

export interface InternalTileLayersOptions {
	layers: {
		[layerName in LayerNames]?: TileLayerOptions
	};
	active?: ActiveProj;
}

export interface Options extends MapOptions {
	rootElem?: HTMLElement;
	lang?: Lang;
	data?: DataOptions[] | DataOptions;
	draw?: DrawOptions | boolean;
	tileLayerName?: TileLayerName;
	tileLayers?: TileLayersOptions;
	availableTileLayerNamesBlacklist?: TileLayerName[];
	availableTileLayerNamesWhitelist?: TileLayerName[];
	overlayNames?: OverlayName[];
	availableOverlayNameBlacklist?: OverlayName[];
	availableOverlayNameWhitelist?: OverlayName[];
	tileLayerOpacity?: number;
	center?: LatLngExpression;
	zoom?: number;
	zoomToData?: boolean | LajiMapFitBoundsOptions;
	locate?: boolean;
	onPopupClose?: () => void;
	markerPopupOffset?: number;
	featurePopupOffset?: number;
	popupOnHover?: boolean;
	on?: LeafletEventHandlerFnMap;
	polyline?: boolean | CustomPolylineOptions;
	polygon?: boolean | DrawOptions.PolygonOptions;
	rectangle?: boolean | DrawOptions.RectangleOptions;
	circle?: boolean | DrawOptions.CircleOptions;
	marker?: boolean | DrawOptions.MarkerOptions;
	bodyAsDialogRoot?: boolean;
	clickBeforeZoomAndPan?: boolean;
	viewLocked?: boolean;
	controls?: boolean | ControlsOptions;
	lajiGeoServerAddress?: string;
	googleSearchUrl?: string;
	customControls?: CustomControl[];
	lineTransect?: LineTransectOptions;
}

export interface UserLocationOptions {
	on?: boolean;
	onLocationFound?: (latlng?: LatLng, accuracy?: number) => void;
	onLocationError?: (e: ErrorEvent) => void;
	userLocation?: {latlng: LatLng, accuracy: number};
	panOnFound?: boolean;
}
