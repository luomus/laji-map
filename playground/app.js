import LajiMap from "../src/map";
import lineTransects from "./data.json";
import * as utils from "../src/utils";

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
				getPopup: (idx) => {
					return `gray ${idx}`;
				},
				cluster: true,
				on: {
					click: (e, {idx, feature, layer}) => {
						console.info("clicked", idx, feature, layer);
					},
				},
				activeIdx: 0,
				editable: true,
			},

		];

		this.drawOptions = {
			featureCollection: {
				type: "FeatureCollection",
				features: [
					{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":
					[
						[22.207004189222086,60.47430300256853],
						[22.311658377997933,60.43453495634962]
					]
					}},
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
			},
			onChange: this.onMapChange,
			polyline: {
				showStart: true
			}
			//activeIdx: 0,
		};

		this.activeIdx = 0;

		const options = {
			rootElem: document.getElementById("root"),
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
			data: this.data,
			tileLayerName: "openStreetMap",
			overlayNames: ["ykjGrid", "ykjGridLabels"],
			controls: {
				coordinates: true,
				drawCopy: true,
				drawUpload: true,
				drawClear: true,
				drawReverse: true,
				drawDelete: true
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
		};


		const map = new LajiMap(options);
		this.map = map;
		const map2 = new LajiMap({...options,
			rootElem: document.getElementById("root2"),
			lang: "en",
			lineTransect: undefined,
			center: [60.40403173483798, 22.104264017028992],
			zoom: 7,
			tileLayerName: "taustakartta"
		});
		this.map2 = map2;

		map2.addData({
			geoData: {type:"GeometryCollection", "geometries": [{"type":"Point","coordinates":[22.24,60.42]}]},
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
		});

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
			}
		});
	}
}

const app = new App();
if (process.env.NODE_ENV !== "production") {
	window.ltMap = app.map;
	window.drawMap = app.map2;
	window.lajiMapUtils = utils;
}

