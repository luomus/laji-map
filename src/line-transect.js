import { dependsOn, depsProvided, provide, reflect } from "./dependency-utils";
import { latLngSegmentsToGeoJSONGeometry, geoJSONLineToLatLngSegmentArrays, roundMeters, createTextInput, isPolyline, combineColors } from "./utils";
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
const hoverLineStyle = {...lineStyle, color: INCOMPLETE_COLOR};
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
const activePointStyle = {...pointStyle, fillColor: activeLineStyle.color};
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

function idxTupleToFlatIdx(idxTuple, container) {
	const [lineIdx, _pointIdx] = idxTuple;
	let pointIdx = 0;
	let pointGroupPointer = lineIdx - 1;
	while (pointGroupPointer >= 0) {
		pointIdx += container[pointGroupPointer].length;
		pointGroupPointer--;
	}
	pointIdx += _pointIdx;

	return pointIdx;
}

function idxTuplesEqual(i,j) {
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

		this.commitRemoveLTSegment = this.commitRemoveLTSegment.bind(this);
		this.startRemoveLTSegmentMode = this.startRemoveLTSegmentMode.bind(this);
		this.startRemoveLTPointMode = this.startRemoveLTPointMode.bind(this);
		this.stopRemoveLTPointMode = this.stopRemoveLTPointMode.bind(this);
		this.chooseFirstSegmentToConnect = this.chooseFirstSegmentToConnect.bind(this);
		this.chooseLastSegmentToConnectAndCommit = this.chooseLastSegmentToConnectAndCommit.bind(this);
		this.startSplitByMetersLTSegmentMode = this.startSplitByMetersLTSegmentMode.bind(this);

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
					onChange: this._onLTChange,
					keepActiveTooltipOpen: this.keepActiveTooltipOpen
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

	@dependsOn("map")
	setLineTransect(data) {
		if (!depsProvided(this, "setLineTransect", arguments)) return;
		if (!data) return;

		let {feature, activeIdx, onChange, keepActiveTooltipOpen} = data;
		this.LTFeature = feature;
		this._onLTChange = onChange;
		this._LTActiveIdx = activeIdx;
		this.keepActiveTooltipOpen = keepActiveTooltipOpen;

		this._LTHistory = [{geometry: feature.geometry}];
		this._LTHistoryPointer = 0;

		this.setLineTransectGeometry(feature.geometry);
		this._origLineTransect = L.featureGroup(this._allSegments.map(line =>
			L.polyline(line._latlngs, origLineStyle).setText("→", {repeat: true, attributes: {...origLineStyle, dy: 5, "font-size": 18}, below: true})
		)).addTo(this.map).bringToBack();
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
			});
			this._LTHistory.push({geometry, events, featureCollection: undoData.prevFeature});
			this._LTHistoryPointer++;
		}

		const wholeLinesAsSegments = geoJSONLineToLatLngSegmentArrays(geometry);

		if (this._pointLayerGroup) this.map.removeLayer(this._pointLayerGroup);
		if (this._lineLayerGroup) this.map.removeLayer(this._lineLayerGroup);
		if (this._corridorLayerGroup) this.map.removeLayer(this._corridorLayerGroup);
		this._pointLayers = [];
		this._lineLayers = [];
		this._corridorLayers = [];

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

		this._overlappingPointIdxs = {};
		this._overlappingSeamPointIdxs = {};
		const overlappingsCoordsToIdxs = {};

		i = 0;
		pointLayers.forEach((points, groupI) => {
			points.forEach((point, pointI) => {
				const latlng = point.getLatLng();
				const stringCoords = `${latlng.lat}-${latlng.lng}`;
				const overlapping = overlappingsCoordsToIdxs[stringCoords];
				let overlappingEndOrStart = false;
				if (overlapping) {
					const [overlappingLineIdx] = overlapping;
					const pointIdx = idxTupleToFlatIdx(overlappingsCoordsToIdxs[stringCoords], this._pointLayers);
					if (overlappingLineIdx !== undefined && overlappingLineIdx !== groupI - 1) {
						this._overlappingPointIdxs[i] = pointIdx;
						this._overlappingPointIdxs[pointIdx] = i;
						overlappingEndOrStart = true;
					} else {
						this._overlappingSeamPointIdxs[i] = pointIdx;
						this._overlappingSeamPointIdxs[pointIdx] = i;
					}
				}
				if (overlappingEndOrStart) {
					point.setStyle(overlappingPointStyle);
				} else if (pointI === 0 || pointI === points.length - 1) {
					point.setStyle(seamPointStyle);
				}
				overlappingsCoordsToIdxs[stringCoords] = [groupI, pointI];
				i++;
			});
		});
		this._setIdxTupleMappings();
		this._setLineTransectEvents();

		if (this.keepActiveTooltipOpen) this._openTooltipFor(this._LTActiveIdx);

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

	_openTooltipFor(lineIdx) {
		const that = this;
		function getTooltipFor(lineIdx) {
			const prevDistance = roundMeters(lineIdx === 0 ? 0 : that.lineIdxsToDistances[lineIdx - 1], 10);
			const distance = roundMeters(that.lineIdxsToDistances[lineIdx], 10);
			return 	`${lineIdx + 1}. ${that.translations.interval} (${prevDistance}-${distance}m)`;
		}

		let tooltip = getTooltipFor(lineIdx);
		const line = this._lineLayers[lineIdx][0];
		if (!line._tooltip) line.bindTooltip(tooltip, {direction: "top", permanent: true});
		line.openTooltip();
	}


	_closeTooltipFor(lineIdx) {
		const line = this._lineLayers[lineIdx];
		if (!line) return;
		const segment = line[0];
		if (lineIdx !== this._LTActiveIdx || !this.keepActiveTooltipOpen) segment.closeTooltip().unbindTooltip();
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
	_getPoint(i, callback, questionTranslationKey = "FirstOrLastPoint", firstTranslationKey = "FirstPartitive", lastTranslationKey = "LastPartitive" ) {
		if (this._overlappingPointIdxs[i] !== undefined) {
			const firstIdxTuple = this.flatIdxToIdxTuple(this._overlappingPointIdxs[i]);
			const lastIdxTuple = this.flatIdxToIdxTuple(i);
			const firstPoint = this._allPoints[this._overlappingPointIdxs[i]];
			const lastPoint = this._allPoints[i];

			const translateHooks = [];

			const popup = document.createElement("div");
			popup.className = "text-center";

			const question = document.createElement("span");
			translateHooks.push(this.addTranslationHook(question, questionTranslationKey));

			const firstButton = document.createElement("button");
			firstButton.addEventListener("click", () => {
				lastPoint.setStyle(pointStyle);
				lastPoint.closePopup();
				callback(firstIdxTuple);
			});
			translateHooks.push(this.addTranslationHook(firstButton, firstTranslationKey));

			const lastButton = document.createElement("button");
			lastButton.addEventListener("click", () => {
				firstPoint.setStyle(pointStyle);
				lastPoint.closePopup();
				callback(lastIdxTuple);
			});
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
			callback(this.flatIdxToIdxTuple(i));
		}
	}

	getIdxsFromLayer(layer) {
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

		this.lineIdxsToDistances = {};
		this.leafletIdsToFlatPointIdxs = {};

		let distance = 0;
		i = 0;
		this._pointLayers.forEach((points, lineIdx) => {
			let prevLatLng = undefined;
			points.forEach(point => {
				const latlng = point.getLatLng();
				distance += prevLatLng ? latlng.distanceTo(prevLatLng) : 0;
				prevLatLng = latlng;
				this.leafletIdsToFlatPointIdxs[point._leaflet_id] = i;
				i++;
			});
			this.lineIdxsToDistances[lineIdx] = distance;
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
			this._openTooltipFor(lineIdx);
		};
		const onMouseOut = (e) => {
			L.DomEvent.stopPropagation(e);

			const {lineIdx} = this.getIdxsFromEvent(e);

			this._hoveredIdxTuple = undefined;
			this._updateLTStyleForLineIdx(lineIdx);
			if (lineIdx !== this._LTActiveIdx) this._closeTooltipFor(lineIdx);
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

			this._getPoint(this.getIdxsFromEvent(e).i, idxTuple => this._setLTPointEditable(...idxTuple));
		}).on("click", e => {
			L.DomEvent.stopPropagation(e);

			const {lineIdx} = this.getIdxsFromEvent(e);

			if (!this._selectLTMode) {
				this._triggerEvent(this._getOnActiveSegmentChangeEvent(lineIdx), this._onLTChange);
			}
		}).on("mouseover", e => {
			pointIsMiddlePoint(e) && onMouseOver(e);
		}).on("mouseout", e => {
			pointIsMiddlePoint(e) &&onMouseOut(e);
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

		this.map.on("mousemove", e => {
			const {latlng} = e;
			const closestPoint = L.GeometryUtil.closestLayer(this.map, this._allPoints, latlng).layer;
			const {idxTuple, i} = this.getIdxsFromLayer(closestPoint);
			const prevClosestPointIdxTuple = this._closebyPointIdxTuple;
			const closestPointPixelPoint = this.map.latLngToLayerPoint(closestPoint.getLatLng());
			const latLngPixelPoint = this.map.latLngToLayerPoint(latlng);
			this._closebyPointIdxTuple = closestPointPixelPoint.distanceTo(latLngPixelPoint) <= POINT_DIST_TRESHOLD ? idxTuple : undefined;
			if (prevClosestPointIdxTuple !== this._closebyPointIdxTuple) {
				if (this._closebyPointIdxTuple) {
					const layer = this._getLayerForIdxTuple(this._pointLayers, ...this._closebyPointIdxTuple);
					if (layer && this.map.hasLayer(layer)) layer.bringToFront();
					if (this._LTdragPoint) this._LTdragPoint.bringToFront();
				}
				[prevClosestPointIdxTuple, this._closebyPointIdxTuple].forEach(idxTuple => {
					if (idxTuple) {
						const layers = [this._getLayerForIdxTuple(this._pointLayers, ...idxTuple)];
						if (this._overlappingPointIdxs[i]) {
							layers.push(this._allPoints[this._overlappingPointIdxs[i]]);
						} else if (this._overlappingSeamPointIdxs[i]) {
							layers.push(this._allPoints[this._overlappingSeamPointIdxs[i]]);
						}
						layers.forEach(layer => layer && layer.setStyle(this._getStyleForLTLayer(layer)));
					}
				});
			}
		}).on("dblclick", e => {
			L.DomEvent.stopPropagation(e);
			if (this._closebyPointIdxTuple) {
				this._disableDblClickZoom = true;
				this._getPoint(this.getIdxsFromLayer(this._getLayerForIdxTuple(this._pointLayers, ...this._closebyPointIdxTuple)).i, idxTuple => this._setLTPointEditable(...idxTuple));
				setTimeout(() => {
					this._disableDblClickZoom = false;
				}, 10);
			}
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
						text: translations.DeleteLineSegment,
						callback: () => this.commitRemoveLTSegment(lineIdx, segmentIdx),
						iconCls: "laji-map-line-transect-remove-segment-glyph"
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

		this._allPoints.forEach((point, i) => {
			point.bindContextMenu({
				contextmenuInheritItems: false,
				contextmenuItems: [
					{
						text: translations.RemovePoint,
						callback: () => {
							this._getPoint(i, idxTuple => this.removeLTPoint(...idxTuple), "RemoveFirstOrLastPoint", "First", "Last");
						},
						iconCls: "glyphicon glyphicon-remove-sign"
					}
				]
			});
		});
	}

	// Commit can be an array of events that are triggered at the same time as the event that this function triggers.
	removeLTPoint(lineIdx, segmentIdx, commit = true, removeSeamPoint = true) {
		let events = [];

		const prevFeature = this._formatLTFeatureOut();

		const line = this._lineLayers[lineIdx];
		const precedingSegment = line[segmentIdx - 1];
		const followingSegment = line[segmentIdx];
		if (precedingSegment && followingSegment) {
			precedingSegment.setLatLngs([precedingSegment.getLatLngs()[0], followingSegment.getLatLngs()[1]]);
			this._lineLayers[lineIdx] = line.filter(l => l !== followingSegment);
			const feature = this._formatLTFeatureOut();
			events = [{
				type: "edit",
				idx: lineIdx,
				feature: feature,
				geometry: {type: "LineString", coordinates: feature.geometry.coordinates[lineIdx]}
			}];
		} else {
			let precedingLine = this._lineLayers[lineIdx - 1];
			if (followingSegment && precedingLine && precedingLine[precedingLine.length - 1].getLatLngs()[1].equals(followingSegment.getLatLngs()[0])) {
				this._lineLayers[lineIdx] = [...precedingLine, ...line];
				this._lineLayers.splice(lineIdx - 1, 1);
				if (removeSeamPoint) this.removeLTPoint(lineIdx - 1, precedingLine.length, false);
				const feature = this._formatLTFeatureOut();
				events = [
					{
						type: "edit",
						idx: lineIdx - 1,
						feature,
						geometry: {type: "LineString", coordinates: feature.geometry.coordinates[lineIdx]}
					},
					{
						type: "delete",
						idx: lineIdx,
						feature
					}
				];
			}
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
	}

	_setLTPointEditable(lineIdx, pointIdx) {
		if (idxTuplesEqual(this.LTEditPointIdx, [lineIdx, pointIdx])) return;

		if (this.LTEditPointIdx !== undefined) {
			const [_lineIdx, _segmentIdx] = this.LTEditPointIdx;
			const editableLayer = this._pointLayers[_lineIdx][_segmentIdx];
			editableLayer.setStyle(pointStyle);
			this._commitPointDrag();
		}

		const pointIdxInAll = idxTupleToFlatIdx([lineIdx, pointIdx], this._pointLayers);
		const overlappingSeamPointIdx = this._overlappingSeamPointIdxs[pointIdxInAll];
		if (overlappingSeamPointIdx) {
			const overlappingPoint = this._allPoints[overlappingSeamPointIdx];
			overlappingPoint.remove();
		}

		this.LTEditPointIdx = [lineIdx, pointIdx];
		this._featureBeforePointDrag = this._formatLTFeatureOut();
		if (pointIdx !== undefined) {
			const point = this._getLayerForIdxTuple(this._pointLayers, lineIdx, pointIdx);
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

			this._pointLayers.forEach(points => points.forEach(point => {
				point.closeTooltip()
					.unbindTooltip();
			}));

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
		this._LTdragPoint.remove();
		this._LTdragPoint = undefined;

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
			precedingLine.setLatLngs(lineCoords).openTooltip();
			precedingCorridor.setLatLngs(this._getCorridorCoordsForLine(lineCoords));
		}

		if (followingIdxTuple) {
			const lineCoords = [latlng, followingLine.getLatLngs()[1]];
			followingLine.setLatLngs(lineCoords).openTooltip();
			followingCorridor.setLatLngs(this._getCorridorCoordsForLine(lineCoords));
		}

		point.setLatLng(latlng);
		this._LTdragPoint.setLatLng(latlng);
	}

	_getIdxTuplePrecedingEditPoint() {
		if (!this.LTEditPointIdx) return undefined;
		const [lineIdx, pointIdx] = this.LTEditPointIdx;

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

	_getLayerForIdxTuple(layer, lineIdx, segmentIdx) {
		return layer[lineIdx][segmentIdx];
	}

	_getIdxTupleFollowingEditPoint() {
		if (!this.LTEditPointIdx) return undefined;
		const [lineIdx, pointIdx] = this.LTEditPointIdx;

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
		const {lineIdx, segmentIdx, idxTuple, i} = this.getIdxsFromLayer(layer);
		const isPoint = layer instanceof L.CircleMarker;
		const isActive = lineIdx === this._LTActiveIdx && (!isPoint || (segmentIdx !== 0 && segmentIdx !== this._pointLayers[lineIdx].length - 1));
		const [hoveredLineIdx, hoveredSegmentIdx] = this._hoveredIdxTuple || [];
		const isEditPoint = isPoint && idxTuplesEqual(idxTuple, this.LTEditPointIdx);
		const isClosebyPoint = isPoint && idxTuplesEqual(idxTuple, this._closebyPointIdxTuple);
		const isOverlappingEndOrStartPoint = isPoint && this._overlappingPointIdxs.hasOwnProperty(i);
		const isSeamPoint = isPoint && this._overlappingSeamPointIdxs.hasOwnProperty(i);
		const isEdit = isPoint
			?    isEditPoint
			:    idxTuplesEqual(idxTuple, this._splitIdxTuple)
				|| idxTuplesEqual(idxTuple, this._firstLTSegmentToRemoveIdx)
				|| idxTuplesEqual(idxTuple, this._getIdxTuplePrecedingEditPoint())
				|| idxTuplesEqual(idxTuple, this._getIdxTupleFollowingEditPoint())
				|| (this._selectLTMode === "segment" && lineIdx === hoveredLineIdx && segmentIdx === hoveredSegmentIdx)
				|| (this._selectLTMode === "line" && lineIdx === hoveredLineIdx);
		const _isHover = !isEdit && lineIdx === hoveredLineIdx;
		const isHover = isPoint
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
	}

	_updateLtStyleForIdxTuple(lineIdx, segmentIdx) {
		if (lineIdx === undefined || segmentIdx === undefined) return;
		[this._lineLayers, this._corridorLayers, this._pointLayers].forEach(layerGroup => {
			if (layerGroup === this._pointLayers && segmentIdx === 0 || segmentIdx === this._pointLayers[lineIdx].length - 1) return;
			const lineGroup = layerGroup[lineIdx] || [];
			const layer = lineGroup[segmentIdx];
			if (layer) layer.setStyle(this._getStyleForLTLayer(layer));
		});
		(lineIdx === this._LTActiveIdx && this.keepActiveTooltipOpen) ? this._openTooltipFor(lineIdx) : this._closeTooltipFor(lineIdx);
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

		if (lineIdx < this._LTActiveIdx) {
			events.push(this._getOnActiveSegmentChangeEvent(this._LTActiveIdx + 1));
		}

		this.setLineTransectGeometry(feature.geometry, {events, prevFeature});
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
		this._updateLtStyleForIdxTuple(lastLineCutIdx);
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
		this._createTooltip("SplitLineTooltip");
	}

	startLTLineSplitForIdx(...idxTuple) {
		this._lineCutIdx = idxTuple;
		this._lineSplitFn = this._commitLTLineSplit;
		this.map.on("mousemove", this._mouseMoveLTLineSplitHandler);
		this._createTooltip("SplitLineTooltip");
	}

	startLTPointAdd() {
		this._lineSplitFn = this._commitLTPointAdd;
		this.map.on("mousemove", this._mouseMoveLTLineSplitHandler);
		this._createTooltip("AddPointTooltip");
	}

	startLTPointAddSplitForIdx(...idxTuple) {
		this._lineCutIdx = idxTuple;
		this._lineSplitFn = this._commitLTPointAdd;
		this.map.on("mousemove", this._mouseMoveLTLineSplitHandler);
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
		if (lineIdx !== undefined && segmentIdx !== undefined) this._updateLtStyleForIdxTuple(lineIdx, segmentIdx);
		this._disposeTooltip();
	}

	startRemoveLTSegmentMode() {
		this.startSelectLTSegmentMode(this.commitRemoveLTSegment, "DeleteLineSegmentTooltip");
	}

	startSplitByMetersLTSegmentMode() {
		this.startSelectLTSegmentMode(this.splitLTByMeters, "SplitLineByMetersTooltip", "line");
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

	commitRemoveLTSegment(lineIdx, segmentIdx) {
		const prevFeature = this._formatLTFeatureOut();
		this._lineLayers[lineIdx].splice(segmentIdx, 1);
		const length = this._lineLayers[lineIdx].length;
		const feature = this._formatLTFeatureOut();

		let events = undefined;

		if (length === 0) {
			events = [
				{type: "delete", feature, idx: lineIdx},
			];
			if (this._LTActiveIdx !== undefined && lineIdx - 1 < this._LTActiveIdx && lineIdx - 1 >= 0) {
				events.push(this._getOnActiveSegmentChangeEvent(this._LTActiveIdx - 1));
			}
		} else if (segmentIdx !== 0 && segmentIdx !== length) { // Removed from the middle
			events = [
				{
					type: "edit",
					feature,
					idx: lineIdx,
					geometry: {type: "LineString", coordinates: feature.geometry.coordinates[lineIdx]}
				},
				{
					type: "insert",
					idx: lineIdx + 1,
					geometry: {type: "LineString", coordinates: feature.geometry.coordinates[lineIdx + 1]}
				}
			];
			if (this._LTActiveIdx !== undefined && this._LTActiveIdx > lineIdx) {
				events.push(this._getOnActiveSegmentChangeEvent(this._LTActiveIdx + 1));
			}
		} else {
			events = [
				{
					type: "edit",
					feature,
					idx: lineIdx,
					geometry: {type: "LineString", coordinates: feature.geometry.coordinates[lineIdx]}
				}
			];
		}

		this._triggerEvent(events, this._onLTChange);
		this.setLineTransectGeometry(feature.geometry, {events, prevFeature});
		this.map.fire("lineTransect:delete");
	}

	splitLTByMeters(lineIdx) {
		const splitByMeters = (e) => {
			e.preventDefault();

			const {value} = input;

			let distance = 0;
			let distanceLessThanLength = 0;
			let currentSegmentIdx = 0;
			let currentSegment = undefined;
			while (distance < value) {
				currentSegment = this._lineLayers[lineIdx][currentSegmentIdx];
				const [start, end] = currentSegment.getLatLngs();
				distanceLessThanLength = distance;
				distance += start.distanceTo(end);
				currentSegmentIdx++;
			}
			const remainingLength = value - distanceLessThanLength;
			const lineAngleFromNorth = this._degreesFromNorth(currentSegment.getLatLngs());
			const splitPoint = L.GeometryUtil.destination(currentSegment.getLatLngs()[0], lineAngleFromNorth, remainingLength);
			this._commitLTLineSplit(lineIdx, currentSegmentIdx - 1, splitPoint);
			if (this._selectLTMode) this.stopSelectLTSegmentMode();
			this._closeDialog(e);
		};

		const translateHooks = [];
		const container = document.createElement("form");

		const prevDistance = lineIdx === 0 ? 0 : this.lineIdxsToDistances[lineIdx - 1];
		const length = roundMeters(this.lineIdxsToDistances[lineIdx] - prevDistance);

		const help = document.createElement("span");
		help.className = "help-block";
		translateHooks.push(this.addTranslationHook(help, () => `${this.translations.segmentSplitByLengthHelp}: ${length}m`));

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

