declare module "leaflet.nontiledlayer" {
	import * as L from "leaflet";
	export class WMS extends L.TileLayer.WMS {}
}
