import * as L from "leaflet";
import * as G from "geojson";
import {IdxTuple} from "./map.defs";

export interface Options {
	lineTransect?: LineTransectOptions;
}

export interface GetLineTransectFeatureStyleOptions {
	lineIdx: number;
	segmentIdx: number;
	type: Function;
	style: L.PathOptions;
}

export interface LineTransectOptions {
	feature: LineTransectFeature;
	activeIdx?: number;
	onChange?: (events: LineTransectEvent[]) => void;
	getFeatureStyle?: (options: GetLineTransectFeatureStyleOptions) => L.PathOptions;
	getTooltip?: (lineIdx: number, text: string, callback?: (callbackText: string) => void) => string;
	printMode?: boolean;
	editable?: boolean;
}

export interface LineTransectIdx {
	i: number;
	lineIdx: number;
	segmentIdx: number;
	idxTuple: SegmentIdxTuple;
}

export type LineTransectGeometry = G.LineString | G.MultiLineString;
export interface LineTransectFeature {
	type: string;
	geometry: LineTransectGeometry;
	properties: G.GeoJsonProperties;
	id?: string | number;
}

export type PointIdxTuple = IdxTuple;
export type SegmentIdxTuple = IdxTuple;

export interface LineTransectEvent {
	type: string;
	idxs?: number[];
	idx?: number;
	feature?: LineTransectFeature;
	prevFeature?: LineTransectFeature;
	geometry?: LineTransectGeometry;
	target?: number;
}

export type SegmentLayer = L.Polyline<G.LineString> | L.CircleMarker | L.Polygon<G.Polygon>;
export type SegmentLayers = SegmentLayer[];

export interface TooltipMessages {
	text?: string;
	click?: string;
	dblclick?: string;
	rightclick?: string;
	drag?: string;
}

export interface LineTransectHistoryEntry {
	geometry: LineTransectGeometry;
	undoEvents?: LineTransectEvent[];
	redoEvents?: LineTransectEvent[];
}
