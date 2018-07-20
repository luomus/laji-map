import * as L from "leaflet";
import {Icon} from "leaflet";

interface VectorMarkerIconOptions {
    icon?: string;
    prefix?: string;
    markerColor?: string;
    iconColor?: string;
    spin?: boolean;
    extraClasses?: string;
    opacity?: number;
}

declare module "leaflet" {
    namespace VectorMarkers {
       function icon(options: VectorMarkerIconOptions): Icon
    }
}
