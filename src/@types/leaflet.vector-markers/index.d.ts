import * as L from "leaflet";

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
		function icon(options: VectorMarkerIconOptions): L.Icon;
		class Icon extends L.Icon {
			constructor(options: VectorMarkerIconOptions);
		}
		interface Options extends VectorMarkerIconOptions {}
    }

	interface BaseIconOptions extends VectorMarkerIconOptions { }
}
