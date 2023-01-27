import * as L from "leaflet";
import LajiMap, { computeOpacities } from "../map";
import * as noUiSlider from "nouislider";
import { capitalizeFirstLetter } from "../utils";
import { Data } from "../map.defs";

const LayerControl = L.Control.extend({
	options: L.Control.Layers.prototype.options,
	initialize(lajiMap: LajiMap, options) {
		this.lajiMap = lajiMap;
		L.Util.setOptions(this, options);
	},
	onAdd(map: L.Map) {
		this._map = map;
		this.__checkDisabledLayers = () => this._checkDisabledLayers();
		this.dataLayersByName = {};
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

		this._finnishAndWorldContainer = document.createElement("div");
		this._section.appendChild(this._finnishAndWorldContainer);

		this.translateHooks = [];
		this.elems = {};
		this.updateLayout();

		this._map.on("tileLayersChange", this.updateListContainers, this);
		this._map.on("tileLayersChange", this.updateLists, this);
		this._map.on("tileLayersChange", this.updateActiveProj, this);
		this._map.on("projectionChange", this.updateActiveProj, this);
		this._map.on("lajiMap:dataChange", this.updateListContainers, this);
		this._map.on("lajiMap:dataChange", this.updateLists, this);

		return container;
	},
	onRemove() {
		this.translateHooks.forEach(hook => {
			this.lajiMap.removeTranslationHook(hook);
		});
		this._map.off("tileLayersChange", this.updateListContainers);
		this._map.off("tileLayersChange", this.updateLists);
		this._map.off("tileLayersChange", this.updateActiveProj);
		this._map.off("projectionChange", this.updateActiveProj);
		this._map.off("moveend", this.__checkDisabledLayers);
	},
	createListItem(name: string, available: boolean) {
		const li = document.createElement("li");
		li.id = name;
		li.className = "laji-map-layer-control-layer-item";
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.addEventListener("change", (e) => {
			// Handle data item.
			const checked = (e.target as any).checked;
			const data = this.dataLayersByName[name];
			if (data) {
				const opacity = checked ? 1 : 0;
				this.updateDataOpacity(data, opacity);
				data.onVisibleChange?.(checked);
				data.visible = checked;
				return;
			}

			// Handle tile layer.
			const {layers} = this.lajiMap._tileLayers;
			const _layerOptions = layers[name];
			const _layer = {...this.lajiMap.tileLayers, ...this.lajiMap.overlaysByNames}[name];
			this.lajiMap.setTileLayers({
				...this.lajiMap._tileLayers,
				active: this.lajiMap.finnishTileLayers[name]
					? "finnish"
					: this.lajiMap.worldTileLayers[name]
						? "world"
						: this.lajiMap._tileLayers.active,
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
		if (this.dataLayersByName[name]) {
			label.innerHTML = name;
		} else {
			this.translateHooks.push(this.lajiMap.addTranslationHook(label, capitalizeFirstLetter(name)));
		}
		li.appendChild(label);

		const checkboxContainer = document.createElement("div");
		checkboxContainer.appendChild(checkbox);
		li.appendChild(checkboxContainer);

		const sliderInput = document.createElement("div");
		li.appendChild(sliderInput);

		const slider = noUiSlider.create(sliderInput, {
			start: (this.lajiMap._tileLayers.layers[name] || {opacity: 0}).opacity,
			range: {
				min: [0],
				max: [1]
			},
			step: 0.01,
			connect: [true, false],
			behaviour: "snap"
		});
		let liSlideHeightFixer: HTMLElement;
		let firstUpdated = false;
		slider.on("update", () => {
			if (!firstUpdated) {
				firstUpdated = true;
				return;
			}
			const opacity = +slider.get();

			const data = this.dataLayersByName[name];
			// Handle data item.
			if (data) {
				this.updateDataOpacity(data, opacity);
				return;
			}

			// Handle tile layer
			if (this.lajiMap._internalTileLayersUpdate) return;
			const {layers} = this.lajiMap._tileLayers;
			const _layerOptions = layers[name];
			const active = this.lajiMap.finnishTileLayers[name]
				? "finnish"
				: this.lajiMap.worldTileLayers[name]
					? "world"
					: this.lajiMap._tileLayers.active;
			const prevActive = this.lajiMap._tileLayers.active || "finnish";
			if (!_layerOptions.visible || active !== prevActive) {
				this.lajiMap.setTileLayers({
					...this.lajiMap._tileLayers,
					active,
					layers: {
						...layers, [name]: {..._layerOptions, visible: true, opacity}
					}
				});
			} else {
				this.lajiMap._tileLayers.layers[name] = {..._layerOptions, visible: true, opacity};
				const layer = this.lajiMap.tileLayers[name] || this.lajiMap.overlaysByNames[name];
				layer instanceof L.TileLayer
					? layer.setOpacity(opacity)
					: layer.eachLayer((l: L.TileLayer) => l.setOpacity(opacity));
			}
		});
		L.Browser.mobile && slider.on("start", () => {
			this._section.className += " sliding";
			const {top, left, height, width} = li.getBoundingClientRect();

			liSlideHeightFixer = document.createElement("div");
			liSlideHeightFixer.style.height = `${height}px`;

			li.parentElement.insertBefore(liSlideHeightFixer, li);
			document.body.appendChild(li);

			L.DomUtil.addClass(li, "leaflet-container");
			li.style.background = "white";
			li.style.position = "absolute";
			li.style.top = `${top}px`;
			li.style.left = `${left}px`;
			li.style.width = `${width}px`;
			li.style.height = `${height}px`;
			li.style.zIndex = "1002";
		});
		L.Browser.mobile && slider.on("end", () => {
			this._section.className = this._section.className.replace(" sliding", "");

			liSlideHeightFixer.parentElement.insertBefore(li, liSlideHeightFixer);
			liSlideHeightFixer.remove();
			L.DomUtil.removeClass(li, "leaflet-container");
			li.style.background = null;
			li.style.position = null;
			li.style.top = null;
			li.style.left = null;
			li.style.width = null;
			li.style.height = null;
			li.style.zIndex = null;
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

			if (this.dataLayersByName[name]) {
				this.updateDataOpacity(this.dataLayersByName[name], opacity);
				return;
			}

			const {layers} = this.lajiMap._tileLayers;
			const _layerOptions = layers[name];
			if (!opacity && _layerOptions.visible) {
				this.lajiMap.setTileLayers({
					...this.lajiMap._tileLayers,
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

	updateDataOpacity(data: Data, opacity: number) {
		data.groupContainer.eachLayer((l: any) => {
			l.setStyle({...l.style, ...computeOpacities(opacity)});
			if (data.cluster) {
				const visibleParent = (data.groupContainer as any).getVisibleParent(l);
				visibleParent?.setOpacity(opacity);
			}
		});
		data.opacity = opacity;
		data.onOpacityChange?.(opacity);
	},
	createList(
		layers: {[name: string]: L.TileLayer[]},
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
		const translationHook = this.lajiMap.addTranslationHook(legend, capitalizeFirstLetter(label));
		this.translateHooks.push(translationHook);

		list.appendChild(legend);
		list.appendChild(innerList);
		Object.keys(layers).sort((a, b) => this.lajiMap._tileLayerOrder.indexOf(a) - this.lajiMap._tileLayerOrder.indexOf(b)).forEach(name => {
			innerList.appendChild(this.createListItem(name, availableLayers[name]));
		});
		return [list, translationHook];
	},
	getFinnishList(): [HTMLElement, () => void]  {
		const availableLayers = this.lajiMap.getAvailableFinnishTileLayers();
		if (Object.keys(availableLayers).length === 0) {
			this.finnishList = undefined;
			return [undefined, undefined];
		}
		if (this.finnishList) {
			return [this.finnishList, this.finnishTranslationHook];
		}
		const [finnishList, finnishTranslationHook] = this.createList(
			this.lajiMap.finnishTileLayers,
			availableLayers,
			this.lajiMap._tileLayers.active === "finnish" ? "FinnishMaps" : "ActivateFinnishMaps",
			"finnish-list"
		);
		this.finnishList = finnishList;
		this.finnishTranslationHook = finnishTranslationHook;
		if (finnishList) {
			if (this.worldList) {
				this._finnishAndWorldContainer.insertBefore(finnishList, this.worldList);
			} else {
				this._finnishAndWorldContainer.appendChild(finnishList);
			}
		}
		return [this.finnishList, this.finnishTranslationHook];
	},
	getWorldList(): [HTMLElement, () => void]  {
		const availableLayers = this.lajiMap.getAvailableWorldTileLayers();
		if (Object.keys(availableLayers).length === 0) {
			this.worldList = undefined;
			return [undefined, undefined];
		}
		if (this.worldList) {
			return [this.worldList, this.worldTranslationHook];
		}
		const [worldList, worldTranslationHook] = this.createList(
			this.lajiMap.worldTileLayers,
			availableLayers,
			this.lajiMap._tileLayers.active === "world" ? "WorldMaps" : "ActivateWorldMaps",
			"world-list"
		);
		this.worldList = worldList;
		this.worldTranslationHook = worldTranslationHook;
		if (worldList) {
			this._finnishAndWorldContainer.appendChild(worldList);
		}
		return [this.worldList, this.worldTranslationHook];
	},
	getOverlayList() {
		const availableLayers = this.lajiMap.getAvailableOverlaysByNames();
		if (Object.keys(availableLayers).length === 0) {
			this.overlayList = undefined;
			return undefined;
		}
		if (this.overlayList) {
			return this.overlayList;
		}
		const [overlayList] = this.createList(this.lajiMap.overlaysByNames, this.lajiMap.getAvailableOverlaysByNames(), "Overlays", "overlay-list");
		this.overlayList = overlayList;
		if (overlayList) {
			this._section.appendChild(overlayList);
		}
	},
	getDataList() {
		const data: any[] = [this.lajiMap.getDraw(), ...this.lajiMap.data].filter(d => typeof d?.label === "string");
		this.dataLayersByName = data.reduce<Record<string, L.LayerGroup>>((byName, d: any) => {
			byName[d.label] = d;
			return byName;
		}, {});
		const [dataList] = this.createList(this.dataLayersByName, this.dataLayersByName, "LayerControlData", "overlay-list");
		this.dataList = dataList;
		if (dataList) {
			this._section.appendChild(dataList);
		}
	},
	updateLayout() {
		this.updateListContainers();
		this.updateActiveProj();
		this.updateLists();
		this.updateHelp();
		this.updateClose();
	},
	updateActiveProj() {
		const {activeProjName} = this.lajiMap;
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
			this.finnishTranslationHook = this.lajiMap.addTranslationHook(
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
			this.worldTranslationHook = this.lajiMap.addTranslationHook(
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
		const oldDataList = this.dataList;
		const [finnishList] = this.getFinnishList();
		const [worldList] = this.getWorldList();
		const overlayList = this.getOverlayList();
		const dataList = this.getDataList();
		const lists = [
			[oldFinnish, finnishList, "finnish"],
			[oldWorld, worldList, "world"],
		];

		[...lists, [oldOverlayList, overlayList], [oldDataList, dataList]].forEach(([oldList, list]) => {
			if (oldList && !list) {
				oldList.parentElement.removeChild(oldList);
			}
		});

		lists.filter(([oldList, list]) => !oldList && list).forEach(([, list, active]) => {
			list.querySelector("legend").addEventListener("click", () => {
				if (this._finnishDisabled) {
					return;
				}
				if (active === this.lajiMap._tileLayers.active) {
					if (finnishList && active === "finnish") {
						active = "world";
					} else if (worldList && active === "world") {
						active = "finnish";
					}
				}

				const worldLayers = this.lajiMap.getAvailableWorldTileLayers();
				const finnishLayers = this.lajiMap.getAvailableFinnishTileLayers();

				const checkLayer = name => !(this.lajiMap._tileLayers.layers[name] || this.dataLayersByName[name]).visible;

				const ensureHasLayersIfProjChanged = (_active, layers) =>
					active === _active
					&& Object.keys(layers).every(checkLayer)
					&& {...this.lajiMap._tileLayers.layers, [this.lajiMap._tileLayerOrder.find(l => layers[l])]: true};

				const layerOptions =
					ensureHasLayersIfProjChanged("world", worldLayers)
					|| ensureHasLayersIfProjChanged("finnish", finnishLayers)
					|| this.lajiMap._tileLayers.layers;
				this.lajiMap.setTileLayers({...this.lajiMap._tileLayers, active, layers: layerOptions});
			});
		});
	},
	updateLists() {
		Object.keys({...this.lajiMap.tileLayers, ...this.lajiMap.overlaysByNames, ...this.dataLayersByName}).forEach(name => {
			const available = this.lajiMap._tileLayers.layers[name] || this.dataLayersByName[name];

			if (!this.elems[name]) return;

			this.elems[name].li.style.display = available ? "block" : "none";

			if (!available) return;

			const {opacity, visible} = this.lajiMap._tileLayers.layers[name] || this.dataLayersByName[name];
			const {slider, checkbox, li} = this.elems[name];
			this.lajiMap._internalTileLayersUpdate = true;
			if (visible) {
				L.DomUtil.addClass(li, "active");
			} else {
				L.DomUtil.removeClass(li, "active");
			}
			slider.set(opacity);
			this.lajiMap._internalTileLayersUpdate = false;
			checkbox.checked = visible;
		});
	},
	_checkDisabledLayers() {
		const latLng = this._map.getCenter();
		if (!this.finnishList) {
			return;
		}
		if (this.lajiMap._isOutsideFinland(latLng) && !this._finnishDisabled) {
			this._finnishDisabled = true;
			L.DomUtil.addClass(this.finnishList.querySelector("legend"), "disabled");
			this.worldList && L.DomUtil.addClass(this.worldList.querySelector("legend"), "disabled");
			this.translateHooks = this.translateHooks.filter(h => h !== this.finnishTranslationHook);
			this.finnishTranslationHook = this.lajiMap.addTranslationHook(
				this.finnishList.querySelector("legend"),
				"FinnishMapDisabledOutsideFinland"
			);
			this.translateHooks.push(this.finnishTranslationHook);
		} else if (!this.lajiMap._isOutsideFinland(latLng) && this._finnishDisabled) {
			this._finnishDisabled = false;
			L.DomUtil.removeClass(this.finnishList.querySelector("legend"), "disabled");
			this.worldList && L.DomUtil.removeClass(this.worldList.querySelector("legend"), "disabled");
			this.translateHooks = this.translateHooks.filter(h => h !== this.finnishTranslationHook);
			this.finnishTranslationHook = this.lajiMap.addTranslationHook(
				this.finnishList.querySelector("legend"),
				this.lajiMap.activeProjName === "finnish" ? "FinnishMaps" : "ActivateFinnishMaps"
			);
			this.translateHooks.push(this.finnishTranslationHook);
		}
	},
	updateHelp() {
		const list = document.createElement("fieldset");
		list.className = "layer-help";
		const legend = document.createElement("legend");
		const link = document.createElement("a");
		link.target = "_blank";
		link.rel = "noopener norefererrer";
		const glyph = document.createElement("span");
		glyph.className = "glyphicon glyphicon-question-sign";
		legend.appendChild(glyph);
		if (this.helpTranslationHook) {
			this.translateHooks = this.translateHooks.filter(h => h !== this.helpTranslationHook);
		}
		this.helpTranslationHook = this.lajiMap.addTranslationHook(link, "LayerHelp");
		this.translateHooks.push(this.helpTranslationHook);
		link.href = "http://laji.fi/about/5723";
		list.appendChild(legend);
		legend.appendChild(link);
		const oldHelp = this.helpElem;
		if (oldHelp) {
			oldHelp.parentElement.removeChild(oldHelp);
		}
		this.helpElem = list;
		this._section.appendChild(this.helpElem);
	},
	updateClose() {
		if (!L.Browser.mobile) {
			return;
		}
		const list = document.createElement("fieldset");
		list.className = "layer-close";

		const legend = document.createElement("legend");
		legend.tabIndex = 0;
		legend.addEventListener("click", L.Control.Layers.prototype.collapse.bind(this));

		const glyph = document.createElement("span");
		glyph.innerHTML = "✖";

		if (this.closeTranslationHook) {
			this.translateHooks = this.translateHooks.filter(h => h !== this.closeTranslationHook);
		}

		const label = document.createElement("span");
		this.closeTranslationHook = this.lajiMap.addTranslationHook(label, "Close");
		this.translateHooks.push(this.closeTranslationHook);

		list.appendChild(legend);
		legend.appendChild(glyph);
		legend.appendChild(label);

		this._section.insertBefore(list, this._section.children[0]);
	}
}) as unknown as { new(...args: any[]): L.Control };

export default LayerControl;
