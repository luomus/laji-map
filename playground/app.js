import LajiMap from "../src/map";
import lineTransects from "../data.json";

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
				getPopup: (idx, callback) => {
					return `gray ${idx}`;
				},
				cluster: true
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
					}
				},
				getPopup: (idx, callback) => {
					return `green ${idx}`;
				}
			}
		];

		this.drawData = {
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
			getPopup: (idx, callback) => {
				return `${idx}`;
			},
			getTooltip: (idx, callback) => {
				setTimeout(() => callback(`${idx}`), 2000);
				// return `${idx}`;
			},
			tooltipOptions: {
				permanent: true
			},
			cluster: true,
		}

		this.activeIdx = 0;

		const options = {
			rootElem: document.getElementById("root"),
			activeIdx: 0,
			draw: {data: this.drawData, marker: false},
			// draw: false,
			lineTransect: {feature: lineTransects.features[2], activeIdx: 3, onChange: this.onLTChange},
			lang: "fi",
			popupOnHover: true,
			// zoom: 7,
			// center: [60.40403173483798, 22.104264017028992],
			// center: {
			// 	"lat": 60.3499057749654,
			// 	"lng": 21.160612106323246
			// },
			// zoom: 11,
			markerPopupOffset: 40,
			featurePopupOffset: 5,
			controlSettings: {
				draw: false,
				// draw: {"rectangle": true},
				drawCopy: false,
				drawClear: false,
				// coordinates: true,
				coordinateInput: false,
				// coordinateInput: false
				lineTransect: true
			},
			data: this.data,
			// tileLayerName: "openStreetMap",
		};

		const map = new LajiMap(options);
		this.map = map;
		const map2 = new LajiMap({...options,
			rootElem: document.getElementById("root2"),
			// tileLayerName: "taustakartta",
			lineTransect: {feature: lineTransects.features[3], activeIdx: 3},
			center: {
				"lat": 60.02423666765825,
				"lng": 22.735643075910296
			},
			zoom: 10
		});

		// map.startLTLineSplit();
		// map.startRemoveLTSegmentMode();

		// map.addData(
		// 	{
		// 		featureCollection: lineTransects,
		// 		// featureCollection: {
		// 		// 	features: [
		// 		// 		{
		// 		// 			type: "Feature",
		// 		// 			properties: {},
		// 		// 			geometry: {
		// 		// 				type: "Point",
		// 		// 				coordinates: [
		// 		// 					22.024264017028992,
		// 		// 					60.40403173483798
		// 		// 				]
		// 		// 			}
		// 		// 		}
		// 		// 	]
		// 		// },
		// 		getPopup: (idx) => "linja "  + idx,
		// 		getFeatureStyle: ({idx, feature}) => {
		// 			console.log(feature);
		// 			return {
		// 				weight: 2,
		// 				opacity: 1,
		// 				fillOpacity: 1,
		// 				color: "#000"
		// 			}
		// 		}
		// 	}
		// );

		["fi", "en", "sv"].forEach(lang => {
			document.getElementById(lang).addEventListener("click", () => map.setLang(lang));
		});
	}

	onLTChange = (events) => {
		events.forEach(e => {
			// console.log(e);
			switch (e.type) {
				case "create":
					// drawData.featureCollection.features.push(e.feature);
					break;
				case "delete":
					// drawData.featureCollection.features = drawData.featureCollection.features.filter((item, i) => !e.idxs.includes(i));
					break;
				case "edit":
					// console.log(e.feature);
					// for (let idx in e.featureCollection) {
					// 	this.drawData.featureCollection.features[idx] = e.features[idx];
					// }
					break;
				case "active":
					// this.activeIdx = e.idx;
			}
		});
	}

	onMapChange = (events) => {
		let { drawData } = this;
		events.forEach(e => {
			console.log(e);
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

