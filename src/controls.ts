import * as L from "leaflet";
import * as G from "geojson";
import SearchControl from "./controls/geosearch-control";
import LajiMap from "./map";
import { DrawOptions, DataItemType, LajiMapEvent } from "./map.defs";
import { detectFormat, detectCRS, convertAnyToWGS84GeoJSON, isObject, renderLajiMapError } from "./utils";
import { ESC, EPSG2393String, EPSG2393WKTString, EPSG3067String, EPSG3067WKTString, } from "./globals";
import { dependsOn, depsProvided, provide, reflect, isProvided } from "./dependency-utils";
import { ControlsOptions, CustomControl, DrawControlOptions, InternalControlsOptions, WithControls } from "./controls.defs";
import LayerControl from "./controls/layer-control";
import CoordinatesControl from "./controls/coordinates-control";
import coordinateInputControl from "./controls/coordinate-input-control";
import drawCopyControl from "./controls/draw-copy-control";
import drawUploadControl from "./controls/draw-upload-control";
import drawClearControl from "./controls/draw-clear-control";

function getSubControlName(name, subName) {
	return (name !== undefined) ? `${name}.${subName}` : subName;
}

type Constructor<LM> = new(...args: any[]) => LM;
export default function LajiMapWithControls<LM extends Constructor<LajiMap>>(Base: LM) { class LajiMapWithControls extends Base implements WithControls {  // eslint-disable-line max-len
	getOptionKeys() {
		return {
			...super.getOptionKeys(),
			controlSettings: "setControlsWarn",
			controls: ["setControls", () => this.controlSettings],
			customControls: ["setCustomControls", () => {
				return this._customControls === undefined
					? this._customControls
					: this._customControls.map(({_custom, ...rest}) => { // eslint-disable-line @typescript-eslint/no-unused-vars
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
				control: () => this._tileLayers && new LayerControl(this, {position: "topleft"})
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
				control: () => new CoordinatesControl(this)
			},
			{
				name: "fullscreen",
				position: "bottomright",
				text: this.translations.MapFullscreen,
				iconCls: "glyphicon glyphicon-resize-full",
				fn: () => this.toggleFullscreen()
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
						fn: () => drawClearControl(this),
						dependencies: [
							() => this.drawIsEditable()
						]

					},
					{
						name: "delete",
						text: this.translations.DeleteFeature,
						iconCls: "glyphicon glyphicon-remove-sign",
						fn: () => {
							this._startDrawRemove();
						},
						finishFn: () => this._finishDrawRemove(),
						dependencies: [
							() => this.drawIsEditable()
						]

					},
					{
						name: "reverse",
						iconCls: "glyphicon glyphicon-sort",
						text: this.translations.ReverseFeature,
						fn: () => {
							this._startDrawReverse();
						},
						finishFn: () => this._finishDrawReverse(),
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

			that._addKeyListener(ESC, stop, undefined);
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

	setControlsWarn(controlSettings) {
		console.warn("laji-map warning: 'controlSettings' option is deprecated and will be removed in the future. 'controlSettings' option has been renamed 'controls'"); // eslint-disable-line max-len
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
			fullscreen: false,
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
				console.error("laji-map error: controls.coordinateInput is deprecated and is removed. Please use controls.draw.coordinateInput");
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

	getZoomControl(): L.Control.Zoom {
		const that = this;
		const ZoomControl = L.Control.Zoom.extend({
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
		return coordinateInputControl(this);
	}

	openDrawCopyDialog() {
		return drawCopyControl(this);
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
				if (crs === EPSG2393String || crs === EPSG2393WKTString) {
					crs = "EPSG:2393";
				} else if (crs === EPSG3067String || crs === EPSG3067WKTString) {
					crs = "EPSG:3067";
				}
				valid = convertAnyToWGS84GeoJSON(value, !!"validate all");
			} catch (e) {
				const addError = (msg) => {
					if (!displayErrors) {
						return;
					}
					alert = document.createElement("div");
					alert.className = "alert alert-danger";
					alert.innerHTML = msg;
					_container.appendChild(alert);
				};
				if (e._lajiMapError) {
					if (e.translationKey !== "GeoDataFormatDetectionError") {
						addError(e.stringify(this.translations));
					}
				} else if (displayErrors && e._lajiMapGeoJSONConversionError) {
					fixedGeoJSON = e.geoJSON;
					e.errors.forEach(_e => {
						const {fixable} = _e;
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
				} else {
					addError(this.translations.UnknownConversionError);
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
		return drawUploadControl(this);
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

			if (this.getDraw()
				&& this.drawIsEditable()
				&& this.getDraw()[featureType] !== false
				&& this.controlSettings.draw[featureType] !== false) {
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

	@dependsOn("geocodingProvider")
	getGoogleGeocodingControl() {
		if (!depsProvided(this, "getGoogleGeocodingControl", arguments)) return;
		const control = new (SearchControl as any)({
			providers: this.providers,
			showMarker: false,
			autoClose: true,
			searchLabel: `${this.translations.GeocodingSearchLabel}...`,
			notFoundMessage: this.translations.GeocodingSearchFail
		});
		return control;
	}

	setFullscreenOn() {
		super.setFullscreenOn();
		this._updateFullscreenControl();
	}

	setFullscreenOff() {
		super.setFullscreenOff();
		this._updateFullscreenControl();
	}

	_updateFullscreenControl() {
		const button = this._controlButtons.fullscreen;
		if (!button) return;
		const icon = button.children[0];
		const _replace = ["full", "small"];
		const replace = this._fullscreen
			? _replace
			: _replace.reverse();
		const title = this._fullscreen
			? "MapExitFullscreen"
			: "MapFullscreen";
		icon.className = icon.className.replace(...replace as [string, string]);
		button.title = this.translations[title];
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
} return LajiMapWithControls; }
