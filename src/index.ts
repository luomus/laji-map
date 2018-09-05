/* tslint:disable */

// Compiled result doesn't resolve type definitions correctly without these.
import * as CoreDefinitions from "./map";
import * as ControlsDefinitions from "./controls";
import * as LineTransectDefinitions from "./line-transect";

import _LajiMap, {Options as LajiMapOptions} from "./map";
import WithControls, {Options as LajiMapOptionsWithControls} from  "./controls";
import WithLineTransect, {Options as LajiMapOptionsWithLineTransect} from  "./line-transect";

export const LajiMap = WithControls(WithLineTransect(_LajiMap));
export default LajiMap;
export * from "./map";
export * from "./controls";
export * from "./line-transect";

export interface Options extends LajiMapOptions, LajiMapOptionsWithControls, LajiMapOptionsWithLineTransect {

}
//export default WithLineTransect(LajiMap);
//export default WithControls(LajiMap)
//export default LajiMap
