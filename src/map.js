import React, { Component } from "react";
import L, { map, Control, FeatureGroup, geoJson, Path } from "leaflet";
import draw from "leaflet-draw";
import "proj4leaflet";
import "./lib/Leaflet.MML-layers/mmlLayers.js";
import "leaflet-contextmenu";
import "Leaflet.vector-markers";

const NORMAL_COLOR = "#257ECA";
const ACTIVE_COLOR = "#06840A";
const INCOMPLETE_COLOR = "#55AEFA";

import translations from "./translations.js";

export default class LajiMap {
	constructor(props) {
		["rootElem", "locate", "latitude", "longitude", "zoom", "onChange"].forEach(prop => {
			this[prop] = props[prop];
		});

		this.constructDictionary();
		this.initializeMap();
		this.setLang(props.lang);
		this.setData(props.data);
		this.activeId = (props.activeIdx !== undefined) ? this.idxsToIds[props.activeIdx] : undefined;
		this.setActive(this.activeId);
		this.map.addLayer(this.drawnItems);
		this.initalizeMapControls();
		this.initializeMapEvents();
	}

	initializeMap() {
		L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

		this.map = map(this.rootElem, {
			crs: L.TileLayer.MML.get3067Proj(),
			contextmenu: true,
			contextmenuItems: [],
			zoomControl: false
		});

		this.map.addLayer(L.tileLayer.mml_wmts({
			layer: "maastokartta"
		}));

		if (this.locate) {
			this.onLocate(this.initializeView);
		} else {
			this.initializeView();
		}
	}

	initializeView = () => {
		this.map.setView([
			this.longitude || 60.1718699,
			this.latitude || 24.9419917
		], this.zoom || 10);
	}

	initializeMapEvents() {
		this.map.on("click", () => {
			this.interceptClick();
		});
		this.map.on("dblclick", (e) => {
			this.onAdd(new L.marker(e.latlng));
		});
		this.map.on("draw:created", ({ layer }) => this.onAdd(layer));
	}

	initalizeMapControls() {
		const drawOptions = {
			position: "topright",
			draw: {
				circle: false,
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

		["polyline", "polygon", "rectangle"].forEach(type => {
			drawOptions.draw[type] = {shapeOptions: this.getStyleForType(type, {color: INCOMPLETE_COLOR, opacity: 0.8})};
		});

		this.drawControl = new Control.Draw(drawOptions);
		this.map.addControl(this.drawControl);

		this.zoomControl = new L.control.zoom();
		this.map.addControl(this.zoomControl);

		const that = this;
		const GeoControl = L.Control.extend({
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
				return L.DomUtil.create("span", "glyphicon glyphicon-" + glyphName, L.DomUtil.create("a", "", container))
			},

			_createSearch: function(container) {
				this._searchElem = this._createItem(container, "search");
				L.DomEvent.on(this._searchElem, "click", this._onSearch, this);
				return this._searchElem;
			},

			_createLocate: function(container) {
				const locateElem = this._createItem(container, "screenshot");
				L.DomEvent.on(locateElem, "click", that.onLocate);
				return locateElem;
			},

			_onSearch: function() {
				console.log("search");
			}
		});

		this.map.addControl(new GeoControl());
	}

	destroy() {
		this.map.off();
		this.map = null;
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

			// original strings are here: https://github.com/Leaflet/Leaflet.draw/blob/master/src/Leaflet.draw.js
			["polyline", "polygon", "rectangle"].forEach(featureType => {
				drawLocalizations.toolbar.buttons[featureType] = join("Draw", featureType);
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

			if (this.drawControl) {
				this.map.removeControl(this.drawControl);
				this.map.addControl(this.drawControl);
			}

			if (this.zoomControl) {
				this.map.removeControl(this.zoomControl);
				this.zoomControl = new L.control.zoom({
					zoomInTitle: translations.ZoomIn,
					zoomOutTitle: translations.ZoomOut
				});
				this.map.addControl(this.zoomControl);
			}

			if (this.idsToIdxs) for (let id in this.idsToIdxs) {
				this.updateContextMenuFor(id);
			}
		}
	}

	setData(data) {
		this.data = data.slice(0);
		this.drawnItems = geoJson(this.data, {
			pointToLayer: (featureData, latlng) => {
				let layer;
				if (featureData.geometry.type === "Point") {
					layer = new L.marker(latlng, {icon: this.createIcon()});
				} else {
					layer = L.GeoJSON.geometryToLayer(featureData);
				}
				return layer;
			}
		});
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

		layer.on("click", () => {
			if (!this.interceptClick()) this.onActiveChange(id);
		});
		layer.on("dblclick", () => this.setEditable(id));

		return layer.toGeoJSON();
	}

	updateContextMenuFor(id) {
		const layer = this.getLayerById(id);
		const { translations } = this;
		layer.unbindContextMenu();
		layer.bindContextMenu({
			contextmenuItems: [{
				text: translations ? translations.Edit + " " + translations.featurePartitive : "",
				callback: () => this.setEditable(id)
			}, {
				text: translations ? translations.Delete + " " + translations.feature : "",
				callback: () => this.onDelete(id)
			}]
		});
	}


	onLocate(onFail) {
		if (!navigator) return;

		navigator.geolocation.getCurrentPosition(
			({ coords }) => { // success
				this.map.setView([coords.latitude, coords.longitude], this.zoom || 7);
			},
			() => { // fail
				alert(this.translations.geolocationFailed);
				if (onFail) onFail();
		});
	}

	getLayerById(id) {
		return this.drawnItems._layers[id];
	}

	triggerEvent(e) {
		if (!Array.isArray(e)) e = [e];
		if (this.onChange) this.onChange(e);
	}

	onAdd(layer) {
		if (layer instanceof L.Marker) layer.setIcon(this.createIcon());

		const newItem = this.initializeLayer(layer, this.data.length);
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
			const geoJson = data[id].toGeoJSON();
			eventData[this.idsToIdxs[id]] = geoJson;
			this.data[id] = geoJson;
		}

		this.triggerEvent({
			type: "edit",
			data: eventData
		});
	}

	//TODO nää idx. Sit fix laji-form. Sit bugi tää: edit tilaan marker ja poista -> ????
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
