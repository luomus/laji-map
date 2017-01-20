import {
	MAASTOKARTTA,
	TAUSTAKARTTA,
	OPEN_STREET,
	GOOGLE_SATELLITE,
	EPSG3067String,
	EPSG2393String
} from "./globals";

import { dependsOn, depsProvided, provide, reflect, isProvided } from "./map";

export default function controls(LajiMap) {
return class LajiMapWithControls extends LajiMap {

	constructor(props) {
		super(props);
		this._initControls();
	}

	_initControls() {
		this.controls = {
			layer: undefined,
			location: undefined,
			zoom: undefined,
			draw: undefined,
			coordinateInput: undefined,
			drawCopy: undefined,
			drawClear: undefined,
			coordinates: undefined,
			scale: undefined
		};

		provide(this, "controlsConstructed");
	}

	setOption(option, value) {
		super.setOption(option, value);
		if (option === "controlSettings") {
			this.setControlSettings(value);
		}
	}

	swapMap() {
		let otherMap = this.foreignMap;
		let nextMap = this.finnishMap;

		if (this.map === this.foreignMap) {
			otherMap = this.finnishMap;
			nextMap = this.foreignMap;
		}

		if (this.controls) Object.keys(this.controls).forEach(controlName => {
			const control = this.controls[controlName];
			if  (control) {
				otherMap.removeControl(control);
				nextMap.addControl(control);
			}
		});

		super.swapMap();
	}

	@dependsOn("controls")
	_setLang(lang) {
		if (!depsProvided(this, "setLang", arguments)) return;

		// original strings are here: https://github.com/Leaflet/Leaflet.draw/blob/master/src/Leaflet.draw.js
		const drawLocalizations = L.drawLocal.draw;

		const join = (...params) => this._joinTranslations(...params);

		drawLocalizations.toolbar.buttons.marker = join("Add", "marker");

		["polygon", "rectangle", "polyline", "circle"].forEach(featureType => {
			drawLocalizations.toolbar.buttons[featureType] = join("Draw", featureType);
		});

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

		provide(this, "translations");
	}

	setLang(lang) {
		super.setLang(lang);
		this._setLang(lang);
	}

	setOption(option, value)  {
		if (option === "controlSettings") this.setControlSettings(value);
		else super.setOption(option, value);
	}

	@reflect()
	@dependsOn("map", "translations", "controlSettings")
	_updateMapControls() {
		if (!depsProvided(this, "_updateMapControls", arguments)) return;

		Object.keys(this.controls).forEach(controlName => {
			const control = this.controls[controlName];
			if (control) this.map.removeControl(control);
		});

		this._addControl("layer", this._getLayerControl());
		this._addControl("location", this._getLocationControl());
		this._addControl("zoom", this._getZoomControl());

		this.controlItems = {
			coordinateInput: {
				name: "coordinateInput",
				text: this.translations.AddFeatureByCoordinates,
				iconCls: "laji-map-coordinate-input-glyph",
				callback: (...params) => this.openCoordinatesDialog(...params)
			},
			drawCopy: {
				name: "drawCopy",
				text: this.translations.CopyDrawnFeatures,
				iconCls: "glyphicon glyphicon-floppy-save",
				callback: (...params) => this.openDrawCopyDialog(...params)
			},
			drawClear: {
				name: "drawClear",
				text: this.translations.ClearMap,
				iconCls: "glyphicon glyphicon-trash",
				callback: (...params) => this.clearDrawData(...params)
			}
		};

		if (isProvided(this, "draw")) {
			this._addControl("draw", this._getDrawControl());
			this._addControl("coordinateInput", this._getCoordinateInputControl());
			this._addControl("drawCopy", this._getDrawCopyControl());
			this._addControl("drawClear", this._getDrawClearControl());
		}

		this._addControl("scale", L.control.scale({metric: true, imperial: false}));
		this._addControl("coordinates", this._getCoordinatesControl());

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
		this.getFeatureTypes().forEach(featureType => {
			removeHref(`leaflet-draw-draw-${featureType}`);
		});
		removeHref("leaflet-control-layers-toggle");
		removeHref("leaflet-contextmenu-item");

		provide(this, "controls");
	}

	@reflect()
	@dependsOn("draw")
	_updateDrawControls() {
		this._updateMapControls();
	}

	@dependsOn("controlsConstructed")
	setControlSettings(controlSettings) {
		if (!depsProvided(this, "setControlSettings", arguments)) return;

		this.controlSettings = {
			draw: {marker: true, circle: true, rectangle: true, polygon: true, polyline: true},
			layer: true,
			zoom: true,
			location: {
				userLocation: true,
				search: true
			},
			coordinateInput: true,
			drawCopy: false,
			drawClear: false,
			coordinates: false,
			scale: true
		};

		for (let setting in controlSettings) {
			if (!this.controlSettings.hasOwnProperty(setting)) continue;

			let newSetting = controlSettings[setting];
			if (this.controlSettings[setting].constructor === Object) {
				if (controlSettings[setting].constructor === Object) {
					newSetting = {...this.controlSettings[setting], ...controlSettings[setting]};
				} else {
					newSetting = Object.keys(this.controlSettings[setting]).reduce((subSettings, subSetting) => {
						subSettings[subSetting] = controlSettings[setting];
						return subSettings;
					}, {});
				}
			}
			this.controlSettings[setting] = newSetting;
		}

		provide(this, "controlSettings")
	}

	_controlIsAllowed(name) {
		const dependencies = {
			coordinateInput: [
				() => this.draw,
				() => (["marker", "rectangle"].some(type => {return this.draw[type] !== false}))
			],
			drawCopy: [
				() => this.draw,
				() => this.getFeatureTypes().some(type => this.draw[type])
			],
			drawClear: [
				() => this.draw,
				() => this.getFeatureTypes().some(type => this.draw[type])
			]
		};

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

	_addControl(name, control) {
		if (control && this._controlIsAllowed(name)) {
			this.controls[name] = control;
			this.map.addControl(control);
		}
	}

	_createControlItem(that, container, glyphName, title, fn) {
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

	_getDrawControl() {
		const drawOptions = {
			position: "topright",
			draw: {
				marker: {
					icon: this._createIcon({...this._getDrawingDraftStyle()})
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

		const featureTypes = this.getFeatureTypes();

		featureTypes.forEach(type => {
			if (this.draw[type] === false || this.controlSettings.draw[type] === false) {
				drawOptions.draw[type] = false;
			}
		});

		featureTypes.slice(0, -1).forEach(type => {
			drawOptions.draw[type] = {
				shapeOptions: this._getDrawingDraftStyle()
			};
		});

		featureTypes.forEach(type => {
			if (this.controlSettings.draw === false ||
				(this.controlSettings.draw.constructor === Object && this.controlSettings.draw[type] !== true)) {
				drawOptions.draw[type] = false;
			}
		});

		return new L.Control.Draw(drawOptions);
	}

	_getLocationControl() {
		const that = this;
		const LocationControl = L.Control.extend({
			options: {
				position: "topleft"
			},

			onAdd: function(map) {
				const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control laji-map-location-control");

				function isAllowed(control) {
					return (
						that.controlSettings.location === true ||
						(that.controlSettings.location.constructor === Object && that.controlSettings.location[control])
					);
				}

				//TODO disabled until implemented.
				// if (isAllowed("search")) this._createSearch(container);
				if (isAllowed("userLocation")) this._createLocate(container);
				return container;
			},

			_createSearch: function(container) {
				return that._createControlItem(this, container, "glyphicon glyphicon-search", that.translations.Search, () => this._onSearch(this));
			},

			_createLocate: function(container) {
				return that._createControlItem(this, container, "glyphicon glyphicon-screenshot", that.translations.Geolocate, () => that._onLocate());
			},

			_onSearch: function() {
			}
		});

		return new LocationControl();
	}

	_getCoordinateInputControl() {
		const that = this;
		const CoordinateInputControl = L.Control.extend({
			options: {
				position: "topright"
			},
			onAdd: function(map) {
				const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control laji-map-coordinate-input-control");
				const {iconCls, text, callback} = that.controlItems.coordinateInput;
				that._createControlItem(this, container, iconCls, text, callback);
				return container;
			}
		});

		return new CoordinateInputControl();
	}

	_getDrawCopyControl() {
		const that = this;

		const DrawCopyControl = L.Control.extend({
			options: {
				position: "topright"
			},

			onAdd: function(map) {
				const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control");
				that._createControlItem(this, container, "glyphicon glyphicon-floppy-save",
					that.translations.CopyDrawnFeatures, (...params) => that.openDrawCopyDialog(...params));
				return container;
			}
		});

		return new DrawCopyControl();
	}

	_getDrawClearControl() {
		const that = this;

		const DrawClearControl = L.Control.extend({
			options: {
				position: "topright"
			},

			onAdd: function(map) {
				const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control");
				that._createControlItem(
					this,
					container,
					"glyphicon glyphicon-trash",
					that.translations.ClearMap,
					(...params) => that.clearDrawData(...params)
				);
				return container;
			}
		});

		return new DrawClearControl();

	}

	_getCoordinatesControl() {
		const that = this;
		const CoordinateControl = L.Control.extend({
			options: {
				position: "bottomleft"
			},

			onAdd: function(map) {
				const container = L.DomUtil.create(
					"div",
					"leaflet-bar leaflet-control laji-map-control laji-map-coordinates-control"
				);

				const table = L.DomUtil.create("table", undefined, container);
				let visible = false;
				container.style.display = "none";

				const coordinateTypes = [
					{name: "WGS84"},
					{name: "YKJ"},
					{name: "ETRS"}
				];

				coordinateTypes.forEach(coordinateType => {
					const row = L.DomUtil.create("tr", undefined, table);
					coordinateType.nameCell = L.DomUtil.create("td", undefined, row);
					coordinateType.coordsCell = L.DomUtil.create("td", undefined, row);
				});

				that.maps.forEach(map => {
					map.on("mousemove", ({latlng}) => {
						if (!visible) {
							container.style.display = "block";
							visible = true;
						}

						const {lat, lng} = latlng;
						const wgs84 = [lat, lng].map(c => c.toFixed(6));
						const ykj = that.convert([lat, lng], "WGS84", "EPSG:2393").reverse();
						const euref = that.convert([lat, lng], "WGS84", "EPSG:3067").reverse();

						coordinateTypes.forEach(({name, nameCell, coordsCell}) => {
							let coords = wgs84;
							if (name === "YKJ") coords = ykj;
							else if (name === "ETRS") coords = euref;
							nameCell.innerHTML = `<strong>${name}:</strong>`;
							coordsCell.innerHTML = coords.join(name === "WGS84" ? ", " : ":");
						});
					}).on("mouseout", () => {
						container.style.display = "none";
						visible = false;
					})
				});

				return container;
			}
		});

		return new CoordinateControl();
	}

	_getLayerControl() {
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

	_getZoomControl() {
		return L.control.zoom({
			zoomInTitle: this.translations.ZoomIn,
			zoomOutTitle: this.translations.ZoomOut
		});
	}

	_showDialog(container, onClose) {
		const closeButton = document.createElement("button");
		closeButton.setAttribute("type", "button");
		closeButton.className = "close";
		closeButton.innerHTML = "✖";
		closeButton.addEventListener("click", close);

		const _container = document.createElement("div");
		_container.className = "laji-map-dialog panel panel-default panel-body";
		_container.appendChild(closeButton);
		_container.appendChild(container);

		const that = this;
		function close(e) {
			if (e) e.preventDefault();
			that.blockerElem.style.display = "";
			that.blockerElem.removeEventListener("click", close);
			document.removeEventListener("keydown", onEscListener);
			that.container.removeChild(_container);
			if (onClose) onClose();
		}

		function onEscListener(e) {
			e = e || window.event;
			var isEscape = false;
			if ("key" in e) {
				isEscape = (e.key == "Escape" || e.key == "Esc");
			} else {
				isEscape = (e.keyCode == 27);
			}
			if (isEscape) {
				close(e);
			}
		}

		this.blockerElem.addEventListener("click", close);
		document.addEventListener("keydown", onEscListener);

		this.blockerElem.style.display = "block";
		this.container.appendChild(_container);

		this._closeDialog = close;
	}

	openCoordinatesDialog() {
		const that = this;
		const translateHooks = [];

		function createTextInput(id, translationKey) {
			const input = document.createElement("input");
			input.setAttribute("type", "text");
			input.id = `laji-map-${id}`;
			input.className = "form-control";

			const label = document.createElement("label");
			label.setAttribute("for", input.id);
			translateHooks.push(that.addTranslationHook(label, "innerHTML", translationKey));

			const row = document.createElement("div");
			row.className = "form-group row";

			const col = document.createElement("div");
			col.className = "col-xs-12";

			[label, input].forEach(elem => {col.appendChild(elem)});
			row.appendChild(col);

			return row;
		}

		function formatter(input) { return e => {
			let charCode = (typeof e.which === "undefined") ? e.keyCode : e.which;

			if (charCode >= 48 && charCode <= 57) { // is a number
				// The input cursor isn't necessary at the EOL, but this validation works regardless.
				inputValidate(e, input.value + String.fromCharCode(charCode));
			}
		}}

		const ykjAllowed = that.draw.rectangle;
		const wgs84Allowed = that.draw.marker;

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
		container.className = "laji-map-coordinates";

		const latLabelInput = createTextInput("coordinate-input-lat", "Latitude");
		const lngLabelInput = createTextInput("coordinate-input-lng", "Longitude");
		const latInput = latLabelInput.getElementsByTagName("input")[0];
		const lngInput = lngLabelInput.getElementsByTagName("input")[0];

		const submitButton = document.createElement("button");
		submitButton.setAttribute("type", "submit");
		submitButton.className = "btn btn-block btn-info";
		translateHooks.push(this.addTranslationHook(submitButton, "innerHTML", "Add"));
		submitButton.setAttribute("disabled", "disabled");

		let helpSpan = document.createElement("span");
		helpSpan.className = "help-block";

		function getHelpTxt() {
			let help = "";
			const rectangleAllowed = that.draw.rectangle;
			if (rectangleAllowed) help = that.translations.EnterYKJRectangle;
			if (that.draw.marker) {
				if (rectangleAllowed) help += ` ${that.translations.or} ${that.translations.enterWgs84Coordinates}`;
				else help = that.translations.EnterWgs84Coordinates;
			}
			help += ".";
			return help;
		}
		translateHooks.push(this.addTranslationHook(helpSpan, "innerHTML", getHelpTxt));

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

		function toYKJFormat(coords) {
			let strFormat = "" + coords;
			while (strFormat.length < 7) {
				strFormat = strFormat += "0";
			}
			return +strFormat;
		}

		function convert(coords) {
			return that.convert(coords, "EPSG:2393", "WGS84");
		}

		container.addEventListener("submit", e => {
			e.preventDefault();

			const latlngStr = [latInput.value, lngInput.value];
			const latlng = latlngStr.map(parseFloat);

			const isYKJ = !validateLatLng(latlngStr, wgs84Validator);

			let geometry = { type: "Point",
				coordinates: (isYKJ ? convert(latlng.map(toYKJFormat)) : latlng.reverse())
			};
			const feature = {
				type: "Feature",
				geometry: geometry,
				properties: {}
			};

			if (isYKJ && latlngStr[0].length < 7) {
				const latStart = toYKJFormat(latlng[0]);
				const latEnd = toYKJFormat(latlng[0] + 1);

				const lonStart = toYKJFormat(latlng[1]);
				const lonEnd = toYKJFormat(latlng[1] + 1);

				geometry.type = 'Polygon';
				geometry.coordinates = [[
					[latStart, lonStart],
					[latStart, lonEnd],
					[latEnd, lonEnd],
					[latEnd, lonStart],
					[latStart, lonStart]
				].map(convert)];
			}

			const layer = this._featureToLayer(this.draw.data.getFeatureStyle)(feature);
			const isMarker = layer instanceof L.Marker;

			this._onAdd(layer);
			const center = (isMarker) ? layer.getLatLng() : layer.getBounds().getCenter();
			this.map.setView(center, this.map.zoom, {animate: false});
			if (isMarker) {
				if (this.clusterDrawLayer) this.clusterDrawLayer.zoomToShowLayer(layer);
				else this.setNormalizedZoom(9);
			} else {
				this.map.fitBounds(layer.getBounds());
			}
			this._closeDialog(e);
		});

		container.appendChild(helpSpan);
		container.appendChild(latLabelInput);
		container.appendChild(lngLabelInput);
		container.appendChild(submitButton);

		this._showDialog(container, () => {
			translateHooks.forEach(hook => {
				that.removeTranslationHook(hook);
			})
		});

		latInput.focus();
	}

	openDrawCopyDialog() {
		const container = document.createElement("div");

		const input = document.createElement("textarea");
		input.setAttribute("rows", 10);
		input.setAttribute("cols", 50);
		input.setAttribute("readonly", "readonly");
		input.className = "form-control";
		input.addEventListener("focus", input.select);

		const features = this.draw.data.featureCollection.features.map(this.formatFeatureOut);
		const originalGeoJSON = {...this.draw.data.featureCollection, features};

		function updateGeoJSON(geoJSON) {
			input.value = JSON.stringify(geoJSON, undefined, 2);
			input.focus();
			input.select();
		}

		const that = this;

		// Must be called with cloned object, since this modifies the given object!
		function convertRecursively(obj, from, to) {
			if (typeof obj === "object" && obj !== null) {
				Object.keys(obj).forEach(key => {
					if (key === "coordinates") {
						obj[key] = Array.isArray(obj[key][0]) ?
							[obj[key][0].map(coords => that.convert(coords.slice(0).reverse(), from, to))] :
							that.convert(obj[key].slice(0).reverse(), from, to);
					}
					else convertRecursively(obj[key], from, to);
				})
			}
			return obj;
		}

		let activeProj = "WGS84";
		let activeTab = undefined;

		const tabs = document.createElement("ul");
		tabs.className = "nav nav-tabs";

		[
			{name: "WGS84", proj: "WGS84"},
			{name: "YKJ", proj: "EPSG:2393"},
			{name: "ETRS", proj: "EPSG:3067"}
		].map(({name, proj}) => {
			const tab = document.createElement("li");
			const text = document.createElement("a");

			if (proj === activeProj) {
				activeTab = tab;
				tab.className = "active";
			}

			text.innerHTML = name;
			tab.appendChild(text);

			const isWGS84 = proj === "WGS84";

			tab.addEventListener("click", () => {
				const reprojected = isWGS84 ?
					originalGeoJSON :
					convertRecursively(JSON.parse(JSON.stringify(originalGeoJSON)), "WGS84", proj);

				if (!isWGS84) {
					reprojected.crs = {
						type: proj,
						properties: {
							[proj]: proj === "EPSG:2393" ? EPSG2393String : EPSG3067String
						}
					}
				}

				const {scrollTop} = input;
				updateGeoJSON(reprojected);
				input.scrollTop = scrollTop;

				activeProj = proj;
				activeTab.className = "";
				activeTab = tab;
				tab.className = "active";
			});
			return tab;
		}).forEach(tab => tabs.appendChild(tab));

		container.appendChild(tabs);
		container.appendChild(input);

		that._showDialog(container);
		updateGeoJSON(originalGeoJSON);
	}

	_joinTranslations(...words) {
		const { translations } = this;
		return words.map(word => translations[word]).join(" ");
	}

	@reflect()
	@dependsOn("maps", "translations", "controls", "draw")
	_updateContextMenu() {
		if (!depsProvided(this, "_updateContextMenu", arguments)) return;

		const join = (...params) => this._joinTranslations(...params);

		this.maps.forEach(map => {
			map.contextmenu.removeAllItems();

			this.getFeatureTypes().filter(type => type !== "circle").forEach(featureType => {
				const text = join("Draw", featureType);

				if (this.draw && this.draw[featureType] !== false && this.controlSettings.draw[featureType] !== false) {
					map.contextmenu.addItem({
						text: text,
						iconCls: "context-menu-draw context-menu-draw-" + featureType,
						callback: () => this.triggerDrawing(featureType)
					});
				}
			});

			let lineAdded = false;
			[
				this.controlItems.coordinateInput,
				this.controlItems.drawCopy,
				this.controlItems.drawClear
			].forEach(control => {
				if (this._controlIsAllowed(control.name)) {
					if (!lineAdded) {
						map.contextmenu.addItem("-");
						lineAdded = true;
					}
					map.contextmenu.addItem(control);
				}
			});
		});
	}

}
}