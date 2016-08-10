import React, { Component } from "react";
import deepEquals from "deeper";
import { MenuItem } from "react-bootstrap";

// These are imported at componentDidMount, so they won"t be imported on server side rendering.
let L;
let map, Control, FeatureGroup, geoJson, Path;
let draw;

const NORMAL_COLOR = "#257ECA";
const ACTIVE_COLOR = "#06840A";
const INCOMPLETE_COLOR = "#55AEFA";

import translations from "./translations.js";

const style = {
	map: {
		width: "100%",
		height: "100%"
	},
};

export default class MapComponent extends Component {
	static defaultProps = {
		lang: "en"
	}

	constructor(props) {
		super(props);
		this.map = null;
		this.data = undefined;
		this.activeId = undefined;
		this.dictionary = this.constructTranslations();
		this.state = {};
		this.updateFromProps(props);
	}

	componentWillReceiveProps(props) {
		this.updateFromProps(props)
	}

	componentWillUnmount() {
		this.map.off();
		this.map = null;
		this.mounted = false;
	}

	render() {
		const { translations } = this.state;
		let id = 0;
		if (this.drawnItems) this.drawnItems.eachLayer(layer => {
			let j = id;
			layer.unbindContextMenu();
			layer.bindContextMenu({
				contextmenuItems: [{
					text: translations ? translations.Edit + " " + translations.featurePartitive : "",
					callback: () => this.setEditable(j)
				}, {
					text: translations ? translations.Delete + " " + translations.feature : "",
					callback: () => this.onDelete(j)
				}]
			});
			id++;
		});
		return (
			<div style={ style.map }>
				<div ref="map" style={ style.map } />
			</div>
		);
	}

	updateFromProps(props) {
		this.prevData = this.data ? this.data.slice(0) : undefined;
		this.data = props.data.slice(0);
		this.prevActiveId = this.activeId;
		this.activeId = props.activeId;
		if (this.activateAfterUpdate !== undefined) {
			this.setActive(this.activateAfterUpdate);
			this.activateAfterUpdate = undefined;
		}
		if (this.mounted) this.updateTranslations(props);
		if (this.mounted) this.redrawFeatures();
		else this.shouldUpdateAfterMount = true;
	}

	constructTranslations = () => {
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
		return dictionaries;
	}

	updateTranslations = (props) => {

		if (!this.state.translations || this.lang !== props.lang) {
			this.lang = props.lang;
			const drawLocalizations = L.drawLocal.draw;
			this.setState({translations: this.dictionary[this.lang]}, () => {

				const { translations } = this.state;
				function join(...words) {
					return words.map(word => translations[word]).join(" ");
				}

				// original strings are here: https://github.com/Leaflet/Leaflet.draw/blob/master/src/Leaflet.draw.js
				["polyline", "polygon", "rectangle"].forEach(featureType => {
					drawLocalizations.toolbar.buttons[featureType] = join("Draw", featureType);
				})
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

				L.control.zoom.zoomInTitle = "MOI:";

				this.map.removeControl(this.drawControl);
				this.map.addControl(this.drawControl);

				this.map.removeControl(this.zoomControl);
				this.zoomControl = new L.control.zoom({
					zoomInTitle: translations.ZoomIn,
					zoomOutTitle: translations.ZoomOut
				});
				this.map.addControl(this.zoomControl);
			})
		}
	}

	redrawFeatures() {
		if (!this.mounted) throw "map wasn't mounted";

		const shouldResetLayers = (!this.prevData && this.data || this.prevData.length !== this.data.length ||
															 !deepEquals(this.prevData, this.data));

		let drawnItems = shouldResetLayers ? geoJson(this.data) : this.drawnItems;

		if (shouldResetLayers) this.drawnItems.clearLayers();

		this.idsToLeafletIds = {};
		this.leafletIdsToIds = {};

		let id = 0;
		drawnItems.eachLayer(layer => {
			this.idsToLeafletIds[id] = layer._leaflet_id;
			this.leafletIdsToIds[layer._leaflet_id] = id;

			if (shouldResetLayers) {
				let j = id;

				layer.on("click", () => {
					if (!this.interceptClick()) this.setActive(j);
				});
				layer.on("dblclick", () => this.setEditable(j));
			}

			if (shouldResetLayers) this.drawnItems.addLayer(layer);
			if (shouldResetLayers || this.prevActiveId !== this.activeId) this.updateLayerStyle(id);
			id++;
		});

	}

	componentDidMount() {
		this.mounted = true;

		L = require("leaflet");
		({ map, Control, FeatureGroup, geoJson, Path } = L);
		draw = require("leaflet-draw");
		require("proj4leaflet");
		require("./lib/Leaflet.MML-layers/mmlLayers.js");
		require("leaflet-contextmenu");
		require("Leaflet.vector-markers");

		L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

		this.map = map(this.refs.map, {
			crs: L.TileLayer.MML.get3067Proj(),
			contextmenu: true,
			contextmenuItems: [],
			zoomControl: false
		});

		if (this.props.locate) {
			this.onLocate();
		} else {
			this.map.setView([
				this.props.longitude || 60.1718699,
				this.props.latitude || 24.9419917
			], this.props.zoom || 10);
		}

		const tileLayer = L.tileLayer.mml_wmts({
			layer: "maastokartta"
		});

		this.map.addLayer(tileLayer);

		this.drawnItems = geoJson();
		this.map.addLayer(this.drawnItems);
		if (this.shouldUpdateAfterMount) {
			this.updateTranslations(this.props);
			this.redrawFeatures();
		}

		const drawOptions = {
			position: "topright",
			draw: {
				circle: false,
				marker: {
					icon: L.VectorMarkers.icon({
						prefix: "glyphicon",
						icon: "record",
						markerColor: INCOMPLETE_COLOR,
					}),
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

		this.map.on("click", () => {
			this.interceptClick();
		});
		this.map.on("dblclick", (e) => {
			this.onAdd(new L.marker(e.latlng));
		});
		this.map.on("draw:created", ({ layer }) => this.onAdd(layer));

		this.updateTranslations(this.props);
	}

	onLocate = () => {
		if (!navigator) return;

		navigator.geolocation.getCurrentPosition(
			// success
			({ coords }) => {
				this.map.setView([coords.latitude, coords.longitude], this.props.zoom || 7);
			},
			// fail
			() => {
				alert(this.state.translations.geolocationFailed)
			})
	}

	getLayerById = id => {
		return this.drawnItems._layers[this.idsToLeafletIds[id]];
	}

	onChange = change => {
		if (this.props.onChange) this.props.onChange(change);
	}

	onAdd = layer => {
		this.activateAfterUpdate = this.data.length;
		this.onChange({
			type: "create",
			data: layer.toGeoJSON()
		});
	};

	onEdit = data => {
		for (let id in data) {
			data[id] = data[id].toGeoJSON();
		}

		this.onChange({
			type: "edit",
			data: data
		});
	}

	onDelete = ids => {
		if (!Array.isArray(ids)) ids = [ids];
		if (this.data && this.data.filter((item, id) => !ids.includes(id)).length === 0) {
			this.setActive(undefined)
		} else if (this.activeId !== undefined && ids.includes(this.activeId)) {
			let newActiveId = undefined;
			if (this.activeId === 0 && ids.length != this.data.length) newActiveId = 0;
			else {
				newActiveId = this.activeId;
				let idxOfActive = ids.indexOf(this.activeId);
				for (let idx = idxOfActive; idx >= 0; idx--) {
					if (ids[idx] <= this.activeId) newActiveId--;
				}
				if (newActiveId === -1) newActiveId = 0;
			}
			this.setActive(newActiveId);

		} else if (this.activeId) {
			let newActiveId = this.activeId;
			ids.forEach(id => {
				if (id < newActiveId) newActiveId--;
			})
			if (newActiveId !== this.activeId) this.setActive(newActiveId);
		}

		this.onChange({
			type: "delete",
			ids: ids
		});
	}

	setActive = id => {
		this.onChange({
			type: "active",
			id: id
		});
	}

	focusToLayer = id => {
		if (id === undefined) {
			this.activeId = id;
			return;
		}

		let layer = this.getLayerById(id);
		if (!layer) return;

		if (layer instanceof L.Marker) {
			this.map.setView(layer.getLatLng());
		} else	{
			this.map.fitBounds(layer.getBounds());
		}

		this.setActive(id);
	}

	setEditable = id => {
		this.clearEditable();
		this.editId = id;
		this.getLayerById(this.editId).editing.enable();
	}

	clearEditable = () => {
		if (this.editId === undefined) return;
		this.getLayerById(this.editId).editing.disable();
		this.editId = undefined;
	}

	commitEdit = () => {
		this.onEdit({[this.editId]: this.getLayerById(this.editId)});
		this.clearEditable();
	}

	interceptClick = () => {
		if (this.editId !== undefined) {
			this.commitEdit();
			return true;
		}
	}

	getStyleForType = (type, overrideStyles) => {
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

	getStyleForId = id => {
		return this.getStyleForType(this.data[id].geometry.type,
			{color: this.activeId === id ? ACTIVE_COLOR : NORMAL_COLOR});
	}

	updateLayerStyle = id => {
		const layer = this.getLayerById(id);

		if (layer instanceof L.Marker) {
			layer.setIcon(
				L.VectorMarkers.icon({
					prefix: "glyphicon",
					icon: "record",
					markerColor: this.activeId === id ? ACTIVE_COLOR : NORMAL_COLOR
				})
			);
		} else {
			if (this.activeId === id) style.color = ACTIVE_COLOR;
			layer.setStyle(this.getStyleForId(id));
		}
	}

}
