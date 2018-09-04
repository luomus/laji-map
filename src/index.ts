/* tslint:disable */
import LajiMap, {Options as _LajiMapOptions} from "./map";
import WithControls, {LajiMapOptions as LajiMapOptionsWithControls} from  "./controls";
import WithLineTransect, {LajiMapOptions as LajiMapOptionsWithLineTransect} from  "./line-transect";

export default WithControls(WithLineTransect(LajiMap));
//export default WithLineTransect(LajiMap);
//export default WithControls(LajiMap)
//export default LajiMap
