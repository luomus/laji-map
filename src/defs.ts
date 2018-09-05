import { Options as LajiMapOptions } from "./map.defs";
import { Options as LajiMapOptionsWithControls } from  "./controls.defs";
import { Options as LajiMapOptionsWithLineTransect } from  "./line-transect.defs";

export * from "./map.defs";
export * from "./controls.defs";
export * from "./line-transect.defs";

export interface Options extends LajiMapOptions, LajiMapOptionsWithControls, LajiMapOptionsWithLineTransect {

}
