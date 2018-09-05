/* tslint:disable */
import * as LM from "./map.defs";
import * as C from "./controls.defs";
import * as LT from "./line-transect.defs";

import { Options as LajiMapOptions } from "./map.defs";
import { Options as LajiMapOptionsWithControls } from  "./controls.defs";
import { Options as LajiMapOptionsWithLineTransect } from  "./line-transect.defs";

import LajiMap from "./map";
import WithControls from "./controls";
import WithLineTransect from  "./line-transect";

export default WithControls(WithLineTransect(LajiMap));

export * from "./map.defs";
export * from "./controls.defs";
export * from "./line-transect.defs";

export interface Options extends LajiMapOptions, LajiMapOptionsWithControls, LajiMapOptionsWithLineTransect {

}
