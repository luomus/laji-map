import L, { map, Control, FeatureGroup, geoJson, Path } from "leaflet";
import draw from "leaflet-draw";
import "proj4leaflet";
import "./lib/Leaflet.MML-layers/mmlLayers.js";
import "leaflet-contextmenu";
import "Leaflet.vector-markers";

const NORMAL_COLOR = "#257ECA";
const ACTIVE_COLOR = "#06840A";
const INCOMPLETE_COLOR = "#36B43A";
const USER_LOCATION_COLOR = "#FF0000";

import translations from "./translations.js";

import boundsOfFinland from "./finland_bounds.json";

const finlandPolygon = geoJson(boundsOfFinland);

export default class LajiMap {
	constructor(props) {
		this.tileLayerName = "taustakartta";
		this.lang = "en";
		this.locate = false;
		this.zoom = 4;
		this.data = [];
		this.drawnItems = geoJson([], {
			pointToLayer: (featureData, latlng) => {
				let layer;
				if (featureData.geometry.type === "Point") {
					layer = (featureData.geometry.radius) ?
						new L.circle(latlng, featureData.geometry.radius) :
						new L.marker(latlng, {icon: this.createIcon()});
				} else {
					layer = L.GeoJSON.geometryToLayer(featureData);
				}
				return layer;
			}
		});
		this.activeIdx = 0;

		["rootElem", "locate", "latlng","zoom", "lang",
		 "onChange", "tileLayerName", "data", "activeIdx", "getPopup"].forEach(prop => {
			if (props.hasOwnProperty(prop)) this[prop] = props[prop];
		});

		this.constructDictionary();
		this.initializeMap();
		this.setLang(this.lang);
		this.setData(this.data);
		this.activeId = (this.activeIdx !== undefined) ? this.idxsToIds[this.activeIdx] : undefined;
		this.setActive(this.activeId);
		this.map.addLayer(this.drawnItems);
		this.initalizeMapControls();
		this.initializeMapEvents();
	}

	initializeMap() {
		L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

		this.foreignCRS = L.CRS.EPSG3857;
		this.mmlCRS = L.TileLayer.MML.get3067Proj();

		this.map = map(this.rootElem, {
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
				this.map.addControl(this.layerControl);
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
			this.latlng || [60.1718699, 24.9419917],
			this.zoom || 10
		);
	}

	initializeMapEvents() {
		this.map.addEventListener({
			click: e => { if (!this.interceptClick()) this.onAdd(new L.marker(e.latlng));},
			"draw:created": ({ layer }) => this.onAdd(layer),
			"draw:drawstart": () => { this.drawing = true },
			"draw:drawstop": () => { this.drawing = false },
			locationfound: this.onLocationFound,
			locationerror: this.onLocationNotFound,
			moveend: this.onMapMoveEnd,
			"contextmenu.hide": () => { this.contextMenuHideTimestamp = Date.now() },
			popupopen: popup => {
				if (this.layerClicked) {
					this.getLayerById(this.activeId).closePopup();
					this.layerClicked = false;
				}
			}
		});
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
				featureGroup: this.drawnItems,
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

		this.map.addControl(this.getLayerControl());

		this.locationControl = new LocationControl();
		this.map.addControl(this.locationControl);

		this.drawControl = new Control.Draw(drawOptions);
		this.map.addControl(this.drawControl);

		this.map.addControl(this.getZoomControl());
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

				this.map.contextmenu.addItem({
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
				this.map.addControl(control);
			});

			if (this.zoomControl) {
				this.map.removeControl(this.zoomControl);
				this.map.addControl(this.getZoomControl());
			}

			if (this.layerControl) {
				this.map.removeControl(this.layerControl);
				this.map.addControl(this.getLayerControl());
			}

			if (this.idsToIdxs) for (let id in this.idsToIdxs) {
				this.updateContextMenuFor(id);
			}
		}
	}

	setData(data) {
		this.data = (data && Array.isArray(data)) ? data.slice(0) : [];
		this.drawnItems.clearLayers();
		this.drawnItems.addData(this.data);
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
		if (prevActiveId !== undefined) this.updateLayerStyle(prevActiveId);
		this.updateLayerStyle(id);
	}

	resetIds() {
		// Maps item indices to internal ids and the other way around.
		// We use leaflet ids as internal ids.
		this.idxsToIds = {};
		this.idsToIdxs = {};

		let counter = 0;
		this.drawnItems.eachLayer(layer => {
			const id = layer._leaflet_id;
			this.idxsToIds[counter] = id;
			this.idsToIdxs[id] = counter;
			counter++;
		});
	}

	redrawFeatures() {
		for (let id in this.idsToIdxs) {
				this.initializeLayer(this.getLayerById(id), this.idsToIdxs[id]);
		}
	}

	initializeLayer(layer, idx) {
		this.drawnItems.addLayer(layer);

		const id = layer._leaflet_id;
		this.idxsToIds[idx] = id;
		this.idsToIdxs[id] = idx;

		this.updateLayerStyle(id);

		this.updateContextMenuFor(id);


		layer.on("click", (e) => {
			this.layerClicked = true;
			if (!this.interceptClick()) this.onActiveChange(id);
		});
		layer.on("dblclick", () => this.setEditable(id));

		layer.on("mouseover", () => {
			layer._mouseover = true;
			if (this.getPopup && this.editId !== layer._leaflet_id) {
				// Allow either returning content or firing a callback with content.
				const content = this.getPopup(idx, callbackContent => {
					layer.bindPopup(callbackContent).openPopup();
				});
				if (content) layer.bindPopup(content).openPopup();
			}
		});
		layer.on("mouseout", () => { layer.closePopup(); layer._mouseover = false });

		return layer.toGeoJSON();
	}

	updateContextMenuFor(id) {
		const layer = this.getLayerById(id);
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

	getLayerById(id) {
		return this.drawnItems ? this.drawnItems._layers[id] : undefined;
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

		const newItem = this.enchanceGeoJSON(this.initializeLayer(layer, this.data.length), layer);
		this.data.push(newItem);

		const event = [
			{
				type: "create",
				data: newItem
			},
			this.getOnActiveChangeEvent(this.idxsToIds[this.data.length - 1])
		];

		this.triggerEvent(event);
	};

	onEdit(data) {
		const eventData = {};
		for (let id in data) {
			const geoJson = this.enchanceGeoJSON(data[id].toGeoJSON(), data[id]);
			eventData[this.idsToIdxs[id]] = geoJson;
			this.data[this.idsToIdxs[id]] = geoJson;
		}

		this.triggerEvent({
			type: "edit",
			data: eventData
		});
	}

	onDelete(deleteIds) {
		this.clearEditable();

		if (!Array.isArray(deleteIds)) deleteIds = [deleteIds];

		const deleteIdxs = deleteIds.map(id => this.idsToIdxs[id]);

		const activeIdx = this.idsToIdxs[this.activeId];

		let changeActive = false;
		let newActiveId = undefined;
		if (this.data && Object.keys(this.idsToIdxs).filter(id => !deleteIds.includes(id)).length === 0) {
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

		const data = this.data.filter((item, i) => !deleteIdxs.includes(i));
		this.data = data;

		deleteIds.forEach(id => {
			this.drawnItems.removeLayer(id);
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

		let layer = this.getLayerById(id);
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
		this.getLayerById(this.editId).editing.enable();
	}

	clearEditable() {
		if (this.editId === undefined) return;
		this.getLayerById(this.editId).editing.disable();
		this.editId = undefined;
	}

	commitEdit() {
		this.onEdit({[this.editId]: this.getLayerById(this.editId)});
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

	getStyleForType(type, overrideStyles) {
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

	getStyleForLayer(layer, overrideStyles) {
		return this.getStyleForType(layer.toGeoJSON().geometry.type, overrideStyles);
	}

	updateLayerStyle(id) {
		const layer = this.getLayerById(id);

		if (!layer) return;

		if (layer instanceof L.Marker) {
			layer.options.icon.options.markerColor = (this.activeId === id) ? ACTIVE_COLOR : NORMAL_COLOR;
			if (layer._icon) {
				// Color must also be changed directly through DOM manipulation.
				layer._icon.firstChild.firstChild.style.fill = (id === this.activeId) ? ACTIVE_COLOR : NORMAL_COLOR;
			}
		} else {
			const style =  {};
			if (this.activeId === id) style.color = ACTIVE_COLOR;
			layer.setStyle(this.getStyleForLayer(layer, style));
		}
	}

}
