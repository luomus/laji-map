import * as G from "geojson";
import AbstractProvider, { EndpointArgument } from "leaflet-geosearch/lib/providers/provider";

interface MMLRequestFeatureProperties {
	label: string
}
interface MMLRequestResult {
	features: G.Feature<G.Point, MMLRequestFeatureProperties>;
}

export default class MMLProvider extends AbstractProvider<MMLRequestResult> {
	endpoint({query}: EndpointArgument) {
		const params = typeof query === "string" ? { text: query } : query;
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
				results.push({
					x: f.geometry.coordinates[0],
					y: f.geometry.coordinates[1],
					label,
					raw: f
				});
			}
			uniqueLabels.add(label);
			return results;
		}, []);
	}
}
