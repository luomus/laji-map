import { dependsOn, depsProvided, provide, reflect } from "./dependency-utils";
import { latLngSegmentsToGeoJSONGeometry, geoJSONLineToLatLngSegmentArrays, createTextInput, isPolyline, combineColors, getLineTransectStartEndDistancesForIdx } from "./utils";
import "leaflet-geometryutil";
import "leaflet-textpath";
import {
	NORMAL_COLOR,
	ACTIVE_COLOR,
	INCOMPLETE_COLOR,
	ESC
} from "./globals";

const POINT_DIST_TRESHOLD = 50;
const ODD_AMOUNT = 30;

const lineStyle = {color: NORMAL_COLOR, weight: 2};
const hoverLineStyle = {...lineStyle, color: "#ec9814"};
const activeLineStyle = {...lineStyle, color: ACTIVE_COLOR};
const editLineStyle = {...lineStyle, color: "#f00"};
const origLineStyle = {...lineStyle, weight: 1, fill: "#99b"};

const corridorStyle = {...lineStyle, fillOpacity: 0.6, weight: 0, fillColor: lineStyle.color};
const oddCorridorStyle = {...corridorStyle, weight: 2, fillColor: combineColors(lineStyle.color, "#000000", ODD_AMOUNT)};
const activeCorridorStyle = {...corridorStyle, fillColor: activeLineStyle.color};
const editCorridorStyle = {...corridorStyle, fillColor: editLineStyle.color, fillOpacity: 0.5};
const hoverCorridorStyle = {...corridorStyle, fillColor: hoverLineStyle.color};

const pointStyle = {weight: 0, radius: 3, fillColor: "#154EAA", fillOpacity: 1};
const oddPointStyle = {...pointStyle, fillColor: combineColors(pointStyle.fillColor, "#000000", ODD_AMOUNT)};
const activePointStyle = {...pointStyle, fillColor: combineColors(activeLineStyle.color, "#000000", 40)};
const editPointStyle = {...pointStyle, fillColor: editLineStyle.color};
const hoverPointStyle = {...pointStyle, fillColor: hoverLineStyle.color};
const editablePointStyle = {...pointStyle, radius: 5, fillColor: "#f00", fillOpacity: 0.7};
const overlappingPointStyle = {...pointStyle, radius: 5, weight: 3, color: "#000"};
const seamPointStyle = {...pointStyle, radius: 7};
const closebyEditPointStyle = {...editPointStyle, radius: 9};
const closebyPointStyle = {...pointStyle, fillColor: combineColors(hoverLineStyle.color, "#000000", 40), radius: 9};

const LT_WIDTH_METERS = 25;

function flattenMatrix(m) {
	return m.reduce((flattened, array) => [...flattened, ...array], []);
}

function idxTuplesEqual(i, j) {
	if (i === undefined || j === undefined) {
		return i === j;
	}
	return i.every((_, idx) => i[idx] === j[idx]);
}

function lineToGeoJSONLine(line) {
	const firstLatLng =  line[0].getLatLngs()[0];
	return line.reduce((geoJSON, segment) => {
		const latLng = segment.getLatLngs()[1];
		geoJSON.coordinates.push([latLng.lng, latLng.lat]);
		return geoJSON;
	}, {
		type: "LineString",
		coordinates: [[firstLatLng.lng, firstLatLng.lat]]
	});
}

function idxTupleToIdxTupleStr(i, j) {
	return i !== undefined && j !== undefined ? `${i}-${j}` : undefined;
}

export default LajiMap => class LajiMapWithLineTransect extends LajiMap {
	constructor(props) {
		super(props);
		this._startLTDragHandler = this._startLTDragHandler.bind(this);
		this._stopLTDragHandler = this._stopLTDragHandler.bind(this);
		this._dragLTHandler = this._dragLTHandler.bind(this);

		this._startLTDragPointHandler = this._startLTDragPointHandler.bind(this);
		this._stopLTDragPointHandler = this._stopLTDragPointHandler.bind(this);
		this._dragLTPointHandler = this._dragLTPointHandler.bind(this);

		this._startLTDragCorridorHandler = this._startLTDragCorridorHandler.bind(this);
		this._stopLTDragCorridorHandler = this._stopLTDragCorridorHandler.bind(this);
		this._dragLTCorridorHandler = this._dragLTCorridorHandler.bind(this);

		this._mouseMoveLTLineSplitHandler = this._mouseMoveLTLineSplitHandler.bind(this);
		this.startLTLineSplit = this.startLTLineSplit.bind(this);
		this.stopLTLineSplit = this.stopLTLineSplit.bind(this);

		this.startSelectLTSegmentMode = this.startSelectLTSegmentMode.bind(this);
		this.stopSelectLTSegmentMode = this.stopSelectLTSegmentMode.bind(this);

		this.startRemoveLTPointMode = this.startRemoveLTPointMode.bind(this);
		this.stopRemoveLTPointMode = this.stopRemoveLTPointMode.bind(this);
		this.chooseFirstSegmentToConnect = this.chooseFirstSegmentToConnect.bind(this);
		this.chooseLastSegmentToConnectAndCommit = this.chooseLastSegmentToConnectAndCommit.bind(this);

		this.splitLTByMeters = this.splitLTByMeters.bind(this);

		this._addKeyListener(ESC, () => {
			if (this.LTEditPointIdx) {
				this._commitPointDrag();
				return true;
			} else if (this._lineSplitFn) {
				this.stopLTLineSplit();
				return true;
			} else if (this._selectLTMode) {
				this.stopSelectLTSegmentMode();
				return true;
			}
		});
	}

	getOptionKeys() {
		return {
			...super.getOptionKeys(),
			lineTransect: ["setLineTransect", () => {
				return this.LTFeature ? {
					feature: this._formatLTFeatureOut(),
					activeIdx: this._LTActiveIdx,
					onChange: this._onLTChange
				} : undefined;
			}]
		};
	}

	_interceptClick() {
		return super._interceptClick() || (() => {
			if (this.LTEditPointIdx !== undefined && !this._LTDragging) {
				this._commitPointDrag();
				return true;
			} else if (this._lineSplitFn) {
				this._lineSplitFn(...this._splitIdxTuple, this._splitPoint);
			}
			return false;
		})();
	}

	_getAllData() {
		return this._lineLayerGroup ? [...super._getAllData(), {group: this._lineLayerGroup}] : super._getAllData();
	}

	@dependsOn("map")
	setLineTransect(data) {
		if (!depsProvided(this, "setLineTransect", arguments)) return;
		if (!data) return;

		let {feature, activeIdx, onChange} = data;
		this.LTFeature = feature;
		this._onLTChange = onChange;
		this._LTActiveIdx = activeIdx;

		this._LTHistory = [{geometry: feature.geometry}];
		this._LTHistoryPointer = 0;

		this.setLineTransectGeometry(feature.geometry);
		this._origLineTransect = L.featureGroup(this._allSegments.map(line =>
			L.polyline(line._latlngs, origLineStyle).setText("→", {repeat: true, attributes: {...origLineStyle, dy: 5, "font-size": 18}, below: true})
		)).addTo(this.map).bringToBack();

		if (this.getOptions().zoomToData) this.zoomToData();
	}

	setLTActiveIdx(idx) {
		const prevIdx = this._LTActiveIdx;
		this._LTActiveIdx = idx;
		[prevIdx, this._LTActiveIdx].forEach(i => this._updateLTStyleForLineIdx(i));
	}

	_formatLTFeatureOut() {
		const segments = this._lineLayers.map(line => line.map(segment => segment.getLatLngs().map(({lat, lng}) => [lng, lat])));

		return {...this.LTFeature, geometry: latLngSegmentsToGeoJSONGeometry(segments)};
	}

	setLineTransectGeometry(geometry, undoData) {
		if (undoData) {
			if (this._LTHistoryPointer < this._LTHistory.length - 1) {
				this._LTHistory = this._LTHistory.splice(0).splice(0, this._LTHistoryPointer + 1);
			}
			const events = undoData.events.map(e => {
				switch(e.type) {
				case "edit": {
					return {
						type: "edit",
						idx: e.idx,
						feature: undoData.prevFeature,
						geometry: {type: "LineString", coordinates: undoData.prevFeature.geometry.coordinates[e.idx]}
					};
				}
				case "insert": {
					return {
						type: "delete",
						idx: e.idx,
						feature: undoData.prevFeature
					};
				}
				case "delete": {
					return {
						type: "insert",
						idx: e.idx,
						feature: undoData.prevFeature,
						geometry: {type: "LineString", coordinates: undoData.prevFeature.geometry.coordinates[e.idx]}
					};
				}
				}
			}).filter(e => e);
			this._LTHistory.push({geometry, events, featureCollection: undoData.prevFeature});
			this._LTHistoryPointer++;
		}

		const wholeLinesAsSegments = geoJSONLineToLatLngSegmentArrays(geometry);

		if (this._pointLayerGroup) this.map.removeLayer(this._pointLayerGroup);
		if (this._lineLayerGroup) this.map.removeLayer(this._lineLayerGroup);
		if (this._corridorLayerGroup) this.map.removeLayer(this._corridorLayerGroup);
		if (this._tooltipLayers) {
			Object.keys(this._tooltipLayers).forEach(lineIdx => this._closePopupFor(lineIdx));
		}
		this._pointLayers = [];
		this._lineLayers = [];
		this._corridorLayers = [];
		this._tooltipLayers = [];

		const pointLayers = this._pointLayers;
		const lineLayers = this._lineLayers;
		const corridorLayers = this._corridorLayers;

		let i = 0;
		wholeLinesAsSegments.forEach((wholeLineAsSegments, lineIdx) => {
			[pointLayers, lineLayers, corridorLayers].forEach(layers => {
				layers.push([]);
			});
			const pointLayer = pointLayers[lineIdx];
			const lineLayer = lineLayers[lineIdx];
			const corridorLayer = corridorLayers[lineIdx];

			wholeLineAsSegments.forEach((segment) => {
				lineLayer.push(
					L.polyline(segment, i === this._LTActiveIdx ? activeLineStyle : lineStyle)
						.setText("→", {repeat: true, attributes: {dy: 5, "font-size": 18}})
				);

				const even = lineIdx % 2 === 0;
				pointLayer.push(L.circleMarker(segment[0],
					lineIdx === this._LTActiveIdx
					? activePointStyle
					: even
						? pointStyle
						: oddPointStyle));

				corridorLayer.push(L.polygon(
					this._getCorridorCoordsForLine(segment),
					lineIdx === this._LTActiveIdx
					? activeCorridorStyle
					: even
						? corridorStyle
						: oddCorridorStyle
				));

				i++;
			});

			pointLayer.push(
				L.circleMarker(wholeLineAsSegments[wholeLineAsSegments.length - 1][1], pointStyle)
			);
		});

		this._allSegments = flattenMatrix(lineLayers);
		this._allCorridors = flattenMatrix(corridorLayers);
		this._allPoints = flattenMatrix(pointLayers);

		this._lineLayerGroup = L.featureGroup(this._allSegments).addTo(this.map);
		this._corridorLayerGroup = L.featureGroup(this._allCorridors).addTo(this.map);
		this._pointLayerGroup = L.featureGroup(this._allPoints).addTo(this.map);

		this._LTGroups = this._lineLayers.map((_, lineIdx) => {
			return L.featureGroup([...this._lineLayers[lineIdx], ...this._pointLayers[lineIdx], ...this._corridorLayers[lineIdx]]);
		});

		this._overlappingNonadjacentPointIdxTuples = {};
		this._overlappingAdjacentPointIdxTuples = {};
		const overlappingsCoordsToIdxs = {};

		pointLayers.forEach((points, lineIdx) => {
			points.forEach((point, pointIdx) => {
				const latlng = point.getLatLng();
				const stringCoords = `${latlng.lat}-${latlng.lng}`;
				const overlapping = overlappingsCoordsToIdxs[stringCoords];
				let overlappingEndOrStart = false;
				if (overlapping) {
					const [overlappingLineIdx] = overlapping;

					const pointIdxTuple = [lineIdx, pointIdx];
					const pointIdxTupleStr = idxTupleToIdxTupleStr(...pointIdxTuple);
					const overlappingPointIdxTuple = overlappingsCoordsToIdxs[stringCoords];
					const overlappingPointIdxTupleStr = idxTupleToIdxTupleStr(...overlappingPointIdxTuple);
					if (overlappingLineIdx !== undefined && overlappingLineIdx !== lineIdx - 1) {
						this._overlappingNonadjacentPointIdxTuples[pointIdxTupleStr] = overlappingPointIdxTuple;
						this._overlappingNonadjacentPointIdxTuples[overlappingPointIdxTupleStr] = pointIdxTuple;
						overlappingEndOrStart = true;
					} else {
						this._overlappingAdjacentPointIdxTuples[pointIdxTupleStr] = overlappingPointIdxTuple;
						this._overlappingAdjacentPointIdxTuples[overlappingPointIdxTupleStr] = pointIdxTuple;
					}
				}
				if (overlappingEndOrStart) {
					point.setStyle(overlappingPointStyle);
				} else if (pointIdx === 0 || pointIdx === points.length - 1) {
					point.setStyle(seamPointStyle);
				}
				overlappingsCoordsToIdxs[stringCoords] = [lineIdx, pointIdx];
			});
		});
		this._setIdxTupleMappings();
		this._setLineTransectEvents();

		provide(this, "lineTransect");
	}

	LTUndo() {
		if (this._LTHistoryPointer <= 0) return;
		const {events} = this._LTHistory[this._LTHistoryPointer];
		this._LTHistoryPointer--;
		const {geometry} = this._LTHistory[this._LTHistoryPointer];
		this.setLineTransectGeometry(geometry);
		if (events) {
			this._triggerEvent(events, this._onLTChange);
		}
	}

	LTRedo() {
		if (this._LTHistoryPointer >= this._LTHistory.length - 1) return;
		this._LTHistoryPointer++;
		const {geometry, events} = this._LTHistory[this._LTHistoryPointer];
		this.setLineTransectGeometry(geometry);
		if (events) {
			this._triggerEvent(events, this._onLTChange);
		}
	}

	_openPopupFor(lineIdx) {
		const getPopupFor = (lineIdx) => {
			const [prevDistance, distance] = getLineTransectStartEndDistancesForIdx(this._formatLTFeatureOut(), lineIdx, 10);
			return 	`${prevDistance}-${distance}m`;
		};

		const offset = -this.featurePopupOffset || 0;
		const layer = this._LTGroups[lineIdx];

		let latLng = this._mouseLatLng;

		if (!this._tooltipLayers[lineIdx]) {
			this._tooltipLayers[lineIdx] = new L.Rrose({ offset: new L.Point(0, offset), closeButton: false, autoPan: false })
				.setContent(getPopupFor(lineIdx))
				.setLatLng(latLng)
				.openOn(this.map);
			layer.on("mousemove", e => {
				const latlng = e.latlng;
				this._tooltipLayers[lineIdx].setLatLng(latlng);
			});
		} else if (!this.map.hasLayer(this._tooltipLayers[lineIdx])) {
			this._tooltipLayers[lineIdx].openOn(this.map);
		}

		if (latLng) {
			this._tooltipLayers[lineIdx].setLatLng(latLng);
		}
	}

	_closePopupFor(lineIdx) {
		this._tooltipLayers[lineIdx] && this._tooltipLayers[lineIdx].remove();
	}

	flatIdxToIdxTuple(idx) {
		let lineIdx = 0;
		let line = this._pointLayers[lineIdx];
		while (idx >= line.length) {
			idx -= line.length;
			lineIdx++;
			line = this._pointLayers[lineIdx];
		}
		return [lineIdx, idx];
	}


	// Opens a dialog and asks which point to use, if points are overlapping.
	_getPoint(lineIdx, pointIdx, callback, questionTranslationKey = "FirstOrLastPoint", firstTranslationKey = "FirstPartitive", lastTranslationKey = "LastPartitive" ) {
		const overlappingPointIdxTuple = this._overlappingNonadjacentPointIdxTuples[idxTupleToIdxTupleStr(lineIdx, pointIdx)];
		if (overlappingPointIdxTuple !== undefined) {
			const firstIdxTuple = overlappingPointIdxTuple;
			const lastIdxTuple = [lineIdx, pointIdx];
			const lastPoint = this._getLayerForIdxTuple(this._pointLayers, ...lastIdxTuple);

			const translateHooks = [];

			const popup = document.createElement("div");
			popup.className = "text-center";

			const question = document.createElement("span");
			translateHooks.push(this.addTranslationHook(question, questionTranslationKey));

			const precedingIdxTuple = this._getIdxTuplePrecedingPoint(...firstIdxTuple);
			const followingIdxTuple = this._getIdxTupleFollowingPoint(lineIdx, pointIdx);

			const onClick = (idxTuple) => (e) => {
				e.preventDefault();
				const point = this._getLayerForIdxTuple(this._pointLayers, ...idxTuple);
				this._overlappingPointDialogSegmentIdxTuple = undefined;
				point.setStyle(pointStyle);
				lastPoint.closePopup();
				callback(...idxTuple);
			};

			const onMouseOver = (idxTuple) => () => {
				if (!idxTuple) return;
				this._overlappingPointDialogSegmentIdxTuple = idxTuple;
				this._updateLtStyleForIdxTuple(...idxTuple);
			};
			const onMouseOut = (idxTuple) => () => {
				if (!idxTuple) return;
				this._overlappingPointDialogSegmentIdxTuple = undefined;
				this._updateLtStyleForIdxTuple(...idxTuple);
			};

			const firstButton = document.createElement("button");
			firstButton.addEventListener("click", onClick(firstIdxTuple));
			firstButton.addEventListener("mouseover", onMouseOver(precedingIdxTuple));
			firstButton.addEventListener("mouseout", onMouseOut(precedingIdxTuple));

			translateHooks.push(this.addTranslationHook(firstButton, firstTranslationKey));

			const lastButton = document.createElement("button");
			lastButton.addEventListener("click", onClick(lastIdxTuple));
			lastButton.addEventListener("mouseover", onMouseOver(followingIdxTuple));
			lastButton.addEventListener("mouseout", onMouseOut(followingIdxTuple));
			translateHooks.push(this.addTranslationHook(lastButton, lastTranslationKey));

			const buttonContainer = document.createElement("div");
			buttonContainer.className = "btn-group";
			[firstButton, lastButton].forEach(button => {
				button.className = "btn btn-primary btn-xs";
				buttonContainer.appendChild(button);
			});

			popup.appendChild(question);
			popup.appendChild(buttonContainer);

			lastPoint.bindPopup(popup).openPopup();
			lastPoint.on("popupclose", () => {
				translateHooks.forEach(hook => this.removeTranslationHook(hook));
				lastPoint.unbindPopup();
			});
		} else {
			callback(lineIdx, pointIdx);
		}
	}

	getIdxsFromLayer(layer) {
		if (!layer) return undefined;
		const {_leaflet_id} = layer;
		const getIdxsForId = id => {
			const lineIdx = this.leafletIdsToCorridorLineIdxs[id];
			const segmentIdx = this.leafletIdsToCorridorSegmentIdxs[id];
			return {
				i: this.leafletIdsToFlatCorridorSegmentIdxs[id],
				lineIdx,
				segmentIdx,
				idxTuple: [lineIdx, segmentIdx]
			};
		};
		if (layer instanceof L.CircleMarker) {
			const i = this.leafletIdsToFlatPointIdxs[_leaflet_id];
			const [lineIdx, segmentIdx] = this.flatIdxToIdxTuple(i);
			return {
				i,
				lineIdx,
				segmentIdx,
				idxTuple: [lineIdx, segmentIdx]
			};
		} else if (isPolyline(layer)) {
			const corridorId = this.lineIdsToCorridorIds[layer._leaflet_id];
			return getIdxsForId(corridorId);
		} else {
			return getIdxsForId(_leaflet_id);
		}
	}

	getIdxsFromEvent({layer}) {
		return this.getIdxsFromLayer(layer);
	}


	// Handles also distance calculation
	_setIdxTupleMappings() {
		this.leafletIdsToFlatCorridorSegmentIdxs = {};
		this.leafletIdsToCorridorLineIdxs = {};
		this.leafletIdsToCorridorSegmentIdxs = {};
		this.corridorFlatIdxsToLeafletIds = {};
		this.lineIdsToCorridorIds = {};

		let i = 0;
		this._corridorLayers.forEach((corridors, lineIdx) => corridors.forEach((corridor, segmentIdx) => {
			const id = corridor._leaflet_id;
			this.leafletIdsToFlatCorridorSegmentIdxs[id] = i;
			this.leafletIdsToCorridorLineIdxs[id] = lineIdx;
			this.leafletIdsToCorridorSegmentIdxs[id] = segmentIdx;
			this.corridorFlatIdxsToLeafletIds[i] = id;
			i++;
		}));

		i = 0;
		this._lineLayers.forEach((lines) => lines.forEach((line) => {
			this.lineIdsToCorridorIds[line._leaflet_id] = this.corridorFlatIdxsToLeafletIds[i];
			i++;
		}));

		this.leafletIdsToFlatPointIdxs = {};

		i = 0;
		this._pointLayers.forEach((points) => {
			points.forEach(point => {
				this.leafletIdsToFlatPointIdxs[point._leaflet_id] = i;
				i++;
			});
		});
	}

	_setLineTransectEvents() {
		const onMouseOver = (e) => {
			L.DomEvent.stopPropagation(e);

			const {lineIdx, segmentIdx} = this.getIdxsFromEvent(e);

			const prevHoverIdx = this._hoveredIdxTuple;
			this._hoveredIdxTuple = [lineIdx, segmentIdx];
			if (prevHoverIdx) this._updateLTStyleForLineIdx(prevHoverIdx[0]);
			this._updateLTStyleForLineIdx(this._hoveredIdxTuple[0]);
			this._openPopupFor(lineIdx);
		};
		const onMouseOut = (e) => {
			L.DomEvent.stopPropagation(e);

			const {lineIdx} = this.getIdxsFromEvent(e);

			this._hoveredIdxTuple = undefined;
			this._updateLTStyleForLineIdx(lineIdx);
			this._closePopupFor(lineIdx);
		};
		const pointIsMiddlePoint = (e) => {
			const {lineIdx, segmentIdx} = this.getIdxsFromEvent(e);
			if (segmentIdx === 0 || segmentIdx === this._pointLayers[lineIdx].length - 1) {
				return false;
			}
			return true;
		};

		this._pointLayerGroup.on("dblclick", e => {
			L.DomEvent.stopPropagation(e);

			const {idxTuple} = this.getIdxsFromEvent(e);
			this._getPoint(...idxTuple, (...idxTuple) => this._setLTPointEditable(...idxTuple));
		}).on("click", e => {
			L.DomEvent.stopPropagation(e);

			const {lineIdx} = this.getIdxsFromEvent(e);

			if (!this._selectLTMode) {
				this._triggerEvent(this._getOnActiveSegmentChangeEvent(lineIdx), this._onLTChange);
			}
		}).on("mouseover", e => {
			pointIsMiddlePoint(e) && onMouseOver(e);
		}).on("mouseout", e => {
			pointIsMiddlePoint(e) && onMouseOut(e);
		});

		this._corridorLayerGroup.on("click", e => {
			L.DomEvent.stopPropagation(e);

			const {lineIdx, idxTuple} = this.getIdxsFromEvent(e);

			if (this._selectLTMode) {
				this._hoveredIdxTuple = undefined;
				if (this._onSelectLT) this._onSelectLT(...idxTuple);
			} else {
				this._triggerEvent(this._getOnActiveSegmentChangeEvent(lineIdx), this._onLTChange);
			}
		}).on("mouseover", onMouseOver)
			.on("mouseout", onMouseOut);

		this.map.on("mousemove", ({latlng}) => {
			if (this._splitIdxTuple || this._firstLTSegmentToRemoveIdx || this._selectLTMode) {
				return;
			}
			const closestPoint = L.GeometryUtil.closestLayer(this.map, this._allPoints, latlng).layer;
			const {idxTuple} = this.getIdxsFromLayer(closestPoint);
			const idxTupleStr = idxTuple ? idxTupleToIdxTupleStr(...idxTuple) : undefined;
			const prevClosestPointIdxTuple = this._closebyPointIdxTuple;
			const closestPointPixelPoint = this.map.latLngToLayerPoint(closestPoint.getLatLng());
			const latLngPixelPoint = this.map.latLngToLayerPoint(latlng);
			this._closebyPointIdxTuple = this._contextMenuLayer !== undefined && this._contextMenuLayer === this._LTPointExpander
				? this._closebyPointIdxTuple
				: closestPointPixelPoint.distanceTo(latLngPixelPoint) <= POINT_DIST_TRESHOLD
					? idxTuple
					: undefined;
			if (!idxTuplesEqual(prevClosestPointIdxTuple, this._closebyPointIdxTuple)) {
				if (this._LTPointExpander) {
					const layer = this._LTPointExpander;
					if (this.map.contextmenu.isVisible() && this._contextMenuLayer === this._LTPointExpander) this.map.contextmenu.hide();
					setImmediate(() => layer.remove());
				}
				if (this._closebyPointIdxTuple) {
					this._LTPointExpander = new L.CircleMarker(closestPoint.getLatLng(), {radius: POINT_DIST_TRESHOLD, opacity: 0, fillOpacity: 0})
						.addTo(this.map)
						.bringToBack()
						.bindContextMenu(this._getContextMenuForPoint(...this._closebyPointIdxTuple));
					const layer = this._getLayerForIdxTuple(this._pointLayers, ...this._closebyPointIdxTuple);
					if (layer && this.map.hasLayer(layer)) layer.bringToFront();
					if (this._LTdragPoint) this._LTdragPoint.bringToFront();
				} else if (this._LTPointExpander) {
					this._LTPointExpander = undefined;
				}
				[prevClosestPointIdxTuple, this._closebyPointIdxTuple].forEach(idxTuple => {
					if (idxTuple) {
						const layers = [this._getLayerForIdxTuple(this._pointLayers, ...idxTuple)];
						const overlappingNonadjacentIdxTuple = this._overlappingNonadjacentPointIdxTuples[idxTupleStr];
						const overlappingAdjacentIdxTuple = this._overlappingAdjacentPointIdxTuples[idxTupleStr];
						if (overlappingNonadjacentIdxTuple) {
							layers.push(this._getLayerForIdxTuple(this._pointLayers, ...overlappingNonadjacentIdxTuple));
						} else if (overlappingAdjacentIdxTuple) {
							layers.push(this._getLayerForIdxTuple(this._pointLayers, ...overlappingAdjacentIdxTuple));
						}
						layers.forEach(layer => layer && layer.setStyle(this._getStyleForLTLayer(layer)));
					}
				});
			}
		}).on("dblclick", e => {
			L.DomEvent.stopPropagation(e);
			if (this._closebyPointIdxTuple) {
				this._disableDblClickZoom = true;
				this._getPoint(...this._closebyPointIdxTuple, (...idxTuple) => this._setLTPointEditable(...idxTuple));
				setTimeout(() => {
					this._disableDblClickZoom = false;
				}, 10);
			}
		}).on("contextmenu.show", e => {
			if (e.relatedTarget) this._LTContextMenuLayer = e.relatedTarget;
		}).on("contextmenu.hide", () => {
			const {lineIdx} = this.getIdxsFromLayer(this._LTContextMenuLayer) || {};
			if (lineIdx !== undefined) this._updateLTStyleForLineIdx(lineIdx);
		});
	}

	@reflect()
	@dependsOn("lineTransect", "translations")
	_updateLTLayerContextMenus() {
		if (!depsProvided(this, "_updateLTLayerContextMenus", arguments)) return;

		const {translations} = this;

		this._corridorLayers.forEach((corridor, lineIdx) => corridor.forEach((corridorSegment, segmentIdx) => {
			corridorSegment.bindContextMenu({
				contextmenuInheritItems: false,
				contextmenuItems: [
					{
						text: translations.SplitLine,
						callback: () => this.startLTLineSplitForIdx(lineIdx, segmentIdx),
						iconCls: "glyphicon glyphicon-scissors"
					},
					{
						text: translations.SplitLineByMeters,
						callback: () => this.splitLTByMeters(lineIdx),
						iconCls: "laji-map-line-transect-split-by-meters-glyph"
					},
					{
						text: translations.ConnectSegments,
						callback: () => this.chooseFirstSegmentToConnect(lineIdx, segmentIdx),
						iconCls: "laji-map-line-transect-remove-point-glyph"
					},
					{
						text: translations.CreatePoint,
						callback: () => this.startLTPointAddSplitForIdx(lineIdx, segmentIdx),
						iconCls: "laji-map-line-transect-create-point-glyph"
					},
				]
			});
		}));

		this._pointLayers.forEach((points, lineIdx) => points.forEach((point, pointIdx) => {
			point.bindContextMenu(this._getContextMenuForPoint(lineIdx, pointIdx));
		}));
	}

	_getContextMenuForPoint(lineIdx, pointIdx) {
		return {
			contextmenuInheritItems: false,
			contextmenuItems: [
				{
					text: this.translations.RemovePoint,
					callback: () => {
						this._getPoint(lineIdx, pointIdx, (...idxTuple) => this.removeLTPoint(...idxTuple), "RemoveFirstOrLastPoint", "First", "Last");
					},
					iconCls: "glyphicon glyphicon-remove-sign"
				}
			]
		};
	}

	// 'commit' can be an array of events that are triggered at the same time as the event that this function triggers.
	removeLTPoint(lineIdx, pointIdx, commit = true) {
		let events = [];
		const that = this;

		const prevFeature = this._formatLTFeatureOut();

		const precedingIdxTuple = this._getIdxTuplePrecedingPoint(lineIdx, pointIdx);
		const followingIdxTuple = this._getIdxTupleFollowingPoint(lineIdx, pointIdx);
		const [precedingLineIdx, precedingSegmentIdx] = precedingIdxTuple || [];
		const [followingLineIdx, followingSegmentIdx] = followingIdxTuple || [];

		let precedingSegment = precedingIdxTuple ? this._getLayerForIdxTuple(this._lineLayers, ...precedingIdxTuple) : undefined;
		let followingSegment = followingIdxTuple ? this._getLayerForIdxTuple(this._lineLayers, ...followingIdxTuple) : undefined;
		let precedingLine = this._lineLayers[precedingLineIdx];
		let followingLine = this._lineLayers[followingLineIdx];
		if (precedingLine === followingLine) {
			precedingSegment.setLatLngs([precedingSegment.getLatLngs()[0], followingSegment.getLatLngs()[1]]);
			this._lineLayers[precedingLineIdx] = precedingLine.filter(l => l !== followingSegment);
			addMiddlePointRemoveEvent();
		} else if (precedingLine && !followingLine) {
			precedingLine.splice(precedingSegmentIdx, 1);
			addMiddlePointRemoveEvent();
		} else if (!precedingLine && followingLine) {
			followingLine.splice(followingSegmentIdx, 1);
			addMiddlePointRemoveEvent();
		} else if (precedingLine && followingLine) {
			const precedingSegment = precedingLine[precedingSegmentIdx];
			const followingSegment = followingLine[followingSegmentIdx];
			precedingSegment.setLatLngs([precedingSegment.getLatLngs()[0], followingSegment.getLatLngs()[1]]);
			followingLine.splice(followingSegmentIdx, 1);
			this._lineLayers[precedingLineIdx] = [...precedingLine, ...followingLine];
			this._lineLayers.splice(followingLineIdx, 1);
			const feature = this._formatLTFeatureOut();
			events = [
				{
					type: "edit",
					idx: precedingLineIdx,
					feature,
					geometry: {type: "LineString", coordinates: feature.geometry.coordinates[precedingLineIdx]}
				},
				{
					type: "delete",
					idx: followingLineIdx,
					feature
				}
			];
		}

		if (this._LTActiveIdx !== undefined && this._LTActiveIdx > lineIdx) {
			this._LTActiveIdx = this._LTActiveIdx - 1;
		}

		if (commit) {
			if (Array.isArray(commit)) {
				events = [...commit, ...events];
			}
			this.setLineTransectGeometry(this._formatLTFeatureOut().geometry, {events, prevFeature});
			this._triggerEvent(events, this._onLTChange);
		} else {
			return events;
		}

		function addMiddlePointRemoveEvent() {
			const feature = that._formatLTFeatureOut();
			events = [{
				type: "edit",
				idx: precedingLineIdx,
				feature: feature,
				geometry: {type: "LineString", coordinates: feature.geometry.coordinates[precedingLineIdx]}
			}];
		}
	}

	_setLTPointEditable(lineIdx, pointIdx) {
		if (idxTuplesEqual(this.LTEditPointIdx, [lineIdx, pointIdx])) return;

		if (this.LTEditPointIdx !== undefined) {
			const [_lineIdx, _segmentIdx] = this.LTEditPointIdx;
			const editableLayer = this._pointLayers[_lineIdx][_segmentIdx];
			editableLayer.setStyle(pointStyle);
			this._commitPointDrag();
		}

		const overlappingSeamPointIdx = this._overlappingAdjacentPointIdxTuples[idxTupleToIdxTupleStr(lineIdx, pointIdx)];
		if (overlappingSeamPointIdx) {
			const overlappingPoint = this._getLayerForIdxTuple(this._pointLayers, ...overlappingSeamPointIdx);
			overlappingPoint.remove();
		}

		this.LTEditPointIdx = [lineIdx, pointIdx];
		this._featureBeforePointDrag = this._formatLTFeatureOut();
		if (pointIdx !== undefined) {
			const point = this._getLayerForIdxTuple(this._pointLayers, lineIdx, pointIdx);
			this._LTPointLatLngBeforeDrag = point.getLatLng();
			const style = {color: "#ff0000", opacity: 0.5, fillColor:  "#ffffff", fillOpacity: 0.3};
			this._LTdragPoint = new L.CircleMarker(point.getLatLng(), {radius: POINT_DIST_TRESHOLD, ...style});
			this._LTdragPoint.addTo(this.map)
				.bringToFront()
				.on("mouseover", () => {
					this._LTdragPoint.setStyle(style);
					point.setStyle(this._getStyleForLTLayer(point));
				}).on("mouseout", () => {
					this._LTdragPoint.setStyle({...style, opacity: 0.3});
					point.setStyle(this._getStyleForLTLayer(point));
				})
				.on("remove", () => point.setStyle(this._getStyleForLTLayer(point)))
				.on("mousedown", this._startLTDragPointHandler)
				.on("mouseup", this._stopLTDragPointHandler);

			[pointIdx, pointIdx - 1].filter(i => i >= 0).forEach(idx => {
				const corridor = this._corridorLayers[lineIdx][idx];
				if (corridor) corridor.on("mousedown", this._startLTDragCorridorHandler);
			});
			this.map.on("mouseup", this._stopLTDragCorridorHandler);

			this._closePopupFor(lineIdx);
			[
				this._getIdxTuplePrecedingEditPoint(),
				this._getIdxTupleFollowingEditPoint()
			].filter(i => i)
			 .map(idxTuple => [this._lineLayers, this._corridorLayers].map(layers => this._getLayerForIdxTuple(layers, ...idxTuple)))
			 .forEach(layerPair => layerPair.forEach(layer => layer.setStyle(this._getStyleForLTLayer(layer))));
		}
	}

	_commitPointDrag() {
		this._stopLTDragPointHandler();
		const precedingIdxTuple = this._getIdxTuplePrecedingEditPoint();
		const followingIdxTuple = this._getIdxTupleFollowingEditPoint();
		this.LTEditPointIdx = undefined;
		const dragPointLatLng = this._LTdragPoint.getLatLng();
		this._LTdragPoint.remove();
		this._LTdragPoint = undefined;

		[precedingIdxTuple, followingIdxTuple].forEach(tuple => {
			if (tuple) {
				this._getLayerForIdxTuple(this._corridorLayers, ...tuple).off("mousedown").off("mouseup");
				this._updateLtStyleForIdxTuple(...tuple);
			}
		});

		if (this._LTPointLatLngBeforeDrag.equals(dragPointLatLng)) {
			return;
		}

		const feature = this._formatLTFeatureOut();
		const events = [];
		let prevLineIdx = undefined;
		[precedingIdxTuple, followingIdxTuple].forEach(idxTuple => {
			if (!idxTuple) return;
			const [lineIdx] = idxTuple;
			if (lineIdx !== undefined && lineIdx !== prevLineIdx) {
				prevLineIdx = lineIdx;
				events.push({
					type: "edit",
					feature,
					idx: lineIdx,
					geometry: lineToGeoJSONLine(this._lineLayers[lineIdx])
				});
			}
		});

		this.setLineTransectGeometry(feature.geometry, {events, prevFeature: this._featureBeforePointDrag});

		this._triggerEvent(events, this._onLTChange);
		this.map.fire("lineTransect:pointdrag");
	}

	_startLTDragHandler(handler) {
		this._LTDragging = true;
		this.map.dragging.disable();
		L.DomUtil.disableTextSelection();
		this.map.on("mousemove", handler);
	}

	_stopLTDragHandler(handler) {
		// _interceptClick is triggered after mouseup - we delay drag stopping until map click is handled.
		setImmediate(() => {
			this._LTDragging = false;
			this.map.dragging.enable();
			L.DomUtil.enableTextSelection();
			this.map.off("mousemove", handler);
		});
	}

	_startLTDragPointHandler({latlng}) {
		const [lineIdx, pointIdx] = this.LTEditPointIdx;
		const point = this._pointLayers[lineIdx][pointIdx];
		this._dragPointStart = point.getLatLng();
		this._dragMouseStart = latlng;

		this._startLTDragHandler(this._dragLTPointHandler);
	}

	_stopLTDragPointHandler() {
		this._stopLTDragHandler(this._dragLTPointHandler);
	}

	_dragLTPointHandler({latlng}) {
		if (!this._dragMouseStart) return;

		const mouseMovedDistance = this._dragMouseStart.distanceTo(latlng);
		const mouseRotatedAngle = this._degreesFromNorth([this._dragMouseStart, latlng]);
		const offsetDragPoint = L.GeometryUtil.destination(this._dragPointStart, mouseRotatedAngle, mouseMovedDistance);
		this._dragLTHandler(offsetDragPoint);
	}

	_startLTDragCorridorHandler({latlng}) {
		this._startLTDragHandler(this._dragLTCorridorHandler);

		const [lineIdx, pointIdx] = this.LTEditPointIdx;
		const point = this._pointLayers[lineIdx][pointIdx];

		this._dragPointStart = point.getLatLng();
		this._dragMouseStart = latlng;
	}

	_stopLTDragCorridorHandler() {
		this._stopLTDragHandler(this._dragLTCorridorHandler);
		this._dragPointStart = undefined;
		this._dragMouseStart = undefined;
	}

	_dragLTCorridorHandler({latlng}) {
		if (!this._dragMouseStart) return;
		const mouseMovedDistance = this._dragMouseStart.distanceTo(latlng);
		const mouseRotatedAngle = this._degreesFromNorth([this._dragMouseStart, latlng]);

		const offsetDragPoint = L.GeometryUtil.destination(this._dragPointStart, mouseRotatedAngle, mouseMovedDistance);
		this._dragLTHandler(offsetDragPoint);
	}

	_dragLTHandler(latlng) {
		const idxs = this.LTEditPointIdx;
		const [lineIdx, pointIdx] = idxs;

		const pointLayer = this._pointLayers[lineIdx];
		const point = pointLayer[pointIdx];

		const precedingIdxTuple = this._getIdxTuplePrecedingEditPoint();

		let precedingLine, precedingCorridor;
		if (precedingIdxTuple) {
			precedingLine = this._getLayerForIdxTuple(this._lineLayers, ...precedingIdxTuple);
			precedingCorridor = this._getLayerForIdxTuple(this._corridorLayers, ...precedingIdxTuple);
		}

		const followingIdxTuple = this._getIdxTupleFollowingEditPoint();

		let followingLine, followingCorridor;
		if (followingIdxTuple) {
			followingLine = this._getLayerForIdxTuple(this._lineLayers, ...followingIdxTuple);
			followingCorridor = this._getLayerForIdxTuple(this._corridorLayers, ...followingIdxTuple);
		}

		if (precedingIdxTuple) {
			const lineCoords = [precedingLine.getLatLngs()[0], latlng];
			precedingLine.setLatLngs(lineCoords);
			precedingCorridor.setLatLngs(this._getCorridorCoordsForLine(lineCoords));
		}

		if (followingIdxTuple) {
			const lineCoords = [latlng, followingLine.getLatLngs()[1]];
			followingLine.setLatLngs(lineCoords);
			followingCorridor.setLatLngs(this._getCorridorCoordsForLine(lineCoords));
		}

		point.setLatLng(latlng);
		this._LTdragPoint.setLatLng(latlng);
	}

	_getLayerForIdxTuple(layer, lineIdx, segmentIdx) {
		return layer[lineIdx][segmentIdx];
	}

	_getIdxTuplePrecedingPoint(lineIdx, pointIdx) {
		if (lineIdx === undefined || pointIdx === undefined) return undefined;
		const pointLayer = this._pointLayers[lineIdx];
		const point = pointLayer[pointIdx];

		let precedingLineIdx, precedingIdx = undefined;

		if (pointIdx - 1 >= 0) {
			precedingLineIdx = lineIdx;
			precedingIdx = pointIdx - 1;
		} else if (lineIdx - 1 >= 0) {
			const precedingLineLayer = this._lineLayers[lineIdx - 1];
			if (precedingLineLayer[precedingLineLayer.length - 1].getLatLngs()[1].equals(point.getLatLng())) {
				precedingLineIdx = lineIdx - 1;
				precedingIdx = precedingLineLayer.length - 1;
			}
		}

		return precedingLineIdx !== undefined && precedingIdx !== undefined ? [precedingLineIdx, precedingIdx] : undefined;
	}

	_getIdxTuplePrecedingEditPoint() {
		return this._getIdxTuplePrecedingPoint(...(this.LTEditPointIdx || []));
	}

	_getIdxTupleFollowingPoint(lineIdx, pointIdx) {
		if (lineIdx === undefined || pointIdx === undefined) return undefined;

		const pointLayer = this._pointLayers[lineIdx];
		const point = pointLayer[pointIdx];

		let followingLineIdx, followingIdx = undefined;

		if (pointIdx < pointLayer.length - 1) {
			followingLineIdx = lineIdx;
			followingIdx = pointIdx;
		} else if (lineIdx + 1 <= this._lineLayers.length - 1) {
			const followingLineLayer = this._lineLayers[lineIdx + 1];
			if (followingLineLayer[0].getLatLngs()[0].equals(point.getLatLng())) {
				followingLineIdx = lineIdx + 1;
				followingIdx = 0;
			}
		}

		return followingLineIdx !== undefined && followingIdx !== undefined ? [followingLineIdx, followingIdx] : undefined;
	}

	_getIdxTupleFollowingEditPoint() {
		return this._getIdxTupleFollowingPoint(...(this.LTEditPointIdx || []));
	}

	_degreesFromNorth(lineCoords) {
		const latLngs = lineCoords.map(L.latLng);

		// Line angle horizontally.
		const lineAngle = L.GeometryUtil.computeAngle(...latLngs.map(
			latlng => L.CRS.EPSG3857.project(latlng)
		));

		// Line angle clockwise from north.
		return 90 - lineAngle;
	}

	_getCorridorCoordsForLine(lineCoords) {
		const latLngs = lineCoords.map(L.latLng);
		const lineAngleFromNorth = this._degreesFromNorth(lineCoords);

		// Variables are named as if the line was pointing towards north.
		const SWCorner = L.GeometryUtil.destination(latLngs[0], lineAngleFromNorth - 90, LT_WIDTH_METERS);
		const NWCorner = L.GeometryUtil.destination(latLngs[1], lineAngleFromNorth - 90, LT_WIDTH_METERS);
		const SECorner = L.GeometryUtil.destination(latLngs[0], lineAngleFromNorth + 90, LT_WIDTH_METERS);
		const NECorner = L.GeometryUtil.destination(latLngs[1], lineAngleFromNorth + 90, LT_WIDTH_METERS);

		return [SWCorner, NWCorner, NECorner, SECorner];
	}

	_getOnActiveSegmentChangeEvent(lineIdx) {
		const prevIdx = this._LTActiveIdx;
		this._LTActiveIdx = lineIdx;
		[prevIdx, lineIdx].forEach(i => this._updateLTStyleForLineIdx(i));
		return {type: "active", idx: this._LTActiveIdx};
	}

	_getStyleForLTLayer(layer) {
		const {lineIdx, segmentIdx, idxTuple} = this.getIdxsFromLayer(layer);
		const isPoint = layer instanceof L.CircleMarker;
		const isActive = lineIdx === this._LTActiveIdx && (!isPoint || (segmentIdx !== 0 && segmentIdx !== this._pointLayers[lineIdx].length - 1));
		const [hoveredLineIdx, hoveredSegmentIdx] = this._hoveredIdxTuple || [];
		const contextMenuLineIdx = (this.getIdxsFromLayer(this._contextMenuLayer) || {}).lineIdx;
		const isEditPoint = isPoint && idxTuplesEqual(idxTuple, this.LTEditPointIdx);
		const isClosebyPoint = isPoint && idxTuplesEqual(idxTuple, this._closebyPointIdxTuple);
		const isOverlappingEndOrStartPoint = isPoint && this._overlappingNonadjacentPointIdxTuples.hasOwnProperty(idxTupleToIdxTupleStr(...idxTuple));
		const isSeamPoint = isPoint && this._overlappingAdjacentPointIdxTuples.hasOwnProperty(idxTupleToIdxTupleStr(...idxTuple));

		const _isHover = lineIdx === hoveredLineIdx || lineIdx === contextMenuLineIdx;
		const isEdit = isPoint
			?    isEditPoint
			:    idxTuplesEqual(idxTuple, this._splitIdxTuple)
				|| idxTuplesEqual(idxTuple, this._firstLTSegmentToRemoveIdx)
				|| idxTuplesEqual(idxTuple, this._overlappingPointDialogSegmentIdxTuple)
				|| idxTuplesEqual(idxTuple, this._getIdxTuplePrecedingEditPoint())
				|| idxTuplesEqual(idxTuple, this._getIdxTupleFollowingEditPoint())
				|| (this._selectLTMode === "segment" && _isHover && segmentIdx === hoveredSegmentIdx)
				|| (this._selectLTMode === "line" && _isHover);
		const isHover = this._splitIdxTuple || this._firstLTSegmentToRemoveIdx || this._selectLTMode
			? false
			: isPoint
				? !isSeamPoint && !isOverlappingEndOrStartPoint && _isHover
				: _isHover;

		const lineStyles = {
			normal: lineStyle,
			odd: lineStyle,
			active: activeLineStyle,
			edit: editLineStyle,
			hover: hoverLineStyle,
		};

		const corridorStyles = {
			normal: corridorStyle,
			odd: oddCorridorStyle,
			active: activeCorridorStyle,
			edit: editCorridorStyle,
			hover: hoverCorridorStyle,
		};

		const pointStyles = {
			normal: pointStyle,
			odd: oddPointStyle,
			active: activePointStyle,
			edit: editPointStyle,
			editPoint: editablePointStyle,
			hover: hoverPointStyle,
			closebyEdit: closebyEditPointStyle,
			closeby: closebyPointStyle,
			seam: seamPointStyle,
			overlappingSeam: overlappingPointStyle,
		};

		let styleObject = undefined;
		if (layer instanceof L.Polygon) {
			styleObject = corridorStyles;
		} else if (layer instanceof L.Polyline) {
			styleObject = lineStyles;
		} else if (layer instanceof L.CircleMarker) {
			styleObject = pointStyles;
		}

		if (isEditPoint && isClosebyPoint) {
			return styleObject.closebyEdit;
		} else if (isClosebyPoint) {
			return styleObject.closeby;
		} else if (isEditPoint) {
			return styleObject.editPoint;
		}	else if (isEdit) {
			return styleObject.edit;
		} else if (isHover) {
			return styleObject.hover;
		} else if (isActive) {
			return styleObject.active;
		} else if (isOverlappingEndOrStartPoint) {
			return styleObject.overlappingSeam;
		} else if (isSeamPoint) {
			return styleObject.seam;
		} else {
			return lineIdx % 2 === 0 ? styleObject.normal : styleObject.odd;
		}
	}

	_updateLTStyleForLineIdx(lineIdx) {
		if (lineIdx === undefined) return;
		this._corridorLayers[lineIdx].forEach(corridorLayer => {
			const {segmentIdx} = this.getIdxsFromLayer(corridorLayer);
			this._updateLtStyleForIdxTuple(lineIdx, segmentIdx);
		});
		const [editLineIdx] = (this.LTEditPointIdx || []);
	}

	_updateLtStyleForIdxTuple(lineIdx, segmentIdx) {
		if (lineIdx === undefined || segmentIdx === undefined) return;
		[this._lineLayers, this._corridorLayers, this._pointLayers].forEach(layerGroup => {
			if (layerGroup === this._pointLayers && segmentIdx === 0 || segmentIdx === this._pointLayers[lineIdx].length - 1) return;
			const lineGroup = layerGroup[lineIdx] || [];
			const layer = lineGroup[segmentIdx];
			if (layer) layer.setStyle(this._getStyleForLTLayer(layer));
		});
	}

	_idxTupleToFlatIdx(lineIdx, segmentIdx) {
		if (lineIdx === undefined || segmentIdx === undefined) return undefined;
		return this.getIdxsFromLayer(this._lineLayers[lineIdx][segmentIdx]).i;
	}

	_commitLTLineSplit(lineIdx, segmentIdx, splitPoint) {
		this.stopLTLineSplit();

		const prevFeature = this._formatLTFeatureOut();

		const splitLine = this._lineLayers[lineIdx][segmentIdx];

		const [start, end] = splitLine.getLatLngs();
		// Tail is the part prepending the split and head the following part.
		const splittedSegmentTail = [start, splitPoint];
		const splittedSegmentHead = [splitPoint, end];

		splitLine.setLatLngs(splittedSegmentTail);
		this._lineLayers[lineIdx].splice(segmentIdx + 1, 0, L.polyline(splittedSegmentHead));

		const splittedLineTail = this._lineLayers[lineIdx].slice(0, segmentIdx + 1);
		const splittedLineHead = this._lineLayers[lineIdx].slice(segmentIdx + 1);
		this._lineLayers[lineIdx] = splittedLineTail;
		this._lineLayers.splice(lineIdx + 1, 0, splittedLineHead);

		const feature = this._formatLTFeatureOut();

		const events = [
			{
				type: "edit",
				feature,
				idx: lineIdx,
				geometry: lineToGeoJSONLine(splittedLineTail)
			},
			{
				type: "insert",
				idx: lineIdx + 1,
				geometry: lineToGeoJSONLine(splittedLineHead)
			}
		];

		this.setLineTransectGeometry(feature.geometry, {events, prevFeature});

		if (lineIdx < this._LTActiveIdx) {
			events.push(this._getOnActiveSegmentChangeEvent(this._LTActiveIdx + 1));
		}
		this._triggerEvent(events, this._onLTChange);

		this.map.fire("lineTransect:split");
	}

	_commitLTPointAdd(lineIdx, segmentIdx, splitPoint) {
		this.stopLTLineSplit();

		const prevFeature = this._formatLTFeatureOut();

		const splitLine = this._lineLayers[lineIdx][segmentIdx];

		const [start, end] = splitLine.getLatLngs();
		// Tail is the part prepending the split and head the following part.
		const splittedSegmentTail = [start, splitPoint];
		const splittedSegmentHead = [splitPoint, end];

		splitLine.setLatLngs(splittedSegmentTail);
		this._lineLayers[lineIdx].splice(segmentIdx + 1, 0, L.polyline(splittedSegmentHead));

		const feature = this._formatLTFeatureOut();

		const events = [
			{
				type: "edit",
				feature,
				idx: lineIdx,
				geometry: lineToGeoJSONLine(this._lineLayers[lineIdx])
			},
		];

		this.setLineTransectGeometry(feature.geometry, {events, prevFeature});
		this._triggerEvent(events, this._onLTChange);

		this.map.fire("lineTransect:pointadd");
	}

	stopLTLineSplit() {
		const lastLineCutIdx = this._splitIdxTuple;
		this._lineSplitFn = false;
		if (this._cutLine) this._cutLine.removeFrom(this.map);
		this._cutLine = undefined;
		this._lineCutIdx = undefined;
		this._splitIdxTuple = undefined;
		this.map.off("mousemove", this._mouseMoveLTLineSplitHandler);
		if (lastLineCutIdx) this._updateLtStyleForIdxTuple(...lastLineCutIdx);
		this._disposeTooltip();
	}

	_mouseMoveLTLineSplitHandler({latlng}) {
		const allSegments = this._allSegments;

		let closestLine, closestIdx;
		if (this._lineCutIdx !== undefined) {
			const [lineIdx, segmentIdx] = this._lineCutIdx;
			closestIdx = this._lineCutIdx;
			closestLine = this._lineLayers[lineIdx][segmentIdx];
		} else {
			closestLine = L.GeometryUtil.closestLayer(this.map, allSegments, latlng).layer;
			closestIdx = this.getIdxsFromLayer(closestLine).idxTuple;
		}

		const prevCutIdx = this._splitIdxTuple;
		this._splitIdxTuple = closestIdx;
		if (prevCutIdx) this._updateLtStyleForIdxTuple(...prevCutIdx);
		if (this._splitIdxTuple) this._updateLtStyleForIdxTuple(...this._splitIdxTuple);

		// Update cut line.
		const closestLatLngOnLine = L.GeometryUtil.closest(this.map, closestLine, latlng);
		this._splitPoint = closestLatLngOnLine;
		const lineAngleFromNorth = this._degreesFromNorth(closestLine.getLatLngs());

		const cutLineStart = L.GeometryUtil.destination(closestLatLngOnLine, lineAngleFromNorth - 90, LT_WIDTH_METERS);
		const cutLineEnd = L.GeometryUtil.destination(closestLatLngOnLine, lineAngleFromNorth + 90, LT_WIDTH_METERS);

		if (this._cutLine) {
			this._cutLine.setLatLngs([cutLineStart, cutLineEnd]);
		} else {
			this._cutLine = L.polygon([cutLineStart, cutLineEnd], {...editLineStyle, dashArray: "5 5"}).addTo(this.map);
		}
	}

	startLTLineSplit() {
		this._lineSplitFn = this._commitLTLineSplit;
		this.map.on("mousemove", this._mouseMoveLTLineSplitHandler);
		this._mouseMoveLTLineSplitHandler({latlng: this._mouseLatLng});
		this._createTooltip("SplitLineTooltip");
	}

	startLTLineSplitForIdx(...idxTuple) {
		this._lineCutIdx = idxTuple;
		this._lineSplitFn = this._commitLTLineSplit;
		this.map.on("mousemove", this._mouseMoveLTLineSplitHandler);
		this._mouseMoveLTLineSplitHandler({latlng: this._mouseLatLng});
		this._createTooltip("SplitLineTooltip");
	}

	startLTPointAdd() {
		this._lineSplitFn = this._commitLTPointAdd;
		this.map.on("mousemove", this._mouseMoveLTLineSplitHandler);
		this._mouseMoveLTLineSplitHandler({latlng: this._mouseLatLng});
		this._createTooltip("AddPointTooltip");
	}

	startLTPointAddSplitForIdx(...idxTuple) {
		this._lineCutIdx = idxTuple;
		this._lineSplitFn = this._commitLTPointAdd;
		this.map.on("mousemove", this._mouseMoveLTLineSplitHandler);
		this._mouseMoveLTLineSplitHandler({latlng: this._mouseLatLng});
		this._createTooltip("SplitLineTooltip");
	}

	startSelectLTSegmentMode(onSelect, tooltip, mode = "segment") { // mode should be "segment" or "line"
		this._selectLTMode = mode;
		this._onSelectLT = (...idxTuple) => {
			if (onSelect(...idxTuple) !== false) this.stopSelectLTSegmentMode(...idxTuple);
		};
		if (tooltip) this._createTooltip(tooltip);
	}

	stopSelectLTSegmentMode(lineIdx, segmentIdx) {
		this._selectLTMode = undefined;
		this._onSelectLT = undefined;
		if (this._hoveredIdxTuple) this._updateLtStyleForIdxTuple(...this._hoveredIdxTuple);
		if (lineIdx !== undefined && segmentIdx !== undefined) this._updateLtStyleForIdxTuple(lineIdx, segmentIdx);
		this._disposeTooltip();
	}

	startRemoveLTPointMode() {
		this.startSelectLTSegmentMode(this.chooseFirstSegmentToConnect, "startLineConnectFirstPointHelp");
	}

	stopRemoveLTPointMode(...params) {
		const idxTuple = this._firstLTSegmentToRemoveIdx;
		this._firstLTSegmentToRemoveIdx = undefined;
		if (idxTuple) this._updateLtStyleForIdxTuple(...idxTuple);
		this.stopSelectLTSegmentMode(...params);
	}

	chooseFirstSegmentToConnect(...idxTuple) {
		this._firstLTSegmentToRemoveIdx = idxTuple;
		this._updateLtStyleForIdxTuple(...idxTuple);
		this.startSelectLTSegmentMode(this.chooseLastSegmentToConnectAndCommit, "startLineConnectLastPointHelp");
		return false;
	}

	chooseLastSegmentToConnectAndCommit(...idxTuple) {
		const [first, last] = [this._firstLTSegmentToRemoveIdx, idxTuple].map(tuple => this._idxTupleToFlatIdx(...tuple)).sort((a, b) => a - b);

		let timeout = undefined;
		let prevLatLng = undefined;
		for (let i = first; i <= last; i++) {
			const segment = this._allSegments[i];
			if (!prevLatLng) {
				prevLatLng = segment.getLatLngs()[1];
				continue;
			}
			if (!segment.getLatLngs()[0].equals(prevLatLng)) {
				this._createTooltip("SegmentsMustBeOfSameLine", !!"error");
				if (timeout) clearTimeout(timeout);
				timeout = setTimeout(() => {
					this._createTooltip("startLineConnectLastPointHelp");
					timeout = undefined;
				}, 2000);
				return false;
			}
			prevLatLng = segment.getLatLngs()[1];
		}
		this._firstLTSegmentToRemoveIdx = undefined;

		const flatIdxToIdxTuple = (idx) => {
			return (idx === undefined) ? undefined : this.getIdxsFromLayer(this._allSegments[idx]).idxTuple;
		};

		let i = last;
		let events = [];
		while (i !== first) {
			const _events = this.removeLTPoint(...flatIdxToIdxTuple(i), i === first + 1 ? events : false);
			if (_events) {
				events = [...events, ..._events];
			}
			i--;
		}
	}

	splitLTByMeters() {
		const splitByMeters = (e) => {
			e.preventDefault();

			const {value} = input;

			let distance = 0;
			let distanceLessThanLength = 0;
			let currentSegmentIdx = 0;
			let currentLineIdx = 0;
			let currentSegment = undefined;
			while (true) {
				const currentLine = this._lineLayers[currentLineIdx];
				currentSegment = currentLine[currentSegmentIdx];
				const [start, end] = currentSegment.getLatLngs();
				distanceLessThanLength = distance;

				distance += start.distanceTo(end);
				if (distance >= value) break;

				if (currentSegmentIdx >= currentLine.length - 1) {
					currentSegmentIdx = 0;
					currentLineIdx++;
				} else {
					currentSegmentIdx++;
				}
			}
			const remainingLength = value - distanceLessThanLength;
			const lineAngleFromNorth = this._degreesFromNorth(currentSegment.getLatLngs());
			const splitPoint = L.GeometryUtil.destination(currentSegment.getLatLngs()[0], lineAngleFromNorth, remainingLength);
			this._commitLTLineSplit(currentLineIdx, currentSegmentIdx, splitPoint);
			if (this._selectLTMode) this.stopSelectLTSegmentMode();
			this._closeDialog(e);
		};

		const translateHooks = [];
		const container = document.createElement("form");

		const feature = this._formatLTFeatureOut();
		const [start, length] = getLineTransectStartEndDistancesForIdx(feature, feature.length - 1); // eslint-disable-line no-unused-vars

		const help = document.createElement("span");
		help.className = "help-block";
		translateHooks.push(this.addTranslationHook(help, () => `${this.translations.SegmentSplitByLengthHelp}: ${length}m`));

		const input = createTextInput();
		input.className += " form-group";

		let prevVal = "";
		input.oninput = (e => {
			e.target.value = e.target.value.replace(",", ".");
			if (!e.target.value.match(/^\d*\.?\d*$/)) {
				e.target.value = prevVal;
			}
			prevVal = e.target.value;

			if (e.target.value === "" || parseInt(e.target.value) < 0 || parseInt(e.target.value) > length) {
				submit.setAttribute("disabled", "disabled");
			} else {
				submit.removeAttribute("disabled");
			}
		});

		const submit = document.createElement("button");
		submit.setAttribute("type", "submit");
		submit.className = "btn btn-block btn-primary";
		translateHooks.push(this.addTranslationHook(submit, "SplitLine"));
		submit.setAttribute("disabled", "disabled");

		submit.addEventListener("click", splitByMeters);

		container.appendChild(help);
		container.appendChild(input);
		container.appendChild(submit);

		this._showDialog(container, () => {
			translateHooks.forEach(hook => this.removeTranslationHook(hook));
			submit.removeEventListener("click", splitByMeters);
		});

		input.focus();
	}

	_createTooltip(translationKey, error = false) {
		if (this._tooltip) {
			this.removeTranslationHook(this._tooltipTranslationHook);
		} else {
			this._tooltip = new L.Draw.Tooltip(this.map);
			this._onMouseMove = ({latlng}) => this._tooltip.updatePosition(latlng);
			["mousemove", "touchmove", "MSPointerMove"].forEach(eType => this.map.on(eType, this._onMouseMove));
			if (this._mouseLatLng) this._onMouseMove({latlng: this._mouseLatLng});
		}
		this._tooltipTranslationHook = this.addTranslationHook(() => this._tooltip.updateContent({text: this.translations[translationKey]}));
		if (error) this._tooltip.showAsError();
		else this._tooltip.removeError();
	}

	_disposeTooltip() {
		if (this._onMouseMove) ["mousemove", "touchmove", "MSPointerMove"].forEach(
			eType => this.map.off(eType, this._onMouseMove)
		);
		this._onMouseMove = undefined;
		if (this._tooltip) this._tooltip.dispose();
		this.removeTranslationHook(this._tooltipTranslationHook);
		this._tooltip = undefined;
	}
};

