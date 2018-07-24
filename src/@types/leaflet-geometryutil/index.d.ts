import * as L from "leaflet";

interface ClosestLayerResponse {
	layer: L.Layer;
	latlng: L.LatLng;
	distance: number;
}
declare module "leaflet" {
	namespace GeometryUtil {
		function destination(latLng: L.LatLng, degree: number, meters: number): L.LatLng;

		function closestLayer(map: L.Map, layer: L.Layer[], latLng: L.LatLng): ClosestLayerResponse;

		function computeAngle(a: L.Point, b: L.Point): number;

		function closest(map: L.Map, layer: L.LatLng[] | L.LatLng[][] | L.Polyline | L.Polygon, latLng: L.LatLng, vertices?: boolean): L.LatLng;
	}
}
