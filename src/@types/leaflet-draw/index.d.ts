import * as L from "leaflet";
import "@luomus/leaflet-draw";

declare module "leaflet" {
	interface LeafletEventHandlerFnMap {
		"draw:created": (event: L.DrawEvents.Created) => void;
		"draw:drawstart": (event: L.DrawEvents.DrawStart) => void;
		"draw:drawstop": (event: L.DrawEvents.DrawStop) => void;
		"draw:drawvertex": (event: L.DrawEvents.DrawVertex) => void;
	}
}
