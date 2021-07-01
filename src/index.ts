/* eslint-disable */
import * as LM from "./map.defs";
import * as C from "./controls.defs";
import * as LT from "./line-transect.defs";

import _LajiMap from "./map";
import WithControls from "./controls";
import WithLineTransect from  "./line-transect";

export const LajiMap = WithControls(WithLineTransect(_LajiMap));
export default LajiMap;

export * from "./defs";

