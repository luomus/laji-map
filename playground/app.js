import LajiMap from "../src/map";

import "../src/styles.js";

class App {
	constructor() {
		this.data = [
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
		this.activeIdx = 0;

		this.map = new LajiMap({
			rootElem: document.getElementById("root"),
			data: this.data,
			activeIdx: this.activeIdx,
			locate: true,
			longitude: 60.4353462,
			latitude: 22.2285623,
			zoom: 6,
			onChange: this.onMapChange,
			lang: "fi"
		});

		["fi", "en", "sv"].forEach(lang => {
			document.getElementById(lang).addEventListener("click", () => this.map.setLang(lang))
		})

	}

	onMapChange = (events) => {
		let { data } = this;
		events.forEach(e => {
			console.log(e);
			switch (e.type) {
				case "create":
					data.push(e.data);
					break;
				case "delete":
					this.data = this.data.filter((item, i) => !e.idxs.includes(i));
					break;
				case "edit":
					for (let idx in e.data) {
						this.data[idx] = e.data[idx];
					}
					break;
				case "active":
					this.activeIdx = e.idx;
			}
		});
	}
}

new App();
