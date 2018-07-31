import * as L from "leaflet";

declare module "leaflet" {
	class Rrose extends L.Popup {
		constructor(options?: any);
		setContent(content: string): this;
		openOn(map: L.Map): this;
		setLatLng(latLng: L.LatLng): this;
	}
}
