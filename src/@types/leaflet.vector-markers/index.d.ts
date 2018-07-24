import * as L from "leaflet";
////import {MarkerOptions as _MarkerOptions, IconOptions as _IconOptions} from "leaflet";
//
interface VectorMarkerIconOptions {
    icon?: string;
    prefix?: string;
    markerColor?: string;
    iconColor?: string;
    spin?: boolean;
    extraClasses?: string;
    opacity?: number;
}

interface MarkerOptions {
	icon: VectorMarkerIconOptions
}

declare module "leaflet" {
	namespace VectorMarkers {
       function icon(options: VectorMarkerIconOptions): L.Icon;
    }

    namespace Marker {
		export const options: MarkerOptions
	}
}
