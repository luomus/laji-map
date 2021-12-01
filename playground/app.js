import LajiMap from "../src/index.ts";
import * as utils from "../src/utils.ts";

import "../src/styles.ts";
import * as lineTransects from "./data.json";

let properties;

class App {
	constructor() {

		function getJsonFromUrl() {
			const type = (value) => {
				try {
					return JSON.parse(value);
				} catch (e) {
					return value;
				}
			};

			let query = location.search.substr(1);
			let result = {};
			query.split("&").forEach(function(part) {
				var item = part.split("=");
				result[item[0]] = type(decodeURIComponent(item[1]));
			});
			return result;
		}

		const query = getJsonFromUrl();

		this.data = [
			{
				featureCollection: {
					type: "featureCollection",
					features: [
						{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":
						[
							[22.207004189222086,60.47430300256853],
							[22.311658377997933,60.7]
						]
						}},
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
				getPopup: ({featureIdx: idx}) => {
					return `gray ${idx}`;
				},
				getFeatureStyle: () => {
					return {color: "#f00"};
				},
				cluster: true,
				on: {
					click: (e, {idx, feature, layer}) => {
						console.info("clicked", idx, feature, layer);
					},
				},
				//activeIdx: 0,
				//editable: true,
				highlightOnHover: true,
				showMeasurements: true
			}
		];

		this.drawOptions = {
			showMeasurements: true,
			featureCollection: {
				type: "FeatureCollection",
				features: [
					{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":
					[
						[22.207004189222086,60.47430300256853],
						[22.311658377997933,60.43453495634962]
					]
					}}
				],
			},
			getPopup: ({featureIdx: idx}, callback) => {
				setTimeout(() => callback(`${idx}`), 2000);
			},
			getTooltip: ({feature}) => {
				return feature.geometry.type;
			},
			cluster: true,
			on: {
				click: (e, idx) => {
					console.info(idx);
				},
				mouseenter: (e, idx) => {
					console.info(idx);
				},
			},
			onChange: this.onMapChange,
			polyline: {
				showStart: true,
				showDirection: true
			},
			activeIdx: 0,
			//editable: false
		};

		this.activeIdx = 0;

		const demoOptions = {
			// availableOverlayNameBlacklist: [],
			// availableTileLayerNamesBlacklist: [],
			popupOnHover: true,
			center: {
				"lat": 79.3499057749654,
				"lng": 21.160612106323246
			},
			//zoom: 12,
			zoomToData: {paddingInMeters: 200},
			//locate: true,
			tileLayerName: "maastokartta",
			 tileLayers: {
			 	layers: {
					afeGrid: true
				}
			 },
			// tileLayers: {
			// 	layers: {
			// 		taustakartta: {opacity: 0.5, visible: true},
			// 		ortokuva: {opacity: 0.5, visible: true}
			// 	}
			// },
			//overlayNames: ["ykjGrid", "ykjGridLabels"],
			controls: {
				location: true,
				coordinates: true,
				fullscreen: true,
				draw: {
					copy: true,
					upload: true,
					clear: true,
					reverse: true,
					delete: true
				},
			},
			polyline: {
				opacity: 0.1,
				showDirection: false
			},
			polygon: {
				showArea: true,
				shapeOptions: {
					showArea: true
				}
			},
			lineTransect: {
				feature: lineTransects.features[2],
				activeIdx: 0,
				onChange: this.onLTChange,
				//printMode: true,
			},
			draw: this.drawOptions,
			data: this.data,
			//locate: [undefined, undefined, {latlng: [66,25], accuracy: 200}]
			locate: {on: false, onLocationFound: () => console.info("FOUND")},
			//clickBeforeZoomAndPan: true,
			on: {
				tileLayersChange: (e) => console.log(e)
			}
		};

		let options = {
			googleApiKey: (properties || {}).googleApiKey,
			rootElem: document.getElementById("root"),
			lang: "fi",
		};

		if (query.testMode) {
			delete query.testMode;
		} else {
			options = {
				...options,
				...demoOptions
			};
		}

		options = {
			...options,
			...query
		};

		const map = new LajiMap(options);
		this.map = map;

		//map.addData({
		//	geoData: {type:"GeometryCollection", "geometries": [{"type":"Point","coordinates":[22.24,60.42]}]},
		//	getFeatureStyle: (e) => {
		//		const {featureIdx} = e;
		//		return {
		//			weight: featureIdx,
		//			opacity: 1,
		//			fillOpacity: 1,
		//			color: "#0f0"
		//		};
		//	},
		//	getPopup: (idx) => {
		//		return `green ${idx}`;
		//	}
		//});

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
		let drawData = this.drawOptions;
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
				break;
			case "insert":
				drawData.featureCollection.features.splice(e.idx, 0, e.feature);
				break;
			}
		});
	}
}

(async () => {
	try {
		properties = await import("../properties.json");
	} catch (e) {
		console.warn("LajiMap warning: properties.json not found, google services won't work");
	}
	const app = new App();
	if (process.env.NODE_ENV !== "production") {
		window.map = app.map;
		window.lajiMapUtils = utils;
	}
})();
