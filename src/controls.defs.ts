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
	control?: () => L.Control;
	_custom?: boolean;
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
	delete?: boolean; undo?: boolean;
	redo?: boolean;
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
	layerOpacity?: boolean;
	attribution?: boolean;
}

export interface InternalControlsOptions extends ControlsOptions {
	drawUtils?: boolean | DrawControlOptions;
}

export interface Options {
	controls?: boolean | ControlsOptions;
}

export interface CustomControl extends L.Control {
	_custom: boolean;
	group: string;
}

