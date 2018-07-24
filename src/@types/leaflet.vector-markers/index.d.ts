import * as L from "leaflet";

export interface VectorMarkerIconOptions {
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
       function icon(options: VectorMarkerIconOptions): L.Icon;
    }

	interface BaseIconOptions extends VectorMarkerIconOptions { }
}
