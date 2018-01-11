import "leaflet";
import "leaflet-draw";
import "proj4leaflet";
import "Leaflet.vector-markers";
import "leaflet.markercluster";
import "leaflet-mml-layers";
import "./lib/Leaflet.rrose/leaflet.rrose-src.js";
import { convertAnyToWGS84GeoJSON, convert, detectCRS, detectFormat, stringifyLajiMapError, isPolyline, isObject, combineColors } from "./utils";
import HasControls from "./controls";
import HasLineTransect from "./line-transect";
import { depsProvided, dependsOn, provide, isProvided } from "./dependency-utils";
import {
	INCOMPLETE_COLOR,
	NORMAL_COLOR,
	DATA_LAYER_COLOR,
	EDITABLE_DATA_LAYER_COLOR,
	USER_LOCATION_COLOR,
	MAASTOKARTTA,
	TAUSTAKARTTA,
	ESC,
	ONLY_MML_OVERLAY_NAMES
} from "./globals";

import translations from "./translations.js";

function capitalizeFirstLetter(string) {
	return string.charAt(0).toUpperCase() + string.slice(1);
}

@HasControls
@HasLineTransect
export default class LajiMap {
	constructor(props) {
		this._constructDictionary();
		this.onSetLangHooks = [];

		const options = {
			tileLayerName: TAUSTAKARTTA,
			lang: "en",
			data: [],
			locate: false,
			center:  [65, 26],
			zoom: 2,
			popupOnHover: false,
			draw: false
		};

		this.options = {};
		this.setOptions({...options, ...props});
		this._initializeMap();
		this._stopDrawRemove = this._stopDrawRemove.bind(this);
		this._stopDrawReverse = this._stopDrawReverse.bind(this);
	}

	getOptionKeys() {
		return {
			rootElem: "setRootElem",
			lang: "setLang",
			data: "setData",
			draw: "setDraw",
			tileLayerName: "setTileLayerByName",
			availableTileLayerNamesBlacklist: "setAvailableTileLayerBlacklist",
			availableTileLayerNamesWhitelist: "setAvailableTileLayerWhitelist",
			overlayNames: ["_setOverlaysByName", () => this.getOverlaysByName()],
			availableOverlayNameBlacklist: "setAvailableOverlaysBlacklist",
			availableOverlayNameWhitelist: "setAvailableOverlaysWhitelist",
			tileLayerOpacity: "setTileLayerOpacity",
			center: "setCenter",
			zoom: "setNormalizedZoom",
			zoomToData: "zoomToData",
			locate: true,
			onPopupClose: true,
			markerPopupOffset: true,
			featurePopupOffset: true,
			popupOnHover: true,
			onInitializeDrawLayer: true,
			on: "setEventListeners",
			polyline: true,
			polygon: true,
			rectangle: true,
			circle: true,
			marker: true,
		};
	}

	setOptions(options) {
		Object.keys(options || {}).forEach(option => {
			this.setOption(option, options[option]);
		});
	}

	setOption(option, value) {
		const optionKeys = this.getOptionKeys();

		if (!optionKeys.hasOwnProperty(option)) return;

		const optionKey = Array.isArray(optionKeys[option]) ? optionKeys[option][0] : optionKeys[option];

		if (optionKey === true) this[option] = value;
		else {
			this[optionKey](value);
		}
	}

	getOptions() {
		const optionKeys = this.getOptionKeys();

		return Object.keys(optionKeys).reduce((options, key) => {
			if (Array.isArray(optionKeys[key])) {
				options[key] = optionKeys[key][1]();
			} else if (key in this) {
				options[key] = this[key];
			}
			return options;
		}, {});
	}

	setRootElem(rootElem) {
		this.cleanDOM();

		this.mapElem = this.mapElem || document.createElement("div");
		this.blockerElem = this.blockerElem || document.createElement("div");

		this.container = document.createElement("div");
		this.container.className = "laji-map";

		this.blockerElem.className = "laji-map-blocker";

		this.container.appendChild(this.mapElem);
		document.body.appendChild(this.blockerElem);

		this.rootElem = rootElem;
		this.rootElem.appendChild(this.container);

		if (this.map) this.map.invalidateSize();

		provide(this, "rootElem");
	}

	getMMLProj() {
		const mmlProj = L.TileLayer.MML.get3067Proj();

		// Scale controller won't work without this hack.
		// Fixes also circle projection.
		mmlProj.distance =  L.CRS.Earth.distance;
		mmlProj.R = 6378137;

		return mmlProj;
	}

	@dependsOn("rootElem")
	_initializeMap() {
		try {
			if (!depsProvided(this, "_initializeMap", arguments)) return;
			L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

			this.map = L.map(this.mapElem, {
				contextmenu: true,
				contextmenuItems: [],
				zoomControl: false,
				attributionControl: false,
				noWrap: true,
				continuousWorld: false
			});

			this.tileLayers = {};

			[MAASTOKARTTA, TAUSTAKARTTA].forEach(tileLayerName => {
				this.tileLayers[tileLayerName] = L.tileLayer.mml_wmts({
					layer: tileLayerName
				});
			});

			this.tileLayers.pohjakartta = L.tileLayer.wms("http://avaa.tdata.fi/geoserver/osm_finland/gwc/service/wms?", {
				layers: "osm_finland:Sea",
				format: "image/png",
				transparent: false,
				version: "1.1.0",
				attribution: "LUOMUS"
			});

			this.tileLayers.ortokuva = L.tileLayer.mml("Ortokuva");

			this.tileLayers.openStreetMap = L.tileLayer("http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
				attribution: "&copy; <a href=\"http://osm.org/copyright\" target=\"_blank\" rel=\"noopener noreferrer\">OpenStreetMap</a> contributors"
			});
			this.tileLayers.googleSatellite = L.tileLayer("http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
				subdomains:["mt0","mt1","mt2","mt3"]
			});

			this.availableTileLayers = this.tileLayers;

			this.overlaysByNames = {
				geobiologicalProvinces: L.tileLayer.wms("http://maps.luomus.fi/geoserver/INSPIRE/wms", {
					layers: "INSPIRE:fi_fmnh_br",
					styles: "harmaaviiva",
					format: "image/png",
					transparent: true,
					version: "1.1.0",
					attribution: "LUOMUS"
				}).setOpacity(1),
				forestVegetationZones: L.tileLayer.wms("http://paikkatieto.ymparisto.fi/arcgis/services/INSPIRE/SYKE_EliomaantieteellisetAlueet/MapServer/WmsServer", {
					layers: "Metsakasvillisuusvyohykkeet",
					format: "image/png",
					transparent: true,
					version: "1.3.0"
				}).setOpacity(0.5),
				mireVegetationZones: L.tileLayer.wms("http://paikkatieto.ymparisto.fi/arcgis/services/INSPIRE/SYKE_EliomaantieteellisetAlueet/MapServer/WmsServer", {
					layers: "Suokasvillisuusvyohykkeet",
					format: "image/png",
					transparent: true,
					version: "1.3.0"
				}).setOpacity(0.5),
				threatenedSpeciesEvaluationZones: L.tileLayer.wms("http://maps.luomus.fi/geoserver/Vyohykejaot/wms", {
					layers: "Vyohykejaot:Metsakasvillisuusvyohykkeet_Uhanalaisarviointi",
					format: "image/png",
					transparent: true,
					version: "1.1.0"
				}),
				ykjGrid: L.tileLayer.wms("http://maps.luomus.fi/geoserver/atlas/wms", {
					layers: "atlas:YKJ_ETRS_LINE100,atlas:YKJ_ETRS_LINE1000,atlas:YKJ_ETRS_LINE10000,atlas:YKJ_ETRS_LINE100000",
					format: "image/png",
					transparent: true,
					version: "1.1.0",
					attribution: "LUOMUS"
				}),
				ykjGridLabels: L.tileLayer.wms("http://maps.luomus.fi/geoserver/atlas/wms", {
					layers: "atlas:YKJ_ETRS_LABEL1000,atlas:YKJ_ETRS_LABEL10000,atlas:YKJ_ETRS_LABEL100000",
					format: "image/png",
					transparent: true,
					version: "1.1.0",
					attribution: "LUOMUS"
				})
			};

			this.availableOverlaysByNames = this.overlaysByNames;

			this.userLocationLayer = new L.LayerGroup().addTo(this.map);

			if (this.locate) {
				this.initializeViewAfterLocateFail = true;
				this._onLocate();
			}

			this._initializeMapEvents();

			this.idxsToIds = [];
			this.idsToIdxs = [];
			this.idsToIdxTuples = {};
			this._idxsToHovered = {};
			this._idxsToContextMenuOpen = {};

			provide(this, "map");
		} catch (e) {
			if (e._lajiMapError) {
				this._showError(e);
			} else {
				throw e;
			}
		}
	}


	@dependsOn("map", "tileLayer", "center", "zoom")
	_initializeView() {
		if (!depsProvided(this, "_initializeView", arguments)) return;
		this.map.setView(
			this.center,
			this.getDenormalizedZoom(this.zoom),
			{animate: false}
		);
	}

	@dependsOn("map")
	_initializeMapEvents() {
		if (!depsProvided(this, "_initializeMapEvents", arguments)) return;

		this.map.addEventListener({
			click: () => this._interceptClick(),
			"draw:created": ({layer}) => this._onAdd(this.drawIdx, layer),
			"draw:drawstart": () => {
				this.drawing = true;
				this.map.fire("controlClick", {name: "draw"});
			},
			"draw:drawstop": () => { this.drawing = false; },
			"draw:drawvertex": (e) => {
				const layers = e.layers._layers;
				const keys = Object.keys(layers);
				const latlng = layers[keys[keys.length - 1]].getLatLng();

				const {x, y} = this.map.latLngToContainerPoint(latlng);
				const {width, height} = this.rootElem.getBoundingClientRect();
				const treshold = Math.min(width, height) / 4;
				if ([y, y - height, x, x - width].some(dist => Math.abs(dist) < treshold)) {
					this.map.setView(latlng);
				}
			},
			locationfound: (...params) => this._onLocationFound(...params),
			locationerror: (...params) => this._onLocationNotFound(...params),
			"contextmenu.show": (e) => {
				if (e.relatedTarget) {
					this._hoveredLayer = e.relatedTarget;
					const tuple = this._getIdxTupleByLayer(this._hoveredLayer);
					if (tuple) {
						const [dataIdx, featureIdx] = tuple;
						if (this.data[dataIdx] && this.data[dataIdx].editable) {
							this._idxsToContextMenuOpen[dataIdx][featureIdx] = true;
							this.updateLayerStyle(e.relatedTarget);
						}
					}
				}
				this._interceptClick();
			},
			"contextmenu.hide": () => {
				if (!this._hoveredLayer) return;
				const tuple = this._getIdxTupleByLayer(this._hoveredLayer);
				if (tuple) {
					const [dataIdx, featureIdx] = tuple;
					if (this.data[dataIdx] && this.data[dataIdx].editable) {
						this._idxsToContextMenuOpen[dataIdx][featureIdx] = false;
						this.updateLayerStyle(this._hoveredLayer);
					}
				}
			}
		});

		this._addDocumentEventListener("click", e => {
			if (e.target !== this.rootElem && !this.rootElem.contains(e.target)) {
				this._interceptClick();
			}
		});

		document.addEventListener("keydown", e => this.keyHandler(e));
	}

	keyHandler(e) {
		e = e || window.event;
		var isEscape = false;
		if ("key" in e) {
			isEscape = (e.key == "Escape" || e.key == "Esc");
		} else {
			isEscape = (e.keyCode == 27);
		}
		if (isEscape) {
			this._triggerKeyEvent(ESC, e);
		}
	}

	_addDocumentEventListener(type, fn) {
		if (!this._documentEvents) this._documentEvents = {};
		this._documentEvents[type] = fn;
		document.addEventListener(type, fn);
	}

	_addKeyListener(key, fn, prioritize) {
		if (!this._keyListeners) this._keyListeners = {};
		if (!this._keyListeners[key]) this._keyListeners[key] = [];
		if (prioritize) {
			this._keyListeners[key] = [fn, ...this._keyListeners[key]];
		} else {
			this._keyListeners[key].push(fn);
		}
	}

	_removeKeyListener(key, fn) {
		if (this._keyListeners && this._keyListeners[key]) {
			const index = this._keyListeners[key].indexOf(fn);
			if (index >= 0) {
				this._keyListeners[key].splice(index, 1);
			}
		}
	}

	_triggerKeyEvent(key, e) {
		if (this._keyListeners && this._keyListeners[key])  {
			for (let fn of this._keyListeners[key]) {
				if (fn(e) === true) break;
			}
		}
	}

	@dependsOn("map")
	setEventListeners(eventListeners) {
		if (!depsProvided(this, "setEventListeners", arguments)) return;

		if (this._listenedEvents) {
			Object.keys(this._listenedEvents).forEach(name => {
				this.map.removeEventListener(name, this._listenedEvents[name]);
			});
		}

		this._listenedEvents = eventListeners;
		this.map.addEventListener(eventListeners);
	}

	_getDefaultCRSLayers() {
		return [this.tileLayers.openStreetMap, this.tileLayers.googleSatellite, this.tileLayers.ortokuva];
	}

	_getMMLCRSLayers() {
		return [this.tileLayers.maastokartta, this.tileLayers.taustakartta, this.tileLayers.pohjakartta];
	}

	@dependsOn("map")
	setTileLayerByName(name) {
		if (!depsProvided(this, "setTileLayerByName", arguments)) return;
		this.setTileLayer(this.tileLayers[name]);
	}

	@dependsOn("map")
	setAvailableTileLayers(names = [], condition) {
		if (!depsProvided(this, "setAvailableTileLayers", arguments)) return;
		const list = names.reduce((list, name) => {
			list[name] = true;
			return list;
		}, {});
		this.availableTileLayers = Object.keys(this.tileLayers).reduce((tileLayers, name) => {
			if (name in list === condition) tileLayers[name] = this.tileLayers[name];
			return tileLayers;
		}, {});
	}

	setAvailableTileLayerBlacklist(names) {
		this.setAvailableTileLayers(names, false);
	}

	setAvailableTileLayerWhitelist(names) {
		this.setAvailableTileLayers(names, true);
	}

	@dependsOn("map", "center", "zoom")
	setTileLayer(layer) {
		if (!depsProvided(this, "setTileLayer", arguments)) return;

		const defaultCRSLayers = this._getDefaultCRSLayers();
		const mmlCRSLayers = this._getMMLCRSLayers();

		const center = this.map.getCenter();
		this.map.options.crs = (defaultCRSLayers.includes(layer)) ? L.CRS.EPSG3857 : this.getMMLProj();

		this.map.setView(center);

		let projectionChanged = false;
		let zoom = this.map.getZoom();
		if (mmlCRSLayers.includes(layer) && !mmlCRSLayers.includes(this.tileLayer)) {
			if (isProvided(this, "tileLayer")) zoom = zoom - 3;
			projectionChanged = true;
		} else if (defaultCRSLayers.includes(layer) && !defaultCRSLayers.includes(this.tileLayer)) {
			zoom = zoom + 3;
			projectionChanged = true;
		}

		if (projectionChanged) {
			this.map._resetView(this.map.getCenter(), this.map.getZoom(), true); // Redraw all layers according to new projection.
			this.map.setView(center, zoom, {animate: false});
		}

		if (!this.savedMMLOverlays) this.savedMMLOverlays = {};

		if (this.tileLayer) this.map.removeLayer(this.tileLayer);
		this.tileLayer = layer;
		this.map.addLayer(this.tileLayer);
		if (this.tileLayerOpacity !== undefined) this.setTileLayerOpacity(this.tileLayerOpacity, !"trigger event");

		if (projectionChanged) {
			this.setOverlays(this.overlays, !"trigger event");
		}

		let currentLayerName = undefined;
		for (let tileLayerName in this.tileLayers) {
			if (this.tileLayer == this.tileLayers[tileLayerName]) {
				currentLayerName = tileLayerName;
				this.tileLayerName = currentLayerName;
			}
		}

		if (isProvided(this, "tileLayer")) {
			this.map.fire("tileLayerChange", {tileLayerName: currentLayerName});
		}

		provide(this, "tileLayer");
	}

	getTileLayers() {
		const tileLayers = {};
		Object.keys(this.tileLayers).forEach(tileLayerName => {
			tileLayers[tileLayerName] = this.tileLayers[tileLayerName];
		});
		return tileLayers;
	}

	@dependsOn("tileLayer")
	setTileLayerOpacity(val = 1, triggerEvent = true) {
		if (!depsProvided(this, "setTileLayerOpacity", arguments)) return;

		let initialCall = this.tileLayerOpacity === undefined;

		this.tileLayerOpacity = val;
		this.tileLayer.setOpacity(val);
		if (!initialCall && triggerEvent) this.map.fire("tileLayerOpacityChange", {tileLayerOpacity: val});
	}

	setOverlays(overlays = [], triggerEvent = true) {
		this.overlays = overlays;

		if (this._getDefaultCRSLayers().includes(this.tileLayer)) {
			const onlyMMLOverlays = ONLY_MML_OVERLAY_NAMES.map(name => this.overlaysByNames[name]);
			overlays = overlays.filter(overlay => !onlyMMLOverlays.includes(overlay));
		}

		Object.keys(this.overlaysByNames).forEach(name => {
			const overlay = this.overlaysByNames[name];
			if (this.map.hasLayer(overlay)) this.map.removeLayer(overlay);
		});

		const availableOverlays = [];
		Object.keys(this.availableOverlaysByNames).forEach(name => {
			availableOverlays.push(this.overlaysByNames[name]);
		});

		overlays.forEach(overlay => {
			if (availableOverlays.includes(overlay)) {
				this.map.addLayer(overlay);
			}
		});

		if (triggerEvent) {
			this.map.fire("overlaysChange", {overlayNames: this.getOverlaysByName()});
		}

		provide(this, "overlays");
	}

	// Wrapper that prevents overlay event triggering on initial call.
	_setOverlaysByName(overlayNames) {
		this.setOverlaysByName(overlayNames, false);
	}

	getOverlaysByName() {
		const names = [];
		(this.overlays || []).forEach(overlay => {
			names.push(Object.keys(this.overlaysByNames).find(n => this.overlaysByNames[n] === overlay));
		});
		return names;
	}

	@dependsOn("tileLayer")
	setOverlaysByName(overlayNames = [], triggerEvent = true) {
		if (!depsProvided(this, "setOverlaysByName", arguments)) return;
		this.setOverlays(overlayNames.map(name => this.overlaysByNames[name]), triggerEvent);
	}

	setAvailableOverlaysBlacklist(overlayNames) {
		this.setAvailableOverlays(overlayNames, false);
	}

	setAvailableOverlaysWhitelist(overlayNames) {
		this.setAvailableOverlays(overlayNames, true);
	}

	@dependsOn("map")
	setAvailableOverlays(overlayNames = [], condition) {
		if (!depsProvided(this, "setAvailableOverlays", arguments)) return;
		const list = overlayNames.reduce((list, name) => {
			list[name] = true;
			return list;
		}, {});
		this.availableOverlaysByNames = Object.keys(this.overlaysByNames).reduce((overlaysByNames, name) => {
			if (name in list === condition) overlaysByNames[name] = this.overlaysByNames[name];
			return overlaysByNames;
		}, {});
	}

	getNormalizedZoom() {
		const zoom = this.map.getZoom();
		return (this._getMMLCRSLayers().includes(this.tileLayer)) ? zoom : zoom - 3;
	}

	getDenormalizedZoom() {
		return this._getDefaultCRSLayers().includes(this.tileLayer) ? this.zoom + 3: this.zoom;
	}

	@dependsOn("map")
	setNormalizedZoom(zoom, options = {animate: false}) {
		if (!depsProvided(this, "setNormalizedZoom", arguments)) return;

		this.zoom = zoom;
		if (this.map) this.map.setZoom(this.getDenormalizedZoom(), options);
		provide(this, "zoom");
	}

	@dependsOn("zoom")
	setCenter(center) {
		if (!depsProvided(this, "setCenter", arguments)) return;

		this.center = center;
		if (this.map) this.map.setView(center, this.getDenormalizedZoom(this.zoom), {animate: false});
		provide(this, "center");
	}

	destroy() {
		this.map.remove();
		this.map = null;

		this.cleanDOM();
	}

	cleanDOM() {
		if (this.rootElem) this.rootElem.removeChild(this.container);
		if (this.blockerElem) document.body.removeChild(this.blockerElem);
		if (this._closeDialog) this._closeDialog();

		if (this._documentEvents) Object.keys(this._documentEvents).forEach(type => {
			document.removeEventListener(type, this._documentEvents[type]);
		});
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
			if (["fi", "en", "sv"].every(_lang => _lang != lang)) {
				console.warn(`LajiMap: Invalid lang option '${lang}'. Fallbacking to 'en'.`);
				this.lang = "en";
			}
			this.translations = this.dictionary[this.lang];
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
				0);
			const isClockwise = sum >= 0;

			if (!isClockwise) {
				feature = {...feature, geometry: {...feature.geometry, coordinates: [coordinates.reverse()]}};
			}
		}

		const {lajiMapIdx, ...properties} = feature.properties; //eslint-disable-line
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

	initializeDataItem(item, dataIdx) {
		dataIdx = dataIdx === undefined ? this.data.length : dataIdx;

		let {geoData, ..._item} = item;
		if (geoData) {
			const geoJSON = convertAnyToWGS84GeoJSON(geoData);
			const anyToFeatureCollection = geoJSON => {
				switch (geoJSON.type) {
				case "FeatureCollection":
					return geoJSON;
				case "Feature":
					return {type: "FeatureCollection", features: [geoJSON]};
				case "Point":
				case "Polygon":
				case "LineString":
					return {type: "FeatureCollection", features: [{type: "Feature", geometry: geoJSON}]};
				case "GeometryCollection":
					return {type: "FeatureCollection", features: geoJSON.geometries.map(geom => {return { type: "Feature", geometry: geom}; })};
				}
			};
			item = {
				..._item,
				featureCollection: {
					type: "FeatureCollection",
					features: this.cloneFeatures(anyToFeatureCollection(geoJSON).features)
				},
			};
			this.initializeDataItem(item, dataIdx);
			return;
		}

		const features = item.featureCollection && item.featureCollection.features ?
			item.featureCollection.features :
			[] ;

		item = {
			getFeatureStyle: (...params) => this._getDefaultDataStyle(item)(...params),
			getClusterStyle: (...params) => this._getDefaultDataClusterStyle(item)(...params),
			getDraftStyle: (...params) => this._getDefaultDraftStyle(...params),
			...item,
			featureCollection: {
				type: "FeatureCollection",
				features: this.cloneFeatures(features)
			},
			idx: dataIdx
		};

		item.hasActive = ("activeIdx" in item);

		if (this.data[dataIdx]) {
			this.data[dataIdx].groupContainer.clearLayers();
		}

		const format = (geoData) ? detectFormat(geoData) : undefined;
		const crs = (geoData || item.featureCollection) ? detectCRS(geoData || item.featureCollection) : undefined;
		this._setOnChangeForItem(item, format, crs);

		this.data[dataIdx] = item;

		const layer = L.geoJson(
			convertAnyToWGS84GeoJSON(item.featureCollection),
			{
				pointToLayer: this._featureToLayer(item.getFeatureStyle, dataIdx),
				style: feature => {
					return this._fillStyleWithGlobals(dataIdx, feature.properties.lajiMapIdx, feature);
				},
			}
		);

		item.group = layer;
		item.groupContainer = layer;
		if (item.cluster) {
			item.groupContainer = L.markerClusterGroup({iconCreateFunction: this._getClusterIcon(item), ...item.cluster});
			item.group.addTo(item.groupContainer);
		}
		item.groupContainer.addTo(this.map);

		this.idxsToIds[dataIdx] = {};
		this.idsToIdxs[dataIdx] = {};
		this._idxsToHovered[dataIdx] = [];
		this._idxsToContextMenuOpen[dataIdx] = [];

		layer.eachLayer(layer => {
			this._initializeLayer(layer, dataIdx, layer.feature.properties.lajiMapIdx);
		});

		if (item.hasActive) {
			this.updateLayerStyle(this._getLayerByIdxs(dataIdx, item.activeIdx));
		}

		if (item.on) Object.keys(item.on).forEach(eventName => {
			item.group.on(eventName, (e) => {
				const {layer} = e;
				const {feature} = layer;
				const idx = feature.properties.lajiMapIdx;
				if (eventName === "click" && this._interceptClick()) return;
				item.on[eventName](e, {idx, layer, feature: this.formatFeatureOut(feature, layer)});
			});
		});

		item.group.on("click", e => {
			const {layer: {feature: {properties: {lajiMapIdx}}}} = e;
			if (!this._interceptClick()) this._onActiveChange(item.idx, lajiMapIdx);
		});

		item.group.on("dblclick", ({layer}) => {
			this.map.doubleClickZoom.disable();
			this._setEditable(layer);
			setImmediate(() => this.map.doubleClickZoom.enable());
		});

		item.group.on("mouseover", e => {
			if (item.editable || item.hasActive || item.highlightOnHover) {
				const {layer} = e;
				const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);
				this._idxsToHovered[dataIdx][featureIdx] = true;
				this.updateLayerStyle(layer);
			}
		});

		item.group.on("mouseout", e => {
			if (item.editable || item.hasActive || item.highlightOnHover) {
				const {layer} = e;
				const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);
				this._idxsToHovered[dataIdx][featureIdx] = false;
				this.updateLayerStyle(layer);
			}
		});

		item.group.on("layeradd", e => {
			const item = this.data[dataIdx];
			const {layer} = e;
			const {featureCollection: {features}} = item;
			const featureIdx = features.length - 1;
			const feature = this.formatFeatureOut(layer.toGeoJSON(), layer);

			feature.properties.lajiMapIdx = featureIdx;
			layer.feature = feature;

			if (item.cluster) {
				item.groupContainer.clearLayers();
				item.groupContainer.addLayer(item.group);
			}

			this._initializeLayer(layer, dataIdx, featureIdx);
		});

		item.group.on("layerremove", e => {
			const {layer} = e;
			const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);
			this._idxsToContextMenuOpen[dataIdx][featureIdx] = false;
			this._idxsToHovered[dataIdx][featureIdx] = false;
		});
	}

	@dependsOn("data", "draw", "center", "zoom")
	zoomToData() {
		if (!depsProvided(this, "zoomToData", arguments)) return;

		const featureGroup = L.featureGroup([this.getDraw(), ...this.data].filter(item => item).reduce((layers, item) => {
			const newLayers = item.group.getLayers().filter(layer => !(layer instanceof L.Circle)); // getBounds fails with circles
			layers = [...layers, ...newLayers];
			return layers;
		}, []));

		const bounds = featureGroup.getBounds();
		if (bounds.isValid()) this.map.fitBounds(bounds);
	}

	_initializeLayer(layer, ...indexTuple) {
		this._setIdForLayer(layer, ...indexTuple);
		this._initializePopup(layer);
		this._initializeTooltip(layer);
		this._updateContextMenuForLayer(layer);
		this._decoratePolyline(layer);
	}

	@dependsOn("map", "translations")
	setData(data) {
		if (!depsProvided(this, "setData", arguments)) return;

		if (!this.data) {
			this.data = [];
		} else {
			this.data.forEach((item, idx) => {
				(idx !== this.drawIdx && item) && item.groupContainer.clearLayers();
			});
		}
		if (!Array.isArray(data)) data = [data];
		data.filter(item => item).forEach((item, idx) => (idx !== this.drawIdx) && this.updateData(idx, item));
		provide(this, "data");
	}

	addData(items) {
		if (!items) return;
		if (!Array.isArray(items)) items = [items];
		items.forEach(item => this.initializeDataItem(item));
	}

	updateData(idx, item) {
		this.initializeDataItem(item, idx);
	}

	updateDrawData(item) {
		this.updateData(this.drawIdx, this.getDrawOptions(item));
	}

	removeData(idx) {
		if (this.data[idx]) {
			this.data[idx].groupContainer.clearLayers();
			this.data[idx] = undefined;
		}
	}

	getDrawOptions = (options) => {
		const drawAllowed = options !== false;

		let draw = {
			...this.getFeatureTypes().reduce((_options, key) => {
				let optionValue = {};
				if (options === false || isObject(options) && options[key] === false) optionValue = false;
				else if (isObject(options) && isObject(options[key])) optionValue = options[key];
				_options[key] = optionValue;
				return _options;
			}, {})
		};
		draw = {
			...draw,
			...{
				...(drawAllowed ? (options || {}) : {})
			}
		};

		if (options.data) {
			console.warn("laji-map warning: draw.data is deprecated and will be removed in the future. Please move it's content to draw");
		}

		draw = {
			getFeatureStyle: (...params) => this._getDefaultDrawStyle(...params),
			getClusterStyle: (...params) => this._getDefaultDrawClusterStyle(...params),
			getDraftStyle: (...params) => this._getDefaultDrawDraftStyle(...params),
			editable: true,
			onChange: options.onChange || (options.data || {}).onChange,
			...draw,
			...(options.data || {})
		};

		return draw;
	}

	@dependsOn("map", "data")
	setDraw(options) {
		if (!depsProvided(this, "setDraw", arguments)) return;

		 // Using a negative idx lets us keep the original data indices.
		if (!this.drawIdx) this.drawIdx = -1;

		this.updateDrawData(options);

		this.resetDrawUndoStack();

		provide(this, "draw");
	}

	getDraw() {
		return this.data[this.drawIdx];
	}

	drawIsAllowed = () => {
		const draw = this.getDraw();
		return this.getFeatureTypes().some(type => draw[type]);
	}

	resetDrawUndoStack() {
		this._drawHistory = [{featureCollection: {
			type: "FeatureCollection",
			features: this.cloneFeatures(this.getDraw().featureCollection.features)
		}}];
		this._drawHistoryPointer = 0;
	}

	drawUndo() {
		if (this._drawHistoryPointer <= 0) return;
		const {undoEvents: events} = this._drawHistory[this._drawHistoryPointer];
		this._drawHistoryPointer--;
		const {featureCollection} = this._drawHistory[this._drawHistoryPointer];
		this.updateData(this.drawIdx, {...this.getDraw(), featureCollection});
		if (events) {
			events.some(e => {
				if (e.type === "active") {
					this.setActive(this._getLayerByIdxs(this.drawIdx, e.idx));
					return true;
				}
			});
			this._triggerEvent(events, this.getDraw().onChange);
		}
	}

	drawRedo() {
		if (this._drawHistoryPointer >= this._drawHistory.length - 1) return;
		this._drawHistoryPointer++;
		const {featureCollection, redoEvents: events} = this._drawHistory[this._drawHistoryPointer];
		this.updateData(this.drawIdx, {...this.getDraw(), featureCollection});
		if (events) {
			events.some(e => {
				if (e.type === "active") {
					this.setActive(this._getLayerByIdxs(this.drawIdx, e.idx));
					return true;
				}
			});
			this._triggerEvent(events, this.getDraw().onChange);
		}
	}

	@dependsOn("data")
	_setOnChangeForItem(item, format = "GeoJSON", crs = "WGS84") {
		if (!depsProvided(this, "_setOnChangeForItem", arguments)) return;

		const onChange = item.onChange;
		if (onChange) item.onChange = events => onChange(events.map(e => {
			switch (e.type) {
			case "create":
				e.geoData = convert(e.feature, format, crs);
				break;
			case "edit":
				e.geoData = Object.keys(e.features).reduce((features, idx) => {
					features[idx] = convert(e.features[idx], format, crs);
					return features;
				}, {});
				break;
			}

			return e;
		}));
	}

	clearItemData(item) {
		const prevFeatureCollection = {type: "FeatureCollection", features: this.cloneFeatures(this.data[item.idx].featureCollection.features)};
		const event = {
			type: "delete",
			idxs: Object.keys(this.idxsToIds[item.idx])
		};
		this._triggerEvent(event, item.onChange);

		this.updateData(item.idx, {...item, geoData: undefined, featureCollection: {type: "FeatureCollection", features: []}});
		this._resetIds(item.idx);
		if (item.idx === this.drawIdx) this._updateDrawUndoStack(event, prevFeatureCollection);
	}

	clearDrawData() {
		this.clearItemData(this.getDraw());
	}

	_startDrawRemove() {
		if (this._onDrawRemove) return;
		this._createTooltip("RemoveFeatureOnClick");

		this._drawRemoveLayers = [];
		this._onDrawRemove = ({layer}) => {
			this._drawRemoveLayers.push(layer);
			this._removeLayerFromItem(this.getDraw(), layer);
		};
		this.getDraw().group.on("click", this._onDrawRemove);

		this._addKeyListener(ESC, this._stopDrawRemove);
	}

	_stopDrawRemove() {
		this.getDraw().group.removeEventListener("click", this._onDrawRemove);
		this._onDrawRemove = undefined;
		this._disposeTooltip();
		this._drawRemoveLayers = undefined;
		this._removeKeyListener(ESC, this._stopDrawRemove);
	}

	_finishDrawRemove() {
		const layers = this._drawRemoveLayers;
		this._stopDrawRemove();
		if (layers && layers.length) this._onDelete(this.drawIdx, layers.map(layer => layer._leaflet_id));
	}

	_cancelDrawRemove() {
		const layers = this._drawRemoveLayers;
		this._stopDrawRemove();
		if (layers) layers.forEach(layer => {
			this.getDraw().group.addLayer(layer);
			this.updateLayerStyle(layer);
		});
	}

	_startDrawReverse() {
		if (this._onDrawReverse) return;
		this._createTooltip("ReverseLineOnClick");
		this._drawReverseLayers = [];
		this._onDrawReverse = ({layer}) => {
			this._drawReverseLayers.push(layer);
			this._reversePolyline(layer);
		};
		this.getDraw().group.on("click", this._onDrawReverse);
		this._addKeyListener(ESC, this._stopDrawReverse);
	}

	_stopDrawReverse() {
		if (!this._onDrawReverse) return;
		this.getDraw().group.removeEventListener("click", this._onDrawReverse);
		this._onDrawReverse = undefined;
		this._drawReverseLayers = undefined;
		this._disposeTooltip();
		this._removeKeyListener(ESC, this._stopDrawReverse);
	}

	_finishDrawReverse() {
		const layers = this._drawReverseLayers;
		this._stopDrawReverse();
		if (!layers || !layers.length) return;
		const editData = layers.reduce((idToLayer, layer) => {
			idToLayer[layer._leaflet_id] = layer;
			return idToLayer;
		}, {});
		this._onEdit(this.drawIdx, editData);
	}

	_cancelDrawReverse() {
		const layers = this._drawReverseLayers;
		this._stopDrawReverse();
		if (!layers)  return;
		layers.forEach(layer => {
			layer.setLatLngs(layer._origLatLngs);
			this._decoratePolyline(layer);
			delete layer._origLatLngs;
		}, {});
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

	_getClusterIcon(data) {
		return (cluster) => {
			var childCount = cluster.getChildCount();

			var className = " marker-cluster-";
			if (childCount < 10) {
				className += "small";
			} else if (childCount < 100) {
				className += "medium";
			} else {
				className += "large";
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
			};
			const styleString = Object.keys(styleObject)
				.reduce((style, key) => {style += `${key}:${styleObject[key]};`; return style;}, "");

			return L.divIcon({
				html: `<div style="${styleString}"><span>${childCount}</span></div>`,
				className: `marker-cluster${className}`,
				iconSize: new L.Point(40, 40)
			});
		};
	}

	setActive(layer) {
		const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);
		const item = this.data[dataIdx];
		if (!item.hasActive) return;
		const prevActiveIdx = item.activeIdx;
		item.activeIdx = featureIdx;
		const prevActiveLayer =  this._getLayerByIdxs(dataIdx, prevActiveIdx);
		prevActiveLayer && this.updateLayerStyle(prevActiveLayer);
		this.updateLayerStyle(layer);
	}

	_resetIds(idx) {
		// Maps item indices to internal ids and the other way around.
		// We use leaflet ids as internal ids.
		this.idxsToIds[idx] = {};
		this.idsToIdxs[idx] = {};

		let counter = 0;
		if (this.data[idx].group) this.data[idx].group.eachLayer(layer => {
			this._setIdForLayer(layer, idx, counter);
			counter++;
		});
	}

	_setIdForLayer(layer, dataIdx, featureIdx) {
		if (!this.idxsToIds[dataIdx]) {
			this.idxsToIds[dataIdx] = {};
			this.idsToIdxs[dataIdx] = {};
		}
		const id = layer._leaflet_id;
		this.idxsToIds[dataIdx][featureIdx] = id;
		this.idsToIdxs[dataIdx][id] = featureIdx;
		this.idsToIdxTuples[id] = [dataIdx, featureIdx];
	}

	recluster() {
		this._reclusterData();
		this._reclusterDrawData();
	}

	_reclusterDrawData() {
		this._reclusterDataItem(this.getDraw());
	}

	_reclusterData() {
		if (this.data) this.data.forEach(item => this._reclusterDataItem(item));
	}

	_reclusterDataItem(item) {
		if (item.cluster) {
			this.map.removeLayer(item.groupContainer);
			item.groupContainer = L.markerClusterGroup({
				iconCreateFunction: (...params) => this._getClusterIcon(item)(...params)
			}).addTo(this.map);
			item.groupContainer.addLayer(item.group);
		}
	}

	redrawDrawData() {
		this.redrawDataItem(this.drawIdx);
	}

	redrawDataItem(idx) {
		const dataItem = this.data[idx];
		if (!dataItem || !dataItem.group) return;

		this._updateDataLayerGroupStyle(idx);

		dataItem.group.eachLayer(layer => {
			this._initializePopup(layer);
			this._initializeTooltip(layer);
		});
	}

	redrawData() {
		this.data.forEach((dataItem, idx) => {
			this.redrawDataItem(idx);
		});
	}

	redraw() {
		this.redrawData();
		this.redrawDrawData();
	}

	_initializePopup(layer) {
		const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);

		const item = this.data[dataIdx];
		if (!item.getPopup) return;

		const that = this;

		let latlng = undefined;

		function openPopup(content) {
			if (!latlng) return;
			if (that.editIdx && that.editIdx[0] === dataIdx && that.editIdx[1] ===  featureIdx) return;

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

			const content = item.getPopup(featureIdx, that.formatFeatureOut(layer.toGeoJSON(), layer), callbackContent => {if (that.popupCounter == popupCounter) openPopup(callbackContent);});
			if (content !== undefined && typeof content !== "function") openPopup(content);
		}


		if (this.popupOnHover) {
			layer.on("mousemove", e => {
				latlng = e.latlng;
				if (that.popup) that.popup.setLatLng(latlng);
			});
			layer.on("mouseover", e => {
				getContentAndOpenPopup(e.latlng);
			});
			layer.on("mouseout", () => {
				closePopup();
			});
			layer.on("remove", () => {
				closePopup();
			});
		} else {
			layer.on("click", e => {
				if (item.getPopup) {
					closePopup();
					getContentAndOpenPopup(e.latlng);
				}
			});
		}
	}

	_initializeTooltip(layer) {
		const [dataIdx] = this._getIdxTupleByLayer(layer);

		const item = this.data[dataIdx];
		if (!item.getTooltip) return;

		function openTooltip(content) {
			layer.bindTooltip(content, item.tooltipOptions);
		}

		// Allow either returning content or firing a callback with content.
		const content = item.getTooltip(dataIdx, this.formatFeatureOut(layer.toGeoJSON(), layer), callbackContent => openTooltip(callbackContent));
		if (content !== undefined && typeof content !== "function") openTooltip(content);
	}

	@dependsOn("translations")
	_updateContextMenuForLayer(layer) {
		if (!depsProvided(this, "_updateContextMenuForLayer", arguments)) return;

		const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);

		const { translations } = this;
		layer.unbindContextMenu();

		let contextmenuItems = [];

		if (this.data[dataIdx] && this.data[dataIdx].editable) {
			contextmenuItems = [
				{
					text: translations.EditFeature,
					callback: () => this._setEditable(layer),
					iconCls: "glyphicon glyphicon-pencil"
				},
				{
					text: translations.DeleteFeature,
					callback: () => this._onDelete(dataIdx, this.idxsToIds[dataIdx][featureIdx]),
					iconCls: "glyphicon glyphicon-trash"
				},
			];
		}

		if (isPolyline(layer)) {
			contextmenuItems.push({
				text: translations.ReverseFeature,
				callback: () => {
					this._reversePolyline(layer);
					const id = this.idxsToIds[dataIdx][featureIdx];
					this._onEdit(dataIdx, {[id]: layer});
				},
				iconCls: "glyphicon glyphicon-sort"
			});
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

		this.userLocationMarker.on("click", () => { if (!this._interceptClick()) this.map.fitBounds(this.userLocationRadiusMarker.getBounds()); });
	}

	_onLocationNotFound() {
		alert(this.translations.geolocationFailed);
		if (this.initializeViewAfterLocateFail) this._initializeView();
	}

	_getLayerByIdxs(dataIdx, featureIdx) {
		const item = this.data[dataIdx];
		const id = this.idxsToIds[dataIdx][featureIdx];
		return item.group.getLayer(id);
	}

	_getLayerById(id) {
		const [dataIdx] = this.idsToIdxTuples[id];
		return this.data[dataIdx].group.getLayer(id);
	}

	_getIdxTupleByLayer(layer) {
		return this.idsToIdxTuples[layer._leaflet_id];
	}

	_getDrawLayerById(id) {
		return this._getLayerById(id);
	}

	_triggerEvent(e, handler) {
		if (!Array.isArray(e)) e = [e];
		if (handler) handler(e);
	}

	_decoratePolyline(layer) {
		const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);

		const {showStart, showDirection = true} = this._fillStyleWithGlobals(dataIdx, featureIdx);

		function warn() {
			console.warn("Failed to add a starting point to line");
		}
		if (isPolyline(layer)) {
			if (showDirection !== false) {
				const {clickable} = layer;
				layer.options.clickable = false;
				try {
					layer.setText(null)
					     .setText("→", {repeat: true, attributes: {dy: 5, "font-size": 18}});
				} catch (e) {
					console.warn("laji-map polyline text decorating failed");
				}
				layer.options.clickable = clickable;
			}


			if (showStart) {
				let firstPoint = undefined;

				if (!layer.feature.geometry.type) {
					warn();
					return;
				}

				switch(layer.feature.geometry.type) {
				case "MultiLineString":
					firstPoint = layer.getLatLngs()[0][0];
					break;
				case "LineString":
					firstPoint = layer.getLatLngs()[0];
				}

				if (!firstPoint) {
					warn();
					return;
				}

				if (layer._startCircle) {
					layer._startCircle.remove();
				}
				layer._startCircle = L.circleMarker(firstPoint, this._getStartCircleStyle(layer)).addTo(this.map);
				layer.on("editdrag", () => {
					layer._startCircle.setLatLng(layer.getLatLngs()[0]);
				});
				layer.on("remove", () => {
					layer._startCircle.remove();
				});
				layer.on("add", () => {
					layer._startCircle.addTo(this.map);
				});
			}
		}
	}

	_reversePolyline(layer) {
		const {type} = layer.feature.geometry;

		if (type === "LineString") {
			if (!layer._origLatLngs) layer._origLatLngs = layer.getLatLngs();
			layer.setLatLngs(layer.getLatLngs().slice(0).reverse());
			this._decoratePolyline(layer);
		}
	}

	_getStartCircleStyle(lineLayer) {
		let options = {
			...(this.polyline || {}),
			...lineLayer.options,
		};

		return {
			...options,
			weight: 0,
			radius: options.weight + 1,
			fill: true,
			fillOpacity: 1,
		};
	}

	_onAdd(dataIdx, layer, coordinateVerbatim) {
		if (isPolyline(layer) && layer.getLatLngs().length < 2) return;

		const prevActiveIdx = this.data[dataIdx].activeIdx;

		const item = this.data[dataIdx];
		const {featureCollection: {features}} = item;
		const feature = this.formatFeatureOut(layer.toGeoJSON(), layer);

		if (coordinateVerbatim && feature.geometry) {
			feature.geometry.coordinateVerbatim = coordinateVerbatim;
		}
		features.push(feature);

		item.group.addLayer(layer);

		const event = [
			{
				type: "create",
				feature
			},
		];
		if (item.hasActive) event.push(this._getOnActiveChangeEvent(dataIdx, features.length - 1));

		this._triggerEvent(event, item.onChange);

		if (dataIdx === this.drawIdx) {
			this._updateDrawUndoStack(event, undefined, prevActiveIdx);
		}
	}

	_updateDrawUndoStack(events, prevFeatureCollection, prevActiveIdx) {
		if (this._drawHistoryPointer < this._drawHistory.length - 1) {
			this._drawHistory = this._drawHistory.splice(0).splice(0, this._drawHistoryPointer + 1);
		}

		const featureCollection = {
			type: "FeatureCollection",
			features: this.cloneFeatures(this.getDraw().featureCollection.features)
		};

		let reverseEvents = [];
		(Array.isArray(events) ? events : [events]).forEach(e => {
			switch (e.type) {
			case "create": 
				reverseEvents.push({
					"type": "delete",
					idxs: [featureCollection.features.length - 1]
				});
				break;
			case "edit": 
				reverseEvents.push({
					"type": "edit",
					features: Object.keys(e.features).reduce((features, idx) => {
						features[idx] = prevFeatureCollection.features[idx];
						return features;
					}, {}),
					idxs: [featureCollection.features.length - 1]
				});
				break;
			case "delete": 
				e.idxs.sort().reverse().forEach(idx => reverseEvents.push({
					"type": "insert",
					idx,
					feature: prevFeatureCollection.features[idx]
				}));
				break;
			case "active":
				reverseEvents.push({
					type: "active",
					idx: prevActiveIdx
				});
				break;
			}
		});

		this._drawHistory.push({featureCollection, undoEvents: reverseEvents, redoEvents: Array.isArray(events) ? events : [events]});
		this._drawHistoryPointer++;
	}

	_onEdit(dataIdx, data) {
		const eventData = {};

		const prevFeatureCollection = {type: "FeatureCollection", features: this.cloneFeatures(this.data[dataIdx].featureCollection.features)};

		for (let id in data) {
			const feature = this.formatFeatureOut(data[id].toGeoJSON(), data[id]);
			const idx = this.idsToIdxs[dataIdx][id];
			eventData[idx] = feature;
			this.data[dataIdx].featureCollection.features[idx] = this.formatFeatureIn(feature, idx);
		}

		for (let id in data) {
			const layer = this._getLayerById(id);

			if (layer) {
				layer.closePopup().closeTooltip();
			}
		}

		const item = this.data[dataIdx];

		const event = {
			type: "edit",
			features: eventData
		};

		this._triggerEvent(event, item.onChange);

		if (dataIdx === this.drawIdx) {
			this._updateDrawUndoStack(event, prevFeatureCollection);
		}

	}

	_onDelete(dataIdx, deleteIds) {
		this._clearEditable();

		const prevFeatureCollection = {type: "FeatureCollection", features: this.cloneFeatures(this.data[dataIdx].featureCollection.features)};

		if (!Array.isArray(deleteIds)) deleteIds = [deleteIds];
		const deleteIdxs = deleteIds.map(id => this.idsToIdxs[dataIdx][id]);

		const item = this.data[dataIdx];
		const activeIdx = item.activeIdx;

		const {featureCollection: {features}} = item;

		const survivingIds = Object.keys(this.idsToIdxs[dataIdx]).map(id => parseInt(id)).filter(id => !deleteIds.includes(id));

		let changeActive = false;
		let newActiveId = undefined;
		const activeId = this.idxsToIds[dataIdx][activeIdx];
		if (item.hasActive) {
			if (features && survivingIds.length === 0) {
				changeActive = true;
			} else if (activeIdx !== undefined && deleteIds.includes(activeId)) {
				changeActive = true;

				let closestSmallerId = undefined;
				let closestGreaterId = undefined;
				let closestDistance = undefined;
				let closestNegDistance = undefined;

				survivingIds.forEach(id => {
					const dist = activeIdx - this.idsToIdxs[dataIdx][id];
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
		}

		item.featureCollection.features = features.filter((item, i) => !deleteIdxs.includes(i));

		deleteIds.forEach(id => {
			this._removeLayerFromItem(item, this._getLayerById(id));
		});

		this._resetIds(dataIdx);

		item.group.eachLayer(layer => {
			this._updateContextMenuForLayer(layer);
		});

		this._reclusterDataItem(dataIdx);

		const event = [{
			type: "delete",
			idxs: deleteIdxs
		}];

		if (newActiveId !== undefined && changeActive) event.push(this._getOnActiveChangeEvent(dataIdx, this.idsToIdxs[dataIdx][newActiveId]));

		this._triggerEvent(event, item.onChange);

		if (dataIdx === this.drawIdx) {
			this._updateDrawUndoStack(event, prevFeatureCollection, newActiveId ? activeIdx : undefined);
		}
	}

	_removeLayerFromItem(item, layer) {
		if (item.group !== item.groupContainer && item.groupContainer.hasLayer(layer)) {
			item.groupContainer.removeLayer(layer);
		}
		if (item.group.hasLayer(layer)) {
			item.group.removeLayer(layer);
		}
	}

	_getOnActiveChangeEvent(...idxTuple) {
		this.setActive(this._getLayerByIdxs(...idxTuple));
		return {
			type: "active",
			idx: idxTuple[1]
		};
	}

	_onActiveChange(...idxTuple) {
		const [dataIdx] = idxTuple;
		const item = this.data[dataIdx];
		if (item.hasActive) this._triggerEvent(this._getOnActiveChangeEvent(...idxTuple), item.onChange);
	}

	focusToLayerByIdxs(...idxTuple) {
		const [dataIdx, featureIdx] = idxTuple;
		const id = this.idxsToIds[dataIdx][featureIdx];

		if (featureIdx === undefined) {
			this.activeId = this.idxsToIds[featureIdx];
			return;
		}

		let layer = this._getDrawLayerById(id);
		if (!layer) return;

		if (layer instanceof L.Marker) {
			this.map.setView(layer.getLatLng());
		} else	{
			this.map.fitBounds(layer.getBounds());
		}

		this._onActiveChange(...idxTuple);
	}

	focusToDrawLayer(idx) {
		this.focusToLayerByIdxs(this.drawIdx, idx);
	}

	_setEditable(layer) {
		const [dataIdx, featureIdx] = this._getIdxTupleByLayer(layer);
		const item = this.data[dataIdx];
		if (!item.editable || this._onDrawRemove || this._onDrawReverse) return;
		this._clearEditable();
		this.editIdx = [dataIdx, featureIdx];
		const editLayer = this._getLayerByIdxs(...this.editIdx);
		if (item.cluster) {
			item.groupContainer.removeLayer(editLayer);
			this.map.addLayer(editLayer);
		}
		editLayer.editing.enable();
		editLayer.closePopup();
		this.updateLayerStyle(editLayer);
	}

	_clearEditable() {
		if (this.editIdx === undefined) return;
		const editLayer = this._getLayerByIdxs(...this.editIdx);
		editLayer.editing.disable();
		const item = this.data[this.editIdx[0]];
		if (item.cluster) {
			this.map.removeLayer(editLayer);
			item.groupContainer.addLayer(editLayer);
		}
		this._reclusterDataItem(item);
		this.editIdx = undefined;
	}

	_commitEdit() {
		const {editIdx} = this;
		const [dataIdx, featureIdx] = editIdx;
		const editId = this.idxsToIds[dataIdx][featureIdx];
		this._clearEditable();
		const editLayer = this._getLayerByIdxs(...editIdx);
		this.updateLayerStyle(editLayer);
		this._onEdit(dataIdx, {[editId]: editLayer});
	}

	_interceptClick() {
		if (this._onDrawRemove || this._onDrawReverse || this.drawing) return true;
		if (this.editIdx !== undefined) {
			this._commitEdit();
			return true;
		}
	}

	setLayerStyle(layer, style) {
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
			if (layer._startCircle) layer._startCircle.setStyle(this._getStartCircleStyle(layer));
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
		};
	}

	_getDefaultDrawDraftStyle() {
		return this._getStyleForType(this.drawIdx, undefined, undefined, {color: INCOMPLETE_COLOR, fillColor: INCOMPLETE_COLOR, opacity: 0.8});
	}

	_fillStyleWithGlobals(dataIdx, featureIdx, feature) {
		const item = this.data[dataIdx];
		const dataStyles = item.getFeatureStyle({
			dataIdx,
			featureIdx: featureIdx,
			feature: feature || item.featureCollection.features[featureIdx],
			item
		});

		let layer = undefined;
		if (this.idxsToIds[dataIdx] && item.group) layer = this._getLayerByIdxs(dataIdx, featureIdx);

		const mergeOptions = (type) => {
			return {...(this[type] || {}), ...(item[type] || {})};
		};

		let featureTypeStyle = undefined;
		if (layer) {
			if (layer instanceof L.Marker) {
				featureTypeStyle = mergeOptions("marker");
			} else if (isPolyline(layer)) {
				featureTypeStyle = mergeOptions("polyline");
			} else if (layer instanceof L.Rectangle) {
				featureTypeStyle = mergeOptions("rectangle");
			} else if (layer instanceof L.Polygon) {
				featureTypeStyle = mergeOptions("polygon");
			} else if (layer instanceof L.Circle) {
				featureTypeStyle = mergeOptions("circle");
			}
		} else {
			switch (feature.geometry.type) {
			case "LineString":
			case "MultiLineString":
				featureTypeStyle = mergeOptions("polyline");
				break;
			case "Polygon":
				featureTypeStyle = mergeOptions("polygon");
				break;
			case "Point":
				featureTypeStyle = (feature.geometry.radius) ? mergeOptions("circle") : mergeOptions("marker");
				break;
			}
		}

		return {...(featureTypeStyle || {}), ...(dataStyles || {})};
	}

	_getStyleForType(dataIdx, featureIdx, feature, overrideStyles = {}) {
		const item = this.data[dataIdx];
		const dataStyles = feature ?
			this._fillStyleWithGlobals(dataIdx, featureIdx, feature) :
			item.getFeatureStyle({
				dataIdx,
				featureIdx: featureIdx,
				feature: feature || item.featureCollection.features[featureIdx],
				item
			});

		let style = {
			opacity: 1,
			fillOpacity: 0.4,
			color: NORMAL_COLOR,
			fillColor: NORMAL_COLOR,
			...dataStyles,
			...overrideStyles
		};

		const colors = [];

		let editable = false;
		if (this.editIdx) {
			const [_dataIdx, _featureIdx] = this.editIdx;

			if (_dataIdx === dataIdx && _featureIdx === featureIdx) {
				editable = true;
			}
		}

		let active = false;
		if (item.activeIdx === featureIdx) {
			active = true;
			colors.push(["#00ff00", 80]);
		}

		if (editable) {
			const r = active ? "--" : "00";
			const b = r;
			colors.push([`#${r}ff${b}`, 30]);
		}

		const hovered = (
			dataIdx !== undefined &&
			featureIdx !== undefined &&
			this._idxsToHovered[dataIdx][featureIdx]
		);

		if (hovered) {
			colors.push(["#ffffff", 30]);
		}

		let layer = undefined;
		if (this.idxsToIds[dataIdx]) layer = this._getLayerByIdxs(dataIdx, featureIdx);

		if (colors.length || this._idxsToContextMenuOpen[dataIdx][featureIdx]) {
			style = {...style};
			["color", "fillColor"].forEach(prop => {
				if (style[prop]) {
					let finalColor = undefined;
					if (
						this._idxsToContextMenuOpen[dataIdx][featureIdx] || (
						hovered && (this._onDrawRemove || (this._onDrawReverse && (layer && isPolyline(layer) || feature && (feature.geometry.type === "LineString" || feature.geometry.type === "MultiLineString")))))
					) {
						finalColor = "#ff0000";
					} else {
						finalColor = colors.reduce((combined, [color, amount]) => combineColors(combined, color, amount), style[prop]);
					}
					style[prop] = finalColor;
				}
			});
		}

		return style;
	}

	_getStyleForLayer(layer, overrideStyles) {
		return this._getStyleForType(...this._getIdxTupleByLayer(layer), undefined, overrideStyles);
	}

	updateLayerStyle(layer) {
		if (!layer) return;

		let style = this._getStyleForLayer(layer, style);

		this.setLayerStyle(layer, style);
	}

	_getDefaultDrawStyle() {
		return {color: NORMAL_COLOR, fillColor: NORMAL_COLOR, opacity: 1, fillOpacity: 0.7};
	}

	_getDefaultDrawClusterStyle() {
		return {color: this.getDraw().getFeatureStyle({}).color, opacity: 1};
	}

	_getDefaultDataStyle = item => () => {
		const color = (item && item.editable) ?
			EDITABLE_DATA_LAYER_COLOR :
			DATA_LAYER_COLOR;
		return {color, fillColor: color, opacity: 1, fillOpacity: 0.7};
	}


	_getDefaultDataClusterStyle = (item) => () => {
		return {color: item.editable ? EDITABLE_DATA_LAYER_COLOR : DATA_LAYER_COLOR, opacity: 1};
	}

	_getDefaultDraftStyle(dataIdx) {
		return this._getStyleForType(dataIdx, undefined, undefined, {color: INCOMPLETE_COLOR, fillColor: INCOMPLETE_COLOR, opacity: 0.8});
	}

	_updateDataLayerGroupStyle(idx) {
		const item = this.data[idx];
		if (!item) return;

		item.group.eachLayer(layer => {
			this.updateLayerStyle(layer);
		});
	}

	addTranslationHook(elemOrFn, translationKey, attr = "innerHTML") {
		const that = this;

		function translate() {
			if (typeof elemOrFn === "function") {
				const fn = elemOrFn;
				fn();
			} else {
				const elem = elemOrFn;
				const translation = (typeof translationKey === "function") ? translationKey() : that.translations[translationKey];

				if (typeof elem[attr] === "function") {
					elem[attr](translation);
				} else {
					elem[attr] = translation;
				}
			}
		}

		translate(); this.onSetLangHooks.push(translate);
		return translate;
	}

	removeTranslationHook(hook) {
		const index = this.onSetLangHooks.indexOf(hook);
		if (index >= 0) {
			this.onSetLangHooks.splice(index, 1);
		}
	}

	_getDrawOptionsForType(featureType) {
		featureType = featureType.toLowerCase();
		const baseStyle = this.getDraw().getDraftStyle();
		let additionalOptions = {};

		switch (featureType) {
		case "marker":
			additionalOptions = {
				icon: this._createIcon({...this.getDraw().getDraftStyle()})
			};
			break;
		case "polygon":
			additionalOptions = {
				allowIntersection: false
			};
			break;
		}

		const userDefined = this.getDraw()[featureType] || {};

		return {
			metric: true,
			showLength: true,
			showRadius: true,
			...additionalOptions,
			...userDefined,
			shapeOptions: {
				showArea: true,
				...baseStyle,
				...(additionalOptions.shapeOptions || {}),
				...userDefined
			}
		};
	}

	triggerDrawing(featureType) {
		const layer = new L.Draw[capitalizeFirstLetter(featureType)](this.map, this._getDrawOptionsForType(featureType));
		layer.enable();

		const abort = (e) => {
			if (e.preventDefault) {
				e.preventDefault();
				e.stopPropagation();
			}
			layer.disable();
			this._removeKeyListener(ESC, abort);
			this.map.off("controlClick", abort);
			this.map.removeEventListener("draw:created", abort);
		};

		this.map.on("draw:created", abort);
		this.map.on("controlClick", abort);

		return layer;
	}

	getFeatureTypes() {
		return ["rectangle", "polyline", "polygon", "circle", "marker"];
	}

	_showError(e) {
		const alert = document.createElement("div");
		alert.style.display = "block";
		alert.style.className = "block";
		alert.className = "laji-map-popup alert alert-danger";
		const message = () => (e._lajiMapError) ? stringifyLajiMapError(e, this.translations) : e.message;
		const translationHook = this.addTranslationHook(alert, message);

		this.showClosableElement(alert, () => {
			this.removeTranslationHook(translationHook);
		});
	}

	showClosableElement(elem, onClose, blocker = false, container = this.container) {
		const closeButton = document.createElement("button");
		closeButton.setAttribute("type", "button");
		closeButton.className = "close";
		closeButton.innerHTML = "✖";
		closeButton.addEventListener("click", close);

		elem.insertBefore(closeButton, elem.firstChild);

		const that = this;
		function close(e) {
			if (e) e.preventDefault();
			that._removeKeyListener(ESC, close);
			container.removeChild(elem);
			if (blocker) {
				that.blockerElem.style.display = "";
				that.blockerElem.removeEventListener("click", close);
			}
			if (onClose) onClose(e);
			that._closeDialog = undefined;
		}

		this._addKeyListener(ESC, close);

		container.appendChild(elem);

		if (blocker) {
			this.blockerElem.addEventListener("click", close);
			this.blockerElem.style.display = "block";
		}

		this._closeDialog = close;
	}
}
