import "leaflet";
import "leaflet-draw";
import "proj4leaflet";
import "leaflet-contextmenu";
import "Leaflet.vector-markers";
import "leaflet.markercluster";
import "./lib/Leaflet.MML-layers/mmlLayers.js";
import "./lib/Leaflet.rrose/leaflet.rrose-src.js";
import fetch from "isomorphic-fetch";
import queryString from "querystring";

export const NORMAL_COLOR = "#257ECA";
export const ACTIVE_COLOR = "#06840A";
export const INCOMPLETE_COLOR = "#36B43A";
export const DATA_LAYER_COLOR = "#AAAAAA";
export const USER_LOCATION_COLOR = "#FF0000";

const MAASTOKARTTA = "maastokartta";
const TAUSTAKARTTA = "taustakartta";
const OPEN_STREET = "openStreetMap";
const GOOGLE_SATELLITE = "googleSatellite";

import translations from "./translations.js";

export default class LajiMap {

	constructor(props) {
		this.tileLayerName = TAUSTAKARTTA;
		this.lang = "en";
		this.locate = false;
		this.center =  [65, 26];
		this.zoom = 2;
		this.data = [];
		this.drawData = {featureCollection: {type: "featureCollection", features: []}};
		this.activeIdx = 0;
		this.baseUri = "https://beta.laji.fi/api";
		this.baseQuery = {};
		this.popupOnHover = false;

		["rootElem", "locate", "center", "zoom", "lang", "onChange",
		 "tileLayerName", "drawData", "data", "activeIdx", "markerPopupOffset", "featurePopupOffset",
		 "onInitializeDrawLayer", "popupOnHover", "baseUri",  "baseQuery"].forEach(prop => {
			if (props.hasOwnProperty(prop)) this[prop] = props[prop];
		});

		const {tileLayerName} = props;
		if ([GOOGLE_SATELLITE, OPEN_STREET].includes(tileLayerName) && !props.hasOwnProperty("zoom")) {
			this.zoom += 3;
		}

		this.geoJsonLayerOptions = {
			pointToLayer: this._featureToLayer
		}

		this._constructDictionary();
		this._initializeMap();
		this.setLang(this.lang);
		this.setData(this.data);
		this.setDrawData(this.drawData);
		this.activeId = (this.activeIdx !== undefined) ? this.idxsToIds[this.activeIdx] : undefined;
		this.setActive(this.activeId);
		this._initializeMapEvents();

		this.setControlSettings(props.controlSettings)
	}

	_initializeMap = () => {
		L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

		this.defaultCRS = L.CRS.EPSG3857;
		this.mmlCRS = L.TileLayer.MML.get3067Proj();

		this.container = document.createElement("div"); this.container.className += " laji-map";
		this.rootElem.appendChild(this.container);

		const mapElem = document.createElement("div");
		this.blockerElem = document.createElement("div");
		this.blockerElem.className = "blocker";

		[mapElem, this.blockerElem].forEach(elem => {this.container.appendChild(elem)});

		this.map = L.map(mapElem, {
			crs: L.TileLayer.MML.get3067Proj(),
			contextmenu: true,
			contextmenuItems: [],
			zoomControl: false
		});
		
		if (process.env.NODE_ENV !== "production") window.map = this.map;

		this.map.scrollWheelZoom.enable();

		[MAASTOKARTTA, TAUSTAKARTTA].forEach(tileLayerName => {
			this[tileLayerName] = L.tileLayer.mml_wmts({
				layer: tileLayerName
			});
		});

		this.openStreetMap = L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
		this.googleSatellite = L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
			subdomains:['mt0','mt1','mt2','mt3']
		});

		this.tileLayer = this.maastokartta;

		this._initializeView();

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
			}).setOpacity(0.5)
		};

		this.setTileLayer(this[this.tileLayerName]);

		this.userLocationLayer = new L.LayerGroup().addTo(this.map);

		if (this.locate) {
			this.initializeViewAfterLocateFail = true;
			this._onLocate();
		} else {
			this._initializeView();
		}
	}

	_initializeView = () => {
		this.map.setView(
			this.center,
			this.zoom,
			{animate: false}
		);
	}

	_initializeMapEvents = () => {
		this.map.addEventListener({
			click: e => this._interceptClick(),
			dblclick: e => {
				if (this.controlSettings.draw === true || (typeof this.controlSettings.draw === "object" && this.controlSettings.draw.marker !== false)) {
					this._onAdd(new L.marker(e.latlng));
				}
			},
			"draw:created": ({ layer }) => this._onAdd(layer),
			"draw:drawstart": () => { this.drawing = true },
			"draw:drawstop": () => { this.drawing = false },
			locationfound: this._onLocationFound,
			locationerror: this._onLocationNotFound,
			"contextmenu.hide": () => { this.contextMenuHideTimestamp = Date.now() },
			baselayerchange: ({layer}) => this.setTileLayer(layer)
			// blur: () => this.map.scrollWheelZoom.disable(),
			// focus: () => this.map.scrollWheelZoom.enable()
		});
	}

	_getDefaultCRSLayers = () => {
		return [this.openStreetMap, this.googleSatellite];
	}

	_getMMLCRSLayers = () => {
		return [this.maastokartta, this.taustakartta];
	}

	setTileLayer = (layer) => {
		const defaultCRSLayers = this._getDefaultCRSLayers();
		const mmlCRSLayers = this._getMMLCRSLayers();

		if (!this.tileLayer) {
			this.tileLayer = layer;
			this.map.addLayer(this.tileLayer);
			this._initializeView();
			return;
		}

		const center = this.map.getCenter();
		this.map.options.crs = (defaultCRSLayers.includes(layer)) ? this.defaultCRS : this.mmlCRS;

		this.map.setView(center); // Fix shifted center.

		let projectionChanged = false;

		let zoom = this.map.getZoom();
		if (mmlCRSLayers.includes(layer) && !mmlCRSLayers.includes(this.tileLayer)) {
			zoom = zoom - 3;
			projectionChanged = true;
		} else if (defaultCRSLayers.includes(layer) && !defaultCRSLayers.includes(this.tileLayer)) {
			zoom = zoom + 3;
			projectionChanged = true;
		}

		this.map._resetView(this.map.getCenter(), this.map.getZoom(), true); // Redraw all layers according to new projection.
		this.map.setView(this.map.getCenter(), zoom, {animate: false});

		this.tileLayer = layer;
		this.map.addLayer(this.tileLayer);

		if (projectionChanged) {
			for (let overlayName in this.overlays) {
				const overlay = this.overlays[overlayName];
				if (overlay._map) {
					this.map.removeLayer(overlay);
					this.map.addLayer(overlay);
				}
			}
			this.recluster();
		}
	}

	getTileLayers = () => {
		const tileLayers = {};
		[TAUSTAKARTTA, MAASTOKARTTA, GOOGLE_SATELLITE, OPEN_STREET].forEach(tileLayerName => {
			tileLayers[tileLayerName] = this[tileLayerName];
		})
		return tileLayers;
	}

	getNormalizedZoom = () => {
		const zoom = this.map.getZoom();
		return (this._getMMLCRSLayers().includes(this.tileLayer)) ? zoom : zoom - 3;
	}

	setNormalizedZoom = (zoom) => {
		this.map.setZoom(this._getMMLCRSLayers().includes(this.tileLayer) ? zoom : zoom + 3);
	}

	setControlSettings = (controlSettings) => {
		this.controlSettings = {
			draw: {marker: true, circle: true, rectangle: true, polygon: true, polyline: true},
			layer: true,
			zoom: true,
			location: true,
			coordinateInput: true
		};
		for (let setting in controlSettings) {
			const oldSetting = this.controlSettings[setting];
			const newSetting = controlSettings[setting];
			this.controlSettings[setting] = (typeof newSetting === "object") ?
				{...oldSetting, ...newSetting} :
				newSetting;
		}
		this._initalizeMapControls();
	}

	_controlIsAllowed = (control) => {
		const controlNameMap = {
			draw: {control: this.drawControl},
			zoom: {control: this.zoomControl},
			location: {control: this.locationControl},
			layer: {control: this.layerControl},
			coordinateInput: {control: this.coordinateInputControl,
				dependencies: [
					"draw",
					() => (this.controlSettings.draw === true ||
					       (typeof this.controlSettings.draw === "object" &&
					        ["marker", "rectangle"].some(type => {return this.controlSettings.draw[type] !== false})) )]}
		};

		const {controlSettings} = this;
		function controlIsOk(controlName) {
			const dependencies = controlNameMap[controlName].dependencies || [];
			return (controlSettings && controlSettings[controlName] && dependencies.every(dependency => {return (typeof dependency === "function") ? dependency() : controlIsOk(dependency)}));
		}

		for (let controlName in controlNameMap) {
			if (controlNameMap[controlName].control === control) return controlIsOk(controlName);
		}
	}

	_addControl = (control) => {
		if (this._controlIsAllowed(control)) this.map.addControl(control);
	}

	_initalizeMapControls = () => {
		const drawOptions = {
			position: "topright",
			draw: {
				marker: {
					icon: L.VectorMarkers.icon({
						prefix: "glyphicon",
						icon: "record",
						markerColor: INCOMPLETE_COLOR
					})
				}
			},
			edit: {
				featureGroup: this.drawLayerGroup,
				edit: false,
				remove: false
			}
		};

		const featureTypes = ["polyline", "polygon", "rectangle", "circle", "marker"];

		featureTypes.slice(0, -1).forEach(type => {
			drawOptions.draw[type] = {shapeOptions: this._getStyleForType(type, {color: INCOMPLETE_COLOR, fillColor: INCOMPLETE_COLOR, opacity: 0.8})};
		});

		drawOptions.draw.polygon.allowIntersection = false;

		featureTypes.forEach(type => {
			if (this.controlSettings.draw === false || this.controlSettings.draw[type] === false) drawOptions.draw[type] = false;
		});

		function createControlItem(that, container, glyphName, title, fn) {
			const elem = L.DomUtil.create("a", "", container);
			const glyph = L.DomUtil.create("span", "glyphicon glyphicon-" + glyphName, elem);
			elem.title = title;

			L.DomEvent.on(elem, "click", L.DomEvent.stopPropagation);
			L.DomEvent.on(elem, "mousedown", L.DomEvent.stopPropagation);
			L.DomEvent.on(elem, "click", L.DomEvent.preventDefault);
			L.DomEvent.on(elem, "click", that._refocusOnMap, that);
			L.DomEvent.on(elem, "click", fn);

			return elem;
		}

		const that = this;
		const LocationControl = L.Control.extend({
			options: {
				position: "topleft"
			},

			onAdd: function(map) {
				const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control laji-map-location-control");
				this._createSearch(container);
				this._createLocate(container);
				return container;
			},

			_createSearch: function(container) {
				return createControlItem(this, container, "search", that.translations.Search, () => this._onSearch(this));
			},

			_createLocate: function(container) {
				return createControlItem(this, container, "screenshot", that.translations.Geolocate, () => that._onLocate());
			},

			_onSearch: function() {
				console.log("search");
			}
		});

		const CoordinateInputControl = L.Control.extend({
			options: {
				position: "topright"
			},

			onAdd: function(map) {
				const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control laji-map-coordinate-input-control");
				createControlItem(this, container, "pencil",
					that.translations.AddFeatureByCoordinates, () => that.openCoordinatesDialog());
				return container;
			}
		});

		["layerControl", "drawControl", "zoomControl",
		 "coordinateInputControl", "locationControl"].forEach(control => {
			if (this[control]) this.map.removeControl(this[control]);
		});

		this._addControl(this._getLayerControl());

		this.locationControl = new LocationControl();
		this._addControl(this.locationControl);

		this.drawControl = new L.Control.Draw(drawOptions);
		this._addControl(this.drawControl);

		this._addControl(this._getZoomControl());

		this.coordinateInputControl = new CoordinateInputControl();
		this._addControl(this.coordinateInputControl);

		// hrefs cause map to scroll to top when a control is clicked. This is fixed below.

		function removeHref(className) {
			const elems = document.getElementsByClassName(className);
			for (let i = 0; i < elems.length; i++) {
				const elem = elems[i];
				elem.removeAttribute("href");
			}
		}

		["in", "out"].forEach(zoomType => {
			removeHref(`leaflet-control-zoom-${zoomType}`);
		});

		featureTypes.forEach(featureType => {
			removeHref(`leaflet-draw-draw-${featureType}`);
		});

		removeHref("leaflet-control-layers-toggle");

		removeHref("leaflet-contextmenu-item");
	}

	_getZoomControl = () => {
		this.zoomControl = L.control.zoom({
			zoomInTitle: this.translations.ZoomIn,
			zoomOutTitle: this.translations.ZoomOut
		});
		return this.zoomControl;
	}

	_getLayerControl = () => {
		const baseMaps = {}, overlays = {};
		const { translations } = this;
		[TAUSTAKARTTA, MAASTOKARTTA, GOOGLE_SATELLITE, OPEN_STREET].forEach(tileLayerName => {
			baseMaps[translations[tileLayerName[0].toUpperCase() + tileLayerName.slice(1)]] = this[tileLayerName];
		});
		Object.keys(this.overlays).forEach(overlayName => {
			overlays[translations[overlayName[0].toUpperCase() + overlayName.slice(1)]] = this.overlays[overlayName];
		})

		this.layerControl = L.control.layers(baseMaps, overlays, {position: "topleft"});
		return this.layerControl;
	}

	destroy = () => {
		this.map.off();
		this.map = null;
	}

	_constructDictionary = () => {
		function capitalizeFirstLetter(string) {
			return string.charAt(0).toUpperCase() + string.slice(1);
		}
		let dictionaries = {};
		for (let word in translations) {
			for (let lang in translations[word]) {
				const translation = translations[word][lang];
				if (!dictionaries.hasOwnProperty(lang)) dictionaries[lang] = {};
				dictionaries[lang][word] = translation;
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

	setLang = (lang) => {
		if (!this.translations || this.lang !== lang) {
			this.lang = lang;
			this.translations = this.dictionary[this.lang];

			const { translations } = this;
			function join(...words) {
				return words.map(word => translations[word]).join(" ");
			}

			const drawLocalizations = L.drawLocal.draw;

			this.map.contextmenu.removeAllItems();

			// original strings are here: https://github.com/Leaflet/Leaflet.draw/blob/master/src/Leaflet.draw.js
			["polyline", "polygon", "rectangle", "circle"].forEach(featureType => {
				const text = join("Draw", featureType);

				drawLocalizations.toolbar.buttons[featureType] = text;

				if (this._controlIsAllowed(this.drawControl) &&
				   (this.controlSettings.draw === true || this.controlSettings.draw[featureType] !== false)) {
					this.map.contextmenu.addItem({
						text: text,
						iconCls: "context-menu-draw context-menu-draw-" + featureType,
						callback: () => this.triggerDrawing(featureType)
					});
				}
			});

			if (this._controlIsAllowed(this.coordinateInputControl)) {
				this.map.contextmenu.addItem("-");
				this.map.contextmenu.addItem({
					text: this.translations.AddFeatureByCoordinates,
					iconCls: "glyphicon glyphicon-pencil",
					callback: this.openCoordinatesDialog
				})
			}

			drawLocalizations.toolbar.buttons.marker = join("Add", "marker");

			drawLocalizations.toolbar.actions.title = join("Cancel", "drawPassiveVerb");
			drawLocalizations.toolbar.actions.text = join("Cancel");
			drawLocalizations.toolbar.finish.title = join("Finish", "drawPassiveVerb");
			drawLocalizations.toolbar.finish.text = join("Finish");
			drawLocalizations.toolbar.undo.title = join("Delete", "lastPointDrawn");
			drawLocalizations.toolbar.undo.text = join("Delete", "last", "point");

			drawLocalizations.handlers.circle.tooltip.start = join("Click", "and", "drag", "toDrawCircle");
			drawLocalizations.handlers.marker.tooltip.start = join("ClickMapToPlaceMarker");

			drawLocalizations.handlers.polygon.tooltip.start = join("ClickToStartDrawingShape");
			drawLocalizations.handlers.polygon.tooltip.cont = join("ClickToContinueDrawingShape");
			drawLocalizations.handlers.polygon.tooltip.end = join("ClickToEndDrawingShape");

			drawLocalizations.handlers.polyline.tooltip.start = join("ClickToStartDrawingPolyline");
			drawLocalizations.handlers.polyline.tooltip.cont = join("ClickToContinueDrawingPolyline");
			drawLocalizations.handlers.polyline.tooltip.end = join("ClickToEndDrawingPolyline");
			drawLocalizations.handlers.polyline.error = join("shapeEdgesCannotCross") + "!";

			drawLocalizations.handlers.rectangle.tooltip.start = join("Click", "and", "drag", "toDrawRectangle");

			drawLocalizations.handlers.simpleshape.tooltip.end = join("simpleShapeEnd");

			[this.drawControl, this.locationControl].forEach(control => {
				if (!control) return;
				this.map.removeControl(control);
				this._addControl(control);
			});

			if (this.zoomControl) {
				this.map.removeControl(this.zoomControl);
				this._addControl(this._getZoomControl());
			}

			if (this.layerControl) {
				this.map.removeControl(this.layerControl);
				this._addControl(this._getLayerControl());
			}

			if (this.idsToIdxs) for (let id in this.idsToIdxs) {
				this._updateContextMenuForDrawItem(id);
			}
		}
	}

	cloneDataItem = (dataItem) => {
		let featureCollection = {type: "featureCollection"};
		featureCollection.features = dataItem.featureCollection.features.slice(0);
		return {getFeatureStyle: this._getDefaultDataStyle, getClusterStyle: this._getDefaultDataClusterStyle, ...dataItem, featureCollection};
	}

	initializeDataItem = (idx) => {
		const item = this.data[idx];
		const layer = L.geoJson(this.data[idx].featureCollection, this.geoJsonLayerOptions);
		this.dataLayerGroups.push(layer);
		let container = this.map;
		if (item.cluster) {
			item.clusterLayer = L.markerClusterGroup({iconCreateFunction: this._getClusterIcon(item), ...item.cluster}).addTo(this.map);
			container = item.clusterLayer;
		}
		layer.addTo(container);
		this.redrawDataItem(idx)
	}

	setData = (data) => {
		if (this.dataLayerGroups) {
			this.data.forEach((item ,i) => {
				if (item.clusterLayer) {
					this.map.removeLayer(item.clusterLayer);
				} else if (this.dataLayerGroups[i]) {
					this.map.removeLayer(this.dataLayerGroups[i]);
				}
			});
		}
		this.data = (data ? (Array.isArray(data) ? data : [data]) : []).map(this.cloneDataItem);
		this.dataLayerGroups = [];
		this.data.forEach((item, idx) => this.initializeDataItem(idx));
		this.redrawData();
	}

	addData = (data) => {
		if (!data) return;
		if (!Array.isArray(data)) data = [data];
		const newData = data.map(this.cloneDataItem);
		this.data = this.data.concat(newData);
		for (let idx = this.data.length - newData.length; idx < this.data.length; idx++) {
			this.initializeDataItem(idx);
		}
	}

	setDrawData = (data) => {
		if (!data) data = {
			featureCollection: {features: []}
		};

		const featureCollection = {type: "featureCollection"};
		featureCollection.features = data.featureCollection.features.slice(0);
		this.drawData = (data) ? {
			getFeatureStyle: this._getDefaultDrawStyle,
			getClusterStyle: this._getDefaultDrawClusterStyle,
			...data,
			featureCollection} : [];

		if (this.drawLayerGroup) this.drawLayerGroup.clearLayers();
		if (this.clusterDrawLayer) this.clusterDrawLayer.clearLayers();

		this.drawLayerGroup = L.geoJson(this.drawData.featureCollection, this.geoJsonLayerOptions);
		let drawLayerForMap = this.drawLayerGroup;
		if (data.cluster) {
			this.clusterDrawLayer = L.markerClusterGroup(
				{iconCreateFunction: this._getClusterIcon(this.drawData, !!"isDrawData"),
					...data.cluster})
				.addLayer(this.drawLayerGroup);
			drawLayerForMap = this.clusterDrawLayer;
		}
		drawLayerForMap.addTo(this.map);
		this._resetIds();
		this.redrawDrawData();
	}

 	_createIcon = () => {
		return L.VectorMarkers.icon({
			prefix: "glyphicon",
			icon: "record",
			markerColor: NORMAL_COLOR
		});
	}

	_getClusterIcon = (data, isDrawData) => (cluster) => {
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

	setActive = (id) => {
		const prevActiveId = this.activeId;
		this.activeId = id;
		this._updateDrawLayerStyle(prevActiveId);
		this._updateDrawLayerStyle(id);
	}

	_resetIds = () => {
		// Maps item indices to internal ids and the other way around.
		// We use leaflet ids as internal ids.
		this.idxsToIds = {};
		this.idsToIdxs = {};

		let counter = 0;
		this.drawLayerGroup.eachLayer(layer => {
			const id = layer._leaflet_id;
			this.idxsToIds[counter] = id;
			this.idsToIdxs[id] = counter;
			counter++;
		});
	}

	recluster = () => {
		this._reclusterData();
		this._reclusterDrawData();
	}

	_reclusterDrawData = () => {
		if (this.clusterDrawLayer) {
			this.clusterDrawLayer.clearLayers();
			this.clusterDrawLayer.addLayer(this.drawLayerGroup);
		}
	}

	_reclusterData = () => {
		if (this.data) this.data.forEach((dataItem, idx) => {
			if (dataItem.clusterLayer) {
				this.map.removeLayer(dataItem.clusterLayer);
				dataItem.clusterLayer = L.markerClusterGroup({iconCreateFunction: this._getClusterIcon(dataItem), ...dataItem.cluster}).addTo(this.map);
				dataItem.clusterLayer.addLayer(this.dataLayerGroups[idx]);
			}
		});
	}

	redrawDrawData = () => {
		for (let id in this.idsToIdxs) {
			this._initializeDrawLayer(this._getDrawLayerById(id), this.idsToIdxs[id]);
		}
		this._reclusterDrawData();
	}

	redrawDataItem = (idx) => {
		const dataItem = this.data[idx];

		this._updateDataLayerGroupStyle(idx);

		let _idx = 0;
		this.dataLayerGroups[idx].eachLayer(layer => {
			this._initializePopups(dataItem, layer, _idx);
			_idx++;
		});
	}

	redrawData = () => {
		this.data.forEach((dataItem, idx) => {
			this.redrawDataItem(idx);
		})
	}

	redraw = () => {
		this.redrawDrawData();
		this.redrawData();
	}

	_initializePopups = (data, layer, idx) => {
		const that = this;

		let latlng = undefined;

		function openPopup(content) {
			if (!latlng) return;
			if (data === that.drawData && that.editId === layer._leaflet_id) return;

			const offset = (layer instanceof L.Marker) ? (-that.markerPopupOffset  || 0) : (-that.featurePopupOffset || 0);

			that.popup = new L.Rrose({ offset: new L.Point(0, offset), closeButton: !that.popupOnHover, autoPan: false })
				.setContent(content)
				.setLatLng(latlng)
				.openOn(that.map);
		}
		function closePopup() {
			if (latlng) that.map.closePopup();
			latlng = undefined;
		}

		function getContentAndOpenPopup(_latlng) {
			if (!that.popupCounter) that.popupCounter = 0;
			that.popupCounter++;

			latlng = _latlng;

			let {popupCounter} = that;

			//// Allow either returning content or firing a callback with content.
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

	_initializeDrawLayer = (layer, idx) => {
		this.drawLayerGroup.addLayer(layer);

		const id = layer._leaflet_id;
		this.idxsToIds[idx] = id;
		this.idsToIdxs[id] = idx;

		this._updateDrawLayerStyle(id);

		this._updateContextMenuForDrawItem(id);

		layer.on("click", (e) => {
			this.layerClicked = true;
			if (!this._interceptClick()) this._onActiveChange(id);
		});
		layer.on("dblclick", () => this._setEditable(id));

		this._initializePopups(this.drawData, layer, idx);

		if (this.onInitializeDrawLayer) this.onInitializeDrawLayer(idx, layer);

		return layer.toGeoJSON();
	}

	_updateContextMenuForDrawItem(id) {
		const layer = this._getDrawLayerById(id);
		const { translations } = this;
		layer.unbindContextMenu();
		layer.bindContextMenu({
			contextmenuInheritItems: false,
			contextmenuItems: [{
				text: translations ? translations.EditFeature : "",
				callback: () => this._setEditable(id)
			}, {
				text: translations ? translations.DeleteFeature : "",
				callback: () => this._onDelete(id)
			}]
		});
	}

	_onLocate = () => {
		this.map.locate();
	}

	_onLocationFound = ({latlng, accuracy, bounds}) => {
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

	_onLocationNotFound = () => {
		alert(this.translations.geolocationFailed);
		if (this.initializeViewAfterLocateFail) this._initializeView();
	}

	_getDrawLayerById = (id) => {
		return this.drawLayerGroup._layers ? this.drawLayerGroup._layers[id] : undefined;
	}

	_triggerEvent = (e) => {
		if (!Array.isArray(e)) e = [e];
		if (this.onChange) this.onChange(e);
	}

	_enchanceGeoJSON = (geoJSON, layer) => {
		// GeoJSON circles doesn't have radius, so we extend GeoJSON.
		if (layer instanceof L.Circle) {
			geoJSON.geometry.radius = layer.getRadius();
		}
		return geoJSON;
	}

	_onAdd = (layer) => {
		if (layer instanceof L.Marker) layer.setIcon(this._createIcon());

		const {featureCollection: {features}} = this.drawData;

		const newFeature = this._enchanceGeoJSON(this._initializeDrawLayer(layer, features.length), layer);
		if (this.drawData.cluster) {
			this.clusterDrawLayer.clearLayers();
			this.clusterDrawLayer.addLayer(this.drawLayerGroup);
		}
		features.push(newFeature);

		const event = [
			{
				type: "create",
				feature: newFeature
			},
			this._getOnActiveChangeEvent(this.idxsToIds[features.length - 1])
		];

		this._triggerEvent(event);
	};

	_onEdit = (data) => {
		const eventData = {};
		for (let id in data) {
			const geoJson = this._enchanceGeoJSON(data[id].toGeoJSON(), data[id]);
			eventData[this.idsToIdxs[id]] = geoJson;
			this.drawData.featureCollection.features[this.idsToIdxs[id]] = geoJson;
		}

		this._triggerEvent({
			type: "edit",
			features: eventData
		});
	}

	_onDelete = (deleteIds) => {
		this._clearEditable();

		if (!Array.isArray(deleteIds)) deleteIds = [deleteIds];

		const deleteIdxs = deleteIds.map(id => this.idsToIdxs[id]);

		const activeIdx = this.idsToIdxs[this.activeId];

		const {featureCollection: {features}} = this.drawData;

		const survivingIds = Object.keys(this.idsToIdxs).map(id => parseInt(id)).filter(id => !deleteIds.includes(id));

		let changeActive = false;
		let newActiveId = undefined;
		if (features && survivingIds.length === 0) {
			changeActive = true;
		} else if (this.activeId !== undefined && deleteIds.includes(this.activeId)) {
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
			newActiveId = this.activeId;
			changeActive = true;
		}

		this.drawData.featureCollection.features = features.filter((item, i) => !deleteIdxs.includes(i));

		deleteIds.forEach(id => {
			this.drawLayerGroup.removeLayer(id);
		});
		this._resetIds();

		this._reclusterDrawData();

		const event = [{
			type: "delete",
			idxs: deleteIdxs
		}];

		if (changeActive) event.push(this._getOnActiveChangeEvent(newActiveId));

		this._triggerEvent(event);
	}

	_getOnActiveChangeEvent = (id) => {
		this.setActive(id);
		return {
			type: "active",
			idx: this.idsToIdxs[id]
		}
	}

	_onActiveChange = (id) => {
		this._triggerEvent(this._getOnActiveChangeEvent(id));
	}

	focusToLayer = (idx) => {
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

		this._onActiveChange(id);
	}

	_setEditable = (id) => {
		this._clearEditable();
		this.editId = id;
		const editLayer = this._getDrawLayerById(this.editId);
		if (this.drawData.cluster) {
			this.clusterDrawLayer.removeLayer(editLayer);
			this.map.addLayer(editLayer);
		}
		editLayer.editing.enable();
		editLayer.closePopup();
	}

	_clearEditable = () => {
		if (this.editId === undefined) return;
		const editLayer = this._getDrawLayerById(this.editId);
		editLayer.editing.disable();
		if (this.drawData.cluster) {
			this.map.removeLayer(editLayer);
			this.clusterDrawLayer.addLayer(editLayer);
		}
		this._reclusterDrawData();
		this.editId = undefined;
	}

	_commitEdit = () => {
		this._onEdit({[this.editId]: this._getDrawLayerById(this.editId)});
		this._clearEditable();
	}

	_interceptClick = () => {
		if (this.contextMenuHideTimestamp !== undefined) {
			const timestamp = this.contextMenuHideTimestamp;
			this.contextMenuHideTimestamp = undefined;
			if (Date.now() - timestamp < 200) return true;
		}

		if (this.drawing) return true;
		if (this.editId !== undefined) {
			this._commitEdit();
			return true;
		}
	}

	updateLayerStyle = (layer, style) => {
		if (!layer) return;

		if (layer instanceof L.Marker) {
			if (style.opacity !== undefined) layer.options.opacity = style.opacity;

			layer.options.icon.options.markerColor = style.color;
			if (layer._icon) {
				// Color must also be changed directly through DOM manipulation.
				layer._icon.firstChild.firstChild.style.fill = style.color;
			}
		} else {
			layer.setStyle(style);
		}
	}

  _featureToLayer = (feature, latlng) => {
			let layer;
			if (feature.geometry.type === "Point") {
				layer = (feature.geometry.radius) ?
					new L.circle(latlng, feature.geometry.radius) :
					new L.marker(latlng, {icon: this._createIcon()});
			} else {
				layer = L.GeoJSON.geometryToLayer(feature);
			}
			return layer;
		}

	_getStyleForType = (type, overrideStyles, id) => {
		const idx = this.idsToIdxs[id];

		const styles = {
			weight: type.toLowerCase().includes("line") ? 8 : 14,
			opacity: 1,
			fillOpacity: 0.4,
			color: NORMAL_COLOR
		};

		const dataStyles = this.drawData.getFeatureStyle({
			featureIdx: idx,
			feature: this.drawData.featureCollection.features[idx]
		});

		[dataStyles, overrideStyles].forEach(_styles => {
			if (_styles) for (let style in _styles) {
				styles[style] = _styles[style];
			}
		})

		return styles;
	}

	_getStyleForLayer = (layer, overrideStyles, id) => {
		return this._getStyleForType(layer.toGeoJSON().geometry.type, overrideStyles, id);
	}

	_updateDrawLayerStyle = (id) => {
		if (id === undefined) return;
		const layer = this._getDrawLayerById(id);

		if (!layer) return;

		let style = {};
		if (layer instanceof L.Marker) {
			const idx = this.idsToIdxs[id];
			style = this.drawData.getFeatureStyle({
				featureIdx: idx,
				feature: this.drawData.featureCollection.features[idx]});
		} else {
			const style =  {};
			layer.setStyle(this._getStyleForLayer(layer, style, id));
		}

		this.updateLayerStyle(layer, style);
	}

	_getDefaultDrawStyle = (options) => {
		const featureIdx = options ? options.featureIdx : undefined;
		const color = (featureIdx !== undefined && this.idxsToIds[featureIdx] === this.activeId) ? ACTIVE_COLOR : NORMAL_COLOR;
		return {color: color, fillColor: color, opacity: 1, fillOpacity: 0.7};
	}

	_getDefaultDrawClusterStyle = () => {
		return {color: NORMAL_COLOR, opacity: 1};
	}

	_getDefaultDataStyle = () => {
		return {color: DATA_LAYER_COLOR, fillColor: DATA_LAYER_COLOR, opacity: 1, fillOpacity: 0.7};
	}
	_getDefaultDataClusterStyle = () => {
		return {color: DATA_LAYER_COLOR, opacity: 1};
	}

	_updateDataLayerGroupStyle = (idx) => {
		const dataItem = this.data[idx];
		if (!dataItem) return;

		let i = 0;
		this.dataLayerGroups[idx].eachLayer(layer => {
			this.updateLayerStyle(layer, dataItem.getFeatureStyle({dataIdx: idx, featureIdx: i}));
			i++;
		});
	}

	openCoordinatesDialog = () => {
		const that = this;
		function close(e) {
			e.preventDefault();
			that.blockerElem.style.display = "";
			that.blockerElem.removeEventListener("click", close);
			document.removeEventListener("keydown", onEscListener);
			that.container.removeChild(container);
		}

		function createTextInput(labelTxt) {
			const input = document.createElement("input");
			input.setAttribute("type", "text");
			input.id = `laji-map-${labelTxt}`;
			input.className = "form-control";

			const label = document.createElement("label");
			label.setAttribute("for", input.id);
			label.innerHTML = labelTxt;

			const container = document.createElement("div");
			container.className = "form-group";

			[label, input].forEach(elem => {container.appendChild(elem)});

			return container;
		}

		function formatter(input) { return e => {
			let charCode = (typeof e.which === "undefined") ? e.keyCode : e.which;

			if (charCode >= 48 && charCode <= 57) { // is a number
				// The input cursor isn't necessary at the tail, but this validation works regardless.
				inputValidate(e, input.value + String.fromCharCode(charCode));
			}
		}}

		const wgs84Check = {
			regexp: /^-?([0-9]{1,3}|[0-9]{1,3}\.[0-9]*)$/,
			range: [-180, 180]
		};
		const wgs84Validator = [wgs84Check, wgs84Check];

		const ykjRegexp = /^[0-9]{3,7}$/;
		const ykjFormatter = value => (value.length < 7 ? value + "0".repeat(7 - value.length) : value);
		const ykjValidator = [
			{regexp: ykjRegexp, range: [6600000, 7800000], formatter: ykjFormatter},
			{regexp: ykjRegexp, range: [3000000, 3800000], formatter: ykjFormatter}
		];

		const inputRegexp = /^(-?[0-9]+(\.|,)?[0-9]*|-?)$/;

		function inputValidate(e, value) {
			if (!value.match(inputRegexp)) {
				if (e) e.preventDefault();
				return false;
			}
			return true;
		}

		function validateLatLng(latlng, latLngValidator) {
			return latlng.every((value, i) => {
				const validator = latLngValidator[i];
				const formatted = validator.formatter ? validator.formatter(value) : value;
				return (
					value !== "" && value.match(validator.regexp) &&
					formatted >= validator.range[0] && formatted <= validator.range[1]
				);
			});
		}

		function submitValidate(inputValues) {
			const validators = [];
			if (that.controlSettings.draw.marker) validators.push(wgs84Validator);
			if (that.controlSettings.draw.rectangle) validators.push(ykjValidator);
			return validators.some(validator => validateLatLng(inputValues, validator));
		}

		const {translations} = this;
		const container = document.createElement("form");
		container.className = "laji-map-coordinates well";

		const latLabelInput = createTextInput(translations.Latitude);
		const lngLabelInput = createTextInput(translations.Longitude);
		const latInput = latLabelInput.getElementsByTagName("input")[0];
		const lngInput = lngLabelInput.getElementsByTagName("input")[0];

		const closeButton = document.createElement("button");
		closeButton.setAttribute("type", "button");
		closeButton.className = "close";
		closeButton.innerHTML = "✖";
		closeButton.addEventListener("click", close);

		const submitButton = document.createElement("button");
		submitButton.setAttribute("type", "submit");
		submitButton.className = "btn btn-block btn-info";
		submitButton.innerHTML = `${translations.Add}`;
		submitButton.setAttribute("disabled", "disabled");

		let errorDiv = undefined;

		const inputValues = ["", ""];
		[latInput, lngInput].forEach((input, i) => {
			let prevVal = "";
			input.addEventListener("keypress", formatter(input));
			input.oninput = (e) => {
				if (!inputValidate(e, e.target.value)) {
					e.target.value = prevVal;
				}
				e.target.value = e.target.value.replace(",", ".");
				prevVal = e.target.value;

				inputValues[i] = e.target.value;
				if (submitValidate(inputValues)) {
					submitButton.removeAttribute("disabled");
				} else {
					submitButton.setAttribute("disabled", "disabled");
				}
			}
		});

		container.addEventListener("submit", e => {
			e.preventDefault();

			const latlng = [latInput.value, lngInput.value];
			const system = validateLatLng(latlng, wgs84Validator) ? "WGS84" : "YKJ";
			const coordinates = `${latlng[0]}:${latlng[1]}:${system}`;
			const query = {...this.baseQuery, coordinates};

			fetch(`${this.baseUri}/coordinates/toGeoJson?${queryString.stringify(query)}`).then(response => {
				return response.json();
			}).then(feature => {
				const {geometry} = feature;

				const layer = this._featureToLayer(feature, geometry.coordinates);

				this._onAdd(layer);
				const center = (geometry.type === "Point") ? geometry.coordinates : layer.getBounds().getCenter();
				this.map.setView(center);
				if (geometry.type === "Point") {
					console.log(this.map);
					if (this.clusterDrawLayer) this.clusterDrawLayer.zoomToShowLayer(layer);
					else this.setNormalizedZoom(9);
				} else {
					this.map.fitBounds(layer.getBounds());
				}
				close(e);
			}).catch(response => {
				if (errorDiv) container.removeChild(errorDiv);
				errorDiv = document.createElement("div");
				errorDiv.className = "alert alert-danger";
				errorDiv.innerHTML = this.translations.errorMsg;
				container.insertBefore(errorDiv, latLabelInput);
			});
		});

		this.blockerElem.addEventListener("click", close);

		function onEscListener(e) {
			e = e || window.event;
			var isEscape = false;
			if ("key" in e) {
				isEscape = (e.key == "Escape" || e.key == "Esc");
			} else {
				isEscape = (e.keyCode == 27);
			}
			if (isEscape) {
				if ([latInput, lngInput].every(input => {return document.activeElement !== input})) close(e);
			}
		}

		document.addEventListener("keydown", onEscListener);

		container.appendChild(closeButton);
		container.appendChild(latLabelInput);
		container.appendChild(lngLabelInput);
		container.appendChild(submitButton);

		this.blockerElem.style.display = "block";
		this.container.appendChild(container);

		latInput.focus();
	}

	triggerDrawing = (featureType) => this.drawControl._toolbars.draw._modes[featureType].handler.enable()
}
