import * as L from "leaflet";
import {LatLng, Map} from "leaflet";


declare module "leaflet" {
	class Rrose {
		constructor(options?: any);
		setContent(content: string): this;
		openOn(map: Map): this;
		setLatLng(latLng: LatLng): this;
	}
}
