import * as L from "leaflet";

export interface LeafletShowMeasurementsOptions {
	showOnHover?: boolean;
}

interface HasShowMeasurements {
	showMeasurements(options?: LeafletShowMeasurementsOptions): void;
}

declare module "leaflet" {
	interface Marker extends HasShowMeasurements {
	}
	interface Polyline extends HasShowMeasurements {
	}
	interface Circle extends HasShowMeasurements {
	}

	interface LayerOptions {
		showMeasurements?: LeafletShowMeasurementsOptions | boolean;
	}
}
