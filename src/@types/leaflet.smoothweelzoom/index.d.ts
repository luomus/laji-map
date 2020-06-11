import * as L from "leaflet";

declare module "leaflet" {

	interface MapOptions {
		smoothWheelZoom?: boolean;
		smoothSensitivity?: number;
	}

	interface Map {
		smoothWheelZoom: L.Handler
	}
}

