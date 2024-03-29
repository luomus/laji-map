import type { Control } from "leaflet";
import * as G from "geojson";

export interface ControlOptions {
	name?: string;
	text?: string;
	position?: string;
	eventName?: string;
	group?: string;
	iconCls?: string;
	contextMenu?: boolean;
	fn?: () => void;
	stopFn?: () => void;
	finishFn?: () => void;
	cancelFn?: () => void;
	onAdd?: () => void;
	disabled?: boolean;
	controls?: ControlOptions[];
	control?: () => Control;
	_custom?: boolean;
	dependencies?: (() => boolean)[];
}

export interface DrawControlOptions {
	rectangle?: boolean;
	polygon?: boolean;
	polyline?: boolean;
	circle?: boolean;
	marker?: boolean;
	coordinateInput?: boolean;
	copy?: boolean;
	clear?: boolean;
	reverse?: boolean;
	delete?: boolean;
	undo?: boolean;
	redo?: boolean;
	upload?: boolean;
}

export interface LineTransectControlOptions {
	split?: boolean;
	splitByMeters?: boolean;
	deletePoints?: boolean;
	createPoint?: boolean;
	shiftPoint?: boolean;
	undo?: boolean;
	redo?: boolean;
}

export interface LocationControlOptions {
	user?: boolean;
	search?: boolean;
}

export interface ControlsOptions {
	draw?: boolean | DrawControlOptions;
	layer?: boolean;
	zoom?: boolean;
	scale?: boolean;
	location?: boolean | LocationControlOptions;
	coordinates?: boolean;
	lineTransect?: boolean | LineTransectControlOptions;
	attribution?: boolean;
	fullscreen?: boolean;
}

export interface InternalControlsOptions extends ControlsOptions {
	drawUtils?: boolean | DrawControlOptions;
}

export interface Options {
	controls?: boolean | ControlsOptions;
	customControls?: ControlOptions[];
}

export interface CustomControl extends ControlOptions {
	_custom: boolean;
	group: string;
}

export interface InternalCustomControl extends CustomControl {
}

interface FormatDetector {
	elem: HTMLElement;
	validate: (value?: string) => {valid: boolean, geoJSON: G.GeoJSON};
	unmount: () => void;
}
export interface FormatDetectorOptions {
	displayFormat?: boolean;
	displayOnlyGeoJSONErrors?: boolean;
	allowGrid?: boolean;
	point?: boolean;
	polygon?: boolean;
	polyline?: boolean;
	single?: boolean;
}

export interface WithControls {
	createFormatDetectorElem: (options?: FormatDetectorOptions) => FormatDetector
}
