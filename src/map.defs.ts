import * as L from "leaflet";
import * as G from "geojson";

export interface LajiMapFitBoundsOptions extends L.FitBoundsOptions {
	paddingInMeters?: number;
	minZoom?: number;
}

export interface LajiMapEvent {
	type: string;
	idxs?: number[];
	idx?: number;
	features?: {[id: number]: G.Feature};
	feature?: G.Feature;
}

export interface GetFeatureStyleOptions {
	dataIdx?: number;
	featureIdx?: number;
	feature?: G.Feature;
	item?: Data;
}

export interface CustomPolylineOptions extends L.PolylineOptions {
	showStart?: boolean;
	showDirection?: boolean;
}

export interface DataOptions {
	featureCollection?: any;
	geoData?: G.GeoJSON | string;
	cluster?: boolean | L.MarkerClusterGroupOptions;
	activeIdx?: number;
	editable?: boolean;
	hasActive?: boolean;
	getClusterStyle?: (childCount: number) => L.PathOptions;
	tooltipOptions?: any;
	on?: {[type: string]: (e: L.LeafletEvent, data: {feature?: G.Feature, layer?: DataItemLayer, idx?: number}) => void};
	highlightOnHover?: boolean;
	onChange?(events: LajiMapEvent[]): void;
	getFeatureStyle?(options: GetFeatureStyleOptions): L.PathOptions;
	getDraftStyle?(dataIdx?: number): L.PathOptions;
	getTooltip?(dataIdx: number, feature: G.Feature, callback: (content: string) => void): string;
	getPopup?(dataIdx: number, feature: G.Feature, callback: (content: string) => void): string;
}

export interface Data extends DataOptions {
	group: L.GeoJSON;
	groupContainer: L.FeatureGroup;
	idx: number;
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
export type DataItemLayer = L.Polygon | L.Polyline | L.Marker | L.Circle;
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
	pohjakartta = "pohjakartta",
	ortokuva = "ortokuva",
	laser = "laser",
	openStreetMap = "openStreetMap",
	googleSatellite = "googleSatellite"
}

export enum OverlayName {
	geobiologicalProvinces = "geobiologicalProvinces",
	geobiologicalProvinceBorders = "geobiologicalProvinceBorders",
	forestVegetationZones = "forestVegetationZones",
	mireVegetationZones = "mireVegetationZones",
	threatenedSpeciesEvaluationZones = "threatenedSpeciesEvaluationZones",
	biodiversityForestZones = "biodiversityForestZones",
	ykjGrid = "ykjGrid",
	ykjGridLabels = "ykjGridLabels"
}

export interface Options {
	rootElem?: HTMLElement;
	lang?: Lang;
	data?: DataOptions[];
	draw?: DrawOptions | boolean;
	tileLayerName?: TileLayerName;
	availableTileLayerNamesBlacklist?: TileLayerName[];
	availableTileLayerNamesWhitelist?: TileLayerName[];
	overlayNames?: OverlayName[];
	availableOverlayNameBlacklist?: OverlayName[];
	availableOverlayNameWhitelist?: OverlayName[];
	tileLayerOpacity?: number;
	center?: L.LatLngExpression;
	zoom?: number;
	zoomToData?: boolean | LajiMapFitBoundsOptions;
	locate?: boolean;
	onPopupClose?: () => void;
	markerPopupOffset?: number;
	featurePopupOffset?: number;
	popupOnHover?: boolean;
	on?: L.LeafletEventHandlerFnMap;
	polyline?: boolean | CustomPolylineOptions;
	polygon?: boolean | L.DrawOptions.PolygonOptions;
	rectangle?: boolean | L.DrawOptions.RectangleOptions;
	circle?: boolean | L.DrawOptions.CircleOptions;
	marker?: boolean | L.DrawOptions.MarkerOptions;
	bodyAsDialogRoot?: boolean;
	clickBeforeZoomAndPan?: boolean;
}
