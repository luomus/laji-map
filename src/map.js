import "leaflet";
import "leaflet-draw";
import "proj4leaflet";
import "leaflet-contextmenu";
import "Leaflet.vector-markers";
import "leaflet.markercluster";
import "./lib/Leaflet.MML-layers/mmlLayers.js";

const NORMAL_COLOR = "#257ECA";
const ACTIVE_COLOR = "#06840A";
const INCOMPLETE_COLOR = "#36B43A";
const DATA_LAYER_COLOR = "#AAAAAA";
const USER_LOCATION_COLOR = "#FF0000";

import translations from "./translations.js";

export default class LajiMap {

	constructor(props) {
		this.tileLayerName = "taustakartta";
		this.lang = "en";
		this.locate = false;
		this.zoom = 4;
		this.data = [];
		this.drawData = {featureCollection: {type: "featureCollection", features: []}};
		this.activeIdx = 0;
		this.controlSettings = {
			draw: {marker: true, circle: true, rectangle: true, polygon: true, polyline: true},
			layer: true,
			zoom: true,
			location: true,
			coordinateInput: true
		};
		this.popupOnHover = false;

		["rootElem", "locate", "center", "zoom", "lang", "onChange",
		 "tileLayerName", "drawData", "data", "activeIdx",
		 "onInitializeDrawLayer", "popupOnHover"].forEach(prop => {
			if (props.hasOwnProperty(prop)) this[prop] = props[prop];
		});

		for (let controlSetting in props.controlSettings) {
			this.controlSettings[controlSetting] = props.controlSettings[controlSetting];
		}

		this.geoJsonLayerOptions = {
			pointToLayer: (feature, latlng) => {
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
		}

		this._constructDictionary();
		this._initializeMap();
		this.setLang(this.lang);
		this.setData(this.data);
		this.setDrawData(this.drawData);
		this.activeId = (this.activeIdx !== undefined) ? this.idxsToIds[this.activeIdx] : undefined;
		this.setActive(this.activeId);
		this._initalizeMapControls();
		this._initializeMapEvents();
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

		this.map.scrollWheelZoom.disable();

		["taustakartta", "maastokartta"].forEach(tileLayerName => {
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
			this.center || [60.1718699, 24.9419917],
			this.zoom || 10,
			{animate: false}
		);
	}

	_initializeMapEvents = () => {
		this.map.addEventListener({
			click: e => this._interceptClick(),
			dblclick: e => {
				if (this.controlSettings.draw && this.controlSettings.marker !== false) {
					this._onAdd(new L.marker(e.latlng));
				}
			},
			"draw:created": ({ layer }) => this._onAdd(layer),
			"draw:drawstart": () => { this.drawing = true },
			"draw:drawstop": () => { this.drawing = false },
			locationfound: this._onLocationFound,
			locationerror: this._onLocationNotFound,
			"contextmenu.hide": () => { this.contextMenuHideTimestamp = Date.now() },
			popupopen: popup => {
				if (this.layerClicked) {
					if (this.popupOnHover) {
						this._getDrawLayerById(this.activeId).closePopup();
					}
					this.layerClicked = false;
				}
			},
			baselayerchange: ({layer}) => this.setTileLayer(layer),
			blur: () => this.map.scrollWheelZoom.disable(),
			focus: () => this.map.scrollWheelZoom.enable()
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

		// This calculation is based on guessing...
		let zoom = this.map.getZoom();
		if (mmlCRSLayers.includes(layer) && !mmlCRSLayers.includes(this.tileLayer)) {
			zoom = zoom - 3;
		} else if (defaultCRSLayers.includes(layer) && !defaultCRSLayers.includes(this.tileLayer)) {
			zoom = zoom + 3;
		}

		this.map._resetView(this.map.getCenter(), this.map.getZoom(), true); // Redraw all layers according to new projection.
		this.map.setView(this.map.getCenter(), zoom, {animate: false});

		this.tileLayer = layer;
		this.map.addLayer(this.tileLayer);
	}

	getTileLayers = () => {
		const tileLayers = {};
		["maastokartta", "taustakartta", "openStreetMap", "googleSatellite"].forEach(tileLayerName => {
			tileLayers[tileLayerName] = this[tileLayerName];
		})
		return tileLayers;
	}

	getNormalizedZoom = () => {
		const zoom = this.map.getZoom();
		return (this._getMMLCRSLayers().includes(this.tileLayer)) ? zoom : zoom - 3;
	}

	_controlIsAllowed = (control) => {
		const controlNameMap = {
			draw: {control: this.drawControl},
			zoom: {control: this.zoomControl},
			location: {control: this.locationControl},
			layer: {control: this.layerControl},
			coordinateInput: {control: this.coordinateInputControl, dependencies: ["draw"]}
		};

		const {controlSettings} = this;
		function controlIsOk(controlName) {
			const dependencies = controlNameMap[controlName].dependencies || [];
			return (controlSettings[controlName] && dependencies.every(dependency => controlIsOk(dependency)));
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

		featureTypes.forEach(type => {
			if (this.controlSettings[type] === false) drawOptions.draw[type] = false;
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
				const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control");
				this._createSearch(container);
				this._createLocate(container);
				return container;
			},

			_createSearch: function(container) {
				return createControlItem(this, container, "search", that.translations.Search, () => this._onSearch(this));
			},

			_createLocate: function(container) {
				return createControlItem(this, container, "screenshot", that.translations.Geolocate, () => this._onLocate());
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
				const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control");
				createControlItem(this, container, "pencil",
					that.translations.AddMarkerByCoordinates, () => that.openCoordinatesDialog());
				return container;
			}
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
		const baseMaps = {};
		const { translations } = this;
		["taustakartta", "maastokartta", "openStreetMap", "googleSatellite"].forEach(tileLayerName => {
			baseMaps[translations[tileLayerName[0].toUpperCase() + tileLayerName.slice(1)]] = this[tileLayerName];
		});

		this.layerControl = L.control.layers(baseMaps, {}, {position: "topleft"});
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

				if (this._controlIsAllowed(this.drawControl) && this.controlSettings[featureType] !== false) {
					this.map.contextmenu.addItem({
						text: text,
						iconCls: "context-menu-draw context-menu-draw-" + featureType,
						callback: () => this.drawControl._toolbars.draw._modes[featureType].handler.enable()
					});
				}
			});

			if (this._controlIsAllowed(this.coordinateInputControl)) {
				this.map.contextmenu.addItem("-");
				this.map.contextmenu.addItem({
					text: this.translations.addMarkerByCoordinates,
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
				}
				else if (this.dataLayerGroups[i]) {
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

	_reclusterDrawData = () => {
		if (this.drawData.cluster) {
			this.clusterDrawLayer.clearLayers();
			this.clusterDrawLayer.addLayer(this.drawLayerGroup);
		}
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
		function openPopup(content) {
			if (!layer || content === undefined || content === null) return;
			if (that.popupOnHover !== true) layer.unbindPopup();
			layer.bindPopup(content).openPopup();
		}

		function getContentAndOpenPopup() {
			// Allow either returning content or firing a callback with content.
			const content = data.getPopup(idx, callbackContent => openPopup(callbackContent));
			if (content) openPopup(content);
		}

		if (this.popupOnHover) {
			layer.on("mouseover", () => {
				if (data.getPopup && this.editId !== layer._leaflet_id) {
					getContentAndOpenPopup();
				}
			});
			layer.on("mouseout", () => {
				layer.closePopup();
			});
		} else {
			layer.on("click", () => {
				if (data.getPopup) {
					getContentAndOpenPopup();
				} else if (data === this.drawData && this.editId === layer._leaflet_id) {
					layer.closePopup();
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
			container.remove();
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
			let charCode = (typeof e.which == "undefined") ? e.keyCode : e.which;

			// The input cursor isn't necessary at the tail, but this validation works regardless.
			validate(e, input.value + String.fromCharCode(charCode));
		}}

		function validate(e, value) {
			value = value.trim();
			if (!value.match(/^([(0-9]+(\.|,)?[0-9]*|)$/)) {
				e.preventDefault();
				return false;
			}
			return true;
		}

		const {translations} = this;
		const container = document.createElement("form");
		container.className = "laji-map-coordinates well";

		const latLabelInput = createTextInput(`${translations.Latitude} (WGS84)`);
		const lngLabelInput = createTextInput(`${translations.Longitude} (WGS84)`);
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
		submitButton.innerHTML = `${translations.Add} ${translations.marker}`;
		submitButton.setAttribute("disabled", "disabled");

		const inputValidContainer = [false, false];
		[latInput, lngInput].forEach((input, i) => {
			let prevVal = "";
			input.addEventListener("keypress", formatter(input));
			input.oninput = (e) => {
				if (!validate(e, e.target.value)) {
					e.target.value = prevVal;
				}
				e.target.value = e.target.value.replace(",", ".");
				prevVal = e.target.value;

				inputValidContainer[i] = validate(e, e.target.value);
				if (inputValidContainer.every(item => item)) {
					submitButton.removeAttribute("disabled");
				} else {
					submitButton.setAttribute("disabled", "disabled");
				}
			}
		});

		container.addEventListener("submit", e => {
			close(e);
			const latlng = [latInput.value, lngInput.value];
			const marker = new L.Marker(latlng);
			this._onAdd(marker);
			this.map.setView(latlng);
			if (this.clusterDrawLayer) this.clusterDrawLayer.zoomToShowLayer(marker);
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
}
