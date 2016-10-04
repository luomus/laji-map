import "leaflet";
import "leaflet-draw";
import "proj4leaflet";
import "leaflet-contextmenu";
import "Leaflet.vector-markers";
import "./lib/Leaflet.MML-layers/mmlLayers.js";
import "./layerControl.js";

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
			location: true
		};
		this.popupOnHover = false;

		["rootElem", "locate", "center", "zoom", "lang", "onChange",
		 "tileLayerName", "drawData", "data", "activeIdx",
		 "onInitializeDrawLayer", "controlSettings", "popupOnHover"].forEach(prop => {
			if (props.hasOwnProperty(prop)) this[prop] = props[prop];
		});

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
		this.map.addLayer(this.drawLayerGroup);
		this._initalizeMapControls();
		this._initializeMapEvents();
	}

	_initializeMap = () => {
		L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

		this.defaultCRS = L.CRS.EPSG3857;
		this.mmlCRS = L.TileLayer.MML.get3067Proj();

		this.map = L.map(this.rootElem, {
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
		this._setTileLayer(this[this.tileLayerName]);

		this.userLocationLayer = new L.LayerGroup().addTo(this.map);

		this.drawLayerGroup = L.geoJson([], this.geoJsonLayerOptions);

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
			baselayerchange: ({layer}) => this._setTileLayer(layer),
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

	_setTileLayer = (layer) => {
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

	getNormalizedZoom = () => {
		const zoom = this.map.getZoom();
		return (this._getMMLCRSLayers().includes(this.tileLayer)) ? zoom : zoom - 3;
	}

	_controlIsAllowed = (control) => {
		const controlNameMap = {
			draw: this.drawControl,
			zoom: this.zoomControl,
			location: this.locationControl,
			layer: this.layerControl
		};

		for (let controlName in controlNameMap) {
			if (controlNameMap[controlName] === control) {
				if (!this.controlSettings.hasOwnProperty(controlName) || this.controlSettings[controlName]) return true;
				return false;
			}
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

		featureTypes.slice(0,1).forEach(type => {
			drawOptions.draw[type] = {shapeOptions: this._getStyleForType(type, {color: INCOMPLETE_COLOR, opacity: 0.8})};
		});

		featureTypes.forEach(type => {
			if (this.controlSettings[type] === false) drawOptions.draw[type] = false;
		});

		const that = this;
		const LocationControl = L.Control.extend({
			options: {
				position: "topleft"
			},

			onAdd: function(map) {
				const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-geocontrol");
				this._createSearch(container);
				this._createLocate(container);
				return container;
			},

			_createItem: function(container, glyphName) {
				const elem = L.DomUtil.create("a", "", container);
				//elem.href = "#";
				const glyph = L.DomUtil.create("span", "glyphicon glyphicon-" + glyphName, elem);
				L.DomEvent.on(elem, "click", L.DomEvent.stopPropagation);
				L.DomEvent.on(elem, "mousedown", L.DomEvent.stopPropagation);
				L.DomEvent.on(elem, "click", L.DomEvent.preventDefault);
				L.DomEvent.on(elem, "click", this._refocusOnMap, this);
				return elem;
			},

			_createSearch: function(container) {
				this._searchElem = this._createItem(container, "search");
				this._searchElem.title = that.translations.Search;
				L.DomEvent.on(this._searchElem, "click", this._onSearch, this);
				return this._searchElem;
			},

			_createLocate: function(container) {
				const locateElem = this._createItem(container, "screenshot");
				locateElem.title = that.translations.Geolocate;
				L.DomEvent.on(locateElem, "click", that._onLocate);
				return locateElem;
			},

			_onSearch: function() {
				console.log("search");
			}
		});

		this._addControl(this._getLayerControl());

		this.locationControl = new LocationControl();
		this._addControl(this.locationControl);

		this.drawControl = new L.Control.Draw(drawOptions);
		this._addControl(this.drawControl);

		this._addControl(this._getZoomControl());

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

				if (this._controlIsAllowed(this.drawControl) && this.controlSettings[featureType] !== false) this.map.contextmenu.addItem({
					text: text,
					iconCls: "context-menu-draw context-menu-draw-" + featureType,
					callback: () => this.drawControl._toolbars.draw._modes[featureType].handler.enable()
				});
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
		return {...dataItem, featureCollection};
	}

	initializeDataItem = (idx) => {
		const layer = L.geoJson(this.data[idx].featureCollection, this.geoJsonLayerOptions);
		this.dataLayerGroups.push(layer);
		layer.addTo(this.map);
		this.redrawDataItem(idx)
	}

	setData = (data) => {
		this.data = data ? (Array.isArray(data) ? data : [data]) : [];

		if (this.dataLayerGroups) {
			this.dataLayerGroups.forEach(layer => this.map.removeLayer(layer));
		}
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
		const featureCollection = {type: "featureCollection"};
		featureCollection.features = data.featureCollection.features.slice(0);
		this.drawData = (data) ? {...data, featureCollection} : [];
		this.drawLayerGroup.clearLayers();
		this.drawLayerGroup.addData(this.drawData.featureCollection);
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

	redrawDrawData = () => {
		for (let id in this.idsToIdxs) {
			this._initializeDrawLayer(this._getDrawLayerById(id), this.idsToIdxs[id]);
		}
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
		return this.drawLayerGroup ? this.drawLayerGroup._layers[id] : undefined;
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

		let changeActive = false;
		let newActiveId = undefined;
		if (features && Object.keys(this.idsToIdxs).filter(id => !deleteIds.includes(id)).length === 0) {
			changeActive = true;
		} else if (this.activeId !== undefined && deleteIds.includes(this.activeId)) {
			changeActive = true;

			let closestSmallerId = undefined;
			let closestGreaterId = undefined;
			let closestDistance = undefined;
			let closestNegDistance = undefined;

			Object.keys(this.idsToIdxs).forEach(id => {
				const dist = activeIdx - this.idsToIdxs[id];
				if (dist > 0 && (closestDistance === undefined || dist < closestDistance)) {
					closestDistance = dist;
					closestSmallerId = id;
				} else if (dist < 0 && (closestDistance === undefined || dist > closestNegDistance)) {
					closestNegDistance = dist;
					closestGreaterId = id;
				}
			});

			if (closestSmallerId !== undefined) newActiveId = closestSmallerId;
			else if (closestGreaterId !== undefined) newActiveId = closestGreaterId;
		} else  {
			newActiveId = this.activeId;
			changeActive = true;
		}

		this.drawData.featureCollection.features = features.filter((item, i) => !deleteIdxs.includes(i));

		deleteIds.forEach(id => {
			this.drawLayerGroup.removeLayer(id);
		});
		this._resetIds();

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
		this._getDrawLayerById(this.editId).editing.enable();
		this._getDrawLayerById(id).closePopup();
	}

	_clearEditable = () => {
		if (this.editId === undefined) return;
		this._getDrawLayerById(this.editId).editing.disable();
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
		if (this.drawData.getFeatureStyle) {
			return this.drawData.getFeatureStyle({
				featureIdx: idx,
				feature: this.drawData.featureCollection.features[idx]});
		}

		const styles = {
			weight: type.toLowerCase().includes("line") ? 8 : 14,
			opacity: 1,
			fillOpacity: 0.4,
			color: NORMAL_COLOR
		};

		if (overrideStyles) for (let style in overrideStyles) {
			styles[style] = overrideStyles[style];
		}

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
			style.color = (id === this.activeId) ? ACTIVE_COLOR : NORMAL_COLOR;
			const idx = this.idsToIdxs[id];
			if (this.drawData.getFeatureStyle) {
				style = this.drawData.getFeatureStyle({
					featureIdx: idx,
					feature: this.drawData.featureCollection.features[idx]});
			}
		} else {
			const style =  {};
			if (this.activeId === id) style.color = ACTIVE_COLOR;
			layer.setStyle(this._getStyleForLayer(layer, style, id));
		}

		this.updateLayerStyle(layer, style);
	}

	_updateDataLayerGroupStyle = (idx) => {
		const dataItem = this.data[idx];
		if (!dataItem) return;

		const defaultStyle = {color: DATA_LAYER_COLOR, fillColor: DATA_LAYER_COLOR, opacity: 1, fillOpacity: 0.7};

		let i = 0;
		this.dataLayerGroups[idx].eachLayer(layer => {
			this.updateLayerStyle(layer, dataItem.getFeatureStyle ?
				dataItem.getFeatureStyle({dataIdx: idx, featureIdx: i}) :
				defaultStyle);
			i++;
		});
	}
}
