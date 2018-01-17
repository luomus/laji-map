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

const POINT_DIST_TRESHOLD = 100;
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
const editablePointStyle = {...pointStyle, radius: 7, fillColor: "#f00", fillOpacity: 0.7};
const overlappingPointStyle = {...pointStyle, radius: 5, weight: 3, color: "#000"};
const seamPointStyle = {...pointStyle, radius: 7};

const LT_WIDTH_METERS = 25;

function flattenMatrix(m) {
	return m.reduce((flattened, array) => [...flattened, ...array], []);
}

function parseIdxsFromLTIdx(idx) {
	return idx ? idx.split("-").map(i => +i) : undefined;
}

function LTIdxToFlatIdx(LTIdx, container) {
	const overlappingLTIdx = parseIdxsFromLTIdx(LTIdx);
	let pointIdx = 0;
	let pointGroupPointer = overlappingLTIdx[0] - 1;
	while (pointGroupPointer >= 0) {
		pointIdx += container[pointGroupPointer].length;
		pointGroupPointer--;
	}
	pointIdx += overlappingLTIdx[1];

	return pointIdx;
}

function flatIdxToLTIdx(idx, container) {
	let lineIdx = 0;
	let line = container[lineIdx];
	while (idx >= line.length) {
		idx -= line.length;
		lineIdx++;
		line = container[lineIdx];
	}
	return `${lineIdx}-${idx}`;
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
			if (this.lineTransectEditIdx) {
				this._commitPointDrag();
				return true;
			} else if (this._lineCutting) {
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
			if (this.lineTransectEditIdx !== undefined && !this._LTDragging) {
				this._commitPointDrag();
				return true;
			} else if (this._lineCutting) {
				this._commitLTLineSplit(this._splitLTIdx, this._splitPoint);
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

		this._LTHistory = [feature.geometry];
		this._LTHistoryPointer = 0;

		this.setLineTransectGeometry(feature.geometry);
		this._origLineTransect = L.featureGroup(this._allLines.map(line =>
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

	setLineTransectGeometry(geometry, undoable) {
		if (undoable) {
			if (this._LTHistoryPointer < this._LTHistory.length - 1) {
				this._LTHistory = this._LTHistory.splice(0).splice(0, this._LTHistoryPointer + 1);
			}
			this._LTHistory.push(geometry);
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
				pointLayer.push(L.circleMarker(segment[0], even ? pointStyle : oddPointStyle));

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

		this._allLines = flattenMatrix(lineLayers);
		this._allCorridors = flattenMatrix(corridorLayers);
		this._allPoints = flattenMatrix(pointLayers);

		this._lineLayerGroup = L.featureGroup(this._allLines).addTo(this.map);
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
					const [overlappingLineIdx] = overlapping.split("-").map(parseInt);
					const pointIdx = LTIdxToFlatIdx(overlappingsCoordsToIdxs[stringCoords], this._pointLayers);
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
				overlappingsCoordsToIdxs[stringCoords] = `${groupI}-${pointI}`;

				i++;
			});
		});
		this._setLTIdxMappings();
		this._setLineTransectEvents();

		if (this.keepActiveTooltipOpen) this._openTooltipFor(this._LTActiveIdx);

		provide(this, "lineTransect");
	}

	LTUndo() {
		if (this._LTHistoryPointer <= 0) return;
		this._LTHistoryPointer--;
		this.setLineTransectGeometry(this._LTHistory[this._LTHistoryPointer]);
	}

	LTRedo() {
		if (this._LTHistoryPointer >= this._LTHistory.length - 1) return;
		this._LTHistoryPointer++;
		this.setLineTransectGeometry(this._LTHistory[this._LTHistoryPointer]);
	}

	_openTooltipFor(i) {
		const that = this;
		function getTooltipFor(idx) {
			const lineIdx = parseIdxsFromLTIdx(flatIdxToLTIdx(idx, that._lineLayers))[0];
			const prevDistance = roundMeters(lineIdx === 0 ? 0 : that.lineIdxsToDistances[lineIdx - 1], 10);
			const distance = roundMeters(that.lineIdxsToDistances[lineIdx], 10);
			return 	`${lineIdx + 1}. ${that.translations.interval} (${prevDistance}-${distance}m)`;
		}

		let tooltip = getTooltipFor(i);
		const line = this._allLines[i];
		if (!line._tooltip) line.bindTooltip(tooltip, {direction: "top", permanent: true});
		line.openTooltip();
	}


	_closeTooltipFor(i) {
		const line = this._allLines[i];
		if (i !== this._LTActiveIdx || !this.keepActiveTooltipOpen) line.closeTooltip().unbindTooltip();
	}

	// Opens a dialog and asks which point to use, if points are overlapping.
	_getPoint(i, callback, questionTranslationKey = "FirstOrLastPoint", firstTranslationKey = "FirstPartitive", lastTranslationKey = "LastPartitive" ) {
		if (this._overlappingPointIdxs[i] !== undefined) {
			const firstLTIdx = flatIdxToLTIdx(this._overlappingPointIdxs[i], this._pointLayers);
			const lastLTIdx = flatIdxToLTIdx(i, this._pointLayers);
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
				callback(firstLTIdx);
			});
			translateHooks.push(this.addTranslationHook(firstButton, firstTranslationKey));

			const lastButton = document.createElement("button");
			lastButton.addEventListener("click", () => {
				firstPoint.setStyle(pointStyle);
				lastPoint.closePopup();
				callback(lastLTIdx);
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
			callback(flatIdxToLTIdx(i, this._pointLayers));
		}
	}

	getIdxsFromLayer(layer) {
		const {_leaflet_id} = layer;
		const getIdxsForId = id => {
			return {
				i: this.leafletIdsToFlatCorridorSegmentIdxs[id],
				lineIdx: this.leafletIdsToCorridorLineIdxs[id],
				segmentIdx: this.leafletIdsToCorridorSegmentIdxs[id]
			};
		};
		if (layer instanceof L.CircleMarker) {
			return {
				i: this.leafletIdsToFlatPointIdxs[_leaflet_id]
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
	_setLTIdxMappings() {
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

		this._pointLayerGroup.on("dblclick", e => {
			L.DomEvent.stopPropagation(e);

			this._getPoint(this.getIdxsFromEvent(e).i, LTIdx => this._setLTPointEditable(...parseIdxsFromLTIdx(LTIdx)));
		});

		this._corridorLayerGroup.on("click", e => {
			L.DomEvent.stopPropagation(e);

			const {i, lineIdx} = this.getIdxsFromEvent(e);

			if (this._selectLTMode) {
				this._hoveredLTIdx = undefined;
				if (this._onSelectLT) this._onSelectLT(i);
			} else {
				this._triggerEvent(this._getOnActiveSegmentChangeEvent(lineIdx), this._onLTChange);
			}
		}).on("mouseover", e => {
			L.DomEvent.stopPropagation(e);

			const {i, lineIdx, segmentIdx} = this.getIdxsFromEvent(e);

			const prevHoverIdx = this._hoveredLTIdx;
			this._hoveredLTIdx = [lineIdx, segmentIdx];
			if (prevHoverIdx) this._updateLTStyleForLineIdx(prevHoverIdx[0]);
			this._updateLTStyleForLineIdx(this._hoveredLTIdx[0]);
			this._openTooltipFor(i);
		}).on("mouseout", e => {
			L.DomEvent.stopPropagation(e);

			const {i, lineIdx} = this.getIdxsFromEvent(e);

			this._hoveredLTIdx = undefined;
			this._updateLTStyleForLineIdx(lineIdx);
			if (i !== this._LTActiveIdx) this._closeTooltipFor(i);
		}).on("dblclick", e => {
			L.DomEvent.stopPropagation(e);

			const {latlng} = e;
			const {lineIdx, segmentIdx} = this.getIdxsFromEvent(e);

			const points = [segmentIdx, segmentIdx + 1].map(idx => this._pointLayers[lineIdx][idx]);
			const closestPoint = L.GeometryUtil.closestLayer(this.map, points, latlng).layer;
			const closerIdx = (closestPoint === points[0]) ? segmentIdx : segmentIdx + 1;
			if (closestPoint.getLatLng().distanceTo(latlng) <= POINT_DIST_TRESHOLD) {
				this._setLTPointEditable(lineIdx, closerIdx);
			}
		});
	}

	@reflect()
	@dependsOn("lineTransect", "translations")
	_updateLTLayerContextMenus() {
		if (!depsProvided(this, "_updateLTLayerContextMenus", arguments)) return;

		const {translations} = this;

		this._allCorridors.forEach((corridor, idx) => {
			corridor.bindContextMenu({
				contextmenuInheritItems: false,
				contextmenuItems: [
					{
						text: translations.SplitLine,
						callback: () => this.startLTLineSplitForIdx(idx),
						iconCls: "glyphicon glyphicon-scissors"
					},
					{
						text: translations.SplitLineByMeters,
						callback: () => this.splitLTByMeters(idx),
						iconCls: "laji-map-line-transect-split-by-meters-glyph"
					},
					{
						text: translations.DeleteLineSegment,
						callback: () => this.commitRemoveLTSegment(idx),
						iconCls: "laji-map-line-transect-remove-segment-glyph"
					},
					{
						text: translations.ConnectSegments,
						callback: () => this.chooseFirstSegmentToConnect(idx),
						iconCls: "laji-map-line-transect-remove-point-glyph"
					}
				]
			});
		});

		this._allPoints.forEach((point, i) => {
			point.bindContextMenu({
				contextmenuInheritItems: false,
				contextmenuItems: [
					{
						text: translations.RemovePoint,
						callback: () => {
							this._getPoint(i, LTIdx => this.removeLTPoint(LTIdx), "RemoveFirstOrLastPoint", "First", "Last");
						},
						iconCls: "glyphicon glyphicon-remove-sign"
					}
				]
			});
		});
	}

	// Commit can be an array of events that are triggered at the same time as the event that this function triggers.
	removeLTPoint(LTIdx, commit = true, removeSeamPoint = true) {
		let events = [];

		const [lineIdx, segmentIdx] = parseIdxsFromLTIdx(LTIdx);
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
				if (removeSeamPoint) this.removeLTPoint(`${lineIdx - 1}-${precedingLine.length}`, false);
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

		if (this._LTActiveIdx !== undefined && this._LTActiveIdx > LTIdxToFlatIdx(LTIdx, this._allLines)) {
			this._LTActiveIdx = this._LTActiveIdx - 1;
		}

		if (commit) {
			this.setLineTransectGeometry(this._formatLTFeatureOut().geometry, !!"undoable");
			if (Array.isArray(commit)) {
				events = [...commit, ...events];
			}
			this._triggerEvent(events, this._onLTChange);
		} else {
			return events;
		}
	}

	_setLTPointEditable(lineIdx, pointIdx) {
		if (this.lineTransectEditIdx !== undefined) {
			const [_lineIdx, _segmentIdx] = parseIdxsFromLTIdx(this.lineTransectEditIdx);
			const editableLayer = this._pointLayers[_lineIdx][_segmentIdx];
			editableLayer.setStyle(pointStyle);
			this._commitPointDrag();
		}

		const pointIdxInAll = LTIdxToFlatIdx(`${lineIdx}-${pointIdx}`, this._pointLayers);
		const overlappingSeamPointIdx = this._overlappingSeamPointIdxs[pointIdxInAll];
		if (overlappingSeamPointIdx) {
			const overlappingPoint = this._allPoints[overlappingSeamPointIdx];
			overlappingPoint.remove();
		}

		this.lineTransectEditIdx = `${lineIdx}-${pointIdx}`;
		if (pointIdx !== undefined) {
			const layer = this._pointLayers[lineIdx][pointIdx];
			layer.setStyle(editablePointStyle)
				.on("mousedown", this._startLTDragPointHandler)
				.on("mouseup", this._stopLTDragPointHandler)
				.bringToFront();

			[pointIdx, pointIdx - 1].filter(i => i >= 0).forEach(idx => {
				const corridor = this._corridorLayers[lineIdx][idx];
				if (corridor) corridor.on("mousedown", this._startLTDragCorridorHandler);
			});
			this.map.on("mouseup", this._stopLTDragCorridorHandler);


			this._pointLayers.forEach(points => points.forEach(point => {
				point.closeTooltip()
					.unbindTooltip();
			}));
		}
	}

	_commitPointDrag() {
		this.map.off("mouseup", this._stopLTDragCorridorHandler);
		this._stopLTDragPointHandler();
		this.lineTransectEditIdx = undefined;

		const feature = this._formatLTFeatureOut();
		this.setLineTransectGeometry(feature.geometry, !!"undoable");

		const events = [];
		let prevLineIdx = undefined;
		[this._precedingLTDragIdx, this._followingLTDragIdx].forEach(idx => {
			const {lineIdx} = this.getIdxsFromLayer(this._allLines[idx]);
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

	_startLTDragPointHandler() {
		this._startLTDragHandler(this._dragLTPointHandler);
	}

	_stopLTDragPointHandler() {
		this._stopLTDragHandler(this._dragLTPointHandler);
	}

	_dragLTPointHandler({latlng}) {
		this._dragLTHandler(latlng);
	}

	_startLTDragCorridorHandler({latlng}) {
		this._startLTDragHandler(this._dragLTCorridorHandler);

		const idxs = parseIdxsFromLTIdx(this.lineTransectEditIdx);
		const point = this._pointLayers[idxs[0]][idxs[1]];

		this._dragPointStart = point.getLatLng();
		this._dragMouseStart = latlng;
	}

	_stopLTDragCorridorHandler() {
		this._stopLTDragHandler(this._dragLTCorridorHandler);
		this._dragPointStart = undefined;
		this._dragMouseStart = undefined;
	}

	_dragLTCorridorHandler({latlng}) {
		const mouseMovedDistance = this._dragMouseStart.distanceTo(latlng);
		const mouseRotatedAngle = this._degreesFromNorth([this._dragMouseStart, latlng]);

		const offsetDragPoint = L.GeometryUtil.destination(this._dragPointStart, mouseRotatedAngle, mouseMovedDistance);
		this._dragLTHandler(offsetDragPoint);
	}

	_dragLTHandler(latlng) {
		const idxs = parseIdxsFromLTIdx(this.lineTransectEditIdx);
		const [lineIdx, pointIdx] = idxs;

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

		let precedingLine, precedingCorridor, precedingPoint;
		if (precedingIdx !== undefined) {
			precedingLine = this._lineLayers[precedingLineIdx][precedingIdx];
			precedingCorridor = this._corridorLayers[precedingLineIdx][precedingIdx];
			precedingPoint = this._pointLayers[precedingLineIdx][precedingIdx];
		}

		let followingLineIdx, followingIdx = undefined;

		if (pointIdx < pointLayer.length - 1) {
			followingLineIdx = lineIdx;
			followingIdx = pointIdx;
		} else if (lineIdx + 1 < this._lineLayers.length - 1) {
			const followingLineLayer = this._lineLayers[lineIdx + 1];
			if (followingLineLayer[0].getLatLngs()[0].equals(point.getLatLng())) {
				followingLineIdx = lineIdx + 1;
				followingIdx = 0;
			}
		}

		let followingLine, followingCorridor, followingPoint;
		if (followingIdx !== undefined) {
			followingLine = this._lineLayers[followingLineIdx][followingIdx];
			followingCorridor = this._corridorLayers[followingLineIdx][followingIdx];
			followingPoint = this._pointLayers[followingLineIdx][followingIdx + 1];
		}

		if (precedingIdx !== undefined) {
			this._precedingLTDragIdx = precedingIdx;
			const lineCoords = [precedingLine.getLatLngs()[0], latlng];
			precedingLine.setLatLngs(lineCoords).openTooltip();
			precedingCorridor.setLatLngs(this._getCorridorCoordsForLine(lineCoords, precedingIdx));
		}

		if (followingIdx !== undefined) {
			this._followingLTDragIdx = this.getIdxsFromLayer(this._lineLayers[followingLineIdx][followingIdx]).i;
			const lineCoords = [latlng, followingLine.getLatLngs()[1]];
			followingLine.setLatLngs(lineCoords).openTooltip();
			followingCorridor.setLatLngs(this._getCorridorCoordsForLine(lineCoords, precedingIdx));
		}

		point.setLatLng(latlng);
		[precedingPoint, point, followingPoint].forEach(p => p && p.bringToFront());
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

	// Doesn't handle points.
	_getStyleForLTLayer(layer) {
		const {i: idx, lineIdx, segmentIdx} = this.getIdxsFromLayer(layer);
		const isActive = lineIdx === this._LTActiveIdx;
		const [hoveredLineIdx, hoveredSegmentIdx] = this._hoveredLTIdx || [];
		const isEdit = idx === this._splitLTIdx ||
			(this._selectLTMode === "segment" && lineIdx === hoveredLineIdx && segmentIdx === hoveredSegmentIdx) ||
			(this._selectLTMode === "line" && lineIdx === hoveredLineIdx) ||
			idx === this._firstLTSegmentToRemoveIdx;
		const isHover = !isEdit && lineIdx === hoveredLineIdx;

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

		let styleObject = undefined;
		if (layer instanceof L.Polygon) {
			styleObject = corridorStyles;
		} else if (layer instanceof L.Polyline) {
			styleObject = lineStyles;
		}

		if (isEdit) {
			return styleObject.edit;
		} else if (isHover) {
			return styleObject.hover;
		} else if (isActive) {
			return styleObject.active;
		} else {
			return lineIdx % 2 === 0 ? styleObject.normal : styleObject.odd;
		}
	}

	_updateLTStyleForLineIdx(idx) {
		if (idx === undefined) return;
		this._corridorLayers[idx].forEach(corridorLayer => {
			const {i} = this.getIdxsFromLayer(corridorLayer);
			this._updateLTStyleForIdx(i);
		});
	}

	_updateLTStyleForIdx(idx) {
		if (idx === undefined) return;
		[this._allLines, this._allCorridors].forEach(layerGroup => {
			const layer = layerGroup[idx];
			layer.setStyle(this._getStyleForLTLayer(layer));
		});
		(idx === this._LTActiveIdx && this.keepActiveTooltipOpen) ? this._openTooltipFor(idx) : this._closeTooltipFor(idx);
	}

	_commitLTLineSplit(splitIdx, splitPoint) {
		this.stopLTLineSplit();

		const splitLine = this._allLines[splitIdx];
		const {lineIdx, segmentIdx} = this.getIdxsFromLayer(splitLine);

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
		this.setLineTransectGeometry(feature.geometry, !!"undoable");

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

		this._triggerEvent(events, this._onLTChange);

		this.map.fire("lineTransect:split");
	}

	stopLTLineSplit() {
		const lastLineCutIdx = this._splitLTIdx;
		this._lineCutting = false;
		if (this._cutLine) this._cutLine.removeFrom(this.map);
		this._cutLine = undefined;
		this._lineCutIdx = undefined;
		this._splitLTIdx = undefined;
		this.map.off("mousemove", this._mouseMoveLTLineSplitHandler);
		this._updateLTStyleForIdx(lastLineCutIdx);
		this._disposeTooltip();
	}

	_mouseMoveLTLineSplitHandler({latlng}) {
		const allLines = this._allLines;

		let closestLine, closestIdx;
		if (this._lineCutIdx !== undefined) {
			closestIdx = this._lineCutIdx;
			closestLine = allLines[closestIdx];
		} else {
			closestLine = L.GeometryUtil.closestLayer(this.map, allLines, latlng).layer;
			closestIdx = allLines.indexOf(closestLine);
		}

		const prevCutIdx = this._splitLTIdx;
		this._splitLTIdx = closestIdx;
		this._updateLTStyleForIdx(prevCutIdx);
		this._updateLTStyleForIdx(this._splitLTIdx);

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
		this._lineCutting = true;
		this.map.on("mousemove", this._mouseMoveLTLineSplitHandler);
		this._createTooltip("SplitLineTooltip");
	}

	startLTLineSplitForIdx(idx) {
		this._lineCutting = true;
		this._lineCutIdx = idx;
		this.map.on("mousemove", this._mouseMoveLTLineSplitHandler);
		this._createTooltip("SplitLineTooltip");
	}

	startSelectLTSegmentMode(onSelect, tooltip, mode = "segment") { // mode should be "segment" or "line"
		this._selectLTMode = mode;
		this._onSelectLT = (idx) => {
			if (onSelect(idx) !== false) this.stopSelectLTSegmentMode(idx);
		};
		if (tooltip) this._createTooltip(tooltip);
	}

	stopSelectLTSegmentMode(idx) {
		this._selectLTMode = undefined;
		this._onSelectLT = undefined;
		try {
			this._updateLTStyleForIdx(idx);
		} catch (e) {
			// Swallow warning
		}
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
		const idx = this._firstLTSegmentToRemoveIdx;
		this._firstLTSegmentToRemoveIdx = undefined;
		this._updateLTStyleForIdx(idx);
		this.stopSelectLTSegmentMode(...params);
	}

	chooseFirstSegmentToConnect(idx) {
		this._firstLTSegmentToRemoveIdx = idx;
		this._updateLTStyleForIdx(idx);
		this.startSelectLTSegmentMode(this.chooseLastSegmentToConnectAndCommit, "startLineConnectLastPointHelp");
		return false;
	}

	chooseLastSegmentToConnectAndCommit(idx) {
		const [first, last] = [this._firstLTSegmentToRemoveIdx, idx].sort((a, b) => a - b);
		this._firstLTSegmentToRemoveIdx = undefined;

		let i = last;
		let events = [];
		while (i !== first) {
			const _events = this.removeLTPoint(flatIdxToLTIdx(i, this._lineLayers), i === first + 1 ? events : false);
			if (_events) {
				events = [...events, ..._events];
			}
			i--;
		}
	}

	commitRemoveLTSegment(i) {
		const {lineIdx, segmentIdx} = this.getIdxsFromLayer(this._allLines[i]);
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
		this.setLineTransectGeometry(feature.geometry, !!"undoable");
		this.map.fire("lineTransect:delete");
	}

	splitLTByMeters(idx) {
		const splitByMeters = (e) => {
			e.preventDefault();

			const {value} = input;

			const segment = this._allLines[idx];
			const {lineIdx} = this.getIdxsFromLayer(segment);

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
			this._commitLTLineSplit(LTIdxToFlatIdx(`${lineIdx}-${currentSegmentIdx - 1}`, this._lineLayers), splitPoint);
			if (this._selectLTMode) this.stopSelectLTSegmentMode();
			this._closeDialog(e);
		};

		const translateHooks = [];
		const container = document.createElement("form");

		const lineIdx = parseIdxsFromLTIdx(flatIdxToLTIdx(idx, this._lineLayers))[0];
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

