import "leaflet";
import "leaflet-draw";
import "proj4leaflet";
import "leaflet-contextmenu";
import "Leaflet.vector-markers";
import "leaflet.markercluster";
import "leaflet-mml-layers";
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

const options = ["rootElem", "locate", "center", "zoom", "lang", "onChange", "onPopupClose", "getDrawingDraftStyle",
	"tileLayerName", "drawData", "data", "activeIdx", "markerPopupOffset", "featurePopupOffset",
	"onInitializeDrawLayer", "enableDrawEditing", "popupOnHover", "baseUri",  "baseQuery"];

const optionKeys = options.reduce((o, i) => {o[i] = true; return o;}, {});

export default class LajiMap {
	constructor(props) {
		this._constructDictionary();

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
		this.enableDrawEditing = true;

		Object.keys(props).forEach(prop => {
			if (optionKeys[prop]) this[prop] =props[prop];
		});

		this._initControlSettings(props.controlSettings);

		const {tileLayerName} = props;
		if ([GOOGLE_SATELLITE, OPEN_STREET].includes(tileLayerName) && !props.hasOwnProperty("zoom")) {
			this.zoom += 3;
		}

		this._initializeMap();
		this.setLang(this.lang);
		this.setData(this.data);
		this.setDrawData(this.drawData);
		this._initializeMapEvents();
		this._initializeMapControls();
	}

	setOptions = (options) => {
		Object.keys(options || {}).forEach(option => {
			this.setOption(option, options[option]);
		});
	}

	setOption = (option, value) => {
		if (option === "lang") this.setLang(value);
		else if (option === "data") this.setData(value);
		else if (option === "drawData") this.setDrawData(value);
		else if (option === "activeIdx") this.setActive(value);
		else if (option === "controlSettings") this.setControlSettings(value);
		else if (option === "tileLayerName") this.setTileLayer(this[value]);
		else if (option === "center") this.map.setView(value, this.getNormalizedZoom(this.zoom));
		else if (option === "zoom") {
			this.zoom = value;
			this.setNormalizedZoom(this.zoom);
		}
		else if (optionKeys[option]) {
			this[option] = value;
		}
	}

	_initializeMap = () => {
		L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

		this.container = document.createElement("div");
		const {className} = this.container;
		this.container.className += ((className !== undefined && className !== null && className !== "") ? " " : "")
			+ "laji-map";
		this.rootElem.appendChild(this.container);

		this.finnishMapElem = document.createElement("div");
		this.foreignMapElem = document.createElement("div");
		this.blockerElem = document.createElement("div");
		this.blockerElem.className = "blocker";

		[this.finnishMapElem, this.foreignMapElem, this.blockerElem].forEach(elem => {this.container.appendChild(elem)});

		const mapOptions = {
			contextmenu: true,
			contextmenuItems: [],
			zoomControl: false,
			noWrap: true,
			continuousWorld: false,
		}

		const mmlProj = L.TileLayer.MML.get3067Proj();

		// Scale controller won't work without this hack.
		// Fixes also circle projection.
		mmlProj.distance =  L.CRS.Earth.distance;
		mmlProj.R = 6378137;

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
			}).setOpacity(0.5)
		};

		this.setTileLayer(this[this.tileLayerName]);

		this._initializeView();

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
		this.maps.forEach(map => {
			map.addEventListener({
				click: e => this._interceptClick(),
				dblclick: e => {
					if (this.editIdx !== undefined) return;
					if (this.controlSettings.draw === true ||
							(typeof this.controlSettings.draw === "object" && this.controlSettings.draw.marker !== false)
					) {
						this._onAdd(new L.marker(e.latlng));
					}
				},
				"draw:created": ({ layer }) => this._onAdd(layer),
				"draw:drawstart": () => { this.drawing = true },
				"draw:drawstop": () => { this.drawing = false },
				locationfound: this._onLocationFound,
				locationerror: this._onLocationNotFound,
				"contextmenu.hide": () => { this.contextMenuHideTimestamp = Date.now() },
			});
		});
	}

	_getDefaultCRSLayers = () => {
		return [this.openStreetMap, this.googleSatellite];
	}

	_getMMLCRSLayers = () => {
		return [this.maastokartta, this.taustakartta];
	}

	swapMap = () => {
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

		Object.keys(this.controls).forEach(controlName => {
			const control = this.controls[controlName];
			if  (control) {
				otherMap.removeControl(control);
				this.map.addControl(control);
			}
		});
		
		this.map.invalidateSize();
	}

	setTileLayer = (layer) => {
		const defaultCRSLayers = this._getDefaultCRSLayers();
		const mmlCRSLayers = this._getMMLCRSLayers();

		if (!this.tileLayer) {
			this.tileLayer = layer;
			this.map = mmlCRSLayers.includes(this.tileLayer) ? this.finnishMap : this.foreignMap;
			this.swapMap();
			this.map.addLayer(this.tileLayer);
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

	_initControlSettings = (controlSettings) => {
		this.controlSettings = {
			draw: {marker: true, circle: true, rectangle: true, polygon: true, polyline: true},
			layer: true,
			zoom: true,
			location: true,
			coordinateInput: true,
			scale: true
		};
		for (let setting in controlSettings) {
			const oldSetting = this.controlSettings[setting];
			const newSetting = controlSettings[setting];
			this.controlSettings[setting] = (typeof newSetting === "object") ?
			{...oldSetting, ...newSetting} :
				newSetting;
		}
	}

	setControlSettings = (controlSettings) => {
		this._initControlSettings(controlSettings);
		this._initializeMapControls();
	}

	_controlIsAllowed = (name) => {
		const dependencies = {
				coordinateInput: [
						"draw",
						() => (this.controlSettings.draw === true ||
						       (typeof this.controlSettings.draw === "object" &&
						        ["marker", "rectangle"].some(type => {return this.controlSettings.draw[type] !== false})))
				]
		}

		const {controlSettings} = this;

		function controlIsOk(controlName) {
			return (
				controlSettings &&
				controlSettings[controlName] &&
				(dependencies[controlName] || []).every(dependency => {
					return (typeof dependency === "function") ? dependency() : controlIsOk(dependency)})
			);
		}

		return controlIsOk(name);
	}

	_addControl = (name, control) => {
		if (this._controlIsAllowed(name)) {
			this.controls[name] = control;
			this.map.addControl(control);
		}
	}

	controls = {
		layer: undefined,
		location: undefined,
		zoom: undefined,
		draw: undefined,
		coordinateInput: undefined,
		scale: undefined
	}

	_initializeMapControls = () => {
		Object.keys(this.controls).forEach(controlName => {
			const control = this.controls[controlName];
			if (control) this.map.removeControl(control);
		});

		this._addControl("layer", this._getLayerControl());
		this._addControl("location", this._getLocationControl());
		this._addControl("draw", this._getDrawControl());
		this._addControl("coordinateInput", this._getCoordinateInputControl());
		this._addControl("zoom", this._getZoomControl());
		this._addControl("scale", L.control.scale({metric: true, imperial: false}));

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
		["polyline", "polygon", "rectangle", "circle", "marker"].forEach(featureType => {
			removeHref(`leaflet-draw-draw-${featureType}`);
		});
		removeHref("leaflet-control-layers-toggle");
		removeHref("leaflet-contextmenu-item");
	}

	_getDrawControl = () => {
		const customMarkerStyles = this.getDrawingDraftStyle ? this.getDrawingDraftStyle("marker") : {};
		const drawOptions = {
			position: "topright",
			draw: {
				marker: {
					icon: L.VectorMarkers.icon({
						prefix: "glyphicon",
						icon: "record",
						markerColor: customMarkerStyles.color ? customMarkerStyles.color : INCOMPLETE_COLOR,
						opacity: customMarkerStyles.opacity ? customMarkerStyles.opacity : 1,
					})
				},
				polygon: {
					allowIntersection: false
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
			drawOptions.draw[type] = {
				shapeOptions: this.getDrawingDraftStyle ?
					this.getDrawingDraftStyle(type) :
					this._getStyleForType(type, {color: INCOMPLETE_COLOR, fillColor: INCOMPLETE_COLOR, opacity: 0.8})
			};
		});

		featureTypes.forEach(type => {
			if (this.controlSettings.draw === false || this.controlSettings.draw[type] !== true) {
				drawOptions.draw[type] = false;
			}
		});

		return new L.Control.Draw(drawOptions);
	}

	_createControlItem = (that, container, glyphName, title, fn) => {
		const elem = L.DomUtil.create("a", "", container);
		const glyph = L.DomUtil.create("span", glyphName, elem);
		elem.title = title;

		L.DomEvent.on(elem, "click", L.DomEvent.stopPropagation);
		L.DomEvent.on(elem, "mousedown", L.DomEvent.stopPropagation);
		L.DomEvent.on(elem, "click", L.DomEvent.preventDefault);
		L.DomEvent.on(elem, "click", that._refocusOnMap, that);
		L.DomEvent.on(elem, "click", fn);

		return elem;
	}

	_getLocationControl = () => {
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
				return that._createControlItem(this, container, "glyphicon glyphicon-search", that.translations.Search, () => this._onSearch(this));
			},

			_createLocate: function(container) {
				return that._createControlItem(this, container, "glyphicon glyphicon-screenshot", that.translations.Geolocate, () => that._onLocate());
			},

			_onSearch: function() {
				console.log("search");
			}
		});

		return new LocationControl();
	}

	_getCoordinateInputControl = () => {
		const that = this;
		const CoordinateInputControl = L.Control.extend({
			options: {
				position: "topright"
			},

			onAdd: function(map) {
				const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control laji-map-coordinate-input-control");
				const rectangleAllowed = that.controlSettings.draw.rectangle === true;
				that._createControlItem(this, container, `laji-map-coordinate-input-${rectangleAllowed ? "ykj-" : ""}glyph`,
					that.translations.AddFeatureByCoordinates, () => that.openCoordinatesDialog());
				return container;
			}
		});

		return new CoordinateInputControl();
	}

	_getLayerControl = () => {
		const baseMaps = {}, overlays = {};
		const { translations } = this;

		const tileLayersNames = [TAUSTAKARTTA, MAASTOKARTTA, GOOGLE_SATELLITE, OPEN_STREET];

		tileLayersNames.forEach(tileLayerName => {
			baseMaps[translations[tileLayerName[0].toUpperCase() + tileLayerName.slice(1)]] = this[tileLayerName];
		});
		Object.keys(this.overlays).forEach(overlayName => {
			overlays[translations[overlayName[0].toUpperCase() + overlayName.slice(1)]] = this.overlays[overlayName];
		})

		const LayerControl = L.Control.Layers.include({
			_onInputClick: () => {
				const inputs = document.querySelectorAll(".laji-map .leaflet-control-layers-list input");

				const overlayIdsToAdd = {};
				for (let i = 0; i < inputs.length; i++) {
					const input = inputs[i];
					if (input.checked) {
						for (let tileLayerName of tileLayersNames) {
							if (this[tileLayerName]._leaflet_id === input.layerId) {
								this.setTileLayer(this[tileLayerName]);
								break;
							}
						}
						for (let overlayName of Object.keys(this.overlays)) {
							const overlay = this.overlays[overlayName];
							if (overlay._leaflet_id === input.layerId) {
								overlayIdsToAdd[input.layerId] = true;
							}
						}
					}
				}
				for (let overlayName of Object.keys(this.overlays)) {
					const overlay = this.overlays[overlayName];
					if (overlayIdsToAdd[overlay._leaflet_id] && !this.map.hasLayer(overlay)) {
						this.map.addLayer(overlay);
					} else if (!overlayIdsToAdd[overlay._leaflet_id] && this.map.hasLayer(overlay)) {
						this.map.removeLayer(overlay);
					}
				}
				this.controls.layer.expand();
			}
		});

		return new LayerControl(baseMaps, overlays, {position: "topleft"});
	}

	_getZoomControl = () => {
		return L.control.zoom({
			zoomInTitle: this.translations.ZoomIn,
			zoomOutTitle: this.translations.ZoomOut
		});
	}

	destroy = () => {
		this.maps.forEach(map => {
			map.off();
			map = null;
		})
	}

	_constructDictionary = () => {
		function capitalizeFirstLetter(string) {
			return string.charAt(0).toUpperCase() + string.slice(1);
		}
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

	setLang = (lang) => {
		if (!this.translations || this.lang !== lang) {
			this.lang = lang;
			this.translations = this.dictionary[this.lang];

			const { translations } = this;
			function join(...words) {
				return words.map(word => translations[word]).join(" ");
			}

			const drawLocalizations = L.drawLocal.draw;

			this.maps.forEach(map => {
				map.contextmenu.removeAllItems();

				// original strings are here: https://github.com/Leaflet/Leaflet.draw/blob/master/src/Leaflet.draw.js
				["polyline", "polygon", "rectangle", "circle"].forEach(featureType => {
					const text = join("Draw", featureType);

					drawLocalizations.toolbar.buttons[featureType] = text;

					if (this._controlIsAllowed("draw") &&
						(this.controlSettings.draw === true || this.controlSettings.draw[featureType] !== false)) {
						map.contextmenu.addItem({
							text: text,
							iconCls: "context-menu-draw context-menu-draw-" + featureType,
							callback: () => this.triggerDrawing(featureType)
						});
					}
				});

				if (this._controlIsAllowed("coordinateInput")) {
					map.contextmenu.addItem("-");
					map.contextmenu.addItem({
						text: this.translations.AddFeatureByCoordinates,
						iconCls: "laji-map-coordinate-input-glyph",
						callback: this.openCoordinatesDialog
					})
				}
			});

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

			if (this.idsToIdxs) for (let id in this.idsToIdxs) {
				this._updateContextMenuForLayer(this._getDrawLayerById(id), this.idsToIdxs[id]);
			}
		}
	}

	formatFeatureOut = (feature) => {
		const {lajiMapIdx, ...properties} = feature.properties;
		return {...feature, properties};
	}

	formatFeatureIn = (feature, idx) => {
		return {...feature, properties: {...feature.properties, lajiMapIdx: idx}};
	}

	cloneFeatures = (features) => {
		const featuresClone = [];
		for (let i = 0; i < features.length; i++) {
			const feature = features[i];
			featuresClone[i] = this.formatFeatureIn(feature, i);
		}
		return featuresClone;
	}

	cloneDataItem = (dataItem) => {
		let featureCollection = {type: "featureCollection"};
		featureCollection.features = this.cloneFeatures(dataItem.featureCollection.features);
		return {getFeatureStyle: this._getDefaultDataStyle, getClusterStyle: this._getDefaultDataClusterStyle, ...dataItem, featureCollection};
	}

	initializeDataItem = (idx) => {
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

	setData = (data) => {
		if (this.dataLayerGroups) {
			this.data.forEach((item ,i) => {
				if (item.clusterLayer) {
					item.clusterLayer.clearLayers();
				} else if (this.dataLayerGroups[i]) {
					this.dataLayerGroups[i].clearLayers();
				}
			});
		}
		this.data = (data ? (Array.isArray(data) ? data : [data]) : []).map(this.cloneDataItem);
		this.dataLayerGroups = [];
		this.data.forEach((item, idx) => this.initializeDataItem(idx));
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
		featureCollection.features = this.cloneFeatures(data.featureCollection.features);
		this.drawData = (data) ? {
			getFeatureStyle: this._getDefaultDrawStyle,
			getClusterStyle: this._getDefaultDrawClusterStyle,
			...data,
			featureCollection} : [];

		if (this.drawLayerGroup) this.drawLayerGroup.clearLayers();
		if (this.clusterDrawLayer) this.clusterDrawLayer.clearLayers();

		this.drawLayerGroup = L.geoJson(
			this.drawData.featureCollection,
			{
				pointToLayer: this._featureToLayer(this.drawData.getFeatureStyle),
				style: feature => {
					return this.drawData.getFeatureStyle({featureIdx: feature.properties.lajiMapIdx, feature})
				},
				onEachFeature: (feature, layer) => {
					this._initializeDrawLayer(layer, feature.properties.lajiMapIdx);
				}
		});
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
		this.setActive(this.activeIdx);
	}

 	_createIcon = (options = {}) => {
		const markerColor = options.color || NORMAL_COLOR;
		const opacity = options.opacity || 1;
		return L.VectorMarkers.icon({
			prefix: "glyphicon",
			icon: "record",
			markerColor,
			opacity
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

	setActive = (idx) => {
		const id = this.idxsToIds[idx];
		const prevActiveIdx = this.activeIdx;
		this.activeIdx = idx;
		this._updateDrawLayerStyle(this.idxsToIds[prevActiveIdx]);
		this._updateDrawLayerStyle(id);
	}

	_resetIds = () => {
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
		this._resetIds();
		this._reclusterDrawData();
	}

	redrawDataItem = (idx) => {
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

	redrawData = () => {
		this.data.forEach((dataItem, idx) => {
			this.redrawDataItem(idx);
		})
	}

	redraw = () => {
		this.redrawDrawData();
		this.redrawData();
	}

	_initializePopup = (data, layer, idx) => {
		if (!data.getPopup) return;

		const that = this;

		let latlng = undefined;

		function openPopup(content) {
			if (!latlng) return;
			if (data === that.drawData && that.editIdx === idx) return;

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

	_initializeTooltip = (data, layer, idx) => {
		if (!data.getTooltip) return;

		function openTooltip(content) {
			layer.bindTooltip(content, data.tooltipOptions)
		}

		// Allow either returning content or firing a callback with content.
		const content = data.getTooltip(idx, callbackContent => openTooltip(callbackContent));
		if (content) openTooltip(content);
	}

	_initializeDrawLayer = (layer, idx) => {
		if (this.drawLayerGroup) this.drawLayerGroup.addLayer(layer);

		if (!this.idxsToIds) this.idxsToIds = {};
		if (!this.idsToIdxs) this.idsToIdxs = {};

		this._updateContextMenuForLayer(layer, idx);

		layer.on("click", (e) => {
			if (!this._interceptClick()) this._onActiveChange(this.idsToIdxs[layer._leaflet_id]);
		});
		layer.on("dblclick", () => this._setEditable(this.idsToIdxs[layer._leaflet_id]));

		this._initializePopup(this.drawData, layer, idx);
		this._initializeTooltip(this.drawData, layer, idx);

		if (this.onInitializeDrawLayer) this.onInitializeDrawLayer(idx, layer);

		return layer;
	}

	_updateContextMenuForLayer(layer, idx) {
		const { translations } = this;
		layer.unbindContextMenu();

		let contextmenuItems = [{
			text: translations ? translations.DeleteFeature : "",
			callback: () => this._onDelete(this.idxsToIds[idx]),
			iconCls: "glyphicon glyphicon-trash"
		}];

		if (this.enableDrawEditing) {
			contextmenuItems = [{
					text: translations ? translations.EditFeature : "",
					callback: () => this._setEditable(idx),
					iconCls: "glyphicon glyphicon-pencil"
				},
				...contextmenuItems
			]
		}

		layer.bindContextMenu({
			contextmenuInheritItems: false,
			contextmenuItems
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
		} else if  (layer instanceof L.Rectangle) {
			const coordinates = geoJSON.geometry.coordinates[0];
			//If the coordinates are ordered counterclockwise, reverse them.
			if (coordinates[0][0] < coordinates[1][0] || coordinates[0][1] < coordinates[1][1]) {
				coordinates.reverse();
			}
		}
		return geoJSON;
	}

	_onAdd = (layer) => {
		if (layer instanceof L.Marker) layer.setIcon(this._createIcon());

		const {featureCollection: {features}} = this.drawData;

		const idx = features.length;
		const newFeature = this._enchanceGeoJSON(this._initializeDrawLayer(layer, features.length).toGeoJSON(), layer);
		newFeature.properties.lajiMapIdx = idx;
		const id = layer._leaflet_id;
		this.idsToIdxs[id] = idx;
		this.idxsToIds[idx] = id;

		if (this.drawData.cluster) {
			this.clusterDrawLayer.clearLayers();
			this.clusterDrawLayer.addLayer(this.drawLayerGroup);
		}
		features.push(newFeature);

		const event = [
			{
				type: "create",
				feature: this.formatFeatureOut(newFeature)
			},
			this._getOnActiveChangeEvent(features.length - 1)
		];

		this._triggerEvent(event);
	};

	_onEdit = (data) => {
		const eventData = {};
		for (let id in data) {
			const geoJson = this._enchanceGeoJSON(data[id].toGeoJSON(), data[id]);
			const idx = this.idsToIdxs[id];
			eventData[idx] = this.formatFeatureOut(geoJson);
			this.drawData.featureCollection.features[idx] = this.formatFeatureIn(geoJson, idx);
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

		const activeIdx = this.activeIdx;

		const {featureCollection: {features}} = this.drawData;

		const survivingIds = Object.keys(this.idsToIdxs).map(id => parseInt(id)).filter(id => !deleteIds.includes(id));

		let changeActive = false;
		let newActiveId = undefined;
		const activeId = this.idxsToIds[this.activeIdx];
		if (features && survivingIds.length === 0) {
			changeActive = true;
		} else if (this.activeIdx !== undefined && deleteIds.includes(activeId)) {
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

		if (changeActive) event.push(this._getOnActiveChangeEvent(this.idsToIdxs[newActiveId]));

		this._triggerEvent(event);
	}

	_getOnActiveChangeEvent = (idx) => {
		this.setActive(idx);
		return {
			type: "active",
			idx
		}
	}

	_onActiveChange = (idx) => {
		this._triggerEvent(this._getOnActiveChangeEvent(idx));
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

		this._onActiveChange(idx);
	}

	_setEditable = (idx) => {
		if (!this.enableDrawEditing) return;
		this._clearEditable();
		this.editIdx = idx;
		const editLayer = this._getDrawLayerById(this.idxsToIds[this.editIdx]);
		if (this.drawData.cluster) {
			this.clusterDrawLayer.removeLayer(editLayer);
			this.map.addLayer(editLayer);
		}
		editLayer.editing.enable();
		editLayer.closePopup();
	}

	_clearEditable = () => {
		if (this.editIdx === undefined) return;
		const editLayer = this._getDrawLayerById(this.idxsToIds[this.editIdx]);
		editLayer.editing.disable();
		if (this.drawData.cluster) {
			this.map.removeLayer(editLayer);
			this.clusterDrawLayer.addLayer(editLayer);
		}
		this._reclusterDrawData();
		this.editIdx = undefined;
	}

	_commitEdit = () => {
		const {editIdx} = this;
		const editId = this.idxsToIds[editIdx];
		this._clearEditable();
		this._onEdit({[editId]: this._getDrawLayerById(editId)});
	}

	_interceptClick = () => {
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

	updateLayerStyle = (layer, style) => {
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

  _featureToLayer = (getFeatureStyle, dataIdx) => (feature, latlng) => {
		let layer;
		if (feature.geometry.type === "Point") {
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

	_getStyleForType = (type, overrideStyles, id) => {
		const idx = this.idsToIdxs[id];

		const styles = {
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
		const color = (this.idxsToIds && featureIdx !== undefined && featureIdx === this.activeIdx) ? ACTIVE_COLOR : NORMAL_COLOR;
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

		const ykjAllowed = that.controlSettings.draw.rectangle;
		const wgs84Allowed = that.controlSettings.draw.marker;

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

		const inputRegexp = wgs84Allowed ? /^(-?[0-9]+(\.|,)?[0-9]*|-?)$/ : /^[0-9]*$/;

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
			if (wgs84Allowed) validators.push(wgs84Validator);
			if (ykjAllowed) validators.push(ykjValidator);
			return validators.some(validator => validateLatLng(inputValues, validator));
		}

		const {translations} = this;
		const container = document.createElement("form");
		container.className = "laji-map-coordinates panel panel-default panel-body";

		const onlyYkjAllowed = ykjAllowed && !wgs84Allowed;

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
		submitButton.innerHTML = translations.Add;
		submitButton.setAttribute("disabled", "disabled");

		let helpSpan = document.createElement("span");
		helpSpan.className = "help-block";
		const markerAllowed = that.controlSettings.draw.marker;
		if (markerAllowed) helpSpan.innerHTML = that.translations.EnterWgs84Coordinates;
		if (that.controlSettings.draw.rectangle) {
			if (markerAllowed) helpSpan.innerHTML += ` ${that.translations.or} ${that.translations.enterYKJRectangle}`;
			else helpSpan.innerHTML = that.translations.EnterYKJRectangle;
		}
		helpSpan.innerHTML += ".";

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

				const layer = this._featureToLayer(this.drawData.getFeatureStyle)(feature, geometry.coordinates);

				this._onAdd(layer);
				const center = (geometry.type === "Point") ? geometry.coordinates : layer.getBounds().getCenter();
				this.map.setView(center);
				if (geometry.type === "Point") {
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
				container.insertBefore(errorDiv, lngLabelInput);
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
		container.appendChild(helpSpan);
		container.appendChild(lngLabelInput);
		container.appendChild(latLabelInput);
		container.appendChild(submitButton);

		this.blockerElem.style.display = "block";
		this.container.appendChild(container);

		lngInput.focus();
	}

	triggerDrawing = (featureType) => this.controls.draw._toolbars.draw._modes[featureType].handler.enable()
}
