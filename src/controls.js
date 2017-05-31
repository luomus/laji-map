import "leaflet-contextmenu";
import { convertGeoJSON, convertLatLng, standardizeGeoJSON, geoJSONToISO6709, geoJSONToWKT } from "./utils";
import {
	MAASTOKARTTA,
	TAUSTAKARTTA,
	POHJAKARTTA,
	OPEN_STREET,
	GOOGLE_SATELLITE,
	EPSG3067String,
	EPSG2393String,
	ESC,
	ONLY_MML_OVERLAY_NAMES
} from "./globals";
import { dependsOn, depsProvided, provide, reflect, isProvided } from "./dependency-utils";

function getSubControlName(name, subName) {
	return (name !== undefined) ? `${name}.${subName}` : subName;
}


export default LajiMap => class LajiMapWithControls extends LajiMap {
	constructor(props) {
		super(props);
		this._initControls();
	}

	_initControls() {
		this.controls = {};
		provide(this, "controlsConstructed");
	}

	@dependsOn("controls")
	_setLang() {
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

		this.controlItems = [
			{
				name: "layer",
				control: this._getLayerControl()
			},
			{
				name: "location",
				position: "topleft",
				controls: [
					{
						name: "userLocation",
						text: this.translations.Geolocate,
						iconCls: "glyphicon glyphicon-screenshot",
						fn: (...params) => this._onLocate(...params),
					}
				],
				contextMenu: false
			},
			{
				name: "zoom",
				control: L.control.zoom({
					zoomInTitle: this.translations.ZoomIn,
					zoomOutTitle: this.translations.ZoomOut
				})
			},
			{
				name: "scale",
				control: L.control.scale({metric: true, imperial: false})
			},
			{
				name: "coordinates",
				control: this._getCoordinatesControl()
			},
			{
				name: "draw",
				control: this._getDrawControl()
			},
			{
				controls: [
					{
						name: "coordinateInput",
						text: this.translations.AddFeatureByCoordinates,
						iconCls: "laji-map-coordinate-input-glyph",
						fn: (...params) => this.openCoordinatesInputDialog(...params)
					},
					{
						name: "drawCopy",
						text: this.translations.CopyDrawnFeatures,
						iconCls: "glyphicon glyphicon-floppy-save",
						fn: (...params) => this.openDrawCopyDialog(...params)
					},
					{
						name: "drawClear",
						text: this.translations.ClearMap,
						iconCls: "glyphicon glyphicon-trash",
						fn: (...params) => this.clearDrawData(...params)
					}
				]
			},
			{
				name: "lineTransect",
				controls: [
					{
						name: "split",
						text: this.translations.SplitLine,
						iconCls: "glyphicon glyphicon-scissors",
						fn: (...params) => this.startLTLineSplit(...params),
						stopFn: (...params) => this.stopLTLineSplit(...params),
						eventName: "lineTransect:split"
					},
					{
						name: "delete",
						text: this.translations.DeleteLineSegment,
						iconCls: "glyphicon glyphicon-remove-sign",
						fn: (...params) => this.startRemoveLTSegmentMode(...params),
						stopFn: (...params) => this.stopRemoveLTSegmentMode(...params),
						eventName: "lineTransect:delete"
					},
					{
						name: "undo",
						text: this.translations.Undo,
						iconCls: "laji-map-line-transect-undo-glyph",
						fn: (...params) => this.LTUndo(...params),
						onAdd: () => this.updateUndoButton()
					},
					{
						name: "redo",
						text: this.translations.Redo,
						iconCls: "laji-map-line-transect-redo-glyph",
						fn: (...params) => this.LTRedo(...params),
						onAdd: () => this.updateRedoButton()
					}
				]
			}
		];

		const that = this;

		function _createCancelHandler(name, fn, eventName) {
			let cont = this.cancelHandlers[name];

			const _that = this;
			function stop() {
				fn();
				that._removeKeyListener(ESC, stop);
				_that.container.removeChild(cont);
				that.map.off(eventName);
			}

			if (!cont) {
				this.cancelHandlers[name] = L.DomUtil.create("ul", "leaflet-draw-actions");
				cont = this.cancelHandlers[name];
				const buttonWrapper = L.DomUtil.create("li");
				const button = that._createControlButton(this, buttonWrapper, stop);
				that.addTranslationHook(button, "Cancel");
				cont.appendChild(buttonWrapper);
			}

			that._addKeyListener(ESC, stop, !!"high priority");
			that.map.on(eventName, stop);

			const parentBtn = that._controlButtons[name];
			cont.style.top = `${parentBtn.offsetTop}px`;
			cont.style.display = "block";

			this.container.appendChild(cont);
		}

		this._controlButtons = {};

		this.controlItems.forEach(({name, control, controls, position, iconCls, fn, stopFn, text, eventName, onAdd: _onAdd}) => {
			function callback(fn, stopFn, name, eventName) { return (...params) => {
				if (stopFn) {
					fn(...params);
					this._createCancelHandler(name, stopFn, eventName);
				} else {
					fn(...params);
				}
			};}

			const leafletControl = control || (() => {
				const onAdd = (controls && controls.some(({name: subName}) => this._controlIsAllowed(getSubControlName(name, subName)))) ?
					function() {
						this.container = L.DomUtil.create("div", "leaflet-control laji-map-control leaflet-draw");
						this.buttonContainer = L.DomUtil.create("div", "leaflet-bar laji-map-control", this.container);
						this.cancelHandlers = {};

						controls.forEach(({name: subName, iconCls, text, fn, stopFn, eventName, onAdd: _onAdd}) => {
							const buttonName = getSubControlName(name, subName);
							that._controlButtons[buttonName] = that._createControlItem(this, this.buttonContainer, iconCls, text, callback.apply(this, [fn, stopFn, buttonName, eventName]));
							if (_onAdd) _onAdd();
						});

						return this.container;
					} : function() {
						const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control");
						that._controlButtons[name] = that._createControlItem(this, container, iconCls, text, callback.apply(this, [fn, stopFn, name, eventName]));
						if (_onAdd) _onAdd();
						return container;
					};

				const Control = L.Control.extend({
					options: position ? {position} : undefined,
					onAdd,
					_createCancelHandler
				});
				return new Control();
			})();

			this._addControl(name, leafletControl);
		});

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
		if (!depsProvided(this, "_updateDrawControls", arguments)) return;
		this._updateMapControls();
	}

	@reflect()
	@dependsOn("lineTransect")
	_updateLineTransectControls() {
		if (!depsProvided(this, "_updateLineTransectControls", arguments)) return;
		this._updateMapControls();
	}

	@reflect()
	@dependsOn("tileLayer", "overlays")
	_updateLayersControls() {
		if (!depsProvided(this, "_updateLayersControls", arguments)) return;
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
			scale: true,
			lineTransect: {split: true, delete: true, undo: true, redo: true}
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

		provide(this, "controlSettings");
	}

	_controlIsAllowed(name) {
		const dependencies = {
			coordinateInput: [
				() => this.draw,
				() => (["marker", "rectangle"].some(type => {return this.draw[type] !== false;}))
			],
			draw: [
				() => isProvided(this, "draw"),
			],
			drawCopy: [
				() => this.getFeatureTypes().some(type => this.draw[type])
			],
			drawClear: [
				() => this.getFeatureTypes().some(type => this.draw[type])
			],
			lineTransect: [
				() => isProvided(this, "lineTransect")
			]
		};

		const {controlSettings} = this;

		function controlIsOk(controlName) {
			if (controlName === undefined) return true;

			let splitted, parentControl, subControl;
			if (controlName.includes(".")) {
				splitted = name.split(".");
				parentControl = splitted[0];
				subControl = splitted[1];
			}

			function dependenciesAreOk(controlName) {
				return (dependencies[controlName] || []).every(dependency => 
					(typeof dependency === "function") ? dependency() : controlIsOk(dependency)
				);
			}
			
			if (!splitted) {
				const controlItem = controlSettings[controlName];
				return (
					controlItem &&
					dependenciesAreOk(controlName) &&
					(controlItem.constructor !== Object || Object.keys(controlItem).some(name => controlItem[name]))
				);
			} else {
				return (
					controlSettings[parentControl] === true ||
					(controlSettings[parentControl].constructor === Object && controlSettings[parentControl][subControl])
				) && (
					dependenciesAreOk(parentControl) && dependenciesAreOk(subControl)
				);
			}
		}

		return controlIsOk(name);
	}


	_addControl(name, control) {
		if (control && this._controlIsAllowed(name)) {
			this.controls[name] = control;
			this.map.addControl(control);
		}
	}

	_createControlButton(that, container, fn) {
		const elem = L.DomUtil.create("a", "", container);

		L.DomEvent.on(elem, "click", L.DomEvent.stopPropagation);
		L.DomEvent.on(elem, "mousedown", L.DomEvent.stopPropagation);
		L.DomEvent.on(elem, "click", L.DomEvent.preventDefault);
		L.DomEvent.on(elem, "click", that._refocusOnMap, that);
		L.DomEvent.on(elem, "click", fn);

		return elem;
	}

	_createControlItem(that, container, glyphName, title, fn) {
		const elem = this._createControlButton(that, container, fn);
		L.DomUtil.create("span", glyphName, elem);
		elem.title = title;

		return elem;
	}

	_getDrawControl() {
		const drawOptions = {
			position: "topright",
			edit: {
				featureGroup: this.drawLayerGroup,
				edit: false,
				remove: false
			}
		};

		drawOptions.draw = this.getFeatureTypes().reduce((options, type) => {
			options[type] = (this.draw[type] === false || this.controlSettings.draw[type] === false) ?
				false : this._getDrawOptionsForType(type);
			return options;
		}, {});


		return new L.Control.Draw(drawOptions);
	}


	_getCoordinatesControl() {
		const that = this;
		const CoordinateControl = L.Control.extend({
			options: {
				position: "bottomleft"
			},

			onAdd: function() {
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

				that.map.on("mousemove", ({latlng}) => {
					if (!visible) {
						container.style.display = "block";
						visible = true;
					}

					const {lat, lng} = latlng;
					const wgs84 = [lat, lng].map(c => c.toFixed(6));
					const ykj = convertLatLng([lat, lng], "WGS84", "EPSG:2393").reverse();
					const euref = convertLatLng([lat, lng], "WGS84", "EPSG:3067").reverse();

					coordinateTypes.forEach(({name, nameCell, coordsCell}) => {
						let coords = wgs84;
						if (name === "YKJ") coords = ykj;
						else if (name === "ETRS") coords = euref;
						nameCell.innerHTML = `<strong>${name}:</strong>`;
						coordsCell.innerHTML = coords.join(name === "WGS84" ? ", " : ":");
						coordsCell.className = "monospace";
					});
				}).on("mouseout", () => {
					container.style.display = "none";
					visible = false;
				});

				return container;
			}
		});

		return new CoordinateControl();
	}

	_getLayerControl() {
		const baseMaps = {}, overlays = {};
		const { translations } = this;

		const tileLayersNames = [TAUSTAKARTTA, MAASTOKARTTA, POHJAKARTTA, GOOGLE_SATELLITE, OPEN_STREET];

		tileLayersNames.forEach(tileLayerName => {
			baseMaps[translations[tileLayerName[0].toUpperCase() + tileLayerName.slice(1)]] = this[tileLayerName];
		});
		Object.keys(this.overlays).forEach(overlayName => {
			if (this._getDefaultCRSLayers().includes(this.tileLayer) && ONLY_MML_OVERLAY_NAMES.includes(overlayName)) return;
			overlays[translations[overlayName[0].toUpperCase() + overlayName.slice(1)]] = this.overlays[overlayName];
		});

		const that = this;
		const LayerControl = L.Control.Layers.extend({
			_onInputClick: function(e) {
				if (!e) return;

				const inputs = that.rootElem.querySelectorAll(".laji-map .leaflet-control-layers-list input");

				const overlayIdsToAdd = {};
				for (let i = 0; i < inputs.length; i++) {
					const input = inputs[i];
					if (input.checked) {
						for (let tileLayerName of tileLayersNames) {
							if (that[tileLayerName]._leaflet_id === input.layerId) {
								that.setTileLayer(that[tileLayerName]);
								break;
							}
						}
						for (let overlayName of Object.keys(that.overlays)) {
							const overlay = that.overlays[overlayName];
							if (overlay._leaflet_id === input.layerId) {
								overlayIdsToAdd[input.layerId] = true;
							}
						}
					}
				}

				for (let overlayName of Object.keys(that.overlays)) {
					const overlay = that.overlays[overlayName];
					if (overlayIdsToAdd[overlay._leaflet_id] && !that.map.hasLayer(overlay)) {
						that.map.addLayer(overlay);
					} else if (!overlayIdsToAdd[overlay._leaflet_id] && that.map.hasLayer(overlay)) {
						that.map.removeLayer(overlay);
					}
				}

				this._handlingClick = false;

				that.controls.layer.expand();
			}
		});
		return new LayerControl(baseMaps, overlays, {position: "topleft"});
	}

	setLineTransectGeometry(feature, undo) {
		super.setLineTransectGeometry(feature, undo);
		this.updateUndoButton();
		this.updateRedoButton();
	}

	updateUndoButton() {
		const undoButton = this._controlButtons && this._controlButtons["lineTransect.undo"];
		if (!undoButton) return;
		if (this._LTHistoryPointer <= 0 && !undoButton.className.includes("leaflet-disabled")) {
			undoButton.className += " leaflet-disabled";
		} else if (this._LTHistoryPointer > 0 && this._LTHistoryPointer < this._LTHistory.length && undoButton.className.includes("leaflet-disabled")) {
			undoButton.className = undoButton.className.replace(" leaflet-disabled", "");
		}
	}

	updateRedoButton() {
		const redoButton = this._controlButtons && this._controlButtons["lineTransect.redo"];
		if (!redoButton) return;
		if (this._LTHistoryPointer >= this._LTHistory.length - 1 && !redoButton.className.includes("leaflet-disabled")) {
			redoButton.className += " leaflet-disabled";
		} else if (this._LTHistoryPointer >= 0 && this._LTHistoryPointer < this._LTHistory.length - 1 && redoButton.className.includes("leaflet-disabled")) {
			redoButton.className = redoButton.className.replace(" leaflet-disabled", "");
		}
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
			that._removeKeyListener(ESC, close);
			that.container.removeChild(_container);
			if (onClose) onClose();
		}

		this.blockerElem.addEventListener("click", close);
		this._addKeyListener(ESC, close);

		this.blockerElem.style.display = "block";
		this.container.appendChild(_container);

		this._closeDialog = close;
	}

	openCoordinatesInputDialog() {
		const that = this;
		const translateHooks = [];

		function createTextInput(id, translationKey) {
			const input = document.createElement("input");
			input.setAttribute("type", "text");
			input.id = `laji-map-${id}`;
			input.className = "form-control";

			const label = document.createElement("label");
			label.setAttribute("for", input.id);
			translateHooks.push(that.addTranslationHook(label, translationKey));

			const row = document.createElement("div");
			row.className = "form-group row";

			const col = document.createElement("div");
			col.className = "col-xs-12";

			[label, input].forEach(elem => {col.appendChild(elem);});
			row.appendChild(col);

			return row;
		}

		function formatter(input) { return e => {
			let charCode = (typeof e.which === "undefined") ? e.keyCode : e.which;

			if (charCode >= 48 && charCode <= 57) { // is a number
			// The input cursor isn't necessary at the EOL, but this validation works regardless.
				inputValidate(e, input.value + String.fromCharCode(charCode));
			}
		};}

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

		const container = document.createElement("form");
		container.className = "laji-map-coordinates";

		const latLabelInput = createTextInput("coordinate-input-lat", "Latitude");
		const lngLabelInput = createTextInput("coordinate-input-lng", "Longitude");
		const latInput = latLabelInput.getElementsByTagName("input")[0];
		const lngInput = lngLabelInput.getElementsByTagName("input")[0];

		const submitButton = document.createElement("button");
		submitButton.setAttribute("type", "submit");
		submitButton.className = "btn btn-block btn-primary";
		translateHooks.push(this.addTranslationHook(submitButton, "Add"));
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
		translateHooks.push(this.addTranslationHook(helpSpan, getHelpTxt));

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
			};
		});

		function toYKJFormat(coords) {
			let strFormat = "" + coords;
			while (strFormat.length < 7) {
				strFormat = strFormat += "0";
			}
			return +strFormat;
		}

		function convert(coords) {
			return convertLatLng(coords, "EPSG:2393", "WGS84");
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

			if (isYKJ && (latlngStr[0].length < 7 || this.draw.marker === false)) {
				const latStart = toYKJFormat(latlng[0]);
				const latEnd = toYKJFormat(latlng[0] + 1);

				const lonStart = toYKJFormat(latlng[1]);
				const lonEnd = toYKJFormat(latlng[1] + 1);

				geometry.type = "Polygon";
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

			this._onAdd(layer, latInput.value + ":" + lngInput.value);
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
			});
		});

		latInput.focus();
	}

	openDrawCopyDialog() {
		const table = document.createElement("table");
		table.className = "laji-form-draw-copy-table";

		const HTMLInput = document.createElement("textarea");
		HTMLInput.setAttribute("rows", 10);
		HTMLInput.setAttribute("cols", 50);
		HTMLInput.setAttribute("readonly", "readonly");
		HTMLInput.className = "form-control";
		HTMLInput.addEventListener("focus", HTMLInput.select);

		const features = this.draw.data.featureCollection.features.map(this.formatFeatureOut);
		const originalGeoJSON = {...this.draw.data.featureCollection, features};

		function converterFor(proj) {
			return input => {
				const reprojected = convertGeoJSON(input, "WGS84", proj);
				reprojected.crs = {
					type: "name",
					properties: {
						name: proj === "EPSG:2393" ? EPSG2393String : EPSG3067String
					}
				};
				return reprojected;
			};
		}

		const TOP = "TOP";
		const LEFT = "LEFT";

		const pipeline = [
			{ // GeoJSON -> GeoJSON with coordinates converted
				commands: {
					WGS84: standardizeGeoJSON,
					YKJ: input => converterFor("EPSG:2393")(standardizeGeoJSON(input)),
					ETRS: input => converterFor("EPSG:3067")(standardizeGeoJSON(input))
				},
				position: TOP
			},
			{ // GeoJSON -> String
				commands: {
					GeoJSON: input => JSON.stringify(input, undefined, 2),
					ISO: geoJSONToISO6709,
					WKT: geoJSONToWKT
				},
				position: LEFT
			}
		];

		let activeCommands = pipeline.map(({commands}) => Object.keys(commands)[0]);

		const leftTabs = [];
		const topTabs = [];

		pipeline.forEach(({commands, position}, idx) => {
			let activeTab = undefined;

			function setActiveTab(tab, label) {
				if (activeTab) {
					activeTab.className = "";
				}
				activeTab = tab;
				activeTab.className = "active";
				activeCommands[idx] = label;
			}

			const tabs = document.createElement("ul");
			const tabContainer = (position === LEFT) ? (() => {
				const _tabContainer = document.createElement("div");
				_tabContainer.className = "tabs-left";
				_tabContainer.appendChild(tabs);
				return _tabContainer;
			})() : tabs;
			tabs.className = "nav nav-tabs";

			Object.keys(commands).map((label, idx) => {
				const tab = document.createElement("li");
				const text = document.createElement("a");

				if (idx === 0) {
					setActiveTab(tab, label);
				}

				text.innerHTML = label;
				tab.appendChild(text);

				tab.addEventListener("click", () => {
					const {scrollTop} = HTMLInput;
					setActiveTab(tab, label);
					updateOutput();
					HTMLInput.scrollTop = scrollTop;
				});

				return tab;
			}).forEach(tab => tabs.appendChild(tab));

			let tabsArr = topTabs;
			if (position === LEFT) tabsArr = leftTabs;
			tabsArr.push(tabContainer);
		});

		updateOutput();

		function updateOutput() {
			HTMLInput.value = pipeline.reduce((_output, {commands}, idx) => 
				commands[activeCommands[idx]](_output), originalGeoJSON
			);
			HTMLInput.focus();
			HTMLInput.select();
		}

		const rows = [
			[undefined, topTabs], 
			[leftTabs, HTMLInput]
		];

		const tBody = document.createElement("tbody");
		rows.forEach(row => {
			const tr = document.createElement("tr");
			row.forEach(items => (Array.isArray(items) ? items : [items])
				.forEach(elem => {
				 const td = document.createElement("td");
				 td.appendChild(elem || document.createElement("div"));
				 tr.appendChild(td);
				}));
			tBody.appendChild(tr);
		});

		table.appendChild(tBody);

		this._showDialog(table);
		updateOutput(originalGeoJSON);
	}

	_joinTranslations(...words) {
		const { translations } = this;
		return words.map(word => translations[word]).join(" ");
	}

	@reflect()
	@dependsOn("controls")
	_updateContextMenu() {
		if (!depsProvided(this, "_updateContextMenu", arguments)) return;

		const join = (...params) => this._joinTranslations(...params);

		this.map.contextmenu.removeAllItems();

		let groupAdded = false;

		this.getFeatureTypes().forEach(featureType => {
			const text = join("Draw", featureType);

			if (this.draw && this.draw[featureType] !== false && this.controlSettings.draw[featureType] !== false) {
				this.map.contextmenu.addItem({
					text: text,
					iconCls: "context-menu-draw context-menu-draw-" + featureType,
					callback: () => this.triggerDrawing(featureType)
				});
				groupAdded = true;
			}
		});

		const addControlGroup = (groupName, controlGroup) => {
			if (controlGroup.contextMenu === false) return;
			if (groupAdded && controlGroup.some(control => this._controlIsAllowed(getSubControlName(groupName, control.name)))) {
				this.map.contextmenu.addItem("-");
			}
			groupAdded = false;
			controlGroup.forEach(control => {
				if ("text" in control && this._controlIsAllowed(getSubControlName(groupName, control.name))) {
					this.map.contextmenu.addItem({...control, callback: control.fn});
					groupAdded = true;
				}
			});
		};
		this.controlItems.filter(item => item.contextMenu !== false).forEach(control => addControlGroup(control.controls ? control.name : undefined, control.controls ?  control.controls : [control]));
	}
};
