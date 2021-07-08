import * as L from "leaflet";
import LajiMap from "../map";
import  { convertLatLng } from "../utils";

export default L.Control.extend({
	options: {
		position: "bottomleft"
	},
	initialize(lajiMap: LajiMap, options: L.ControlOptions) {
		this.lajiMap = lajiMap;
		L.Util.setOptions(this, options);
	},
	onAdd() {
		const container = L.DomUtil.create(
			"div",
			"leaflet-bar leaflet-control laji-map-control laji-map-coordinates-control"
		);

		const table = L.DomUtil.create("table", undefined, container);
		let visible = false;
		container.style.display = "none";

		const coordinateTypes: any[] = [
			{name: "WGS84"},
			{name: "YKJ"},
			{name: "ETRS-TM35FIN"}
		];

		coordinateTypes.forEach(coordinateType => {
			const row = L.DomUtil.create("tr", undefined, table);
			coordinateType.nameCell = L.DomUtil.create("td", undefined, row);
			coordinateType.coordsCell = L.DomUtil.create("td", undefined, row);
		});

		this.lajiMap.map.on("mousemove", ({latlng}: L.LeafletMouseEvent) => {
			if (!visible) {
				container.style.display = "block";
				visible = true;
			}

			const [lng, lat] = this.lajiMap.wrapGeoJSONCoordinate([latlng.lng, latlng.lat]);
			const wgs84 = [lat, lng].map(c => c.toFixed(6));
			let ykj, etrsTm35Fin;
			try {
				ykj = convertLatLng([lat, lng], "WGS84", "EPSG:2393");
				etrsTm35Fin = convertLatLng([lat, lng], "WGS84", "EPSG:3067");
			} catch (e) {
				//
			}

			coordinateTypes.forEach(({name, nameCell, coordsCell}) => {
				let coords = wgs84;
				if (name === "YKJ") coords = ykj;
				else if (name === "ETRS-TM35FIN") coords = etrsTm35Fin;
				nameCell.innerHTML = `<strong>${name}:</strong>`;
				let coordsFormatted = undefined;
				if (coords) switch (name) {
				case "WGS84":
					coordsFormatted = coords.join(", ");
					break;
				case "YKJ":
					coordsFormatted = coords.join(":");
					break;
				case "ETRS-TM35FIN":
					coordsFormatted = `N=${coords[0]} E=${coords[1]}`;
				}
				coordsCell.innerHTML = coordsFormatted || "";
				coordsCell.className = "monospace";
			});
		}).on("mouseout", () => {
			container.style.display = "none";
			visible = false;
		});

		return container;
	}
});
