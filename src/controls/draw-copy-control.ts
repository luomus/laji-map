import LajiMap from "../map";
import { createTextArea, convertGeoJSON, getCRSObjectForGeoJSON, standardizeGeoJSON, geoJSONToISO6709, geoJSONToWKT } from "../utils";

export default (lajiMap: LajiMap) => {
	const table = document.createElement("table");
	table.className = "laji-map-draw-copy-table";

	const HTMLInput = createTextArea(10, 50);
	HTMLInput.setAttribute("readonly", "readonly");
	HTMLInput.addEventListener("focus", HTMLInput.select);

	const features = lajiMap.getDraw().featureCollection.features.map(f => lajiMap.formatFeatureOut(f));
	const originalGeoJSON = {...lajiMap.getDraw().featureCollection, features};

	const converterFor = (proj) => (input) => {
		const reprojected = convertGeoJSON(input, "WGS84", proj);
		(<any> reprojected).crs = getCRSObjectForGeoJSON(reprojected, proj);
		return reprojected;
	};

	const TOP = "TOP";
	const LEFT = "LEFT";

	const pipeline = [
		{ // GeoJSON -> GeoJSON with coordinates converted
			commands: {
				"WGS84": standardizeGeoJSON,
				"YKJ": input => converterFor("EPSG:2393")(standardizeGeoJSON(input)),
				"ETRS-TM35FIN": input => converterFor("EPSG:3067")(standardizeGeoJSON(input))
			},
			position: TOP
		},
		{ // GeoJSON -> String
			commands: {
				"GeoJSON": input => JSON.stringify(input, undefined, 2),
				"ISO 6709": geoJSONToISO6709,
				"WKT": geoJSONToWKT
			},
			position: LEFT
		}
	];

	let activeCommands = pipeline.map(({commands}) => Object.keys(commands)[0]);

	const leftTabs = [];
	const topTabs = [];

	pipeline.forEach(({commands, position}, idx) => {
		let activeTab = undefined;

		function setActiveTab(tab, label) {
			if (activeTab) {
				activeTab.className = "";
			}
			activeTab = tab;
			activeTab.className = "active";
			activeCommands[idx] = label;
		}

		const tabs = document.createElement("ul");
		const tabContainer = (position === LEFT) ? (() => {
			const _tabContainer = document.createElement("div");
			_tabContainer.className = "tabs-left";
			_tabContainer.appendChild(tabs);
			return _tabContainer;
		})() : tabs;
		tabs.className = "nav nav-tabs";

		Object.keys(commands).map((label, _idx) => {
			const tab = document.createElement("li");
			const text = document.createElement("a");

			if (_idx === 0) {
				setActiveTab(tab, label);
			}

			text.innerHTML = label;
			tab.appendChild(text);

			tab.addEventListener("click", () => {
				const {scrollTop, scrollLeft} = HTMLInput;
				setActiveTab(tab, label);
				updateOutput();
				HTMLInput.scrollTop = scrollTop;
				HTMLInput.scrollLeft = scrollLeft;
			});

			return tab;
		}).forEach(tab => tabs.appendChild(tab));

		let tabsArr = topTabs;
		if (position === LEFT) tabsArr = leftTabs;
		tabsArr.push(tabContainer);
	});

	function updateOutput() {
		HTMLInput.value = pipeline.reduce((_output, {commands}, idx) =>
			commands[activeCommands[idx]](_output), originalGeoJSON
		);
		HTMLInput.focus();
		HTMLInput.select();
	}

	const rows = [
		[undefined, topTabs],
		[leftTabs, HTMLInput]
	];

	const tBody = document.createElement("tbody");
	rows.forEach(row => {
		const tr = document.createElement("tr");
		row.forEach(items => (Array.isArray(items) ? items : [items])
			.forEach(elem => {
				const td = document.createElement("td");
				td.appendChild(elem || document.createElement("div"));
				tr.appendChild(td);
			}));
		tBody.appendChild(tr);
	});

	table.appendChild(tBody);

	lajiMap._showDialog(table);
	updateOutput();
};
