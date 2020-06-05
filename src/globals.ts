/* tslint:disable */
export const INCOMPLETE_COLOR = "#f604fA";
export const NORMAL_COLOR = "#257ECA";
export const ACTIVE_COLOR = "#06840A";
export const DATA_LAYER_COLOR = "#AAAAAA";
export const EDITABLE_DATA_LAYER_COLOR = "#81A3CE";
export const ACTIVE_DATA_LAYER_COLOR = "#81CE97";
export const USER_LOCATION_COLOR = "#FF0000";

export const EPSG3067String = "+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
export const EPSG2393String = "+proj=tmerc +lat_0=0 +lon_0=27 +k=1 +x_0=3500000 +y_0=0 +ellps=intl +towgs84=-96.0617,-82.4278,-121.7535,4.80107,0.34543,-1.37646,1.4964 +units=m +no_defs";

export const EPSG3067WKTString = "PROJCS[\"ETRS89 / ETRS-TM35FIN\",GEOGCS[\"ETRS89\",DATUM[\"D_ETRS_1989\",SPHEROID[\"GRS_1980\",6378137,298.257222101]],PRIMEM[\"Greenwich\",0],UNIT[\"Degree\",0.017453292519943295]],PROJECTION[\"Transverse_Mercator\"],PARAMETER[\"latitude_of_origin\",0],PARAMETER[\"central_meridian\",27],PARAMETER[\"scale_factor\",0.9996],PARAMETER[\"false_easting\",500000],PARAMETER[\"false_northing\",0],UNIT[\"Meter\",1]]";
export const EPSG2393WKTString = "PROJCS[\"KKJ_Finland_Uniform_Coordinate_System\",GEOGCS[\"GCS_KKJ\",DATUM[\"D_KKJ\",SPHEROID[\"International_1924\",6378388,297]],PRIMEM[\"Greenwich\",0],UNIT[\"Degree\",0.017453292519943295]],PROJECTION[\"Transverse_Mercator\"],PARAMETER[\"latitude_of_origin\",0],PARAMETER[\"central_meridian\",27],PARAMETER[\"scale_factor\",1],PARAMETER[\"false_easting\",3500000],PARAMETER[\"false_northing\",0],UNIT[\"Meter\",1]]";

export const ESC = "esc";

export const ONLY_MML_OVERLAY_NAMES = ["ykjGrid", "ykjGridLabels"];

export const FINLAND_BOUNDS: L.LatLngExpression[] = [[71.348, 36.783], [56.311, 15.316]];
