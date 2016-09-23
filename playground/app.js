import LajiMap from "../src/map";

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
						}
					]
				},
				getPopup: (idx, callback) => {
					return `gray ${idx}`;
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
					}
				},
				getPopup: (idx, callback) => {
					return `green ${idx}`;
				}
			}
		]
		this.drawData = {
			featureCollection: {
				type: "collection",
				features: [
					{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[22.207004189222086,60.47430300256853]}},
					{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[22.311658377997933,60.43453495634962]}},
					{
						"type": "Feature",
						"properties": {},
						"geometry": {
							"type": "Point",
							"coordinates": [
								22.104264017028992,
								60.40403173483798
							],
							"radius": 1955.2645542879416
						}
					}
				]
			},
			getPopup: (idx, callback) => {
				return `${idx}`;
			}
		}
		this.activeIdx = 0;

		this.map = new LajiMap({
			rootElem: document.getElementById("root"),
			drawData: this.drawData,
			data: this.data,
			activeIdx: this.activeIdx,
			center: [60.4353462, 22.2285623],
			zoom: 6,
			onChange: this.onMapChange,
			lang: "fi"
		});
		window.map = this.map;

		["fi", "en", "sv"].forEach(lang => {
			document.getElementById(lang).addEventListener("click", () => this.map.setLang(lang))
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

new App();

