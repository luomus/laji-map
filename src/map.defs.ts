import * as G from "geojson";
import {FitBoundsOptions, PolylineOptions, MarkerClusterGroupOptions, PathOptions, LeafletEvent, GeoJSON, FeatureGroup,
	Polygon, Polyline, Marker, Circle, LatLngExpression, LeafletEventHandlerFnMap, DrawOptions, MapOptions, LatLng, ErrorEvent } from "leaflet";
export interface LajiMapFitBoundsOptions extends FitBoundsOptions {
	paddingInMeters?: number;
	minZoom?: number;
}

export interface ZoomToDataOptions extends LajiMapFitBoundsOptions {
	dataIdxs?: number[];
	draw?: boolean;
}

export interface LajiMapEvent {
	type: string;
	idxs?: number[];
	idx?: number;
	features?: {[id: number]: G.Feature};
	feature?: G.Feature;
}

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

export interface DataOptions {
	featureCollection?: any;
	geoData?: G.GeoJSON | string;
	cluster?: boolean | MarkerClusterGroupOptions;
	activeIdx?: number;
	editable?: boolean;
	hasActive?: boolean;
	getClusterStyle?: (childCount: number) => PathOptions;
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
	getTooltip?(options: GetPopupOptions, callback: (content: string) => void): string;
	getPopup?(options: GetPopupOptions, callback: (content: string) => void): string;
	single?: boolean;
}

export interface Data extends DataOptions {
	group: GeoJSON;
	groupContainer: FeatureGroup;
	idx: number;
	hasCustomGetFeatureStyle: boolean;
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
	pohjakartta = "pohjakartta",
	ortokuva = "ortokuva",
	laser = "laser",
	openStreetMap = "openStreetMap",
	googleSatellite = "googleSatellite"
}

export enum OverlayName {
	geobiologicalProvinces = "geobiologicalProvinces",
	geobiologicalProvinceBorders = "geobiologicalProvinceBorders",
	municipalities = "municipalities",
	forestVegetationZones = "forestVegetationZones",
	mireVegetationZones = "mireVegetationZones",
	threatenedSpeciesEvaluationZones = "threatenedSpeciesEvaluationZones",
	biodiversityForestZones = "biodiversityForestZones",
	ykjGrid = "ykjGrid",
	ykjGridLabels = "ykjGridLabels"
}

export interface TileLayerOptions {
	opacity: number;
	visible: boolean;
}

export interface TileLayersOptions {
	layers: {
		[layerName: string]: TileLayerOptions | boolean
	};
	active?: "finnish" | "world";
};

export interface InternalTileLayersOptions {
	layers: {
		[layerName: string]: TileLayerOptions
	};
	active?: "finnish" | "world";
};

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
}

export interface UserLocationOptions {
	on?: boolean;
	onLocationFound?: (latlng?: LatLng, accuracy?: number) => void;
	onLocationError?: (e: ErrorEvent) => void;
	userLocation?: {latlng: LatLng, accuracy: number};
	panOnFound?: boolean;
}
