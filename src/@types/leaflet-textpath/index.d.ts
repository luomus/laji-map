import * as L from "leaflet";

export interface LeafletTextPathOptions {
	repeat?: boolean;
	center?: boolean;
	below?: boolean;
	offset?: number;
	orientation?: number | "flip" | "perpendicular";
	attributes?: any // SVGTextPositioningElement doesn't support font-size.
}

declare module "leaflet" {
	interface Polyline {
		setText(text: string, options?: LeafletTextPathOptions): L.Polyline;
	}
}
