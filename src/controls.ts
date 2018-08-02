import { DrawOptions } from "./map";
import { DataItemType } from "./map";
import * as L from "leaflet";
import {
	convertGeoJSON, convertLatLng, standardizeGeoJSON, geoJSONToISO6709, geoJSONToWKT, getCRSObjectForGeoJSON,
	detectFormat, detectCRS, convertAnyToWGS84GeoJSON, validateLatLng, ykjGridStrictValidator, wgs84Validator,
	ykjValidator, etrsTm35FinValidator, stringifyLajiMapError, createTextInput, createTextArea, isObject, CRSString
} from "./utils";
import {
	ESC,
	ONLY_MML_OVERLAY_NAMES
} from "./globals";
import { dependsOn, depsProvided, provide, reflect, isProvided } from "./dependency-utils";
import * as noUiSlider from "nouislider";
import {LajiMapEvent, DataItemLayer } from "./map";
import LajiMap from "./line-transect";

export interface ControlOptions {
	name?: string;
	text?: string;
	position?: string;
	eventName?: string;
	group?: string;
	iconCls?: string;
	contextMenu?: boolean;
	fn?: () => void;
	stopFn?: () => void;
	finishFn?: () => void;
	cancelFn?: () => void;
	onAdd?: () => void;
	disabled?: boolean;
	controls?: ControlOptions[];
	control?: () => L.Control;
	_custom?: boolean;
}

export interface DrawControlOptions {
	rectangle?: boolean;
	polygon?: boolean;
	polyline?: boolean;
	circle?: boolean;
	marker?: boolean;
	coordinateInput?: boolean;
	copy?: boolean;
	clear?: boolean;
	reverse?: boolean;
	delete?: boolean; undo?: boolean;
	redo?: boolean;
}

export interface LineTransectControlOptions {
	split?: boolean;
	splitByMeters?: boolean;
	deletePoints?: boolean;
	createPoint?: boolean;
	shiftPoint?: boolean;
	undo?: boolean;
	redo?: boolean;
}

export interface LocationControlOptions {
	user?: boolean;
	search?: boolean;
}

export interface ControlsOptions {
	draw?: boolean | DrawControlOptions;
	layer?: boolean;
	zoom?: boolean;
	scale?: boolean;
	location?: boolean | LocationControlOptions;
	coordinates?: boolean;
	lineTransect?: boolean | LineTransectControlOptions;
	layerOpacity?: boolean
	attribution?: boolean
}

interface InternalControlsOptions extends ControlsOptions {
	drawUtils?: boolean | DrawControlOptions
}

export interface LajiMapOptions {
	controls?: boolean | ControlsOptions
}

function getSubControlName(name, subName) {
	return (name !== undefined) ? `${name}.${subName}` : subName;
}

interface CustomControl extends L.Control {
	_custom: boolean;
	group: string;
}

export default class LajiMapWithControls extends LajiMap {
//export default LajiMap => { class LajiMapWithControls extends LajiMap {

	controlItems: ControlOptions[];
	activeControl: L.Control;
	controlSettings: InternalControlsOptions;

	drawControl: L.Control.Draw;
	_locateOn: boolean;
	_controlButtons: {[controlName: string]: HTMLElement};
	controls: L.Control[];
	_customControls: CustomControl[];
	layerControl: L.Control.Layers;
	_opacitySetBySlide: boolean;
	_slider: any;
	_contextMenuItems: {[buttonName: string]: HTMLElement};

	getOptionKeys() {
		return {
			...super.getOptionKeys(),
			controlSettings: "setControlsWarn",
			controls: ["setControls", () => this.controlSettings],
			customControls: "setCustomControls"
		};
	}

	@dependsOn("controls")
	_setLang() {
		if (!depsProvided(this, "_setLang", arguments)) return;

		// Original strings are here: https://github.com/Leaflet/Leaflet.draw/blob/master/src/Leaflet.draw.js
		const drawLocalizations = (<any> L).drawLocal.draw;

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

	@dependsOn("map")
	setLang(lang) {
		if (!depsProvided(this, "setLang", arguments)) return;
		super.setLang(lang);
		this._setLang();
	}

	_initializeMapEvents() {
		super._initializeMapEvents();
		const cancelDraw = ({name}: any) => {
			if (name === "draw" || name === "zoom" || name === "layer") return;
			if (!this.drawControl) return;
			this.getFeatureTypes().forEach(featureType => {
				const handlerContainer = (<any> this.drawControl)._toolbars.draw._modes[featureType];
				if (handlerContainer && handlerContainer.handler._enabled) {
					(<any> this.drawControl)._toolbars.draw._modes[featureType].handler.disable();
				}
			});
			this._clearEditable();
		};
		// TODO Poista kommentit kun laji.fi havaintokartan neliöllä rajaus bugi korjattu. Jostain syystä draw:created -> this._onAdd ei triggeröidy.
		//this.map.on("draw:created", e => {
		//	cancelDraw(e);
		//});
		this.map.on("controlClick", cancelDraw);
	}

	_toggleLocate() {
		this._locateOn ? this._setLocateOff() : this._setLocateOn(!!"triggerEvent");
	}

	_setLocateOn(...params) {
		super._setLocateOn(...params);
		this._updateUserLocate(true);
	}

	_setLocateOff() {
		super._setLocateOff();
		this._updateUserLocate(false);
	}

	_onLocationFound(e) {
		super._onLocationFound(e);
		this._updateUserLocate(this._locateOn);
	}

	@reflect()
	@dependsOn("controls")
	_updateUserLocate(value) {
		if (!depsProvided(this, "_updateUserLocate", arguments)) return;
		this._locateOn = value !== undefined ? value : this._locateOn;
		const button = this._controlButtons["location.userLocation"];
		if (!button) return;
		if (this._locateOn && !button.className.includes(" on")) {
			button.className = `${button.className} on`;
		} else if (!this._locateOn && button.className.includes(" on")) {
			button.className = button.className.replace(" on", "");
		}
		if (!this._located && !button.className.includes(" locating")) {
			button.className = `${button.className} locating`;
		} else if (this._located && button.className.includes(" locating")) {
			button.className = button.className.replace(" locating", "");
		}
	}

	@reflect()
	@dependsOn("map", "translations", "controlSettings")
	_updateMapControls() {
		if (!depsProvided(this, "_updateMapControls", arguments)) return;

		const controlContainerNode = this.container.querySelector(".leaflet-control-container");

		if (!controlContainerNode.className.includes("leaflet-touch")) {
			controlContainerNode.className += " leaflet-touch";
		}

		(this.controls || []).forEach(control => {
			if (control) this.map.removeControl(control);
		});

		this.controls = [];

		this.controlItems = [
			{
				name: "layer",
				control: () => this._getLayerControl(this.controlSettings.layerOpacity)
			},
			{
				name: "location",
				position: "topleft",
				controls: [
					{
						name: "userLocation",
						text: this.translations.Geolocate,
						iconCls: "glyphicon glyphicon-screenshot",
						fn: () => this._toggleLocate(),
					}
				],
				contextMenu: false
			},
			{
				name: "zoom",
				control: () => this.getZoomControl()
			},
			{
				name: "scale",
				control: () => L.control.scale({metric: true, imperial: false})
			},
			{
				name: "attribution",
				control: () => L.control.attribution({prefix: ""})
			},
			{
				name: "coordinates",
				control: () => this._getCoordinatesControl()
			},
			{
				name: "draw",
				control: () => this._getDrawControl()
			},
			{
				name: "drawUtils",
				controls: [
					{
						name: "coordinateInput",
						text: this.translations.AddFeatureByCoordinates,
						iconCls: "laji-map-coordinate-input-glyph",
						fn: () => this.openCoordinatesInputDialog()
					},
					{
						name: "copy",
						text: this.translations.CopyDrawnFeatures,
						iconCls: "glyphicon glyphicon-floppy-save",
						fn: () => this.openDrawCopyDialog()
					},
					{
						name: "upload",
						text: this.translations.UploadDrawnFeatures,
						iconCls: "glyphicon glyphicon-floppy-open",
						fn: () => this.openDrawUploadDialog()
					},
					{
						name: "clear",
						text: this.translations.ClearMap,
						iconCls: "glyphicon glyphicon-trash",
						fn: (...params) => {
							const container = document.createElement("div");
							const translateHooks = [];

							const yesButton = document.createElement("button");
							yesButton.className = "btn btn-block btn-primary";
							translateHooks.push(this.addTranslationHook(yesButton, "Yes"));
							yesButton.addEventListener("click", e => {
								this.clearDrawData();
								this._closeDialog(e);
							});

							const noButton = document.createElement("button");
							noButton.className = "btn btn-block btn-primary";
							translateHooks.push(this.addTranslationHook(noButton, "No"));
							noButton.addEventListener("click", e => this._closeDialog(e));

							const question = document.createElement("h5");
							translateHooks.push(this.addTranslationHook(question, "ConfirmDrawClear"));

							container.appendChild(question);
							container.appendChild(yesButton);
							container.appendChild(noButton);

							this._showDialog(container, () => {
								translateHooks.forEach(hook => {
									that.removeTranslationHook(hook);
								});
							});

							yesButton.focus();
						}
					},
					{
						name: "delete",
						text: this.translations.DeleteFeature,
						iconCls: "glyphicon glyphicon-remove-sign",
						fn: (...params) => {
							this._startDrawRemove();
						},
						finishFn: (...params) => this._finishDrawRemove()
					},
					{
						name: "reverse",
						iconCls: "glyphicon glyphicon-sort",
						text: this.translations.ReverseFeature,
						fn: (...params) => {
							this._startDrawReverse();
						},
						finishFn: (...params) => this._finishDrawReverse()
					},
					{
						name: "undo",
						text: this.translations.Undo,
						iconCls: "laji-map-line-transect-undo-glyph",
						fn: () => this.drawUndo(),
						onAdd: () => this.updateDrawUndoButton(),
						disabled: this._drawHistoryPointer <= 0
					},
					{
						name: "redo",
						text: this.translations.Redo,
						iconCls: "laji-map-line-transect-redo-glyph",
						fn: () => this.drawRedo(),
						onAdd: () => this.updateDrawRedoButton(),
						disabled: this._drawHistoryPointer >= this._drawHistory.length - 1
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
						fn: () => this.startLTLineSplit(),
						finishFn: () => this.stopLTLineSplit(),
						eventName: "lineTransect:split"
					},
					{
						name: "splitByMeters",
						text: this.translations.SplitLineByMeters,
						iconCls: "laji-map-line-transect-split-by-meters-glyph",
						fn: () => this.splitLTByMeters(),
						eventName: "lineTransect:split"
					},
					{
						name: "deletePoints",
						text: this.translations.ConnectSegments,
						iconCls: "laji-map-line-transect-remove-point-glyph",
						fn: () => this.startRemoveLTPointMode(),
						finishFn: () => this.stopRemoveLTPointMode(),
						eventName: "lineTransect:deletePoint"
					},
					{
						name: "createPoint",
						text: this.translations.CreatePoint,
						iconCls: "laji-map-line-transect-create-point-glyph",
						fn: () => this.startLTPointAdd(),
						finishFn: () => this.stopLTLineSplit(),
						eventName: "lineTransect:pointadd"
					},
					{
						name: "shiftPoint",
						text: this.translations.ShiftPoint,
						iconCls: "laji-map-line-transect-shift-point-glyph",
						fn: () => this.startLTPointShift(),
						finishFn: () => this.stopLTPointShift(),
						eventName: "lineTransect:pointshift"
					},
					{
						name: "undo",
						text: this.translations.Undo,
						iconCls: "laji-map-line-transect-undo-glyph",
						fn: () => this.LTUndo(),
						onAdd: () => this.updateLTUndoButton(),
						disabled: this._LTHistoryPointer <= 0
					},
					{
						name: "redo",
						text: this.translations.Redo,
						iconCls: "laji-map-line-transect-redo-glyph",
						fn: () => this.LTRedo(),
						onAdd: () => this.updateLTRedoButton(),
						disabled: !this._LTHistory || this._LTHistoryPointer >= this._LTHistory.length - 1
					}
				]
			}
		];

		const controlGroups = this.controlItems.reduce((groups, group) => {
			if (group.controls) groups[group.name] = group;
			return groups;
		}, {});

		if (this._customControls) {
			this._customControls.forEach(customControl => {
				customControl._custom = true;
				const target = customControl.group && controlGroups[customControl.group]
					? controlGroups[customControl.group].controls
					: this.controlItems;
				target.push(customControl);
			});
		}

		const that = this;

		function _createActionHandler(name, fn, eventName, text) {
			let cont = this.buttonActionContainer[name];

			const _that = this;

			function stop() {
				fn();
				that.map.off("controlClick", stopOnControlClick);
				that._removeKeyListener(ESC, stop);
				if (_that.container.contains(cont)) _that.container.removeChild(cont);
				if (eventName) that.map.off(eventName);
				if (_that.container.contains(cont)) _that.container.removeChild(cont);
				Object.keys(_that.buttonActions[name]).forEach(text => {
					cont.removeChild(_that.buttonActions[name][text]);
				});
				_that.buttonActions[name] = {};
				that.activeControl = undefined;
			}

			function stopOnControlClick({name: _name}: any) {
				if (name !== _name && name !== "zoom" && name !== "layer") stop();
			}

			if (!cont) {
				this.buttonActionContainer[name] = L.DomUtil.create("ul", "leaflet-draw-actions");
				cont = this.buttonActionContainer[name];
			}

			if (!this.buttonActions[name][text]) {
				const buttonWrapper = L.DomUtil.create("li");
				const button = that._createControlButton(this, buttonWrapper, stop);
				that.addTranslationHook(button, text);
				cont.appendChild(buttonWrapper);
				that.map.on("controlClick", stopOnControlClick);
				this.buttonActions[name][text] = buttonWrapper;
			}

			that._addKeyListener(ESC, stop, !!"high priority");
			if (eventName) that.map.on(eventName, stop);

			const parentBtn = that._controlButtons[name];
			cont.style.top = `${parentBtn.offsetTop}px`;
			cont.style.display = "block";

			this.container.appendChild(cont);
			that.activeControl = name;
		}

		function _createFinishHandler(name, fn, eventName) {
			this._createActionHandler(name, fn, eventName, "Finish");
		}

		function _createCancelHandler(name, fn, eventName) {
			this._createActionHandler(name, fn, eventName, "Cancel");
		}

		this._controlButtons = {};

		function callback(fn, finishFn, cancelFn, name, eventName) {return (...params) => {
			that.map.fire("controlClick", {name});
			if (finishFn) {
				fn(...params);
				this._createFinishHandler(name, finishFn, eventName);
				cancelFn && this._createCancelHandler(name, cancelFn, eventName);
			} else {
				fn(...params);
			}
		};}

		this.controlItems.filter(({control, name}) => {
			return !control || this._controlIsAllowed(name);
		}).forEach(({name, control, controls, position, iconCls, fn, finishFn, cancelFn, text, eventName, onAdd: _onAdd}) => {
			const leafletControl = (control ? control() : undefined) || (() => {
				const onAdd = (controls) ?
					function() {
						this.container = L.DomUtil.create("div", "leaflet-control laji-map-control leaflet-draw");
						this.buttonContainer = L.DomUtil.create("div", "leaflet-bar laji-map-control", this.container);
						this.buttonActionContainer = {};
						this.buttonActions = {};

						controls.forEach(({name: subName, iconCls, text, fn, finishFn, cancelFn, eventName, onAdd: _onAdd, _custom}) => {
							const buttonName = getSubControlName(name, subName);
							this.buttonActions[buttonName] = {};
							if (!that._controlIsAllowed(buttonName, _custom)) return;
							that._controlButtons[buttonName] = that._createControlItem(this, this.buttonContainer, iconCls, text, callback.apply(this, [fn, finishFn, cancelFn, buttonName, eventName]), buttonName);
							if (_onAdd) _onAdd();
						});

						return this.container;
					} : function() {
						const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control");
						that._controlButtons[name] = that._createControlItem(this, container, iconCls, text, callback.apply(this, [fn, finishFn, cancelFn, name, eventName]), name);
						if (_onAdd) _onAdd();
						return container;
					};

				if (controls && !controls.filter(({name: subName, _custom}) => that._controlIsAllowed(getSubControlName(name, subName), _custom)).length) {
					return;
				}

				const Control = L.Control.extend({
					options: position ? {position} : undefined,
					onAdd,
					_createActionHandler,
					_createFinishHandler,
					_createCancelHandler
				});
				return new Control();
			})();

			if (leafletControl) this._addControl(name, leafletControl);
		});

		// Hrefs cause map to scroll to top when a control is clicked. This is fixed below.

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

	updateDrawData(item: DrawOptions) {
		super.updateDrawData(item);
		if (isProvided(this, "draw")) {
			this._updateMapControls();
		}
	}

	@reflect()
	@dependsOn("customControls")
	_updateCustomControls() {
		if (!depsProvided(this, "_updateCustomControls", arguments)) return;
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

	setControlsWarn(controlSettings) {
		console.warn("laji-map warning: 'controlSettings' option is deprecated and will be removed in the future. 'controlSettings' option has been renamed 'controls'");
		this.setControls(controlSettings);
	}

	setControls(controlSettings: ControlsOptions | boolean) {
		let _controlSettings: InternalControlsOptions | boolean = JSON.parse(JSON.stringify(controlSettings));
		this.controlSettings = {
			draw: {
				marker: true,
				circle: true,
				rectangle: true,
				polygon: true,
				polyline: true,
			},
			drawUtils: {
				copy: false,
				upload: false,
				clear: false,
				reverse: false,
				delete: false,
				undo: true,
				redo: true,
				coordinateInput: true,
			},
			layer: true,
			zoom: true,
			location: {
				userLocation: true,
				search: true
			},
			coordinates: false,
			scale: true,
			attribution: true,
			lineTransect: {
				split: true,
				splitByMeters: true,
				deleteSegment: true,
				deletePoints: true,
				createPoint: true,
				shiftPoint: true,
				undo: true,
				redo: true
			},
			layerOpacity: true
		} as InternalControlsOptions;


		if (!_controlSettings) {
			_controlSettings = Object.keys(this.controlSettings).reduce((settings, key) => {
				settings[key] = false;
				return settings;
			}, {});
		}

		if (isObject(_controlSettings)) {
			const __controlSettings: InternalControlsOptions = <InternalControlsOptions> _controlSettings;
			if ("draw" in __controlSettings && !isObject(__controlSettings.draw)) {
				__controlSettings.drawUtils = __controlSettings.draw;
			}
			// BW compability for drawCopy etc, which were moved under controlSettings.draw
			["copy", "upload", "clear", "reverse", "delete", "undo", "redo"].forEach(name => {
				// Internally we use 'drawUtils' namespace, but for easier API we allow using 'draw'
				// namespace for the utils.
				if (isObject(__controlSettings.draw) && name in <DrawControlOptions> __controlSettings.draw) {
					if (!__controlSettings.drawUtils) __controlSettings.drawUtils = {};
					__controlSettings.drawUtils[name] = __controlSettings.draw[name];
				}
			});
			if ("coordinateInput" in __controlSettings) {
				console.error("laji-map error: controls.coordinateInput is deprecated and is removed. Please use controls.draw.coordinateInput");
			}

			for (let setting in __controlSettings) {
				if (!(setting in this.controlSettings)) continue;

				let newSetting = __controlSettings[setting];
				if (this.controlSettings[setting].constructor === Object) {
					if (__controlSettings[setting].constructor === Object) {
						newSetting = {...this.controlSettings[setting], ...__controlSettings[setting]};
					} else {
						newSetting = Object.keys(this.controlSettings[setting]).reduce((subSettings, subSetting) => {
							subSettings[subSetting] = __controlSettings[setting];
							return subSettings;
						}, {});
					}
				}
				this.controlSettings[setting] = newSetting;
			}

			if (this.controlSettings.draw && isObject(this.controlSettings.draw) &&  "coordinateInput" in (<any> this.controlSettings.draw)) {
				if (!isObject(this.controlSettings.drawUtils)) {
					this.controlSettings.drawUtils = {};
					this.controlSettings.drawUtils.coordinateInput = (<any> this.controlSettings.draw).coordinateInput;
				}
			}
		}

		provide(this, "controlSettings");
	}

	setCustomControls(controls: CustomControl[]) {
		this._customControls = controls;
		provide(this, "customControls");
	}


	_controlIsAllowed(name, custom = false) {
		const dependencies = {
			draw: [
				() => this.drawIsAllowed()
			],
			drawUtils: [
				() => this.drawIsAllowed()
			],
			"drawUtils.coordinateInput": [
				() => (["marker", "rectangle"].some(type => {
					return this.getDraw()[type] !== false;
				}))
			],
			"drawUtils.reverse": [
				() => this.getDraw().polyline !== false
			],
			lineTransect: [
				() => isProvided(this, "lineTransect"),
				() => this._LTEditable
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
					!(controlName in controlSettings) ||
					controlItem && // Pass custom controls
					dependenciesAreOk(controlName) &&
					(controlItem.constructor !== Object || Object.keys(controlItem).some(name => controlItem[name]))
				);
			} else {
				return (
					controlSettings[parentControl] === true ||
					(controlSettings[parentControl].constructor === Object && (controlSettings[parentControl][subControl] || custom))
				) && (
					dependenciesAreOk(parentControl) && dependenciesAreOk(`${parentControl}.${subControl}`)
				);
			}
		}

		return controlIsOk(name);
	}


	_addControl(name, control: L.Control) {
		if (control && this._controlIsAllowed(name) || (<any> control)._custom) {
			this.map.addControl(control);
			this.controls.push(control);
		}
	}

	_createControlButton(that: any, container, fn, name?): HTMLElement {
		const elem = L.DomUtil.create("a", name ? "button-" + name.replace(".", "_") : "", container);

		L.DomEvent.on(elem, "click", L.DomEvent.stopPropagation);
		L.DomEvent.on(elem, "mousedown", L.DomEvent.stopPropagation);
		L.DomEvent.on(elem, "click", L.DomEvent.preventDefault);
		L.DomEvent.on(elem, "click", that._refocusOnMap, that);
		L.DomEvent.on(elem, "click", fn);
		L.DomEvent.disableClickPropagation(container);

		return elem;
	}

	_createControlItem(that, container, glyphName, title, fn, name): HTMLElement {
		const elem = this._createControlButton(that, container, fn, name);
		L.DomUtil.create("span", glyphName, elem);
		elem.title = title;

		return elem;
	}

	_getDrawControl(): L.Control.Draw {
		const drawOptions: L.Control.DrawConstructorOptions = {
			position: "topright",
			edit: {
				featureGroup: this.getDraw().group,
				edit: false,
				remove: false
			},
			draw: {
				circlemarker: false
			}
		};

		drawOptions.draw = {
			...drawOptions.draw, ...this.getFeatureTypes().reduce((options, type: DataItemType) => {
				options[type] = (!this.getDraw() || this.getDraw()[type] === false || this.controlSettings.draw[type] === false) ?
					false : this._getDrawOptionsForType(type);
				return options;
			}, {})
		};


		this.drawControl = new L.Control.Draw(drawOptions);
		return this.drawControl;
	}


	_getCoordinatesControl(): L.Control {
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

				const coordinateTypes: any[] = [
					{name: "WGS84"},
					{name: "YKJ"},
					{name: "ETRS-TM35FIN"}
				];

				coordinateTypes.forEach(coordinateType => {
					const row = L.DomUtil.create("tr", undefined, table);
					coordinateType.nameCell = L.DomUtil.create("td", undefined, row);
					coordinateType.coordsCell = L.DomUtil.create("td", undefined, row);
				});

				that.map.on("mousemove", ({latlng}: L.LeafletMouseEvent) => {
					if (!visible) {
						container.style.display = "block";
						visible = true;
					}

					const [lng, lat] = that.wrapGeoJSONCoordinate([latlng.lng, latlng.lat]);
					const wgs84 = [lat, lng].map(c => c.toFixed(6));
					let ykj, etrsTm35Fin;
					try {
						ykj = convertLatLng([lat, lng], "WGS84", "EPSG:2393").reverse();
						etrsTm35Fin = convertLatLng([lat, lng], "WGS84", "EPSG:3067").reverse();
					} catch (e) {
						//
					}

					coordinateTypes.forEach(({name, nameCell, coordsCell}) => {
						let coords = wgs84;
						if (name === "YKJ") coords = ykj;
						else if (name === "ETRS-TM35FIN") coords = etrsTm35Fin;
						nameCell.innerHTML = `<strong>${name}:</strong>`;
						let coordsFormatted = undefined;
						if (coords) switch(name) {
						case "WGS84":
							coordsFormatted = coords.join(", ");
							break;
						case "YKJ":
							coordsFormatted = coords.join(":");
							break;
						case "ETRS-TM35FIN":
							coordsFormatted = `N=${coords[0]} E=${coords[1]}`;
						}
						coordsCell.innerHTML = coordsFormatted || "";
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

	_getLayerControl(opacityControl = true): L.Control.Layers {
		const baseMaps = {}, overlays = {};
		const {translations} = this;

		const tileLayersNames = Object.keys(this.availableTileLayers);

		tileLayersNames.forEach(tileLayerName => {
			baseMaps[translations[tileLayerName[0].toUpperCase() + tileLayerName.slice(1)]] = this.tileLayers[tileLayerName];
		});
		Object.keys(this.availableOverlaysByNames).forEach(overlayName => {
			//if (this._getDefaultCRSLayers().includes(this.tileLayer) && ONLY_MML_OVERLAY_NAMES.includes(overlayName)) return;
			overlays[translations[overlayName[0].toUpperCase() + overlayName.slice(1)]] = this.availableOverlaysByNames[overlayName];
		});

		const that = this;
		const LayerControl = L.Control.Layers.extend({
			onAdd: function (map) {
				const container = L.Control.Layers.prototype.onAdd.call(this, map);
				L.DomEvent.disableClickPropagation(container);
				map.on("moveend", () => this._checkDisabledLayers());
				return container;
			},
			_onInputClick: function (e) {
				if (!e) return;

				const inputs: NodeListOf<HTMLInputElement> = that.rootElem.querySelectorAll(".laji-map .leaflet-control-layers-list input");

				const overlayIdsToAdd = (that.overlays || []).reduce((ids, overlay) => {
					ids[L.Util.stamp(overlay)] = true;
					return ids;
				}, {});
				for (let i = 0; i < inputs.length; i++) {
					const input = inputs[i];
					if (input.checked) {
						for (let tileLayerName of tileLayersNames) {
							if (L.Util.stamp(that.tileLayers[tileLayerName]) === (<any> input).layerId) {
								that.setTileLayer(that.tileLayers[tileLayerName]);
								break;
							}
						}
					}

					for (let overlayName of Object.keys(that.availableOverlaysByNames)) {
						const overlay = that.overlaysByNames[overlayName];
						if (L.Util.stamp(overlay) === (<any> input).layerId) {
							overlayIdsToAdd[(<any> input).layerId] = input.checked;
						}
					}
				}

				let overlaysToAdd = [];
				for (let overlayName of Object.keys(that.availableOverlaysByNames)) {
					const overlay = that.overlaysByNames[overlayName];
					if (overlayIdsToAdd[L.Util.stamp(overlay)]) {
						overlaysToAdd.push(overlay);
					}
				}

				if (overlaysToAdd.some(overlay => !(that.overlays || []).includes(overlay)) ||
					(that.overlays || []).some(overlay => !overlaysToAdd.includes(overlay))) {
					that.setOverlays(overlaysToAdd);
				}

				this._handlingClick = false;

				that.layerControl.expand();
				that.map.fire("controlClick", {name: "layer"});
			},
			_initLayout: function() {
				(<any> L.Control.Layers.prototype)._initLayout.call(this);

				if (!opacityControl) return;

				function disableSelect(e) {
					e.preventDefault();
				}

				const sliderContainer = document.createElement("div");
				sliderContainer.className = "slider-container";

				const sliderLabel = document.createElement("label");
				that.addTranslationHook(sliderLabel, "TileLayerOpacityLabel");
				sliderContainer.appendChild(sliderLabel);

				const sliderInput = document.createElement("div");
				sliderContainer.appendChild(sliderInput);

				this._separator.parentElement.insertBefore(sliderContainer, layerControl._separator);

				const sliderSeparator = document.createElement("div");
				sliderSeparator.className = "leaflet-control-layers-separator";
				sliderContainer.parentElement.insertBefore(sliderSeparator, sliderContainer);

				const _noUiSlider = noUiSlider.create(sliderInput, {
					start: that.tileLayerOpacity !== undefined ? that.tileLayerOpacity : 1,
					range: {
						min: [0],
						max: [1]
					},
					step: 0.01,
					connect: [true, false],
					behaviour: "snap"
				});
				_noUiSlider.on("update", () => {
					that._opacitySetBySlide = true;
					that.setTileLayerOpacity(_noUiSlider.get());
				});
				_noUiSlider.on("end", () => {
					that.map.fire("tileLayerOpacityChangeEnd", {tileLayerOpacity: _noUiSlider.get()});
				});
				_noUiSlider.on("start", () => {
					document.addEventListener("selectstart", disableSelect);
				});
				_noUiSlider.on("end", () => {
					document.removeEventListener("selectstart", disableSelect);
				});

				that._slider = _noUiSlider;
			},
			_checkDisabledLayers: function() {
				if (!this._map) return;
				(<any> L.Control.Layers.prototype)._checkDisabledLayers.call(this);
				const labels = [
					...Array.prototype.slice.call(this._baseLayersList.children, 0),
					...Array.prototype.slice.call(this._overlaysList.children, 0)
				];

				const inputs = this._layerControlInputs;
				for (let i = inputs.length - 1; i >= 0; i--) {
					const input = inputs[i];
					const layer = this._getLayer(input.layerId).layer;
					const label = labels[i];

					// Prevents default behaviour where Leaflet disables layers if their maxZoom is exceeded.
					input.disabled = false;
					label.className = "";

					if (that._isOutsideFinland(that.map.getCenter()) && that._getMMLCRSLayers().includes(layer)) {
						input.disabled = true;
						label.className = "disabled";
						if (i === 0) {
							if (!this._outsideFinlandInfoSpan) {
								this._outsideFinlandInfoSpanContainer = document.createElement("div");
								this._outsideFinlandInfoSpan = document.createElement("span");
								that.addTranslationHook(this._outsideFinlandInfoSpan, "OutsideFinlandLayerControlInfo");
								this._outsideFinlandInfoSpan.className = "info";
								this._outsideFinlandInfoSpanContainer.appendChild(this._outsideFinlandInfoSpan);
							}
							label.parentElement.parentElement.insertBefore(this._outsideFinlandInfoSpanContainer, label.parentElement);
						}
					} else if (this._outsideFinlandInfoSpanContainer && this._outsideFinlandInfoSpanContainer.parentElement) {
						this._outsideFinlandInfoSpanContainer.parentElement.removeChild(this._outsideFinlandInfoSpanContainer);
					}
					if (that._getDefaultCRSLayers().includes(that.tileLayer) && ONLY_MML_OVERLAY_NAMES.map(n => that.overlaysByNames[n]).includes(layer)) {
						label.style["text-decoration"] = "line-through";
						if (i === inputs.length - 1) {
							if (!this._onlyMMLInfoSpan) {
								this._onlyMMLInfoSpanContainer = document.createElement("div");
								this._onlyMMLInfoSpan = document.createElement("span");
								that.addTranslationHook(this._onlyMMLInfoSpan, "OnlyMMLLayersInfo");
								this._onlyMMLInfoSpan.className = "info";
								this._onlyMMLInfoSpanContainer.appendChild(this._onlyMMLInfoSpan);
							}
							label.parentElement.parentElement.appendChild(this._onlyMMLInfoSpanContainer);
						}
					}
				}
			}
		});

		const layerControl = new LayerControl(baseMaps, overlays, {position: "topleft"});
		this.layerControl = layerControl;
		return layerControl;
	}

	getZoomControl(): L.Control.Zoom {
		const that = this;
		const ZoomControl = L.Control.Zoom.extend({
			onZoomClick: function() {
				that.map.fire("controlClick", {name: "zoom"});
			},
			onAdd: function(map) {
				const container = L.Control.Zoom.prototype.onAdd.call(this, map);
				L.DomEvent.disableClickPropagation(container);
				this._zoomInButton.addEventListener("click", this.onZoomClick);
				this._zoomOutButton.addEventListener("click", this.onZoomClick);
				return container;
			},
			onRemove: function(map) {
				L.Control.Zoom.prototype.onRemove.call(this, map);
				this._zoomInButton.removeEventListener("click", this.onZoomClick);
				this._zoomOutButton.removeEventListener("click", this.onZoomClick);
			}
		});
		return new ZoomControl({
			zoomInTitle: this.translations.ZoomIn,
			zoomOutTitle: this.translations.ZoomOut
		});
	}

	setTileLayerOpacity(opacity, triggerEvent?) {
		super.setTileLayerOpacity(opacity, triggerEvent);
		if (!this._opacitySetBySlide && this._slider) {
			this._slider.set(opacity);
		}
		this._opacitySetBySlide = false;
	}

	setLineTransectGeometry(feature, undo) {
		super.setLineTransectGeometry(feature, undo);
		this.updateLTUndoButton();
		this.updateLTRedoButton();
	}

	resetDrawUndoStack() {
		super.resetDrawUndoStack();
		this.updateDrawUndoButton();
		this.updateDrawRedoButton();
	}

	_updateDrawUndoStack(events: LajiMapEvent[] | LajiMapEvent, prevFeatureCollection, prevActiveIdx?) {
		super._updateDrawUndoStack(events, prevFeatureCollection, prevActiveIdx);
		this.updateDrawUndoButton();
		this.updateDrawRedoButton();
	}

	drawUndo() {
		super.drawUndo();
		this.updateDrawUndoButton();
		this.updateDrawRedoButton();
	}

	drawRedo() {
		super.drawRedo();
		this.updateDrawUndoButton();
		this.updateDrawRedoButton();
	}

	_updateUndoButton(buttonName, history, historyPointer) {
		const undoButton = this._controlButtons && this._controlButtons[buttonName];
		if (!undoButton) return;

		if (historyPointer <= 0 && !undoButton.className.includes("leaflet-disabled")) {
			undoButton.className += " leaflet-disabled";
		} else if (historyPointer > 0 && historyPointer < history.length && undoButton.className.includes("leaflet-disabled")) {
			undoButton.className = undoButton.className.replace(" leaflet-disabled", "");
		}
		if (this._contextMenuItems) {
			const contextMenuItem = this._contextMenuItems[buttonName];
			if (contextMenuItem) this.map.contextmenu.setDisabled(contextMenuItem, historyPointer <= 0);
		}
	}

	_updateRedoButton(buttonName, history, historyPointer) {
		const redoButton = this._controlButtons && this._controlButtons[buttonName];
		if (!redoButton) return;

		if (historyPointer >= history.length - 1 && !redoButton.className.includes("leaflet-disabled")) {
			redoButton.className += " leaflet-disabled";
		} else if (historyPointer >= 0 && historyPointer < history.length - 1 && redoButton.className.includes("leaflet-disabled")) {
			redoButton.className = redoButton.className.replace(" leaflet-disabled", "");
		}

		if (this._contextMenuItems) {
			const contextMenuItem = this._contextMenuItems[buttonName];
			if (contextMenuItem) this.map.contextmenu.setDisabled(contextMenuItem, historyPointer >= history.length - 1);
		}
	}

	@dependsOn("controls", "contextMenu")
	updateLTUndoButton() {
		if (!depsProvided(this, "updateLTUndoButton", arguments)) return;
		this._updateUndoButton("lineTransect.undo", this._LTHistory, this._LTHistoryPointer);
	}

	@dependsOn("controls", "contextMenu")
	updateLTRedoButton() {
		if (!depsProvided(this, "updateLTRedoButton", arguments)) return;
		this._updateRedoButton("lineTransect.redo", this._LTHistory, this._LTHistoryPointer);
	}

	@dependsOn("controls", "contextMenu")
	updateDrawUndoButton() {
		if (!depsProvided(this, "updateDrawUndoButton", arguments)) return;
		this._updateUndoButton("drawUtils.undo", this._drawHistory, this._drawHistoryPointer);
	}

	@dependsOn("controls", "contextMenu")
	updateDrawRedoButton() {
		if (!depsProvided(this, "updateDrawRedoButton", arguments)) return;
		this._updateRedoButton("drawUtils.redo", this._drawHistory, this._drawHistoryPointer);
	}

	openCoordinatesInputDialog() {
		const that = this;
		const translateHooks = [];

		function createCoordinateInput(id, translationKey) {
			const input = createTextInput();
			input.id = `laji-map-${id}`;

			const label = document.createElement("label");
			label.setAttribute("for", input.id);
			translateHooks.push(that.addTranslationHook(label, translationKey));

			const row = document.createElement("div");
			row.className = "form-group row";

			const col = document.createElement("div");
			col.className = "col-xs-12";

			[label, input].forEach(elem => col.appendChild(elem));
			row.appendChild(col);

			return row;
		}

		function formatter(input) {
			return e => {
				let charCode = (typeof e.which === "undefined") ? e.keyCode : e.which;

				if (charCode >= 48 && charCode <= 57) { // Is a number
					// The input cursor isn't necessary at the EOL, but this validation works regardless.
					inputValidate(e, input.value + String.fromCharCode(charCode));
				}
			};
		}

		const ykjAllowed = that.getDraw().rectangle;
		const etrsTm35FinAllowed = that.getDraw().marker;
		const wgs84Allowed = that.getDraw().marker;

		const inputRegexp = wgs84Allowed ? /^(-?[0-9]+(\.|,)?[0-9]*|-?)$/ : /^[0-9]*$/;

		function inputValidate(e, value) {
			if (!value.match(inputRegexp)) {
				if (e) e.preventDefault();
				return false;
			}
			return true;
		}

		function submitValidate(inputValues) {
			const validators = [];
			if (wgs84Allowed) validators.push(wgs84Validator);
			if (ykjAllowed) validators.push(ykjValidator, ykjGridStrictValidator);
			if (etrsTm35FinAllowed) validators.push(etrsTm35FinValidator);
			return validators.some(validator => validateLatLng(inputValues, validator));
		}

		const container = document.createElement("form");
		container.className = "laji-map-coordinates";

		const latLabelInput = createCoordinateInput("coordinate-input-lat", "Latitude");
		const lngLabelInput = createCoordinateInput("coordinate-input-lng", "Longitude");
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
			const rectangleAllowed = that.getDraw().rectangle;
			if (rectangleAllowed) help = that.translations.EnterYKJRectangle;
			if (that.getDraw().marker) {
				if (rectangleAllowed) help += ` ${that.translations.or} ${that.translations.enterWgs84Coordinates} ${that.translations.or} ${that.translations.enterETRSTM35FINCoordinates}`;
				else help = `${that.translations.EnterWgs84Coordinates} ${that.translations.or} ${that.translations.enterETRSTM35FINCoordinates}`;
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
				const target = <HTMLInputElement> e.target;
				if (!inputValidate(e, target.value)) {
					target.value = prevVal;
				}
				target.value = target.value.replace(",", ".");
				prevVal = target.value;

				inputValues[i] = target.value;
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

		function convert(coords, crs: CRSString = "EPSG:2393") {
			return convertLatLng(coords, crs, "WGS84");
		}

		container.addEventListener("submit", e => {
			e.preventDefault();

			const latlngStr = [latInput.value, lngInput.value];
			const latlng = latlngStr.map(parseFloat);

			const isWGS84Coordinates = validateLatLng(latlngStr, wgs84Validator);
			const isETRS = validateLatLng(latlngStr, etrsTm35FinValidator);
			const isYKJ = validateLatLng(latlngStr, ykjValidator);
			const isYKJGrid = validateLatLng(latlngStr, ykjGridStrictValidator);

			let geometry = {
				type: "Point",
				coordinates: (isYKJ)
					? convert(latlng.map(toYKJFormat), "EPSG:2393")
					: (isETRS)
						? convert(latlng, "EPSG:3067")
						: (isWGS84Coordinates)
							? latlng.reverse()
							: null
			};

			const feature = {
				type: "Feature",
				geometry: geometry,
				properties: {}
			};

			if (isYKJGrid) {
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
				].map(coordinatePair => convert(coordinatePair, "EPSG:2393"))];
			}

			const layer = this._featureToLayer(this.getDraw().getFeatureStyle)(feature);
			const isMarker = layer instanceof L.Marker;

			this._onAdd(this.drawIdx, layer, latInput.value + ":" + lngInput.value);
			const center = (isMarker) ? layer.getLatLng() : layer.getBounds().getCenter();
			this.map.setView(center, this.map.getZoom(), {animate: false});
			if (isMarker) {
				if (this.getDraw().cluster) (<L.MarkerClusterGroup> this.getDraw().groupContainer).zoomToShowLayer(layer);
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
		table.className = "laji-map-draw-copy-table";

		const HTMLInput = createTextArea(10, 50);
		HTMLInput.setAttribute("readonly", "readonly");
		HTMLInput.addEventListener("focus", HTMLInput.select);

		const features = this.getDraw().featureCollection.features.map(this.formatFeatureOut);
		const originalGeoJSON = {...this.getDraw().featureCollection, features};

		function converterFor(proj) {
			return input => {
				const reprojected = convertGeoJSON(input, "WGS84", proj);
				(<any> reprojected).crs = getCRSObjectForGeoJSON(reprojected, proj);
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
					"ETRS-TM35FIN": input => converterFor("EPSG:3067")(standardizeGeoJSON(input))
				},
				position: TOP
			},
			{ // GeoJSON -> String
				commands: {
					GeoJSON: input => JSON.stringify(input, undefined, 2),
					"ISO 6709": geoJSONToISO6709,
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
					const {scrollTop, scrollLeft} = HTMLInput;
					setActiveTab(tab, label);
					updateOutput();
					HTMLInput.scrollTop = scrollTop;
					HTMLInput.scrollLeft = scrollLeft;
				});

				return tab;
			}).forEach(tab => tabs.appendChild(tab));

			let tabsArr = topTabs;
			if (position === LEFT) tabsArr = leftTabs;
			tabsArr.push(tabContainer);
		});

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
		updateOutput();
	}

	openDrawUploadDialog() {
		const container = document.createElement("form");

		const textarea = createTextArea(10, 50);
		textarea.className += " form-group";

		const button = document.createElement("button");
		button.setAttribute("type", "submit");
		button.className = "btn btn-block btn-primary";

		let translationsHooks = [];
		translationsHooks.push(this.addTranslationHook(button, "UploadDrawnFeatures"));
		button.setAttribute("disabled", "disabled");

		textarea.oninput = (e) => {
			const {value} = <HTMLInputElement> e.target;
			if (value === "") {
				updateInfo();
				button.setAttribute("disabled", "disabled");
				if (container.className.includes(" has-error")) container.className = container.className.replace(" has-error", "");
			}
			try {
				const format = detectFormat(value);
				const crs = detectCRS(value);
				const valid = convertAnyToWGS84GeoJSON(value);

				updateInfo(format, crs);
				if (format && crs && valid) {
					button.removeAttribute("disabled");
					if (alert) {
						container.removeChild(alert);
						alert = undefined;
					}
				} else {
					button.setAttribute("disabled", "disabled");
				}
				if (container.className.includes(" has-error")) container.className = container.className.replace(" has-error", "");
			} catch (e) {
				if (value !== "" && !container.className.includes("has-error")) container.className += " has-error";
				updateInfo();
			}
		};

		const that = this;

		const formatContainer = document.createElement("div");
		const crsContainer = document.createElement("div");
		const formatInfo = document.createElement("span");
		const crsInfo = document.createElement("span");
		const formatValue = document.createElement("span");
		const crsValue = document.createElement("span");

		formatContainer.className = "form-group text-success";
		crsContainer.className = "form-group text-success";

		formatContainer.appendChild(formatInfo);
		formatContainer.appendChild(formatValue);
		crsContainer.appendChild(crsInfo);
		crsContainer.appendChild(crsValue);

		translationsHooks.push(that.addTranslationHook(formatInfo, () => `${this.translations.DetectedFormat}: `));
		translationsHooks.push(that.addTranslationHook(crsInfo, () => `${this.translations.DetectedCRS}: `));

		updateInfo();

		function updateInfo(format = "", crs = "") {
			if (format) {
				formatContainer.style.display = "block";
			} else {
				formatContainer.style.display = "none";
			}
			if (crs) {
				crsContainer.style.display = "block";
			} else {
				crsContainer.style.display = "none";
			}
			formatValue.innerHTML = format;
			crsValue.innerHTML = that.translations[crs] ? that.translations[crs] : crs;
		}

		let alert = undefined;
		let alertTranslationHook = undefined;

		function updateAlert(error) {
			if (alert) container.removeChild(alert);
			alert = document.createElement("div");
			alert.className = "alert alert-danger";
			if (alertTranslationHook) that.removeTranslationHook(alertTranslationHook);
			alertTranslationHook = that.addTranslationHook(alert, () => stringifyLajiMapError(error, that.translations));
			container.appendChild(alert);
		}

		function convertText(e) {
			e.preventDefault();
			try {
				const prevFeatureCollection = {
					type: "FeatureCollection",
					features: that.cloneFeatures(that.getDraw().featureCollection.features)
				};
				const events: LajiMapEvent[] = [{
					type: "delete",
					idxs: Object.keys(that.idxsToIds[that.drawIdx]).map(idx => parseInt(idx))
				}];
				that.updateDrawData(<DrawOptions> {...that.getDraw(), featureCollection: undefined, geoData: textarea.value});
				that.getDraw().featureCollection.features.forEach(feature => {
					events.push({type: "create", feature});
				});
				that._triggerEvent(events, that.getDraw().onChange);
				that._updateDrawUndoStack(events, prevFeatureCollection);
				that._closeDialog(e);
			} catch (e) {
				updateAlert(e);
				throw e;
			}
			const bounds = that.getDraw().group.getBounds();
			if (Object.keys(bounds).length) that.map.fitBounds(bounds);
		}

		button.addEventListener("click", convertText);

		container.appendChild(textarea);
		container.appendChild(formatContainer);
		container.appendChild(crsContainer);
		container.appendChild(button);

		this._showDialog(container, () => {
			translationsHooks.forEach(hook => this.removeTranslationHook(hook));
			if (alertTranslationHook) this.removeTranslationHook(alertTranslationHook);
		});

		textarea.focus();
		textarea.select();
	}

	_joinTranslations(...words) {
		const {translations} = this;
		return words.map(word => translations[word]).join(" ");
	}

	@reflect()
	@dependsOn("controls")
	_updateContextMenu() {
		if (!depsProvided(this, "_updateContextMenu", arguments)) return;

		const join = (...params) => this._joinTranslations(...params);

		this.map.contextmenu.removeAllItems();
		this._contextMenuItems = {};

		let groupAdded = false;

		this.getFeatureTypes().forEach(featureType => {
			const text = join("Draw", featureType);

			if (this.getDraw() && this.getDraw()[featureType] !== false && this.controlSettings.draw[featureType] !== false) {
				this._contextMenuItems[`draw.${featureType}`] = this.map.contextmenu.addItem({
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
				const controlName = getSubControlName(groupName, control.name);
				if ("text" in control && this._controlIsAllowed(controlName)) {
					this._contextMenuItems[controlName] = this.map.contextmenu.addItem({
						...control,
						callback: () => (<HTMLButtonElement> this.container.querySelector(`.button-${controlName.replace(".", "_")}`)).click()
					});
					groupAdded = true;
				}
			});
		};
		this.controlItems.filter(item => item.contextMenu !== false).forEach(control => addControlGroup(control.controls ? control.name : undefined, control.controls ? control.controls : [control]));

		provide(this, "contextMenu");
	}

	triggerDrawing(featureType: DataItemType) {
		try {
			(<any> this.drawControl)._toolbars.draw._modes[featureType.toLowerCase()].handler.enable();
			this.addDrawAbortListeners();
		} catch (e) {
			super.triggerDrawing(featureType);
		}
	}

	shouldNotPreventScrolling() : boolean {
		return super.shouldNotPreventScrolling() || !!this.activeControl;
	}
}
//} return <typeof LajiMap> LajiMapWithControls; };