import * as G from "geojson";
import * as L from "leaflet";
import AbstractProvider, { EndpointArgument } from "leaflet-geosearch/lib/providers/provider";
import { convertLatLng } from "./utils";

interface MMLRequestFeatureProperties {
	label: string
}
interface MMLRequestResult {
	features: G.Feature<G.Point, MMLRequestFeatureProperties>;
}

export default class MMLProvider extends AbstractProvider<MMLRequestResult> {
	endpoint({query}: EndpointArgument) {
		const baseParams = { crs: "EPSG:3067" };
		const params = typeof query === "string" ? {...baseParams, text: query} : {...baseParams, ...query};
		return this.getUrl("https://proxy.laji.fi/mml-open/geocoding/v2/pelias/search", params);
	}

	parse(result) {
		// combine kiinteistotunnus results into single bounds.
		if (result.data.features.reduce((kiinteistotunnus, f) =>
			kiinteistotunnus === null
				? f.properties.kiinteistotunnus
				: kiinteistotunnus === f.properties.kiinteistotunnus
					? kiinteistotunnus
					: false
		, null)) {
			const bounds = L.latLngBounds(result.data.features.map(f =>
				convertLatLng(f.geometry.coordinates.reverse(), "EPSG:3067", "WGS84")
			));
			const [first] = result.data.features;
			return [
				{
					label: this.getLabel(first),
					x: bounds.getCenter().lng,
					y: bounds.getCenter().lat,
					bounds: [bounds.getSouthWest(), bounds.getNorthEast()].map(latlng => [latlng.lat, latlng.lng]),
					raw: first
				}
			];
		}

		const uniqueLabels = new Set();
		return result.data.features.reduce((results, f) => {
			const label = this.getLabel(f);

			if (!uniqueLabels.has(label)) {
				const [y, x] = convertLatLng(f.geometry.coordinates.reverse(), "EPSG:3067", "WGS84");
				results.push({x, y, label, raw: f});
			}
			uniqueLabels.add(label);
			return results;
		}, []);
	}

	getLabel(feature: G.Feature) {
		return [
			feature.properties.label,
			feature.properties["label:municipality"],
			feature.properties["label:region"],
			feature.properties["label:subregion"]
		].filter(s => s).join(", ");
	}
}
