import { dependsOn, depsProvided, provide, reflect } from "./dependency-utils";
import { latLngSegmentsToGeoJSONGeometry, geoJSONLineToLatLngSegmentArrays, roundMeters, createTextInput } from "./utils";
import "leaflet-geometryutil";
import "leaflet-textpath";
import {
	NORMAL_COLOR,
	ACTIVE_COLOR,
	INCOMPLETE_COLOR,
	ESC
} from "./globals";

const POINT_DIST_TRESHOLD = 100;

const lineStyle = {color: NORMAL_COLOR, weight: 2};
const hoverLineStyle = {...lineStyle, color: INCOMPLETE_COLOR};
const activeLineStyle = {...lineStyle, color: ACTIVE_COLOR};
const editLineStyle = {...lineStyle, color: "#f00"};
const origLineStyle = {...lineStyle, weight: 1, fill: "#99b"};
const corridorStyle = {...lineStyle, fillOpacity: 0.6, weight: 0, fillColor: lineStyle.color};
const activeCorridorStyle = {...corridorStyle, fillColor: activeLineStyle.color};
const editCorridorStyle = {...corridorStyle, fillColor: editLineStyle.color, fillOpacity: 0.5};
const hoverCorridorStyle = {...corridorStyle, fillColor: hoverLineStyle.color};
const pointStyle = {weight: 0, radius: 5, fillColor: "#154EAA", fillOpacity: 1};
const editablePointStyle = {...pointStyle, radius: 7, fillColor: "#f00", fillOpacity: 0.7};
const overlappingPointStyle = {...pointStyle, radius: 6, weight: 3, color: "#000"};

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


function coordinatePairToGeoJSONLine(coordinatePair) {
	return {type: "StringLine", coordinates: coordinatePair.map(({lat, lng}) => [lng, lat])};
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
		[prevIdx, this._LTActiveIdx].forEach(i => this._updateLTStyleForIdx(i));
	}

	_formatLTFeatureOut() {
		const segments = this._allLines.map(layer => [...layer._latlngs.map(({lat, lng}) => [lng, lat])]);

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
		wholeLinesAsSegments.forEach((wholeLineAsSegments, j) => {
			[pointLayers, lineLayers, corridorLayers].forEach(layers => {
				layers.push([]);
			});
			const pointLayer = pointLayers[j];
			const lineLayer = lineLayers[j];
			const corridorLayer = corridorLayers[j];

			wholeLineAsSegments.forEach((segment) => {
				const _i = i;

				lineLayer.push(
					L.polyline(segment, i === this._LTActiveIdx ? activeLineStyle : lineStyle)
						.setText("→", {repeat: true, attributes: {dy: 5, "font-size": 18}})
				);

				pointLayer.push(L.circleMarker(segment[0], pointStyle));

				corridorLayer.push(L.polygon(
					this._getCorridorCoordsForLine(segment),
					_i === this._LTActiveIdx ? activeCorridorStyle : corridorStyle
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
		const overlappingsCoordsToIdxs = {};

		i = 0;
		pointLayers.forEach((points, groupI) => {
			points.forEach((point, pointI) => {
				const latlng = point.getLatLng();
				const stringCoords = `${latlng.lat}-${latlng.lng}`;
				if (overlappingsCoordsToIdxs[stringCoords]) {
					const pointIdx = LTIdxToFlatIdx(overlappingsCoordsToIdxs[stringCoords], this._pointLayers);

					this._overlappingPointIdxs[i] = pointIdx;
					this._overlappingPointIdxs[pointIdx] = i;
					point.setStyle(overlappingPointStyle);
				} else {
					overlappingsCoordsToIdxs[stringCoords] = `${groupI}-${pointI}`;
				}

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
			const prevDistance = roundMeters(that.pointIdxsToDistances[idx], 10);
			const distance = roundMeters(that.pointIdxsToDistances[idx + 1], 10);
			return 	`${idx + 1}. ${that.translations.interval} (${prevDistance}-${distance}m)`;
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

	getIdxsFromEvent({layer}) {
		const {_leaflet_id} = layer;
		return (layer instanceof L.CircleMarker) ? {
			i: this.leafletIdsToFlatPointIdxs[_leaflet_id]
		} : {
			i: this.leafletIdsToFlatCorridorSegmentIdxs[_leaflet_id],
			lineIdx: this.leafletIdsToCorridorLineIdxs[_leaflet_id],
			segmentIdx: this.leafletIdsToCorridorSegmentIdxs[_leaflet_id]
		};
	}


	// Handles also distance calculation
	_setLTIdxMappings() {
		this.leafletIdsToFlatCorridorSegmentIdxs = {};
		this.leafletIdsToCorridorLineIdxs = {};
		this.leafletIdsToCorridorSegmentIdxs = {};

		let i = 0;
		this._corridorLayers.forEach((corridors, lineIdx) => corridors.forEach((corridor, segmentIdx) => {
			const id = corridor._leaflet_id;
			this.leafletIdsToFlatCorridorSegmentIdxs[id] = i;
			this.leafletIdsToCorridorLineIdxs[id] = lineIdx;
			this.leafletIdsToCorridorSegmentIdxs[id] = segmentIdx;
			i++;
		}));

		this.pointIdxsToDistances = {};
		this.leafletIdsToFlatPointIdxs = {};

		let distance = 0;
		let prevLatLng = undefined;
		i = 0;
		this._pointLayers.forEach(points => {
			prevLatLng = undefined;
			points.forEach(point => {
				const latlng = point.getLatLng();
				distance += prevLatLng ? latlng.distanceTo(prevLatLng) : 0;
				this.pointIdxsToDistances[i] = distance;
				this.leafletIdsToFlatPointIdxs[point._leaflet_id] = i;
				prevLatLng = latlng;
				i++;
			});
		});
	}

	_setLineTransectEvents() {

		this._pointLayerGroup.on("dblclick", e => {
			L.DomEvent.stopPropagation(e);

			this._getPoint(this.getIdxsFromEvent(e).i,  LTIdx => this._setLTPointEditable(...parseIdxsFromLTIdx(LTIdx)));
		});

		this._corridorLayerGroup.on("click", e => {
			L.DomEvent.stopPropagation(e);

			const {i} = this.getIdxsFromEvent(e);

			if (this._selectLTMode) {
				this._hoveredLTLineIdx = undefined;
				if (this._onSelectLT) this._onSelectLT(i);
			} else {
				this._triggerEvent(this._getOnActiveSegmentChangeEvent(i), this._onLTChange);
			}
		}).on("mouseover", e => {
			L.DomEvent.stopPropagation(e);

			const {i} = this.getIdxsFromEvent(e);

			const prevHoverIdx = this._hoveredLTLineIdx;
			this._hoveredLTLineIdx = i;
			this._updateLTStyleForIdx(prevHoverIdx);
			this._updateLTStyleForIdx(this._hoveredLTLineIdx);
			this._openTooltipFor(i);
		}).on("mouseout", e => {
			L.DomEvent.stopPropagation(e);

			const {i} = this.getIdxsFromEvent(e);

			this._hoveredLTLineIdx = undefined;
			this._updateLTStyleForIdx(i);
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
						iconCls: "glyphicon glyphicon-remove-sign"
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

	removeLTPoint(LTIdx) {
		const idxs = parseIdxsFromLTIdx(LTIdx);
		const precedingLine = this._lineLayers[idxs[0]][idxs[1] - 1];
		const followingLine = this._lineLayers[idxs[0]][idxs[1]];
		if (precedingLine && followingLine) {
			precedingLine.setLatLngs([precedingLine.getLatLngs()[0], followingLine.getLatLngs()[1]]);
			this._allLines = this._allLines.filter(l => l !== followingLine);
		} else {
			const lineToFilter = precedingLine || followingLine;
			this._allLines = this._allLines.filter(l => l !== lineToFilter);
		}
		if (this._LTActiveIdx !== undefined && this._LTActiveIdx > LTIdxToFlatIdx(LTIdx, this._allLines)) {
			this._triggerEvent(this._getOnActiveSegmentChangeEvent(this._LTActiveIdx - 1), this._onLTChange);
		}
		this.setLineTransectGeometry(this._formatLTFeatureOut().geometry, !!"undoable");
	}

	_setLTPointEditable(lineIdx, pointIdx) {
		if (this.lineTransectEditIdx !== undefined) {
			const prevIdxs = parseIdxsFromLTIdx(this.lineTransectEditIdx);
			const editableLayer = this._pointLayers[prevIdxs[0]][prevIdxs[1]];
			editableLayer.setStyle(pointStyle);
			this._commitPointDrag();
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
			}
			);
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
		[this._precedingLTDragIdx, this._followingLTDragIdx].forEach(idx => {
			if (idx !== undefined) events.push({
				type: "edit",
				feature,
				idx,
				geometry: this._allLines[idx].toGeoJSON().geometry
			});
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
		setTimeout(() => {
			this._LTDragging = false;
			this.map.dragging.enable();
			L.DomUtil.enableTextSelection();
			this.map.off("mousemove", handler);
		}, 0);
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
		const lineIdx = idxs[0];
		const pointIdx = idxs[1];

		const pointLayer = this._pointLayers[lineIdx];
		const lineLayer = this._lineLayers[lineIdx];
		const corridorLayer = this._corridorLayers[lineIdx];

		const point = pointLayer[pointIdx];
		point.setLatLng(latlng);

		let precedingIdx = pointIdx - 1 >= 0 ? pointIdx - 1 : undefined;
		let precedingLine, precedingCorridor, precedingPoint;
		if (precedingIdx !== undefined) {
			precedingLine = lineLayer[precedingIdx];
			precedingCorridor = corridorLayer[precedingIdx];
			precedingPoint = pointLayer[precedingIdx];
		}

		const followingIdx = pointIdx < pointLayer.length ? pointIdx : undefined;
		let followingLine, followingCorridor, followingPoint;
		if (followingIdx !== undefined) {
			followingLine = lineLayer[followingIdx];
			followingCorridor = corridorLayer[followingIdx];
			followingPoint = pointLayer[followingIdx + 1];
		}

		if (precedingIdx !== undefined) {
			this._precedingLTDragIdx = precedingIdx;
			const lineCoords = [precedingLine.getLatLngs()[0], latlng];
			precedingLine.setLatLngs(lineCoords).openTooltip();
			precedingCorridor.setLatLngs(this._getCorridorCoordsForLine(lineCoords, precedingIdx));
		}

		if (followingIdx !== undefined && followingLine) {
			this._followingLTDragIdx = followingIdx;
			const lineCoords = [latlng, followingLine.getLatLngs()[1]];
			followingLine.setLatLngs(lineCoords).openTooltip();
			followingCorridor.setLatLngs(this._getCorridorCoordsForLine(lineCoords, precedingIdx));
		}

		[precedingPoint, point, followingPoint].forEach(p => {
			if (p) p.bringToFront();
		});
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

	_getOnActiveSegmentChangeEvent(idx) {
		const prevIdx = this._LTActiveIdx;
		this._LTActiveIdx = idx;
		[prevIdx, idx].forEach(i => this._allLines[i] && this._updateLTStyleForIdx(i));
		return {type: "active", idx: this._LTActiveIdx};
	}

	// Doesn't handle points.
	_getStyleForLTLayer(layer, idx) {
		const isActive = idx === this._LTActiveIdx;
		const isEdit = idx === this._splitLTIdx || (this._selectLTMode && idx === this._hoveredLTLineIdx);
		const isHover = idx === this._hoveredLTLineIdx;

		const lineStyles = {
			normal: lineStyle,
			active: activeLineStyle,
			edit: editLineStyle,
			hover: hoverLineStyle,
		};

		const corridorStyles = {
			normal: corridorStyle,
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
			return styleObject.normal;
		}

	}

	_updateLTStyleForIdx(idx) {
		if (idx === undefined) return;
		[this._allLines, this._allCorridors].forEach(layerGroup => {
			const layer = layerGroup[idx];
			layer.setStyle(this._getStyleForLTLayer(layer, idx));
		});
		(idx === this._LTActiveIdx && this.keepActiveTooltipOpen) ? this._openTooltipFor(idx) : this._closeTooltipFor(idx);
	}

	_commitLTLineSplit(splitIdx, splitPoint) {
		this.stopLTLineSplit();

		const splitLine = this._allLines[splitIdx];
		const cutLineLatLng = splitLine.getLatLngs();
		const splittedTail = [cutLineLatLng[0], splitPoint];
		splitLine.setLatLngs(splittedTail);

		const splittedHead = [splitPoint, cutLineLatLng[1]];
		this._allLines.splice(splitIdx + 1, 0, L.polyline(splittedHead));

		const feature = this._formatLTFeatureOut();
		this.setLineTransectGeometry(feature.geometry, !!"undoable");

		const events = [
			{
				type: "edit",
				feature,
				idx: splitIdx,
				geometry: coordinatePairToGeoJSONLine(splittedTail)
			},
			{
				type: "create",
				idx: splitIdx + 1,
				geometry: coordinatePairToGeoJSONLine(splittedHead)
			}
		];

		if (splitIdx < this._LTActiveIdx) {
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

	startSelectLTSegmentMode(onSelect, tooltip) {
		this._selectLTMode = true;
		this._onSelectLT = (idx) => {
			onSelect(idx);
			this.stopSelectLTSegmentMode(idx);
		};
		if (tooltip) this._createTooltip(tooltip);
	}

	stopSelectLTSegmentMode(idx) {
		this._selectLTMode = false;
		this._onSelectLT = undefined;
		this._updateLTStyleForIdx(idx);
		this._disposeTooltip();
	}

	startRemoveLTSegmentMode() {
		this.startSelectLTSegmentMode(this.commitRemoveLTSegment, "DeleteLineSegmentTooltip");
	}

	startSplitByMetersLTSegmentMode() {
		this.startSelectLTSegmentMode(this.splitLTByMeters, "SplitLineByMetersTooltip");
	}

	commitRemoveLTSegment(i) {
		this._allLines.splice(i, 1);
		const feature = this._formatLTFeatureOut();

		const events = [
			{type: "delete", feature, idx: i},
		];
		if (this._LTActiveIdx !== undefined && i - 1 < this._LTActiveIdx) {
			events.push(this._getOnActiveSegmentChangeEvent(this._LTActiveIdx - 1));
		}

		this._triggerEvent(events, this._onLTChange);
		this.setLineTransectGeometry(feature.geometry, !!"undoable");
		this.map.fire("lineTransect:delete");
	}

	splitLTByMeters(idx) {
		const splitByMeters = (e) => {
			e.preventDefault();

			const {value} = input;

			const line = this._allLines[idx];
			const lineAngleFromNorth = this._degreesFromNorth(line.getLatLngs());
			const splitPoint = L.GeometryUtil.destination(line.getLatLngs()[0], lineAngleFromNorth, value);
			this._commitLTLineSplit(idx, splitPoint);
			if (this._selectLTMode) this.stopSelectLTSegmentMode();
			this._closeDialog(e);
		};

		const translateHooks = [];
		const container = document.createElement("form");

		const length = roundMeters(this.pointIdxsToDistances[idx + 1] - this.pointIdxsToDistances[idx]);

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

	_createTooltip(translationKey) {
		this._tooltip = new L.Draw.Tooltip(this.map);
		this.addTranslationHook(() => this._tooltip.updateContent({text: this.translations[translationKey]}));
		this._onMouseMove = ({latlng}) => this._tooltip.updatePosition(latlng);
		["mousemove", "touchmove", "MSPointerMove"].forEach(eType => this.map.on(eType, this._onMouseMove));
	}

	_disposeTooltip() {
		["mousemove", "touchmove", "MSPointerMove"].forEach(eType => this.map.off(eType, this._onMouseMove));
		if (this._tooltip) this._tooltip.dispose();
	}

};

