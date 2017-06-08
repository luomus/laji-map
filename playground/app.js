import LajiMap from "../src/map";
import lineTransects from "./data.json";

import "../src/styles.js";
class App {
	constructor() {
		this.data = [
			{
				featureCollection: {
					type: "featureCollection",
					features: [
						{
							"type": "Feature",
							"properties": {},
							"geometry": {
								"type": "Point",
								"coordinates": [
									22.344264017028992,
									60.40403173483798
								],
								"radius": 7000
							}
						},
						{
							"type": "Feature",
							"properties": {},
							"geometry": {
								"type": "Point",
								"coordinates": [
									21.824264017028992,
									60.40403173483798
								],
								"radius": 6000
							}
						},
						{
							"type": "Feature",
							"properties": {},
							"geometry": {
								"type": "Point",
								"coordinates": [
									21.924264017028992,
									60.40403173483798
								],
							}
						},
						{
							"type": "Feature",
							"properties": {},
							"geometry": {
								"type": "Point",
								"coordinates": [
									21.924264017028992,
									60.40403173483798
								],
							}
						}
					]
				},
				geoData: `LINESTRING(000029.531250000000004 000066.29337283943545,000028.718261718750004 000066.5482634621744)
				POLYGON(000025.751953125000004 000066.24031184756058,000027.487792968750004 000065.9554260417959,000026.542968750000004 000065.5129625532949,000024.719238281250004 000065.36683689226321)
				POINT(000029.069824218750004 000065.34851379240027)
				POLYGON(000027.66357421875 000067.62341925630494,000028.21963007297877 000067.53445445861936,000028.442952786946645 000067.32103848397698,000028.20984692019685 000067.1095081001731,000027.66357421875 000067.02242930360195,000027.117301517303158 000067.1095081001731,000026.884195650553362 000067.32103848397698,000027.107518364521233 000067.53445445861936)
				`,
				getPopup: (idx) => {
					return `gray ${idx}`;
				},
				cluster: true,
				on: {
					click: (e, {idx, feature, layer}) => {
						console.info(idx);
						console.info(feature);
						console.info(layer);
					},
				}
			},
			{
				featureCollection: {
					type: "featureCollection",
					features: [
						{
							"type": "Feature",
							"properties": {},
							"geometry": {
								"type": "Point",
								"coordinates": [
									22.704264017028992,
									60.40403173483798
								],
								"radius": 4000
							}
						}
					]
				},
				getFeatureStyle: (e) => {
					const {featureIdx} = e;
					return {
						weight: featureIdx,
						opacity: 1,
						fillOpacity: 1,
						color: "#0f0"
					};
				},
				getPopup: (idx) => {
					return `green ${idx}`;
				}
			}
		];

		this.drawOptions = {
			data: {
				featureCollection: {
					type: "FeatureCollection",
					features: [
						{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[22.207004189222086,60.47430300256853]}},
						{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[22.311658377997933,60.43453495634962]}},
						{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[22.311658377997933,61.43453495634962]}},
						{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[23.311658377997933,61.43453495634962], "radius": 2000}},
						{
							"type": "Feature",
							"properties": {},
							"geometry": {
								"type": "Point",
								"coordinates": [
									22.104264017028992,
									60.40403173483798
								],
								radius: 4000
							}
						}
					],
				},
				getPopup: (idx, geometry, callback) => {
					setTimeout(() => callback(`${idx}`), 2000);
				},
				getTooltip: (idx, geometry) => {
					return geometry.type;
				},
				cluster: true,
				on: {
					click: (e, idx) => {
						console.info(idx);
					},
					mouseenter: (e, idx) => {
						console.info(idx);
					}
				}
			},
			onChange: this.onMapChange
		};

		this.activeIdx = 0;

		const options = {
			rootElem: document.getElementById("root"),
			activeIdx: 0,
			draw: this.drawOptions,
			lineTransect: {feature: lineTransects.features[2], activeIdx: 3, onChange: this.onLTChange},
			lang: "fi",
			popupOnHover: true,
			center: {
				"lat": 60.3499057749654,
				"lng": 21.160612106323246
			},
			zoom: 11,
			markerPopupOffset: 40,
			featurePopupOffset: 5,
			controlSettings: {
				coordinates: true,
				drawCopy: true,
				drawUpload: true,
				drawClear: true
			},
			data: this.data,
			tileLayerName: "openStreetMap",
			overlayNames: ["ykjGrid", "ykjGridLabels"],
		};

		const map = new LajiMap(options);
		this.map = map;
		new LajiMap({...options,
			rootElem: document.getElementById("root2"),
			lang: "en",
			lineTransect: undefined,
			center: [60.40403173483798, 22.104264017028992],
			zoom: 7,
			tileLayerName: "taustakartta",
		});

		setTimeout(() => {
			this.map.setNormalizedZoom(13);
		}, 100);

		["fi", "en", "sv"].forEach(lang => {
			document.getElementById(lang).addEventListener("click", () => map.setLang(lang));
		});
	}

	onLTChange = (events) => {
		events.forEach(e => {
			console.info(e);
			switch (e.type) {
			case "create":
				break;
			case "delete":
				break;
			case "edit":
				break;
			case "active":
			}
		});
	}

	onMapChange = (events) => {
		let drawData = this.drawOptions.data;
		events.forEach(e => {
			console.info(e);
			switch (e.type) {
			case "create":
				drawData.featureCollection.features.push(e.feature);
				break;
			case "delete":
				drawData.featureCollection.features = drawData.featureCollection.features.filter((item, i) => !e.idxs.includes(i));
				break;
			case "edit":
				for (let idx in e.featureCollection) {
					this.drawData.featureCollection.features[idx] = e.features[idx];
				}
				break;
			case "active":
				this.activeIdx = e.idx;
			}
		});
	}
}

const app = new App();
if (process.env.NODE_ENV !== "production") window.lajiMap = app.map;

