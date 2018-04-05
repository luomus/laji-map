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
				getPopup: (idx) => {
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
				highlightOnHover: true
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
					}}
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
				showStart: true,
				showDirection: true
			},
			//activeIdx: 0,
		};

		this.activeIdx = 0;

		const options = {
			rootElem: document.getElementById("root"),
			lineTransect: {
				feature: lineTransects.features[2],
				activeIdx: 0,
				onChange: this.onLTChange,
				//printMode: true
			},
			lang: "fi",
			popupOnHover: true,
			//center: {
			//	"lat": 60.3499057749654,
			//	"lng": 21.160612106323246
			//},
			//zoom: 12,
			zoomToData: {paddingInMeters: 100},
			markerPopupOffset: 40,
			featurePopupOffset: 5,
			draw: this.drawOptions,
			data: this.data,
			tileLayerName: "openStreetMap",
			overlayNames: ["ykjGrid", "ykjGridLabels"],
			controls: {
				coordinates: true,
				draw: {
					copy: true,
					upload: true,
					clear: true,
					reverse: true,
					delete: true,
				}
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
			}
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

const app = new App();
if (process.env.NODE_ENV !== "production") {
	window.map = app.map;
	window.lajiMapUtils = utils;
}

