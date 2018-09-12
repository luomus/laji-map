/* tslint:disable */
import * as LM from "./map.defs";
import * as C from "./controls.defs";

import _LajiMap from "./map";
import WithControls from "./controls";

export const LajiMap = WithControls(_LajiMap);
export default LajiMap;

export * from "./defs";

