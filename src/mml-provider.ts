import * as G from "geojson";
import AbstractProvider, { EndpointArgument, RequestType } from "leaflet-geosearch/lib/providers/provider";

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
		return result.data.features.map(f => ({
			x: f.geometry.coordinates[0],
			y: f.geometry.coordinates[1],
			label: [f.properties.label, f.properties["label:municipality"], f.properties["label:region"]].filter(s => s).join(", "),
			raw: f
		}));
	}

	search(options) {
		const url = this.endpoint({
			query: options.query,
			type: RequestType.SEARCH,
		});

		return fetch(url).then(r => r.json()).then(json => this.parse({ data: json }));
	}
}
