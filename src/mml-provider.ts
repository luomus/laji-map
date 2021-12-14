import * as G from "geojson";
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
		const uniqueLabels = new Set();
		return result.data.features.reduce((results, f) => {
			const label = [f.properties.label,
				f.properties["label:municipality"],
				f.properties["label:region"],
				f.properties["label:subregion"]
			].filter(s => s).join(", ");

			if (!uniqueLabels.has(label)) {
				const converted = convertLatLng(f.geometry.coordinates.reverse(), "EPSG:3067", "WGS84").reverse();
				results.push({
					x: converted[0],
					y: converted[1],
					label,
					raw: f
				});
			}
			uniqueLabels.add(label);
			return results;
		}, []);
	}
}
