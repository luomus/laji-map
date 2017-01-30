import "leaflet";
import "leaflet-draw";
import "proj4leaflet";
import "leaflet-contextmenu";
import "Leaflet.vector-markers";
import "leaflet.markercluster";
import "leaflet-mml-layers";
import "./lib/Leaflet.rrose/leaflet.rrose-src.js";
import proj4 from "proj4"
import HasControls from "./controls";
import {
	INCOMPLETE_COLOR,
	NORMAL_COLOR,
	ACTIVE_COLOR,
	DATA_LAYER_COLOR,
	USER_LOCATION_COLOR,
	MAASTOKARTTA,
	TAUSTAKARTTA,
	OPEN_STREET,
	GOOGLE_SATELLITE,
	EPSG2393String,
	MAP
} from "./globals";

import translations from "./translations.js";

const optionKeys = {
	rootElem: "setRootElem",
	lang: "setLang",
	data: "setData",
	draw: "setDraw",
	tileLayerName: "setTileLayerByName",
	center: "setCenter",
	zoom: "setNormalizedZoom",
	locate: true,
	onChange: "setOnDrawChange",
	onPopupClose: true,
	markerPopupOffset: true,
	featurePopupOffset: true,
	popupOnHover: true,
	onInitializeDrawLayer: true
}

function capitalizeFirstLetter(string) {
	return string.charAt(0).toUpperCase() + string.slice(1);
}

const providerToDependency = {};
const dependencyToProvider = {};
const reflected = {};

function initDepContextFor(target) {
	["provided", "depsExecuted", "params", "reflected"].forEach(prop => {
		if (!target[prop]) {
			target[prop] = {};
		}
	});
}

export function depsProvided(target, name, args) {
	initDepContextFor(target);
	const {depsExecuted, params} = target;
	if (!depsExecuted[name] && !depIsProvided(target, name)) {
		params[name] = args;
		return false;
	}
	return true;
}

export function reflect() {
	return (target, property) => {
		reflected[property] = true;
	}
}

export function dependsOn(...deps) {
	return (target, property) => {
		if (dependencyToProvider[property]) return; // dependency tree contructed already

		deps.forEach(dep => {
			providerToDependency[dep] = [...(providerToDependency[dep] || []), property];
		});
		dependencyToProvider[property] = deps;
	}
}

function depIsProvided(target, dep) {
	let returnValue = false;
	const {depsExecuted, provided} = target;
	if (dependencyToProvider[dep].every(_prov => provided[_prov])) {
		if (depsExecuted[dep] && !reflected[dep]) return;
		returnValue = true;
	}
	return returnValue;
}

function executeDependencies(target, prov) {
	const {depsExecuted} = target;
	(providerToDependency[prov] || []).filter(dep => depIsProvided(target, dep)).forEach(dep => {
		if (!target.params[dep] && !reflected[dep]) return;
		target[dep](...(target.params[dep] || []));
		delete target.params[dep];
		depsExecuted[dep] = true;
	});
}

export function provide(target, prov) {
	initDepContextFor(target);
	target.provided[prov] = true;
	executeDependencies(target, prov);
}

export function isProvided(target, prov) {
	return target.provided[prov];
}


@HasControls
export default class LajiMap {
	constructor(props) {
		this._constructDictionary();
		this.onSetLangHooks = [];


		proj4.defs("EPSG:2393", EPSG2393String);

		const options = {
			tileLayerName: TAUSTAKARTTA,
			lang: "en",
			data: [],
			draw: {}, //default are set at setDraw
			locate: false,
			center:  [65, 26],
			zoom: 2,
			popupOnHover: false
		};

		const combined = {...options, ...props};
		Object.keys(combined).forEach(option => {
			this.setOption(option, combined[option]);
		});
		this._initializeMap();
	}

	setOptions(options) {
		Object.keys(options || {}).forEach(option => {
			this.setOption(option, options[option]);
		});
	}

	setOption(option, value) {
		if (!optionKeys.hasOwnProperty(option)) return;
		else if (optionKeys[option] === true) this[option] = value;
		else {
			this[optionKeys[option]](value);
		}
	}

	@dependsOn("map")
	setRootElem(rootElem) {
		if (!depsProvided(this, "setRootElem", arguments)) return;

		this.rootElem = rootElem;
		this.rootElem.appendChild(this.container);
	}

	_initializeMap() {
		L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

		this.container = document.createElement("div");
		const {className} = this.container;
		this.container.className += ((className !== undefined && className !== null && className !== "") ? " " : "")
			+ "laji-map";

		this.finnishMapElem = document.createElement("div");
		this.foreignMapElem = document.createElement("div");
		this.blockerElem = document.createElement("div");
		this.blockerElem.className = "blocker";

		[this.finnishMapElem, this.foreignMapElem, this.blockerElem].forEach(elem => {this.container.appendChild(elem)});

		const mmlProj = L.TileLayer.MML.get3067Proj();

		// Scale controller won't work without this hack.
		// Fixes also circle projection.
		mmlProj.distance =  L.CRS.Earth.distance;
		mmlProj.R = 6378137;

		const mapOptions = {
			contextmenu: true,
			contextmenuItems: [],
			zoomControl: false,
			noWrap: true,
			continuousWorld: false,
		}

		this.finnishMap = L.map(this.finnishMapElem, {
			...mapOptions,
			crs: mmlProj,
			maxBounds: [[40, 0], [60, 120]],
		});
		this.foreignMap = L.map(this.foreignMapElem, {
			...mapOptions,
			maxBounds: [[89.45016124669523, 180], [-87.71179927260242, -180]]
		});
		this.maps = [this.finnishMap, this.foreignMap];

		[MAASTOKARTTA, TAUSTAKARTTA].forEach(tileLayerName => {
			this[tileLayerName] = L.tileLayer.mml_wmts({
				layer: tileLayerName
			});
		});

		this.openStreetMap = L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
		this.googleSatellite = L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
			subdomains:['mt0','mt1','mt2','mt3']
		});

		this.overlays = {
			geobiologicalProvinces: L.tileLayer.wms("http://maps.luomus.fi/geoserver/ows", {
				layers: 'test:eliomaakunnat',
				format: 'image/png',
				transparent: true,
				version: '1.3.0'
			}),
			metsakasvillisuusvyohykkeet: L.tileLayer.wms("http://paikkatieto.ymparisto.fi/arcgis/services/INSPIRE/SYKE_EliomaantieteellisetAlueet/MapServer/WmsServer", {
				layers: 'Metsakasvillisuusvyohykkeet',
				format: 'image/png',
				transparent: true,
				version: '1.3.0'
			}).setOpacity(0.5),
			suokasvillisuusvyohykkeet: L.tileLayer.wms("http://paikkatieto.ymparisto.fi/arcgis/services/INSPIRE/SYKE_EliomaantieteellisetAlueet/MapServer/WmsServer", {
				layers: 'Suokasvillisuusvyohykkeet',
				format: 'image/png',
				transparent: true,
				version: '1.3.0'
			}).setOpacity(0.5),
			peninkulmaGrid:
				L.tileLayer.wms("http://maps.luomus.fi/geoserver/YKJ/wms", {
					layers: `YKJ:ykj10km_grid`,
					format: "image/png",
					transparent: true,
					version: "1.1.0",
				})
		};

		this._initializeView();

		if (this.locate) {
			this.initializeViewAfterLocateFail = true;
			this._onLocate();
		}

		this._initializeMapEvents();

		provide(this, "maps");
	}


	@dependsOn("map", "center", "zoom")
	_initializeView() {
		if (!depsProvided(this, "_initializeView", arguments)) return;
		this.map.setView(
			this.center,
			this.getDenormalizedZoom(this.zoom),
			{animate: false}
		);
	}

	@dependsOn("maps")
	_initializeMapEvents() {
		if (!depsProvided(this, "_initializeMapEvents", arguments)) return;

		this.maps.forEach(map => {
			map.addEventListener({
				click: e => this._interceptClick(),
				dblclick: e => {
					if (this.editIdx !== undefined) return;
					if ((typeof this.draw === "object" && this.draw.marker !== false)
					) {
						this._onAdd(new L.marker(e.latlng));
					}
				},
				"draw:created": ({ layer }) => this._onAdd(layer),
				"draw:drawstart": () => { this.drawing = true },
				"draw:drawstop": () => { this.drawing = false },
				locationfound: (...params) => this._onLocationFound(...params),
				locationerror: (...params) => this._onLocationNotFound(...params),
				"contextmenu.hide": () => { this.contextMenuHideTimestamp = Date.now() },
			});
		});
	}

	_getDefaultCRSLayers() {
		return [this.openStreetMap, this.googleSatellite];
	}

	_getMMLCRSLayers() {
		return [this.maastokartta, this.taustakartta];
	}

	swapMap() {
		let mapElem = this.finnishMapElem;
		let otherMapElem = this.foreignMapElem;
		let otherMap = this.foreignMap;

		if (this.map === this.foreignMap) {
			mapElem = this.foreignMapElem;
			otherMapElem = this.finnishMapElem;
			otherMap = this.finnishMap;
		}
		mapElem.style.display = "block";
		otherMapElem.style.display = "none";

		const swapLayer = layer => {
			if (layer) {
				if (otherMap.hasLayer(layer)) otherMap.removeLayer(layer);
				this.map.addLayer(layer);
			}
		}

		if (!this.userLocationLayer) {
			this.userLocationLayer = new L.LayerGroup().addTo(this.map);
		} else  {
			swapLayer(this.userLocationLayer);
		}

		(this.data || []).forEach((item, i) => {
			if (item.clusterLayer) swapLayer(item.clusterLayer);
			else if (this.dataLayerGroups && this.dataLayerGroups[i]) swapLayer(this.dataLayerGroups[i]);
		});

		if (this.clusterDrawLayer) swapLayer(this.clusterDrawLayer);
		else if (this.drawLayerGroup) swapLayer(this.drawLayerGroup);

		this.recluster();

		this.map.invalidateSize();
	}

	@dependsOn("maps")
	setTileLayerByName(name) {
		if (!depsProvided(this, "setTileLayerByName", arguments)) return;
		this.tileLayerName = name;
		this.setTileLayer(this[this.tileLayerName]);
		provide(this, "tileLayerName");
	}

	@dependsOn("maps")
	setTileLayer(layer) {
		if (!depsProvided(this, "setTileLayer", arguments)) return;

		const defaultCRSLayers = this._getDefaultCRSLayers();
		const mmlCRSLayers = this._getMMLCRSLayers();

		if (!this.map) {
			this.tileLayer = layer;
			this.map = mmlCRSLayers.includes(this.tileLayer) ? this.finnishMap : this.foreignMap;
			this.swapMap();
			this.map.addLayer(this.tileLayer);

			provide(this, "map");

			return;
		}

		let mapChanged = false;
		let otherMap = undefined;
		let zoom = this.map.getZoom();
		if (mmlCRSLayers.includes(layer) && !mmlCRSLayers.includes(this.tileLayer)) {
			zoom = zoom - 3;
			mapChanged = true;
			this.map = this.finnishMap;
			otherMap = this.foreignMap;
		} else if (defaultCRSLayers.includes(layer) && !defaultCRSLayers.includes(this.tileLayer)) {
			zoom = zoom + 3;
			mapChanged = true;
			this.map = this.foreignMap;
			otherMap = this.finnishMap;
		}

		if (!mapChanged) {
			this.map.removeLayer(this.tileLayer);
		}
		this.tileLayer = layer;

		this.map.addLayer(this.tileLayer);
		if (mapChanged) {
			this.map.setView(otherMap.getCenter(), zoom, {animate: false});
			for (let overlayName in this.overlays) {
				const overlay = this.overlays[overlayName];
				if (overlay._map) {
					overlay._map.removeLayer(overlay);
					this.map.addLayer(overlay);
				}
			}
			this.swapMap();
		}
	}

	getTileLayers() {
		const tileLayers = {};
		[TAUSTAKARTTA, MAASTOKARTTA, GOOGLE_SATELLITE, OPEN_STREET].forEach(tileLayerName => {
			tileLayers[tileLayerName] = this[tileLayerName];
		})
		return tileLayers;
	}

	getNormalizedZoom() {
		const zoom = this.map.getZoom();
		return (this._getMMLCRSLayers().includes(this.tileLayer)) ? zoom : zoom - 3;
	}

	getDenormalizedZoom() {
		return this._getDefaultCRSLayers().includes(this.tileLayer) ? this.zoom + 3: this.zoom
	}

	@dependsOn("map")
	setNormalizedZoom(zoom) {
		if (!depsProvided(this, "setNormalizedZoom", arguments)) return;

		this.zoom = zoom;
		if (this.map) this.map.setZoom(this.getDenormalizedZoom());
		provide(this, "zoom");
	}

	@dependsOn("zoom")
	setCenter(center) {
		if (!depsProvided(this, "setCenter", arguments)) return;

		this.center = center;
		if (this.map) this.map.setView(center, this.getDenormalizedZoom(this.zoom));
		provide(this, "center");
	}

	destroy() {
		this.maps.forEach(map => {
			map.off();
			map = null;
		})
	}

	_constructDictionary() {
		function decapitalizeFirstLetter(string) {
			return string.charAt(0).toLowerCase() + string.slice(1);
		}

		let dictionaries = {};
		for (let word in translations) {
			for (let lang in translations[word]) {
				const translation = translations[word][lang];
				if (!dictionaries.hasOwnProperty(lang)) dictionaries[lang] = {};
				dictionaries[lang][word] = decapitalizeFirstLetter(translation);
				dictionaries[lang][capitalizeFirstLetter(word)] = capitalizeFirstLetter(translation);
			}
		}

		for (let lang in dictionaries) {
			const dictionary = dictionaries[lang];
			for (let key in dictionary) {
				while (dictionary[key].includes("$")) {
					const keyToReplace = dictionary[key].match(/\$\w+/)[0];
					const replaceKey = keyToReplace.substring(1);
					dictionary[key] = dictionary[key].replace(keyToReplace, dictionary[replaceKey]);
				}
			}
		}
		this.dictionary = dictionaries;
	}


	@dependsOn("map")
	setLang(lang) {
		if (!depsProvided(this, "setLang", arguments)) return;

		if (!this.translations || this.lang !== lang) {
			this.lang = lang;
			this.translations = this.dictionary[this.lang];

			if (this.idsToIdxs) for (let id in this.idsToIdxs) {
				this._updateContextMenuForLayer(this._getDrawLayerById(id), this.idsToIdxs[id]);
			}

			this.onSetLangHooks.forEach(hook => hook());

			provide(this, "translations");
		}
	}

	formatFeatureOut(feature, layer) {
		if (layer && layer instanceof L.Circle) {
			// GeoJSON circles doesn't have radius, so we extend GeoJSON.
			feature.geometry.radius = layer.getRadius();
		} else if  (feature.geometry.type === "Polygon") {
			//If the coordinates are ordered counterclockwise, reverse them.
			const coordinates = feature.geometry.coordinates[0].slice(0);

			const sum = coordinates.map((c, i) => {
					const next = coordinates[i + 1];
					if (next) return [c, next];
				}).filter(c => c)
					.reduce((sum, edge) =>
					(sum + (edge[1][0] - edge[0][0]) * (edge[1][1] + edge[0][1])),
					0
				);
			const isClockwise = sum >= 0;

			if (!isClockwise) {
				feature = {...feature, geometry: {...feature.geometry, coordinates: [coordinates.reverse()]}};
			}
		}

		const {lajiMapIdx, ...properties} = feature.properties;
		return {...feature, properties};
	}

	formatFeatureIn(feature, idx) {
		return {...feature, properties: {...feature.properties, lajiMapIdx: idx}};
	}

	cloneFeatures(features) {
		const featuresClone = [];
		for (let i = 0; i < features.length; i++) {
			const feature = features[i];
			featuresClone[i] = this.formatFeatureIn(feature, i);
		}
		return featuresClone;
	}

	cloneDataItem(dataItem) {
		let featureCollection = {type: "FeatureCollection"};
		featureCollection.features = this.cloneFeatures(dataItem.featureCollection.features);
		return {
			getFeatureStyle: (...params) => this._getDefaultDataStyle(...params),
			getClusterStyle: (...params) => this._getDefaultDataClusterStyle(...params),
			...dataItem, featureCollection
		};
	}

	initializeDataItem(idx) {
		const item = this.data[idx];
		const layer = L.geoJson(
			item.featureCollection,
			{
				pointToLayer: this._featureToLayer(item.getFeatureStyle, idx),
				style: feature => {return item.getFeatureStyle({featureIdx: feature.properties.lajiMapIdx, dataIdx: idx, feature: feature})},
				onEachFeature: (feature, layer) => {
					this._initializePopup(item, layer, feature.properties.lajiMapIdx);
					this._initializeTooltip(item, layer, feature.properties.lajiMapIdx);
				}
			}

		);
		this.dataLayerGroups.push(layer);
		let container = this.map;
		if (item.cluster) {
			item.clusterLayer = L.markerClusterGroup({iconCreateFunction: this._getClusterIcon(item), ...item.cluster}).addTo(this.map);
			container = item.clusterLayer;
		}
		layer.addTo(container);
	}

	@dependsOn("map")
	setData(data) {
		if (!depsProvided(this, "setData", arguments)) return;

		if (this.dataLayerGroups) {
			this.data.forEach((item ,i) => {
				if (item.clusterLayer) {
					item.clusterLayer.clearLayers();
				} else if (this.dataLayerGroups[i]) {
					this.dataLayerGroups[i].clearLayers();
				}
			});
		}
		this.data = (data ? (Array.isArray(data) ? data : [data]) : []).map(item => this.cloneDataItem(item));
		this.dataLayerGroups = [];
		this.data.forEach((item, idx) => this.initializeDataItem(idx));
	}

	addData(data) {
		if (!data) return;
		if (!Array.isArray(data)) data = [data];
		const newData = data.map(item => this.cloneDataItem(item));
		this.data = this.data.concat(newData);
		for (let idx = this.data.length - newData.length; idx < this.data.length; idx++) {
			this.initializeDataItem(idx);
		}
	}

	@dependsOn("map")
	setDraw(options) {
		if (!depsProvided(this, "setDraw", arguments)) return;

		const drawAllowed = (options === true || options.constructor === Object);

		this.draw = drawAllowed ? {
			data: {featureCollection: {type: "FeatureCollection", features: []}},
			editable: true,
			hasActive: false,
			activeIdx: undefined,
			rectangle: true,
			polygon: true,
			polyline: true,
			circle: true,
			marker: true,
			...(options || {})
		} : {
			data: {featureCollection: {type: "FeatureCollection", features: []}},
			editable: false,
			hasActive: false,
			activeIdx: undefined,
			rectangle: false,
			polygon: false,
			polyline: false,
			circle: false,
			marker: false,
		};

		if (drawAllowed) {
			this.setDrawData(this.draw.data);
			this.setOnDrawChange(this.draw.onChange);
			this.setActive(options.hasActive ? options.activeIdx : undefined);
			provide(this, "draw");
		}
	}

	setDrawData(data) {
		if (!data) data = {
			featureCollection: {features: []}
		};

		const featureCollection = {type: "FeatureCollection"};
		featureCollection.features = this.cloneFeatures(data.featureCollection.features);
		this.draw.data = (data) ? {
			getFeatureStyle: (...params) => this._getDefaultDrawStyle(...params),
			getClusterStyle: (...params) => this._getDefaultDrawClusterStyle(...params),
			...data,
			featureCollection
		} : [];

		if (this.drawLayerGroup) this.drawLayerGroup.clearLayers();
		if (this.clusterDrawLayer) this.clusterDrawLayer.clearLayers();

		this.drawLayerGroup = L.geoJson(
			this.draw.data.featureCollection,
			{
				pointToLayer: this._featureToLayer(this.draw.data.getFeatureStyle),
				style: feature => {
					return this.draw.data.getFeatureStyle({featureIdx: feature.properties.lajiMapIdx, feature})
				},
				onEachFeature: (feature, layer) => {
					this._initializeDrawLayer(layer, feature.properties.lajiMapIdx);
				}
		});
		let drawLayerForMap = this.drawLayerGroup;
		if (data.cluster) {
			this.clusterDrawLayer = L.markerClusterGroup(
				{iconCreateFunction: this._getClusterIcon(this.draw.data, !!"isDrawData"),
					...data.cluster})
				.addLayer(this.drawLayerGroup);
			drawLayerForMap = this.clusterDrawLayer;
		}
		drawLayerForMap.addTo(this.map);
		this._resetIds();
		this.setActive(this.draw.activeIdx);
	}

	setOnDrawChange(onChange) {
		this.draw.onChange = onChange;
	}

	clearDrawData() {
		this.setDrawData({...this.draw.data, featureCollection: {type: "FeatureCollection", features: []}});
	}

 	_createIcon(options = {}) {
		const markerColor = options.color || NORMAL_COLOR;
		const opacity = options.opacity || 1;
		return L.VectorMarkers.icon({
			prefix: "glyphicon",
			icon: "record",
			markerColor,
			opacity
		});
	}

	_getClusterIcon(data, isDrawData) {
		return (cluster) => {
			var childCount = cluster.getChildCount();

			var className = ' marker-cluster-';
			if (childCount < 10) {
				className += 'small';
			} else if (childCount < 100) {
				className += 'medium';
			} else {
				className += 'large';
			}

			let color =  NORMAL_COLOR;
			let opacity = 0.5;
			if (data.getClusterStyle) {
				const featureStyle = data.getClusterStyle(childCount);
				if (featureStyle.color) color = featureStyle.color;
				if (featureStyle.opacity) opacity = featureStyle.opacity;
			}

			const styleObject = {
				"background-color": color,
				opacity: opacity
			}
			const styleString = Object.keys(styleObject)
				.reduce((style, key) => {style += `${key}:${styleObject[key]};`; return style}, "");

			return L.divIcon({
				html: `<div style="${styleString}"><span>${childCount}</span></div>`,
				className: `marker-cluster${className}`,
				iconSize: new L.Point(40, 40)
			});
		}
	}

	setActive(idx) {
		if (!this.draw.hasActive) return;
		const id = this.idxsToIds[idx];
		const prevActiveIdx = this.draw.activeIdx;
		this.draw.activeIdx = idx;
		this._updateDrawLayerStyle(this.idxsToIds[prevActiveIdx]);
		this._updateDrawLayerStyle(id);
	}

	_resetIds() {
		// Maps item indices to internal ids and the other way around.
		// We use leaflet ids as internal ids.
		this.idxsToIds = {};
		this.idsToIdxs = {};

		let counter = 0;
		if (this.drawLayerGroup) this.drawLayerGroup.eachLayer(layer => {
			const id = layer._leaflet_id;
			this.idxsToIds[counter] = id;
			this.idsToIdxs[id] = counter;
			counter++;
		});
	}

	recluster() {
		this._reclusterData();
		this._reclusterDrawData();
	}

	_reclusterDrawData() {
		if (this.clusterDrawLayer) {
			this.clusterDrawLayer.clearLayers();
			this.clusterDrawLayer.addLayer(this.drawLayerGroup);
		}
	}

	_reclusterData() {
		if (this.data) this.data.forEach((dataItem, idx) => {
			if (dataItem.clusterLayer) {
				this.map.removeLayer(dataItem.clusterLayer);
				dataItem.clusterLayer = L.markerClusterGroup({
					iconCreateFunction: (...params) => this._getClusterIcon(dataItem)(...params),
					...dataItem.cluster}
				).addTo(this.map);
				dataItem.clusterLayer.addLayer(this.dataLayerGroups[idx]);
			}
		});
	}

	redrawDrawData() {
		for (let id in this.idsToIdxs) {
			this._initializeDrawLayer(this._getDrawLayerById(id), this.idsToIdxs[id]);
		}
		this._resetIds();
		this._reclusterDrawData();
	}

	redrawDataItem(idx) {
		const dataItem = this.data[idx];
		if (!dataItem || !this.dataLayerGroups || !this.dataLayerGroups[idx]) return;

		this._updateDataLayerGroupStyle(idx);

		let _idx = 0;
		this.dataLayerGroups[idx].eachLayer(layer => {
			this._initializePopup(dataItem, layer, _idx);
			this._initializeTooltip(dataItem, layer, _idx);
			_idx++;
		});
	}

	redrawData() {
		this.data.forEach((dataItem, idx) => {
			this.redrawDataItem(idx);
		})
	}

	redraw() {
		this.redrawDrawData();
		this.redrawData();
	}

	_initializePopup(data, layer, idx) {
		if (!data.getPopup) return;

		const that = this;

		let latlng = undefined;

		function openPopup(content) {
			if (!latlng) return;
			if (data === that.draw.data && that.editIdx === idx) return;

			const offset = (layer instanceof L.Marker) ? (-that.markerPopupOffset  || 0) : (-that.featurePopupOffset || 0);

			that.popup = new L.Rrose({ offset: new L.Point(0, offset), closeButton: !that.popupOnHover, autoPan: false })
				.setContent(content)
				.setLatLng(latlng)
				.openOn(that.map);
		}

		function closePopup() {
			if (latlng) that.map.closePopup();
			if (that.onPopupClose) that.onPopupClose();
			latlng = undefined;
		}

		function getContentAndOpenPopup(_latlng) {
			if (!that.popupCounter) that.popupCounter = 0;
			that.popupCounter++;

			latlng = _latlng;

			let {popupCounter} = that;

			// Allow either returning content or firing a callback with content.
			const content = data.getPopup(idx, callbackContent => {if (that.popupCounter == popupCounter) openPopup(callbackContent)});
			if (content) openPopup(content);
		}


		if (this.popupOnHover) {
			layer.on("mousemove", e => {
				latlng = e.latlng;
				if (that.popup) that.popup.setLatLng(latlng);
			});
			layer.on("mouseover", e => {
				getContentAndOpenPopup(e.latlng);
			});
			layer.on('mouseout', e => {
				closePopup();
			});
		} else {
			layer.on("click", e => {
				if (data.getPopup) {
					closePopup();
					getContentAndOpenPopup(e.latlng);
				}
			});
		}
	}

	_initializeTooltip(data, layer, idx) {
		if (!data.getTooltip) return;

		function openTooltip(content) {
			layer.bindTooltip(content, data.tooltipOptions)
		}

		// Allow either returning content or firing a callback with content.
		const content = data.getTooltip(idx, callbackContent => openTooltip(callbackContent));
		if (content) openTooltip(content);
	}

	_initializeDrawLayer(layer, idx) {
		if (this.drawLayerGroup) this.drawLayerGroup.addLayer(layer);

		if (!this.idxsToIds) this.idxsToIds = {};
		if (!this.idsToIdxs) this.idsToIdxs = {};

		this._updateContextMenuForLayer(layer, idx);

		layer.on("click", (e) => {
			if (!this._interceptClick()) this._onActiveChange(this.idsToIdxs[layer._leaflet_id]);
		});
		layer.on("dblclick", () => this._setEditable(this.idsToIdxs[layer._leaflet_id]));

		this._initializePopup(this.draw.data, layer, idx);
		this._initializeTooltip(this.draw.data, layer, idx);

		if (this.onInitializeDrawLayer) this.onInitializeDrawLayer(idx, layer);

		return layer;
	}

	_updateContextMenuForLayer(layer, idx) {
		const { translations } = this;
		layer.unbindContextMenu();

		let contextmenuItems = [];

		if (this.draw && this.draw.editable) {
			contextmenuItems = [
				{
					text: translations ? translations.EditFeature : "",
					callback: () => this._setEditable(idx),
					iconCls: "glyphicon glyphicon-pencil"
				},
				{
					text: translations ? translations.DeleteFeature : "",
					callback: () => this._onDelete(this.idxsToIds[idx]),
					iconCls: "glyphicon glyphicon-trash"
				}
				]
		}

		layer.bindContextMenu({
			contextmenuInheritItems: false,
			contextmenuItems
		});
	}

	@dependsOn("map")
	_onLocate() {
		if (!depsProvided(this, "_onLocate", arguments)) return;
		this.map.locate();
	}

	@dependsOn("map")
	_onLocationFound({latlng, accuracy, bounds}) {
		if (!depsProvided(this, "_onLocationFound", arguments)) return;

		this.map.fitBounds(bounds);

		if (this.userLocationRadiusMarker) {
			this.userLocationRadiusMarker.setLatLng(latlng).setRadius(accuracy);
			this.userLocationMarker.setLatLng(latlng);
		} else {
			this.userLocationRadiusMarker = new L.circle(latlng, accuracy,
				{
					color: USER_LOCATION_COLOR,
					fillColor: USER_LOCATION_COLOR,
					opacity: 0
				}).addTo(this.userLocationLayer);
			this.userLocationMarker = new L.CircleMarker(latlng,
				{
					color: USER_LOCATION_COLOR,
					fillColor: USER_LOCATION_COLOR,
					fillOpacity: 0.7
				}).addTo(this.userLocationLayer);
		}

		this.userLocationMarker.on("click", () => { if (!this._interceptClick()) this.map.fitBounds(this.userLocationRadiusMarker.getBounds()) });
	}

	_onLocationNotFound() {
		alert(this.translations.geolocationFailed);
		if (this.initializeViewAfterLocateFail) this._initializeView();
	}

	_getDrawLayerById(id) {
		return this.drawLayerGroup._layers ? this.drawLayerGroup._layers[id] : undefined;
	}

	_triggerEvent(e) {
		if (!Array.isArray(e)) e = [e];
		if (this.draw.onChange) this.draw.onChange(e);
	}

	_onAdd(layer) {
		if (layer instanceof L.Marker) layer.setIcon(this._createIcon());

		const {featureCollection: {features}} = this.draw.data;

		const idx = features.length;
		const feature = this.formatFeatureOut(this._initializeDrawLayer(layer, features.length).toGeoJSON(), layer);
		feature.properties.lajiMapIdx = idx;
		const id = layer._leaflet_id;
		this.idsToIdxs[id] = idx;
		this.idxsToIds[idx] = id;

		if (this.draw.data.cluster) {
			this.clusterDrawLayer.clearLayers();
			this.clusterDrawLayer.addLayer(this.drawLayerGroup);
		}
		features.push(feature);

		const event = [
			{
				type: "create",
				feature
			},
			this._getOnActiveChangeEvent(features.length - 1)
		];

		this._triggerEvent(event);
	};

	_onEdit(data) {
		const eventData = {};
		for (let id in data) {
			const feature = this.formatFeatureOut(data[id].toGeoJSON(), data[id]);
			const idx = this.idsToIdxs[id];
			eventData[idx] = feature;
			this.draw.data.featureCollection.features[idx] = this.formatFeatureIn(feature, idx);
		}

		this._triggerEvent({
			type: "edit",
			features: eventData
		});
	}

	_onDelete(deleteIds) {
		this._clearEditable();

		if (!Array.isArray(deleteIds)) deleteIds = [deleteIds];

		const deleteIdxs = deleteIds.map(id => this.idsToIdxs[id]);

		const activeIdx = this.draw.activeIdx;

		const {featureCollection: {features}} = this.draw.data;

		const survivingIds = Object.keys(this.idsToIdxs).map(id => parseInt(id)).filter(id => !deleteIds.includes(id));

		let changeActive = false;
		let newActiveId = undefined;
		const activeId = this.idxsToIds[this.draw.activeIdx];
		if (features && survivingIds.length === 0) {
			changeActive = true;
		} else if (this.draw.activeIdx !== undefined && deleteIds.includes(activeId)) {
			changeActive = true;

			let closestSmallerId = undefined;
			let closestGreaterId = undefined;
			let closestDistance = undefined;
			let closestNegDistance = undefined;

			survivingIds.forEach(id => {
				const dist = activeIdx - this.idsToIdxs[id];
				if (dist > 0 && (closestDistance === undefined || dist < closestDistance)) {
					closestDistance = dist;
					closestSmallerId = id;
				} else if (dist < 0 && (closestNegDistance === undefined || dist > closestNegDistance)) {
					closestNegDistance = dist;
					closestGreaterId = id;
				}
			});

			if (closestGreaterId !== undefined) newActiveId = closestGreaterId;
			else if (closestSmallerId !== undefined) newActiveId = closestSmallerId;
		} else {
			newActiveId = activeId;
			changeActive = true;
		}

		this.draw.data.featureCollection.features = features.filter((item, i) => !deleteIdxs.includes(i));

		deleteIds.forEach(id => {
			this.drawLayerGroup.removeLayer(id);
		});

		this._resetIds();

		this.drawLayerGroup.eachLayer(layer => {
			this._updateContextMenuForLayer(layer, this.idsToIdxs[layer._leaflet_id]);
		});

		this._reclusterDrawData();

		const event = [{
			type: "delete",
			idxs: deleteIdxs
		}];

		if (changeActive) event.push(this._getOnActiveChangeEvent(this.idsToIdxs[newActiveId]));

		this._triggerEvent(event);
	}

	_getOnActiveChangeEvent(idx) {
		this.setActive(idx);
		return {
			type: "active",
			idx
		}
	}

	_onActiveChange(idx) {
		if (this.draw.hasActive) this._triggerEvent(this._getOnActiveChangeEvent(idx));
	}

	focusToLayer(idx) {
		const id = this.idxsToIds[idx];

		if (idx === undefined) {
			this.activeId = this.idxsToIds[idx];
			return;
		}

		let layer = this._getDrawLayerById(id);
		if (!layer) return;

		if (layer instanceof L.Marker) {
			this.map.setView(layer.getLatLng());
		} else	{
			this.map.fitBounds(layer.getBounds());
		}

		this._onActiveChange(idx);
	}

	_setEditable(idx) {
		if (!this.draw || !this.draw.editable) return;
		this._clearEditable();
		this.editIdx = idx;
		const editLayer = this._getDrawLayerById(this.idxsToIds[this.editIdx]);
		if (this.draw.data.cluster) {
			this.clusterDrawLayer.removeLayer(editLayer);
			this.map.addLayer(editLayer);
		}
		editLayer.editing.enable();
		editLayer.closePopup();
	}

	_clearEditable() {
		if (this.editIdx === undefined) return;
		const editLayer = this._getDrawLayerById(this.idxsToIds[this.editIdx]);
		editLayer.editing.disable();
		if (this.draw.data.cluster) {
			this.map.removeLayer(editLayer);
			this.clusterDrawLayer.addLayer(editLayer);
		}
		this._reclusterDrawData();
		this.editIdx = undefined;
	}

	_commitEdit() {
		const {editIdx} = this;
		const editId = this.idxsToIds[editIdx];
		this._clearEditable();
		this._onEdit({[editId]: this._getDrawLayerById(editId)});
	}

	_interceptClick() {
		if (this.contextMenuHideTimestamp !== undefined) {
			const timestamp = this.contextMenuHideTimestamp;
			this.contextMenuHideTimestamp = undefined;
			if (Date.now() - timestamp < 200) return true;
		}

		if (this.drawing) return true;
		if (this.editIdx !== undefined) {
			this._commitEdit();
			return true;
		}
	}

	updateLayerStyle(layer, style) {
		if (!layer) return;

		if (layer instanceof L.Marker) {
			if (style.opacity !== undefined) layer.options.opacity = style.opacity;

			layer.options.icon.options.markerColor = style.color;
			if (layer._icon) {
				// Color must also be changed directly through DOM manipulation.
				layer._icon.firstChild.firstChild.style.fill = style.color;
				if (style.opacity !== undefined) {
					layer._icon.firstChild.firstChild.style.opacity = style.opacity;
				}
			}
		} else {
			layer.setStyle(style);
		}
	}

	_reversePointCoords(coords) {
		if (!coords || coords.length !== 2) throw new Error("Invalid point coordinates");
		return [coords[1], coords[0]];
	}

	_featureToLayer(getFeatureStyle, dataIdx) {
		return (feature) => {
			let layer;
			if (feature.geometry.type === "Point") {
				const latlng = this._reversePointCoords(feature.geometry.coordinates);
				const params = {feature, featureIdx: feature.properties.lajiMapIdx};
				if (dataIdx !== undefined) params[dataIdx] = dataIdx;
				layer = (feature.geometry.radius) ?
					new L.Circle(latlng, feature.geometry.radius) :
					new L.marker(latlng, {
						icon: this._createIcon(getFeatureStyle(params))
					});
			} else {
				layer = L.GeoJSON.geometryToLayer(feature);
			}
			return layer;
		}
	}

	_getDrawingDraftStyle() {
		return this.draw && this.draw.getDraftStyle ?
			this.draw.getDraftStyle() :
			this._getStyleForType({color: INCOMPLETE_COLOR, fillColor: INCOMPLETE_COLOR, opacity: 0.8});
	}

	_getStyleForType(overrideStyles, id) {
		const idx = this.idsToIdxs[id];

		const styles = {
			opacity: 1,
			fillOpacity: 0.4,
			color: NORMAL_COLOR,
			fillColor: NORMAL_COLOR
		};

		const dataStyles = this.draw.data.getFeatureStyle({
			featureIdx: idx,
			feature: this.draw.data.featureCollection.features[idx]
		});

		[dataStyles, overrideStyles].forEach(_styles => {
			if (_styles) for (let style in _styles) {
				styles[style] = _styles[style];
			}
		})

		return styles;
	}

	_getStyleForLayer(layer, overrideStyles, id) {
		return this._getStyleForType(overrideStyles, id);
	}

	_updateDrawLayerStyle(id) {
		if (id === undefined) return;
		const layer = this._getDrawLayerById(id);

		if (!layer) return;

		let style = {};
		if (layer instanceof L.Marker) {
			const idx = this.idsToIdxs[id];
			style = this.draw.data.getFeatureStyle({
				featureIdx: idx,
				feature: this.draw.data.featureCollection.features[idx]});
		} else {
			const style =  {};
			layer.setStyle(this._getStyleForLayer(layer, style, id));
		}

		this.updateLayerStyle(layer, style);
	}

	_getDefaultDrawStyle(options) {
		const featureIdx = options ? options.featureIdx : undefined;
		const color = (this.idxsToIds && featureIdx !== undefined && featureIdx === this.draw.activeIdx) ? ACTIVE_COLOR : NORMAL_COLOR;
		return {color: color, fillColor: color, opacity: 1, fillOpacity: 0.7};
	}

	_getDefaultDrawClusterStyle() {
		return {color: (this.draw.data.getFeatureStyle || this._getDefaultDrawStyle)({}).color, opacity: 1};
	}

	_getDefaultDataStyle() {
		return {color: DATA_LAYER_COLOR, fillColor: DATA_LAYER_COLOR, opacity: 1, fillOpacity: 0.7};
	}

	_getDefaultDataClusterStyle() {
		return {color: DATA_LAYER_COLOR, opacity: 1};
	}

	_updateDataLayerGroupStyle(idx) {
		const dataItem = this.data[idx];
		if (!dataItem) return;

		let i = 0;
		this.dataLayerGroups[idx].eachLayer(layer => {
			this.updateLayerStyle(layer,
				dataItem.getFeatureStyle({
					dataIdx: idx,
					featureIdx: i,
					feature: this.data[idx].featureCollection.features[i]
				})
			);
			i++;
		});
	}

	addTranslationHook(elem, attr, translationKey) {
		const that = this;

		function translate() {
			const translation = (typeof translationKey === "function") ? translationKey() : that.translations[translationKey];

			if (typeof elem[attr] === "function") {
				elem[attr](translation);
			} else {
				elem[attr] = translation;
			}
		}

		translate();
		this.onSetLangHooks.push(translate);
		return translate;
	}

	removeTranslationHook(hook) {
		const index = this.onSetLangHooks.indexOf(hook);
		if (index >= 0) {
			this.onSetLangHooks.splice(index, 1);
		}
	}

	convert(latlng, from, to) {
		const converted = proj4(from, to, latlng.map(c => +c).slice(0).reverse());
		return (to === "WGS84") ? converted : converted.map(c => parseInt(c));
	}

	triggerDrawing(featureType) {
		const options = this._getDrawingDraftStyle(featureType.toLowerCase());
		const optionsToPass = featureType.toLowerCase() !== "marker" ? {
			shapeOptions: options
		} : {
			icon: this._createIcon(options)
		};
		new L.Draw[capitalizeFirstLetter(featureType)](this.map, optionsToPass).enable();
	}

	getFeatureTypes() {
		return ["rectangle", "polyline", "polygon", "circle", "marker"];
	}
}
