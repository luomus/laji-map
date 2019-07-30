import * as L from "leaflet";
import * as G from "geojson";
import { GeoSearchControl } from "leaflet-geosearch";
import LajiMap from "./map";
import { DrawOptions, DataItemType, LajiMapEvent, TileLayerOptions } from "./map.defs";
import {
	convertGeoJSON, convertLatLng, standardizeGeoJSON, geoJSONToISO6709, geoJSONToWKT, getCRSObjectForGeoJSON,
	detectFormat, detectCRS, convertAnyToWGS84GeoJSON, validateLatLng, ykjGridStrictValidator, etrsTm35FinGridStrictValidator, wgs84Validator,
	ykjValidator, etrsTm35FinValidator, stringifyLajiMapError, createTextInput, createTextArea, isObject, CRSString,
	capitalizeFirstLetter, renderLajiMapError, reverseCoordinate
} from "./utils";
import {
	ESC,
	ONLY_MML_OVERLAY_NAMES,
	EPSG2393String,
	EPSG2393WKTString,
	EPSG3067String,
	EPSG3067WKTString,
} from "./globals";
import { dependsOn, depsProvided, provide, reflect, isProvided } from "./dependency-utils";
import * as noUiSlider from "nouislider";
import {
	ControlOptions, ControlsOptions, CustomControl, DrawControlOptions,
	InternalControlsOptions
} from "./controls.defs";

function getSubControlName(name, subName) {
	return (name !== undefined) ? `${name}.${subName}` : subName;
}

type Constructor<LM> = new(...args: any[]) => LM;
export default function LajiMapWithControls<LM extends Constructor<LajiMap>>(Base: LM) { class LajiMapWithControls extends Base { // tslint:disable-line

	controls: L.Control[];
	_customControls: CustomControl[];
	layerControl: L.Control.Layers;
	controlItems: ControlOptions[];
	_controlItemsByName: {[controlName: string]: ControlOptions};
	activeControl: L.Control;
	controlSettings: InternalControlsOptions;
	drawControl: L.Control.Draw;
	_locateOn: boolean;
	_controlButtons: {[controlName: string]: HTMLElement};
	_opacitySetBySlide: boolean;
	_slider: any;
	_contextMenuItems: {[buttonName: string]: HTMLElement};
	_internalTileLayersUpdate: boolean;

	getOptionKeys() {
		return {
			...super.getOptionKeys(),
			controlSettings: "setControlsWarn",
			controls: ["setControls", () => this.controlSettings],
			customControls: ["setCustomControls", () => {
				return this._customControls === undefined
					? this._customControls
					: this._customControls.map(({_custom, ...rest}) => {
						return {...rest};
					});
			}]
		};
	}

	_setLang() {
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
		super.setLang(lang, !"dontProvide");
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
		// TODO Poista kommentit kun laji.fi havaintokartan neliöllä rajaus bugi korjattu.
		// Jostain syystä draw:created -> this._onAdd ei triggeröidy.
		// this.map.on("draw:created", e => {
		// 	cancelDraw(e);
		// });
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

	setTileLayers(options) {
		const provided = isProvided(this, "tileLayer");
		super.setTileLayers(options);
		if (!provided && isProvided(this, "tileLayer")) {
			this._updateMapControls();
		}
	}

	@reflect()
	@dependsOn("controls")
	_updateUserLocate(value) {
		if (!depsProvided(this, "_updateUserLocate", arguments)) return;
		this._locateOn = value !== undefined ? value : this._locateOn;
		const button = this._controlButtons.location;
		if (!button) return;
		if (this._locateOn && button.className.indexOf(" on") === -1) {
			button.className = `${button.className} on`;
		} else if (!this._locateOn && button.className.indexOf(" on") !== -1) {
			button.className = button.className.replace(" on", "");
		}
		if (!this._located && button.className.indexOf(" locating") === -1) {
			button.className = `${button.className} locating`;
		} else if (this._located && button.className.indexOf(" locating") !== -1) {
			button.className = button.className.replace(" locating", "");
		}
	}

	@reflect()
	@dependsOn("map", "translations", "controlSettings")
	_updateMapControls() {
		if (!depsProvided(this, "_updateMapControls", arguments)) return;

		const controlContainerNode = this.container.querySelector(".leaflet-control-container");

		if (controlContainerNode.className.indexOf("leaflet-touch") === -1) {
			controlContainerNode.className += " leaflet-touch";
		}

		(this.controls || []).forEach(control => {
			if (control) this.map.removeControl(control);
		});

		this.controls = [];

		this.controlItems = [
			{
				name: "layer",
				control: () => this._getLayerControl()
			},
			{
				name: "location",
				position: "topleft",
				text: this.translations.Geolocate,
				iconCls: "glyphicon glyphicon-screenshot",
				fn: () => this._toggleLocate(),
				contextMenu: false
			},
			{
				name: "geocoding",
				control: () => this.getGoogleGeocodingControl(),
				dependencies: [
					() => !!this.googleApiKey
				]
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
				control: () => this._getDrawControl(),
				dependencies: [
					() => this.drawIsEditable()
				]
			},
			{
				name: "drawUtils",
				dependencies: [
					() => this.drawIsAllowed()
				],
				controls: [
					{
						name: "coordinateInput",
						text: this.translations.AddFeatureByCoordinates,
						iconCls: "laji-map-coordinate-input-glyph",
						fn: () => this.openCoordinatesInputDialog(),
						dependencies: [
							() => (["marker", "rectangle"].some(type => {
								return this.getDraw()[type] !== false;
							})),
							() => this.drawIsEditable()
						]
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
						fn: () => this.openDrawUploadDialog(),
						dependencies: [
							() => this.drawIsEditable()
						]
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
						},
						dependencies: [
							() => this.drawIsEditable()
						]

					},
					{
						name: "delete",
						text: this.translations.DeleteFeature,
						iconCls: "glyphicon glyphicon-remove-sign",
						fn: (...params) => {
							this._startDrawRemove();
						},
						finishFn: (...params) => this._finishDrawRemove(),
						dependencies: [
							() => this.drawIsEditable()
						]

					},
					{
						name: "reverse",
						iconCls: "glyphicon glyphicon-sort",
						text: this.translations.ReverseFeature,
						fn: (...params) => {
							this._startDrawReverse();
						},
						finishFn: (...params) => this._finishDrawReverse(),
						dependencies: [
							() => this.getDraw().polyline !== false,
							() => this.drawIsEditable()
						]
					},
					{
						name: "undo",
						text: this.translations.Undo,
						iconCls: "laji-map-line-transect-undo-glyph",
						fn: () => this.drawUndo(),
						onAdd: () => this.updateDrawUndoButton(),
						disabled: this._drawHistoryPointer <= 0,
						dependencies: [
							() => this.drawIsEditable()
						]
					},
					{
						name: "redo",
						text: this.translations.Redo,
						iconCls: "laji-map-line-transect-redo-glyph",
						fn: () => this.drawRedo(),
						onAdd: () => this.updateDrawRedoButton(),
						disabled: this._drawHistoryPointer >= this._drawHistory.length - 1,
						dependencies: [
							() => this.drawIsEditable()
						]
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
						fn: () => (<any> this).startLTLineSplit(),
						finishFn: () => (<any> this).stopLTLineSplit(),
						eventName: "lineTransect:split"
					},
					{
						name: "splitByMeters",
						text: this.translations.SplitLineByMeters,
						iconCls: "laji-map-line-transect-split-by-meters-glyph",
						fn: () => (<any> this).splitLTByMeters(),
						eventName: "lineTransect:split"
					},
					{
						name: "deletePoints",
						text: this.translations.ConnectSegments,
						iconCls: "laji-map-line-transect-remove-point-glyph",
						fn: () => (<any> this).startRemoveLTPointMode(),
						finishFn: () => (<any> this).stopRemoveLTPointMode(),
						eventName: "lineTransect:deletePoint"
					},
					{
						name: "createPoint",
						text: this.translations.CreatePoint,
						iconCls: "laji-map-line-transect-create-point-glyph",
						fn: () => (<any> this).startLTPointAdd(),
						finishFn: () => (<any> this).stopLTLineSplit(),
						eventName: "lineTransect:pointadd"
					},
					{
						name: "shiftPoint",
						text: this.translations.ShiftPoint,
						iconCls: "laji-map-line-transect-shift-point-glyph",
						fn: () => (<any> this).startLTPointShift(),
						finishFn: () => (<any> this).stopLTPointShift(),
						eventName: "lineTransect:pointshift"
					},
					{
						name: "undo",
						text: this.translations.Undo,
						iconCls: "laji-map-line-transect-undo-glyph",
						fn: () => (<any> this).LTUndo(),
						onAdd: () => this.updateLTUndoButton(),
						disabled: (<any> this)._LTHistoryPointer <= 0
					},
					{
						name: "redo",
						text: this.translations.Redo,
						iconCls: "laji-map-line-transect-redo-glyph",
						fn: () => (<any> this).LTRedo(),
						onAdd: () => this.updateLTRedoButton(),
						disabled: !(<any> this)._LTHistory || (<any> this)._LTHistoryPointer >= (<any> this)._LTHistory.length - 1
					}
				],
				dependencies: [
					() => isProvided(this, "lineTransect"),
					() => (<any> this)._LTEditable
				],
			}
		];

		const controlGroups = this.controlItems.reduce((groups, group) => {
			if (group.controls) groups[group.name] = group;
			return groups;
		}, {});

		if (this._customControls) {
			this._customControls = this._customControls.map(customControl => {
				customControl = <any> {...customControl, _custom: true};
				const target = customControl.group && controlGroups[customControl.group]
					? controlGroups[customControl.group].controls
					: this.controlItems;
				target.push(customControl);
				return customControl;
			});
		}

		const reducer = (prefix = "") => (byNames, controlItem) => {
			byNames[`${prefix}${controlItem.name}`] = controlItem;
			if (controlItem.controls) {
				controlItem.controls.reduce(reducer(`${controlItem.name}.`), byNames);
			}
			return byNames;
		};

		this._controlItemsByName = this.controlItems.reduce(reducer(), {});

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
				Object.keys(_that.buttonActions[name]).forEach(_text => {
					cont.removeChild(_that.buttonActions[name][_text]);
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
		}; }

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

						controls.forEach(({
							name: subName,
							iconCls: subIconCls,
							text: subText,
							fn: subFn,
							finishFn: subFinishFn,
							cancelFn: subCancelFn,
							eventName: subEventName,
							onAdd: subOnAdd,
							_custom
						}) => {
							const buttonName = getSubControlName(name, subName);
							this.buttonActions[buttonName] = {};
							if (!that._controlIsAllowed(buttonName, _custom)) return;
							that._controlButtons[buttonName] = that._createControlItem(
								this,
								this.buttonContainer,
								subIconCls,
								subText,
								callback.apply(this, [subFn, subFinishFn, subCancelFn, buttonName, subEventName]),
								buttonName
							);
							if (subOnAdd) subOnAdd();
						});

						return this.container;
					} : function() {
						const container = L.DomUtil.create("div", "leaflet-bar leaflet-control laji-map-control");
						that._controlButtons[name] = that._createControlItem(
							this,
							container,
							iconCls,
							text,
							callback.apply(this, [fn, finishFn, cancelFn, name, eventName]),
							name
						);
						if (_onAdd) _onAdd();
						return container;
					};

				const noneAllowed = controls
					&& !controls.filter(({name: subName, _custom}) =>
						that._controlIsAllowed(getSubControlName(name, subName), _custom)
					).length;

				if (noneAllowed) {
					return;
				}

				const Control = L.Control.extend({ // tslint:disable-line
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
			for (let i = 0; i < elems.length; i++) {  // tslint:disable-line
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

	setControlsWarn(controlSettings) {
		console.warn("laji-map warning: 'controlSettings' option is deprecated and will be removed in the future. 'controlSettings' option has been renamed 'controls'"); // tslint:disable-line
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
			location: true,
			geocoding: true,
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
			const subControlSettings: InternalControlsOptions = <InternalControlsOptions> _controlSettings;
			if ("draw" in subControlSettings && !isObject(subControlSettings.draw)) {
				subControlSettings.drawUtils = subControlSettings.draw;
			}
			// BW compability for drawCopy etc, which were moved under controlSettings.draw
			["copy", "upload", "clear", "reverse", "delete", "undo", "redo", "coordinateInput"].forEach(name => {
				// Internally we use 'drawUtils' namespace, but for easier API we allow using 'draw'
				// namespace for the utils.
				if (isObject(subControlSettings.draw) && name in <DrawControlOptions> subControlSettings.draw) {
					if (!subControlSettings.drawUtils) subControlSettings.drawUtils = {};
					subControlSettings.drawUtils[name] = subControlSettings.draw[name];
				}
			});
			if ("coordinateInput" in subControlSettings) {
				console.error("laji-map error: controls.coordinateInput is deprecated and is removed. Please use controls.draw.coordinateInput"); // tslint:disable-line
			}

			for (let setting in subControlSettings) {
				if (!(setting in this.controlSettings)) continue;

				let newSetting = subControlSettings[setting];
				if (this.controlSettings[setting].constructor === Object) {
					if (subControlSettings[setting].constructor === Object) {
						newSetting = {...this.controlSettings[setting], ...subControlSettings[setting]};
					} else {
						newSetting = Object.keys(this.controlSettings[setting]).reduce((subSettings, subSetting) => {
							subSettings[subSetting] = subControlSettings[setting];
							return subSettings;
						}, {});
					}
				}
				this.controlSettings[setting] = newSetting;
			}

			const drawContainsCoordinateInput = (
				this.controlSettings.draw
				&& isObject(this.controlSettings.draw)
				&&  "coordinateInput" in (<any> this.controlSettings.draw)
			);
			if (drawContainsCoordinateInput) {
				if (!isObject(this.controlSettings.drawUtils)) {
					this.controlSettings.drawUtils = {};
					this.controlSettings.drawUtils.coordinateInput = (<any> this.controlSettings.draw).coordinateInput;
				}
			}
		}

		provide(this, "controlSettings");
	}

	setCustomControls(controls: CustomControl[] = []) {
		const {_customControls = []} = this;
		if (_customControls.length === 0 && controls.length === 0) return;
		this._customControls = controls;
		provide(this, "customControls");
	}

	_controlIsAllowed(name, custom = false) {
		const {controlSettings} = this;

		const controlIsOk = (controlName) => {
			if (controlName === undefined) return true;

			const [parentControl, subControl] = name.split(".");

			function dependenciesAreOk(controlItem) {
				return (controlItem.dependencies || []).every(dependency =>
					(typeof dependency === "function") ? dependency() : controlIsOk(dependency)
				);
			}

			if (!subControl) {
				const controlItem = this._controlItemsByName[parentControl];
				return (
					custom
					|| (
						controlItem
						&& controlSettings[parentControl]
						&& dependenciesAreOk(controlItem)
						&& (controlItem.constructor !== Object || Object.keys(controlItem).some(_name => controlItem[_name]))
					)
				);
			} else {
				return (
					controlSettings[parentControl] === true
					|| (controlSettings[parentControl].constructor === Object && (controlSettings[parentControl][subControl] || custom))
				)
				&& (controlSettings[parentControl][subControl] || custom)
				&& dependenciesAreOk(this._controlItemsByName[parentControl])
				&& dependenciesAreOk(this._controlItemsByName[`${parentControl}.${subControl}`]);
			}
		};

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
		const CoordinateControl = L.Control.extend({ // tslint:disable-line
			options: {
				position: "bottomleft"
			},

			onAdd() {
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
						ykj = convertLatLng([lat, lng], "WGS84", "EPSG:2393");
						etrsTm35Fin = convertLatLng([lat, lng], "WGS84", "EPSG:3067");
					} catch (e) {
						//
					}

					coordinateTypes.forEach(({name, nameCell, coordsCell}) => {
						let coords = wgs84;
						if (name === "YKJ") coords = ykj;
						else if (name === "ETRS-TM35FIN") coords = etrsTm35Fin;
						nameCell.innerHTML = `<strong>${name}:</strong>`;
						let coordsFormatted = undefined;
						if (coords) switch (name) {
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

	_getLayerControl(): L.Control {
		if (!this._tileLayers) {
			return;
		}
		const that = this;
		const LayerControl = L.Control.extend({
			options: L.Control.Layers.prototype.options,
			initialize(options) {
				L.Util.setOptions(this, options);
			},
			onAdd(map) {
				this._map = map;
				this.__checkDisabledLayers = () => this._checkDisabledLayers();
				map.on("moveend", this.__checkDisabledLayers);

				/* Code below copied from L.Control.Layers._initLayout() with some modifications */
				const className = "laji-map-control-layers leaflet-control-layers",
					container = this._container = L.DomUtil.create("div", className),
					collapsed = this.options.collapsed;

				const section = this._section = L.DomUtil.create("section", className + "-list");

				// makes this work on IE touch devices by stopping it from firing a mouseout event when the touch is released
				container.setAttribute("aria-haspopup", "true");

				L.DomEvent.disableClickPropagation(container);
				L.DomEvent.disableScrollPropagation(container);

				if (collapsed) {
					this._map.on("click", L.Control.Layers.prototype.collapse.bind(this), this);

					if (!L.Browser.android) {
						L.DomEvent.on(container, {
							mouseenter: L.Control.Layers.prototype.expand.bind(this),
							mouseleave: L.Control.Layers.prototype.collapse.bind(this)
						}, this);
					}
				}

				const link = this._layersLink = <HTMLAnchorElement> L.DomUtil.create("a", className + "-toggle", container);
				link.href = "#";
				link.title = "Layers";

				if (L.Browser.touch) {
					L.DomEvent.on(link, "click", L.DomEvent.stop);
					L.DomEvent.on(link, "click", L.Control.Layers.prototype.expand, this);
				} else {
					L.DomEvent.on(link, "focus", L.Control.Layers.prototype.expand, this);
				}

				container.appendChild(section);

				/* end of copy */

				this.translateHooks = [];
				this.elems = {};
				this.updateLayout();

				this._map.on("tileLayersChange", this.updateListContainers, this);
				this._map.on("tileLayersChange", this.updateLists, this);
				this._map.on("tileLayersChange", this.updateActiveProj, this);
				this._map.on("projectionChange", this.updateActiveProj, this);

				return container;
			},
			onRemove() {
				this.translateHooks.forEach(hook => {
					that.removeTranslationHook(hook);
				});
				this._map.off("tileLayersChange", this.updateListContainers);
				this._map.off("tileLayersChange", this.updateLists);
				this._map.off("tileLayersChange", this.updateActiveProj);
				this._map.off("projectionChange", this.updateActiveProj);
				this._map.off("moveend", this.__checkDisabledLayers);
			},
			createListItem(name: string, layerOptions: TileLayerOptions, available: boolean) {
				const li = document.createElement("li");
				const checkbox = document.createElement("input");
				checkbox.type = "checkbox";
				checkbox.addEventListener("change", (e) => {
					const {layers} = that._tileLayers;
					const _layerOptions = layers[name];
					const _layer = {...that.tileLayers, ...that.overlaysByNames}[name];
					that.setTileLayers({
						...that._tileLayers,
						active: that.finnishTileLayers[name]
							? "finnish"
							: that.worldTileLayers[name]
								? "world"
								: that._tileLayers.active,
						layers: {
							...layers,
							[name]: {
								..._layerOptions,
								visible: !_layerOptions.visible,
								opacity: !_layerOptions.visible && !_layerOptions.opacity
									? (_layer.options.defaultOpacity || 1)
									: _layerOptions.opacity
							}
						}
					});
				});

				const label = document.createElement("span");
				this.translateHooks.push(that.addTranslationHook(label, capitalizeFirstLetter(name)));
				li.appendChild(label);

				const checkboxContainer = document.createElement("div");
				checkboxContainer.appendChild(checkbox);
				li.appendChild(checkboxContainer);

				const sliderInput = document.createElement("div");
				li.appendChild(sliderInput);

				const slider = noUiSlider.create(sliderInput, {
					start: (that._tileLayers.layers[name] || {opacity: 0}).opacity,
					range: {
						min: [0],
						max: [1]
					},
					step: 0.01,
					connect: [true, false],
					behaviour: "snap"
				});
				let firstUpdated = false;
				slider.on("update", () => {
					if (!firstUpdated) {
						firstUpdated = true;
						return;
					}
					if (that._internalTileLayersUpdate) return;
					const opacity = +slider.get();
					const {layers} = that._tileLayers;
					const _layerOptions = layers[name];
					const active = that.finnishTileLayers[name]
						? "finnish"
						: that.worldTileLayers[name]
						? "world"
						: that._tileLayers.active;
					const prevActive = that._tileLayers.active || "finnish";
					if (!_layerOptions.visible || active !== prevActive) {
						that.setTileLayers({
							...that._tileLayers,
							active,
							layers: {
								...layers, [name]: {..._layerOptions, visible: true, opacity}
							}
						});
					} else {
						that._tileLayers.layers[name] = {..._layerOptions, visible: true, opacity};
						(that.tileLayers[name] || that.overlaysByNames[name]).setOpacity(opacity);
					}
				});

				function disableSelect(e) {
					e.preventDefault();
				}

				slider.on("start", () => {
					document.addEventListener("selectstart", disableSelect);
				});
				slider.on("end", () => {
					document.removeEventListener("selectstart", disableSelect);

					const opacity = +slider.get();
					const {layers} = that._tileLayers;
					const _layerOptions = layers[name];
					if (!opacity && _layerOptions.visible) {
						that.setTileLayers({
							...that._tileLayers,
							layers: {
								...layers, [name]: {..._layerOptions, visible: false}
							}
						});
					}
				});

				this.elems[name] = {li, slider, checkbox};

				if (!available) {
					li.style.display = "none";
				}

				return li;
			},
			createList(
				tileLayers: {[name: string]: L.TileLayer[]},
				availableLayers: {[name: string]: L.TileLayer[]},
				label: string,
				className?: string
			): [HTMLElement, () => void] {
				if (Object.keys(availableLayers).length === 0) {
					return [undefined, undefined];
				}
				const list = document.createElement("fieldset");
				className && L.DomUtil.addClass(list, className);
				const innerList = document.createElement("ul");
				const legend = document.createElement("legend");
				const translationHook = that.addTranslationHook(legend, capitalizeFirstLetter(label));
				this.translateHooks.push(translationHook);

				list.appendChild(legend);
				list.appendChild(innerList);
				Object.keys(tileLayers).sort((a, b) => that._tileLayerOrder.indexOf(a) - that._tileLayerOrder.indexOf(b)).forEach(name => {
					innerList.appendChild(this.createListItem(name, that._tileLayers.layers[name], availableLayers[name]));
				});
				this.layers = {
					...(this.layers || {}),
					...tileLayers
				};
				return [list, translationHook];
			},
			getFinnishList(createNew = false): [HTMLElement, () => void]  {
				const availableLayers = that.getAvailableFinnishTileLayers();
				if (Object.keys(availableLayers).length === 0) {
					this.finnishList = undefined;
					return [undefined, undefined];
				}
				if (this.finnishList) {
					return [this.finnishList, this.finnishTranslationHook];
				}
				const [finnishList, finnishTranslationHook] = this.createList(
					that.finnishTileLayers,
					availableLayers,
					that._tileLayers.active === "finnish" ? "FinnishMaps" : "ActivateFinnishMaps",
					"finnish-list"
				);
				this.finnishList = finnishList;
				this.finnishTranslationHook = finnishTranslationHook;
				if (finnishList) {
					if (this.worldList) {
						this._section.insertBefore(finnishList, this.worldList);
					} else if (this.overlayList) {
						this._section.insertBefore(finnishList, this.overlayList);
					} else {
						this._section.appendChild(finnishList);
					}
				}
				return [this.finnishList, this.finnishTranslationHook];
			},
			getWorldList(): [HTMLElement, () => void]  {
				const availableLayers = that.getAvailableWorldTileLayers();
				if (Object.keys(availableLayers).length === 0) {
					this.worldList = undefined;
					return [undefined, undefined];
				}
				if (this.worldList) {
					return [this.worldList, this.worldTranslationHook];
				}
				const [worldList, worldTranslationHook] = this.createList(
					that.worldTileLayers,
					availableLayers,
					that._tileLayers.active === "world" ? "WorldMaps" : "ActivateWorldMaps",
					"world-list"
				);
				this.worldList = worldList;
				this.worldTranslationHook = worldTranslationHook;
				if (worldList) {
					if (this.overlayList) {
						this._section.insertBefore(worldList, this.overlayList);
					} else {
						this._section.appendChild(worldList);
					}
				}
				return [this.worldList, this.worldTranslationHook];
			},
			getOverlayList(): HTMLElement {
				const availableLayers = that.getAvailableOverlaysByNames();
				if (Object.keys(availableLayers).length === 0) {
					this.overlayList = undefined;
					return undefined;
				}
				if (this.overlayList) {
					return this.overlayList;
				}
				const [overlayList] = this.createList(that.overlaysByNames, that.getAvailableOverlaysByNames(), "Overlays", "overlay-list");
				this.overlayList = overlayList;
				if (overlayList) {
					this._section.appendChild(overlayList);
				}
			},
			updateLayout() {
				this.updateListContainers();
				this.updateActiveProj();
				this.updateLists();
			},
			updateActiveProj() {
				const {activeProjName} = that;
				const lists = [this.finnishList, this.worldList];
				const [activeList, nonActiveList] = activeProjName === "finnish"
					? lists
					: lists.reverse();
				if (activeList) {
					L.DomUtil.addClass(activeList, "active-list");
					L.DomUtil.removeClass(activeList, "nonactive-list");
					activeList.querySelector("legend").tabIndex = 0;
					if (!nonActiveList) {
						L.DomUtil.addClass(activeList, "only-list");
					} else {
						L.DomUtil.removeClass(activeList, "only-list");
					}
				}
				if (nonActiveList) {
					L.DomUtil.addClass(nonActiveList, "nonactive-list");
					L.DomUtil.removeClass(nonActiveList, "active-list");
					nonActiveList.querySelector("legend").tabIndex = 0;
				}

				this.translateHooks = this.translateHooks.filter(hook => hook !== this.finnishTranslationHook && hook !== this.worldTranslationHook);
				if (this.finnishList) {
					this.finnishTranslationHook = that.addTranslationHook(
						this.finnishList.querySelector("legend"),
						!this.worldList
							? "Maps"
							: activeProjName === "finnish"
								? "FinnishMaps"
								: this._finnishDisabled
									? "FinnishMapDisabledOutsideFinland"
									: "ActivateFinnishMaps"
					);
				}
				if (this.worldList) {
					this.worldTranslationHook = that.addTranslationHook(
						this.worldList.querySelector("legend"),
						!this.finnishList
							? "Maps"
							: activeProjName === "world"
								? "WorldMaps"
								: "ActivateWorldMaps"
					);
					this.translateHooks.push(this.finnishTranslationHook, this.worldTranslationHook);
				}
			},
			updateListContainers() {
				const oldFinnish = this.finnishList;
				const oldWorld = this.worldList;
				const oldOverlayList = this.overlayList;
				const [finnishList] = this.getFinnishList();
				const [worldList] = this.getWorldList();
				const overlayList = this.getOverlayList();
				const lists = [
					[oldFinnish, finnishList, "finnish"],
					[oldWorld, worldList, "world"]
				];

				[...lists, [oldOverlayList, overlayList]].forEach(([oldList, list]) => {
					if (oldList && !list) {
						oldList.parentElement.removeChild(oldList);
					}
				});

				lists.filter(([oldList, list]) => !oldList && list).forEach(([oldList, list, active]) => {
					list.querySelector("legend").addEventListener("click", ({target: {tagName}}) => {
						if (this._finnishDisabled) {
							return;
						}
						if (active === that._tileLayers.active) {
							if (finnishList && active === "finnish") {
								active = "world";
							} else if (worldList && active === "world") {
								active = "finnish";
							}
						}

						const layerOptions = active === "finnish"
							|| Object.keys(that.worldTileLayers).some(name => that._tileLayers.layers[name].visible)
							? that._tileLayers.layers
							: {...that._tileLayers.layers, openStreetMap: true};
						that.setTileLayers({...that._tileLayers, active, layers: layerOptions});
					});
				});
			},
			updateLists() {
				Object.keys({...that.tileLayers, ...that.overlaysByNames}).forEach(name => {
					const available = that._tileLayers.layers[name];

					if (!this.elems[name]) return;

					this.elems[name].li.style.display = available ? "block" : "none";

					if (!available) return;

					const {opacity, visible} = that._tileLayers.layers[name];
					const {slider, checkbox, li} = this.elems[name];
					that._internalTileLayersUpdate = true;
					li.className = visible ? "active" : "";
					slider.set(opacity);
					that._internalTileLayersUpdate = false;
					checkbox.checked = visible;
				});
			},
			_checkDisabledLayers() {
				const latLng = this._map.getCenter();
				if (!this.finnishList) {
					return;
				}
				if (that._isOutsideFinland(latLng) && !this._finnishDisabled) {
					this._finnishDisabled = true;
					L.DomUtil.addClass(this.finnishList.querySelector("legend"), "disabled");
					this.worldList && L.DomUtil.addClass(this.worldList.querySelector("legend"), "disabled");
					this.translateHooks = this.translateHooks.filter(h => h !== this.finnishTranslationHook);
					this.finnishTranslationHook = that.addTranslationHook(
						this.finnishList.querySelector("legend"),
						"FinnishMapDisabledOutsideFinland"
					);
					this.translateHooks.push(this.finnishTranslationHook);
				} else if (!that._isOutsideFinland(latLng) && this._finnishDisabled) {
					this._finnishDisabled = false;
					L.DomUtil.removeClass(this.finnishList.querySelector("legend"), "disabled");
					this.worldList && L.DomUtil.removeClass(this.worldList.querySelector("legend"), "disabled");
					this.translateHooks = this.translateHooks.filter(h => h !== this.finnishTranslationHook);
					this.finnishTranslationHook = that.addTranslationHook(
						this.finnishList.querySelector("legend"),
						that.activeProjName === "finnish" ? "FinnishMaps" : "ActivateFinnishMaps"
					);
					this.translateHooks.push(this.finnishTranslationHook);
				}

			}
		});

		return new LayerControl({position: "topleft"});
	}

	getZoomControl(): L.Control.Zoom {
		const that = this;
		const ZoomControl = L.Control.Zoom.extend({ // tslint:disable-line
			onZoomClick() {
				that.map.fire("controlClick", {name: "zoom"});
			},
			onAdd(map) {
				const container = L.Control.Zoom.prototype.onAdd.call(this, map);
				L.DomEvent.disableClickPropagation(container);
				this._zoomInButton.addEventListener("click", this.onZoomClick);
				this._zoomOutButton.addEventListener("click", this.onZoomClick);
				return container;
			},
			onRemove(map) {
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

		if (historyPointer <= 0 && undoButton.className.indexOf("leaflet-disabled") === -1) {
			undoButton.className += " leaflet-disabled";
		} else if (historyPointer > 0
			&& historyPointer < history.length
			&& undoButton.className.indexOf("leaflet-disabled") !== -1
		) {
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

		if (historyPointer >= history.length - 1 && redoButton.className.indexOf("leaflet-disabled") === -1) {
			redoButton.className += " leaflet-disabled";
		} else if (historyPointer >= 0
			&& historyPointer < history.length - 1
			&& redoButton.className.indexOf("leaflet-disabled") !== -1
		) {
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
		this._updateUndoButton("lineTransect.undo", (<any> this)._LTHistory, (<any> this)._LTHistoryPointer);
	}

	@dependsOn("controls", "contextMenu")
	updateLTRedoButton() {
		if (!depsProvided(this, "updateLTRedoButton", arguments)) return;
		this._updateRedoButton("lineTransect.redo", (<any> this)._LTHistory, (<any> this)._LTHistoryPointer);
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
				} else if (charCode === 58) { // is colon
					lngInput.focus();
					lngInput.select();
				}
			};
		}

		const ykjAllowed = that.getDraw().rectangle;
		const etrsTm35FinAllowed = that.getDraw().marker;
		const wgs84Allowed = that.getDraw().marker;

		const inputRegexp = wgs84Allowed ? /^(-?[0-9]+(\.|,)?[0-9]*|-?)$/ : /^[0-9]*$/;

		function inputValidate(e, value) {
			if (!value.match(inputRegexp)) {
				e && e.preventDefault && e.preventDefault();
				return false;
			}
			return true;
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
			let help = `${that.translations.Enter} ${that.translations.yKJRectangle}`;
			const rectangleAllowed = that.getDraw().rectangle || that.getDraw().polygon;
			const {or} = that.translations;
			help += (rectangleAllowed && !that.getDraw().marker ? ` ${or} ` : `, `) + that.translations.ETRSRectangle;
			if (that.getDraw().marker) {
				help += ` ${or} ${rectangleAllowed ? that.translations.wGS84PointCoordinates : that.translations.WGS84Coordinates}`; // tslint:disable-line
			}
			help += ".";
			return help;
		}

		translateHooks.push(this.addTranslationHook(helpSpan, getHelpTxt));

		const {
			validate,
			elem: formatDetectorElem,
			unmount: unmountFormatDetector
		} = this.createFormatDetectorElem({displayFormat: false, displayErrors: false, allowGrid: true});

		const inputValues = ["", ""];
		[latInput, lngInput].forEach((input, i) => {
			let prevVal = "";
			input.addEventListener("keypress", formatter(input));
			input.onpaste = (e) => {
				const matches = (e.clipboardData || (<any> window).clipboardData).getData("text")
					.match(/-?[0-9]+((\.|,)?[0-9]+)/g) || ["", ""];
				const [latMatch, lngMatch] = document.activeElement === lngInput
					? matches.reverse()
					: matches;
				if ([latMatch, lngMatch].every(match => typeof match === "string" && match.length > 0)) {
					[[latInput, latMatch], [lngInput, lngMatch]].forEach(([_input, match]: [HTMLInputElement, string]) => {
						_input.value = match;
						_input.oninput(<any> {target: _input});
					});
					submitButton.focus();
				}
			};
			input.oninput = (e) => {
				const target = <HTMLInputElement> e.target;
				if (!inputValidate(e, target.value)) {
					target.value = prevVal;
				}
				target.value = target.value.replace(",", ".");
				prevVal = target.value;

				inputValues[i] = target.value;

				const {valid, geoJSON} = validate(`${inputValues[0]}:${inputValues[1]}/`);
				if (valid) {
					submitButton.removeAttribute("disabled");
				} else {
					submitButton.setAttribute("disabled", "disabled");
				}
			};
		});

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
			const isYKJGrid = latlngStr[0].length === latlngStr[1].length && validateLatLng(latlngStr, ykjGridStrictValidator);
			const isETRSGrid = latlngStr[0].length === latlngStr[1].length && validateLatLng(latlngStr, etrsTm35FinGridStrictValidator);

			let geometry = {
				type: "Point",
				coordinates: ((isYKJ)
					? convert(latlng, "EPSG:2393")
					: (isETRS)
						? convert(latlng, "EPSG:3067")
						: (isWGS84Coordinates)
							? latlng
							: []).reverse()
			};

			const feature = {
				type: "Feature",
				geometry,
				properties: {}
			};

			if (isYKJGrid || isETRSGrid) {
				const validator = isYKJGrid ? ykjGridStrictValidator : etrsTm35FinGridStrictValidator;
				const latStart = +validator[0].formatter(`${latlng[0]}`);
				const latEnd = +validator[0].formatter(`${latlng[0] + 1}`);

				const lngStart = +validator[1].formatter(`${latlng[1]}`);
				const lngEnd = +validator[1].formatter(`${latlng[1] + 1}`);

				geometry.type = "Polygon";
				geometry.coordinates = [[
					[latStart, lngStart],
					[latStart, lngEnd],
					[latEnd, lngEnd],
					[latEnd, lngStart],
					[latStart, lngStart]
				].map(coordinatePair => reverseCoordinate(convert(coordinatePair, isYKJGrid ? "EPSG:2393" : "EPSG:3067")))];
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
		container.appendChild(formatDetectorElem);
		container.appendChild(submitButton);

		this._showDialog(container, () => {
			translateHooks.forEach(hook => {
				that.removeTranslationHook(hook);
			});
			unmountFormatDetector();
		});

		latInput.focus();
	}

	openDrawCopyDialog() {
		const table = document.createElement("table");
		table.className = "laji-map-draw-copy-table";

		const HTMLInput = createTextArea(10, 50);
		HTMLInput.setAttribute("readonly", "readonly");
		HTMLInput.addEventListener("focus", HTMLInput.select);

		const features = this.getDraw().featureCollection.features.map(f => this.formatFeatureOut(f));
		const originalGeoJSON = {...this.getDraw().featureCollection, features};

		const converterFor = (proj) => (input) => {
			const reprojected = convertGeoJSON(input, "WGS84", proj);
			(<any> reprojected).crs = getCRSObjectForGeoJSON(reprojected, proj);
			return reprojected;
		};

		const TOP = "TOP";
		const LEFT = "LEFT";

		const pipeline = [
			{ // GeoJSON -> GeoJSON with coordinates converted
				commands: {
					"WGS84": standardizeGeoJSON,
					"YKJ": input => converterFor("EPSG:2393")(standardizeGeoJSON(input)),
					"ETRS-TM35FIN": input => converterFor("EPSG:3067")(standardizeGeoJSON(input))
				},
				position: TOP
			},
			{ // GeoJSON -> String
				commands: {
					"GeoJSON": input => JSON.stringify(input, undefined, 2),
					"ISO 6709": geoJSONToISO6709,
					"WKT": geoJSONToWKT
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

			Object.keys(commands).map((label, _idx) => {
				const tab = document.createElement("li");
				const text = document.createElement("a");

				if (_idx === 0) {
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

	createFormatDetectorElem(options: {displayFormat?: boolean, displayErrors?: boolean, allowGrid?: boolean} = {}):
	{elem: HTMLElement, validate: (value?: string) => {valid: boolean, geoJSON: G.GeoJSON}, unmount: () => void} {
		const _container = document.createElement("div");
		const formatContainer = document.createElement("div");
		const crsContainer = document.createElement("div");
		const formatInfo = document.createElement("span");
		const crsInfo = document.createElement("span");
		const formatValue = document.createElement("span");
		const crsValue = document.createElement("span");
		const geoJSONErrorsContainer = document.createElement("ul");
		const geoJSONWarningsContainer = document.createElement("ul");

		formatContainer.className = "form-group text-success format-info";
		crsContainer.className = "form-group text-success crs-info";
		geoJSONErrorsContainer.className = "geojson-validations";
		geoJSONWarningsContainer.className = "geojson-validations";

		_container.appendChild(formatContainer);
		_container.appendChild(crsContainer);
		_container.appendChild(geoJSONErrorsContainer);
		_container.appendChild(geoJSONWarningsContainer);
		formatContainer.appendChild(formatInfo);
		formatContainer.appendChild(formatValue);
		crsContainer.appendChild(crsInfo);
		crsContainer.appendChild(crsValue);

		let alert = undefined;

		const {displayFormat = true, displayErrors = true, allowGrid = false} = options;

		let storedValue = "";
		const updateInfo = (value = "") => {
			storedValue = value;
			let format, crs, valid, hasErrors, hasWarnings, fixedGeoJSON;

			formatInfo.innerHTML =  `${this.translations.DetectedFormat}: `;
			crsInfo.innerHTML =  `${this.translations.DetectedCRS}: `;

			[geoJSONWarningsContainer, geoJSONErrorsContainer].forEach(container => {
				container.style.display = "none";
				while (container.firstChild) {
						container.removeChild(container.firstChild);
				}
			});

			if (alert) {
				_container.removeChild(alert);
				alert = undefined;
			}
			try {
				format = detectFormat(value);
				crs = detectCRS(value, allowGrid);
				try {
					valid = convertAnyToWGS84GeoJSON(value, !!"validate all");
				} catch (e) { ; }
				if (crs === EPSG2393String || crs === EPSG2393WKTString) {
					crs = "EPSG:2393";
				} else if (crs === EPSG3067String || crs === EPSG3067WKTString) {
					crs = "EPSG:3067";
				}
			} catch (e) {
				if (displayErrors && e._lajiMapError) {
					if (e.translationKey !== "GeoDataFormatDetectionError") {
						alert = document.createElement("div");
						alert.className = "alert alert-danger";
						alert.innerHTML = e.stringify(this.translations);
						_container.appendChild(alert);
					}
				} else if (displayErrors && e._lajiMapGeoJSONConversionError) {
					fixedGeoJSON = e.geoJSON;
					e.errors.forEach(_e => {
						const {translationKey, fixable, path} = _e;
						const target = fixable ? geoJSONWarningsContainer : geoJSONErrorsContainer;
						const firstWarning = fixable && !hasWarnings;
						if (fixable) {
							hasWarnings = true;
						} else {
							hasErrors = true;
						}
						if (format !== "GeoJSON") {
							_e.path = undefined;
						}
						const errorElem = renderLajiMapError(_e, this.translations, "li");
						errorElem.className = fixable ? "alert alert-warning" : "alert alert-danger";

						if (firstWarning) {
							const warningContainer = document.createElement("li");
							const warningTitle = document.createElement("span");
							warningTitle.innerHTML = this.translations.GeoJSONUploadWarningsTitle;
							warningTitle.className = "form-group text-warning warning-title";
							warningContainer.appendChild(warningTitle);
							target.appendChild(warningContainer);
						}
						target.appendChild(errorElem);
					});
					if (!hasErrors && geoJSONWarningsContainer.style.display === "none") {
						geoJSONWarningsContainer.style.display = "block";
					}
					if (hasErrors && geoJSONErrorsContainer.style.display === "none") {
						geoJSONErrorsContainer.style.display = "block";
					}
				}
			} finally {
				if (displayFormat && format) {
					formatContainer.style.display = "block";
				} else {
					formatContainer.style.display = "none";
				}
				if (crs && this.translations[crs]) {
					crsContainer.style.display = "block";
				} else {
					crsContainer.style.display = "none";
				}
				formatValue.innerHTML = format;
				if (!hasErrors && hasWarnings) {
					valid = convertAnyToWGS84GeoJSON(fixedGeoJSON);
				}
				if (this.translations[crs]) {
					crsValue.innerHTML = this.translations[crs];
				}
			}
			return {valid: !!(format && crs && allowGrid || valid), geoJSON: valid};
		};

		updateInfo();

		this.addTranslationHook(() => updateInfo(storedValue));
		const unmount = () => {
			this.removeTranslationHook(updateInfo);
		};

		return {elem: _container, validate: updateInfo, unmount};
	}

	openDrawUploadDialog() {
		const container = document.createElement("form");
		container.className = "laji-map-coordinate-upload";

		const textarea = createTextArea(10, 50);
		textarea.className += " form-group";

		const button = document.createElement("button");
		button.setAttribute("type", "submit");
		button.className = "btn btn-block btn-primary";

		let translationsHooks = [];
		translationsHooks.push(this.addTranslationHook(button, "UploadDrawnFeatures"));
		button.setAttribute("disabled", "disabled");

		const {elem: formatDetectorElem, validate, unmount: unmountFormatDetector} = this.createFormatDetectorElem();

		let fixedGeoJSON = undefined;

		textarea.oninput = (e) => {
			const {value} = <HTMLInputElement> e.target;
			const {valid, geoJSON} = validate(value);
			fixedGeoJSON = geoJSON;
			if (valid) {
				button.removeAttribute("disabled");
				if (alert) {
					container.removeChild(alert);
					alert = undefined;
				}
			} else {
				button.setAttribute("disabled", "disabled");
			}
			if (container.className.indexOf(" has-error") !== -1) {
				container.className = container.className.replace(" has-error", "");
			}
		};

		let alert = undefined;
		let alertTranslationHook = undefined;

		const updateAlert = (error) => {
			if (alert) container.removeChild(alert);
			alert = document.createElement("div");
			alert.className = "alert alert-danger";
			if (alertTranslationHook) this.removeTranslationHook(alertTranslationHook);
			alertTranslationHook = this.addTranslationHook(alert, () => stringifyLajiMapError(error, this.translations));
			container.appendChild(alert);
		};

		const convertText = (e) => {
			e.preventDefault();
			try {
				const prevFeatureCollection = {
					type: "FeatureCollection",
					features: this.cloneFeatures(this.getDraw().featureCollection.features)
				};
				const events: LajiMapEvent[] = [{
					type: "delete",
					idxs: Object.keys(this.idxsToIds[this.drawIdx]).map(idx => parseInt(idx))
				}];
				this.updateDrawData(<DrawOptions> {...this.getDraw(), featureCollection: undefined, geoData: fixedGeoJSON || textarea.value});
				this.getDraw().featureCollection.features.forEach(feature => {
					events.push({type: "create", feature});
				});
				this._triggerEvent(events, this.getDraw().onChange);
				this._updateDrawUndoStack(events, prevFeatureCollection);
				this._closeDialog(e);
			} catch (e) {
				if (e.stringify) updateAlert(e);
				throw e;
			}
			const bounds = this.getDraw().group.getBounds();
			if (Object.keys(bounds).length) this.map.fitBounds(bounds);
		};

		button.addEventListener("click", convertText);

		container.appendChild(textarea);
		container.appendChild(formatDetectorElem);
		container.appendChild(button);

		this._showDialog(container, () => {
			translationsHooks.forEach(hook => this.removeTranslationHook(hook));
			if (alertTranslationHook) this.removeTranslationHook(alertTranslationHook);
			unmountFormatDetector();
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

			if (this.getDraw() && this.drawIsEditable() && this.getDraw()[featureType] !== false && this.controlSettings.draw[featureType] !== false) {
				this._contextMenuItems[`draw.${featureType}`] = this.map.contextmenu.addItem({
					text,
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
						callback: () =>
						(<HTMLButtonElement> this.container.querySelector(`.button-${controlName.replace(".", "_")}`)).click()
					});
					groupAdded = true;
				}
			});
		};
		const itemsWithContextMenu = this.controlItems.filter(item => item.contextMenu !== false);
		itemsWithContextMenu.forEach(control => addControlGroup(
			control.controls
				? control.name
				: undefined,
			control.controls
				? control.controls
				: [control]
		));

		provide(this, "contextMenu");
	}

	getGoogleGeocodingControl() {
		const control = new GeoSearchControl({
			provider: this.provider,
			showmarker: false,
			autoClose: true,
			searchLabel: `${this.translations.GeocodingSearchLabel}... (${this.translations.Google})`,
			notFoundMessage: this.translations.GeocodingSearchFail
		});
		const {onAdd} = control.__proto__;
		control.__proto__.onAdd = function(map) {
			const container = onAdd.call(this, map);
			L.DomEvent.disableClickPropagation(container);
			const {resetButton} =  control.elements;
			resetButton.parentElement.removeChild(resetButton);
			control.searchElement.elements.input.addEventListener("blur", () => {
				setTimeout(() => control.closeResults(), 300);
			});
			return container;
		};
		return control;
	}

	triggerDrawing(featureType: DataItemType) {
		try {
			(<any> this.drawControl)._toolbars.draw._modes[featureType.toLowerCase()].handler.enable();
			this.addDrawAbortListeners();
		} catch (e) {
			super.triggerDrawing(featureType);
		}
	}

	shouldNotPreventScrolling(): boolean {
		return super.shouldNotPreventScrolling() || !!this.activeControl;
	}
} return LajiMapWithControls; } // tslint:disable-line
