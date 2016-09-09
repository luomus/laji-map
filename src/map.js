import "leaflet";
import "leaflet-draw";
import "proj4leaflet";
import "./lib/Leaflet.MML-layers/mmlLayers.js";
import "leaflet-contextmenu";
import "Leaflet.vector-markers";

const NORMAL_COLOR = "#257ECA";
const ACTIVE_COLOR = "#06840A";
const INCOMPLETE_COLOR = "#36B43A";
const DATA_LAYER_COLOR = "#AAAAAA";
const USER_LOCATION_COLOR = "#FF0000";

import translations from "./translations.js";

import boundsOfFinland from "./finland_bounds.json";

const finlandPolygon = L.geoJson(boundsOfFinland);

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
			draw: true,
			layer: true,
			zoom: true,
			location: true
		};

		["rootElem", "locate", "center", "zoom", "lang", "onChange",
		 "tileLayerName", "drawData", "data", "activeIdx", "getPopup",
		 "onInitializeDrawLayer", "controlSettings"].forEach(prop => {
			if (props.hasOwnProperty(prop)) this[prop] = props[prop];
		});


		this.geoJsonLayerOptions = {
			pointToLayer: (feature, latlng) => {
				let layer;
				if (feature.geometry.type === "Point") {
					layer = (feature.geometry.radius) ?
						new L.circle(latlng, feature.geometry.radius) :
						new L.marker(latlng, {icon: this.createIcon()});
				} else {
					layer = L.GeoJSON.geometryToLayer(feature);
				}
				return layer;
			}
		}

		this.constructDictionary();
		this.initializeMap();
		this.setLang(this.lang);
		this.setData(this.data);
		this.setDrawData(this.drawData);
		this.activeId = (this.activeIdx !== undefined) ? this.idxsToIds[this.activeIdx] : undefined;
		this.setActive(this.activeId);
		this.map.addLayer(this.drawLayerGroup);
		this.initalizeMapControls();
		this.initializeMapEvents();
	}

	initializeMap() {
		L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

		this.foreignCRS = L.CRS.EPSG3857;
		this.mmlCRS = L.TileLayer.MML.get3067Proj();

		this.map = L.map(this.rootElem, {
			crs: L.TileLayer.MML.get3067Proj(),
			contextmenu: true,
			contextmenuItems: [],
			zoomControl: false
		});

		["taustakartta", "maastokartta"].forEach(tileLayerName => {
			this[tileLayerName] = L.tileLayer.mml_wmts({
				layer: tileLayerName
			});
		});

		this.foreignTileLayer = L.tileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');

		this.switchTileLayer(this[this.tileLayerName]);

		this.userLocationLayer = new L.LayerGroup().addTo(this.map);

		this.drawLayerGroup = L.geoJson([], this.geoJsonLayerOptions);

		this.initializeView();

		if (this.locate) {
			this.initializeViewAfterLocateFail = true;
			this.onLocate();
		} else {
			this.initializeView();
		}
	}

	switchTileLayer(layer) {
		if (this.tileLayer) {
			if ([this.maastokartta, this.taustakartta].includes(layer)) {
				this.interceptMapMoveEnd = true;
				this.map.setView(this.map.getCenter(), 4, {animate: false});
				this.addControl(this.layerControl);
			} else {
				this.interceptMapMoveEnd = true;
				this.map.setView(this.map.getCenter(), 6, {animate: false});
				this.map.removeControl(this.layerControl);
			}

			this.map.removeLayer(this.tileLayer);
			const center = this.map.getCenter();
			this.map.options.crs = (layer === this.foreignTileLayer) ? this.foreignCRS : this.mmlCRS;

			this.interceptMapMoveEnd = true;
			this.map.setView(center); // Fix shifted center.

			this.interceptMapMoveEnd = true;
			this.map._resetView(this.map.getCenter(), this.map.getZoom(), true); // Redraw all layers according to new projection.

			this.tileLayer = layer;
			this.map.addLayer(this.tileLayer);
		} else {
			this.tileLayer = layer;
			this.map.addLayer(this.tileLayer);
		}
	}

	initializeView = () => {
		this.map.setView(
			this.center || [60.1718699, 24.9419917],
			this.zoom || 10
		);
	}

	initializeMapEvents() {
		this.map.addEventListener({
			dblclick: e => { if (this.controlSettings.draw) this.onAdd(new L.marker(e.latlng));},
			"draw:created": ({ layer }) => this.onAdd(layer),
			"draw:drawstart": () => { this.drawing = true },
			"draw:drawstop": () => { this.drawing = false },
			locationfound: this.onLocationFound,
			locationerror: this.onLocationNotFound,
			moveend: this.onMapMoveEnd,
			"contextmenu.hide": () => { this.contextMenuHideTimestamp = Date.now() },
			popupopen: popup => {
				if (this.layerClicked) {
					this.getDrawLayerById(this.activeId).closePopup();
					this.layerClicked = false;
				}
			}
		});
	}

	controlIsAllowed(control) {
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

	addControl(control) {
		if (this.controlIsAllowed(control)) this.map.addControl(control);
	}

	initalizeMapControls() {
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

		["polyline", "polygon", "rectangle", "circle"].forEach(type => {
			drawOptions.draw[type] = {shapeOptions: this.getStyleForType(type, {color: INCOMPLETE_COLOR, opacity: 0.8})};
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
				elem.href = "#";
				const glyph = L.DomUtil.create("span", "glyphicon glyphicon-" + glyphName, elem)
				L.DomEvent.on(elem, "click", L.DomEvent.stopPropagation);
				L.DomEvent.on(elem, "mousedown", L.DomEvent.stopPropagation);
				L.DomEvent.on(elem, "click", L.DomEvent.preventDefault);
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
				L.DomEvent.on(locateElem, "click", that.onLocate);
				return locateElem;
			},

			_onSearch: function() {
				console.log("search");
			}
		});

		this.addControl(this.getLayerControl());

		this.locationControl = new LocationControl();
		this.addControl(this.locationControl);

		this.drawControl = new L.Control.Draw(drawOptions);
		this.addControl(this.drawControl);

		this.addControl(this.getZoomControl());
	}

	getZoomControl() {
		this.zoomControl = L.control.zoom({
			zoomInTitle: this.translations.ZoomIn,
			zoomOutTitle: this.translations.ZoomOut
		});
		return this.zoomControl;
	}

	getLayerControl() {
		const baseMaps = {};
		const { translations } = this;
		["taustakartta", "maastokartta"].forEach(tileLayerName => {
			baseMaps[translations[tileLayerName]] = this[tileLayerName];
		});

		this.layerControl = L.control.layers(baseMaps, {}, {position: "bottomleft"});
		return this.layerControl;
	}

	destroy() {
		this.map.off();
		this.map = null;
	}


	coordinatesAreInFinland(latLng) {
		return finlandPolygon.getBounds().contains(latLng);
	}

	onMapMoveEnd = () => {
		if (this.interceptMapMoveEnd) {
			this.interceptMapMoveEnd = false;
			return;
		}
		const latLng = this.map.getCenter();

		if ([this.maastokartta, this.taustakartta].includes(this.tileLayer) &&
			!this.coordinatesAreInFinland(latLng)) {
			this.switchTileLayer(this.foreignTileLayer);
		} else if (this.tileLayer === this.foreignTileLayer && this.coordinatesAreInFinland(latLng)) {
			this.switchTileLayer(this[this.tileLayerName]);
		}
	}

	constructDictionary() {
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

	setLang(lang) {
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

				if (this.controlIsAllowed(this.drawControl)) this.map.contextmenu.addItem({
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
			drawLocalizations.handlers.marker.tooltip.start = join("Click", "mapPartitive", "toPlaceMarker");

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
				this.addControl(control);
			});

			if (this.zoomControl) {
				this.map.removeControl(this.zoomControl);
				this.addControl(this.getZoomControl());
			}

			if (this.layerControl) {
				this.map.removeControl(this.layerControl);
				this.addControl(this.getLayerControl());
			}

			if (this.idsToIdxs) for (let id in this.idsToIdxs) {
				this.updateContextMenuForDrawItem(id);
			}
		}
	}

	setData(data) {
		this.data = (data) ? data.map(item => {
			let featureCollection = {type: "featureCollection"};
			featureCollection.features = item.featureCollection.features.slice(0);
			return {...item, featureCollection};
		}) : [];
		if (this.dataLayerGroups) {
			this.dataLayerGroups.forEach(layer => this.map.removeLayer(layer));
		}
		this.dataLayerGroups = [];
		this.data.forEach(dataItem => {
			const layer = L.geoJson(dataItem.featureCollection, this.geoJsonLayerOptions);
			this.dataLayerGroups.push(layer);
			layer.addTo(this.map);
		});
		this.redrawFeatures();
	}

	setDrawData(data) {
		const featureCollection = {type: "featureCollection"};
		featureCollection.features = data.featureCollection.features.slice(0);
		this.drawData = (data) ? {...data, featureCollection} : [];
		this.drawLayerGroup.clearLayers();
		this.drawLayerGroup.addData(this.drawData.featureCollection);
		this.resetIds();
		this.redrawFeatures();
	}

	createIcon() {
		return L.VectorMarkers.icon({
			prefix: "glyphicon",
			icon: "record",
			markerColor: NORMAL_COLOR
		});
	}

	setActive(id) {
		const prevActiveId = this.activeId;
		this.activeId = id;
		this.updateDrawLayerStyle(prevActiveId);
		this.updateDrawLayerStyle(id);
	}

	resetIds() {
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

	redrawFeatures() {
		for (let id in this.idsToIdxs) {
				this.initializeDrawLayer(this.getDrawLayerById(id), this.idsToIdxs[id]);
		}

		this.data.forEach((dataItem, idx) => {
			this.updateDataLayerGroupStyle(idx);
		})
	}

	initializeDrawLayer(layer, idx) {
		this.drawLayerGroup.addLayer(layer);

		const id = layer._leaflet_id;
		this.idxsToIds[idx] = id;
		this.idsToIdxs[id] = idx;

		this.updateDrawLayerStyle(id);

		this.updateContextMenuForDrawItem(id);


		layer.on("click", (e) => {
			this.layerClicked = true;
			if (!this.interceptClick()) this.onActiveChange(id);
		});
		layer.on("dblclick", () => this.setEditable(id));

		function openPopup(content) {
			if (content === undefined || content === null) return;
			layer.bindPopup(content).openPopup();
		}

		layer.on("mouseover", () => {
			layer._mouseover = true;
			if (this.getPopup && this.editId !== layer._leaflet_id) {
				// Allow either returning content or firing a callback with content.
				const content = this.getPopup(idx, callbackContent => openPopup(callbackContent));
				if (content) openPopup(content);
			}
		});
		layer.on("mouseout", () => { layer.closePopup(); layer._mouseover = false });

		if (this.onInitializeDrawLayer) this.onInitializeDrawLayer(idx, layer);

		return layer.toGeoJSON();
	}

	updateContextMenuForDrawItem(id) {
		const layer = this.getDrawLayerById(id);
		const { translations } = this;
		layer.unbindContextMenu();
		layer.bindContextMenu({
			contextmenuInheritItems: false,
			contextmenuItems: [{
				text: translations ? translations.Edit + " " + translations.featurePartitive : "",
				callback: () => this.setEditable(id)
			}, {
				text: translations ? translations.Delete + " " + translations.feature : "",
				callback: () => this.onDelete(id)
			}]
		});
	}

	onLocate = () => {
		this.map.locate();
	}

	onLocationFound = ({latlng, accuracy, bounds}) => {
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

		this.userLocationMarker.on("click", () => { if (!this.interceptClick()) this.map.fitBounds(this.userLocationRadiusMarker.getBounds()) });
	}

	onLocationNotFound = () => {
		alert(this.translations.geolocationFailed);
		if (this.initializeViewAfterLocateFail) this.initializeView();
	}

	getDrawLayerById(id) {
		return this.drawLayerGroup ? this.drawLayerGroup._layers[id] : undefined;
	}

	triggerEvent(e) {
		if (!Array.isArray(e)) e = [e];
		if (this.onChange) this.onChange(e);
	}

	enchanceGeoJSON(geoJSON, layer) {
		// GeoJSON circles doesn't have radius, so we extend GeoJSON.
		if (layer instanceof L.Circle) {
			geoJSON.geometry.radius = layer.getRadius();
		}
		return geoJSON;
	}

	onAdd(layer) {
		if (layer instanceof L.Marker) layer.setIcon(this.createIcon());

		const {featureCollection: {features}} = this.drawData;

		const newFeature = this.enchanceGeoJSON(this.initializeDrawLayer(layer, features.length), layer);
		features.push(newFeature);

		const event = [
			{
				type: "create",
				feature: newFeature
			},
			this.getOnActiveChangeEvent(this.idxsToIds[features.length - 1])
		];

		this.triggerEvent(event);
	};

	onEdit(data) {
		const eventData = {};
		for (let id in data) {
			const geoJson = this.enchanceGeoJSON(data[id].toGeoJSON(), data[id]);
			eventData[this.idsToIdxs[id]] = geoJson;
			this.drawData.featureCollection.features[this.idsToIdxs[id]] = geoJson;
		}

		this.triggerEvent({
			type: "edit",
			features: eventData
		});
	}

	onDelete(deleteIds) {
		this.clearEditable();

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
		this.resetIds();

		const event = [{
			type: "delete",
			idxs: deleteIdxs
		}];

		if (changeActive) event.push(this.getOnActiveChangeEvent(newActiveId));

		this.triggerEvent(event);
	}

	getOnActiveChangeEvent(id) {
		this.setActive(id);
		return {
			type: "active",
			idx: this.idsToIdxs[id]
		}
	}

	onActiveChange(id) {
		this.triggerEvent(this.getOnActiveChangeEvent(id));
	}

	focusToLayer(idx) {
		const id = this.idxsToIds[idx];

		if (idx === undefined) {
			this.activeId = this.idxsToIds[idx];
			return;
		}

		let layer = this.getDrawLayerById(id);
		if (!layer) return;

		if (layer instanceof L.Marker) {
			this.map.setView(layer.getLatLng());
		} else	{
			this.map.fitBounds(layer.getBounds());
		}

		this.onActiveChange(id);
	}

	setEditable(id) {
		this.clearEditable();
		this.editId = id;
		this.getDrawLayerById(this.editId).editing.enable();
	}

	clearEditable() {
		if (this.editId === undefined) return;
		this.getDrawLayerById(this.editId).editing.disable();
		this.editId = undefined;
	}

	commitEdit() {
		this.onEdit({[this.editId]: this.getDrawLayerById(this.editId)});
		this.clearEditable();
	}

	interceptClick() {
		if (this.contextMenuHideTimestamp !== undefined) {
			const timestamp = this.contextMenuHideTimestamp;
			this.contextMenuHideTimestamp = undefined;
			if (Date.now() - timestamp < 200) return true;
		}

		if (this.drawing) return true;
		if (this.editId !== undefined) {
			this.commitEdit();
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
			}
		} else {
			layer.setStyle(style);
		}
	}

	getStyleForType(type, overrideStyles, id) {
		const idx = this.idsToIdxs[id];
		if (this.drawData.getFeatureStyle) return this.drawData.getFeatureStyle({featureIdx: idx, feature: this.drawData.featureCollection.features[idx]});

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

	getStyleForLayer(layer, overrideStyles, id) {
		return this.getStyleForType(layer.toGeoJSON().geometry.type, overrideStyles, id);
	}

	updateDrawLayerStyle(id) {
		if (id === undefined) return;
		const layer = this.getDrawLayerById(id);

		if (!layer) return;

		let style = {};
		if (layer instanceof L.Marker) {
			style.color = (id === this.activeId) ? ACTIVE_COLOR : NORMAL_COLOR;
			const idx = this.idsToIdxs[id];
			if (this.drawData.getFeatureStyle) style = this.drawData.getFeatureStyle({featureIdx: idx, feature: this.drawData.featureCollection.features[idx]});
		} else {
			const style =  {};
			if (this.activeId === id) style.color = ACTIVE_COLOR;
			layer.setStyle(this.getStyleForLayer(layer, style, id));
		}

		this.updateLayerStyle(layer, style);
	}

	updateDataLayerGroupStyle(idx) {
		const dataItem = this.data[idx];
		if (!dataItem) return;

		const defaultStyle = {color: DATA_LAYER_COLOR, fillColor: DATA_LAYER_COLOR, opacity: 1, fillOpacity: 0.7};

		let i = 0;
		this.dataLayerGroups[idx].eachLayer(layer => {
			this.updateLayerStyle(layer, dataItem.getFeatureStyle ?
				dataItem.getFeatureStyle({dataIdx: idx, featureIdx: i, feature: dataItem.featureCollection.features[i]}) :
				defaultStyle);
			i++;
		});
	}
}
