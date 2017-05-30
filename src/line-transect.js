import { dependsOn, depsProvided, provide, reflect } from "./dependency-utils";
import { latLngSegmentsToGeoJSONGeometry, geoJSONLineToLatLngSegmentArrays } from "./utils";
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
const origLineStyle = {...lineStyle, weight: 0, fill: "#99b"};
const corridorStyle = {...lineStyle, fillOpacity: 0.6, weight: 0, fillColor: lineStyle.color};
const activeCorridorStyle = {...corridorStyle, fillColor: activeLineStyle.color};
const editCorridorStyle = {...corridorStyle, fillColor: editLineStyle.color, fillOpacity: 0.5};
const hoverCorridorStyle = {...corridorStyle, fillColor: hoverLineStyle.color};
const pointStyle = {weight: 0, radius: 5, fillColor: "#154EAA", fillOpacity: 1};
const editablePointStyle = {...pointStyle, radius: 7, fillColor: "#f00", fillOpacity: 0.7};
const overlappingPointStyle = {...pointStyle, radius: 6, weight: 2, color: "#000"};

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

		this.startRemoveLTSegmentMode = this.startRemoveLTSegmentMode.bind(this);
		this.stopRemoveLTSegmentMode = this.stopRemoveLTSegmentMode.bind(this);

		this._addKeyListener(ESC, () => {
			if (this.lineTransectEditIdx) {
				this._commitPointDrag();
				return true;
			} else if (this._lineCutting) {
				this.stopLTLineSplit();
				return true;
			} else if (this._removeLTMode) {
				this.stopRemoveLTSegmentMode();
				return true;
			}
		});
	}

	setOption(option, value) {
		super.setOption(option, value);
		if (option === "lineTransect" && value) {
			this.setLineTransect(value);
		}
	}

	_interceptClick() {
		return super._interceptClick() || (() => {
			if (this.lineTransectEditIdx !== undefined && !this._LTDragging) {
				this._commitPointDrag();
				return true;
			} else if (this._lineCutting) {
				this._commitLTLineCut();
			}
			return false;
		})();
	}

	@dependsOn("map")
	setLineTransect(data) {
		if (!depsProvided(this, "setLineTransect", arguments)) return;

		let {feature, activeIdx, onChange, keepActiveTooltipOpen} = data;
		this.LTFeature = feature;
		this._onLTChange = onChange;
		this._activeLTIdx = activeIdx;
		this.keepActiveTooltipOpen = keepActiveTooltipOpen;

		this.setLineTransectGeometry(feature.geometry);
		this._origLineTransect = L.featureGroup(this._allLines.map(line => 
			L.polyline(line._latlngs, origLineStyle).setText("→", {repeat: true, attributes: {...origLineStyle, dy: 5, "font-size": 18}, below: true})
		)).addTo(this.map).bringToBack();
	}

	_formatLTFeatureOut() {
		const segments = this._allLines.map(layer => [...layer._latlngs.map(({lat, lng}) => [lng, lat])]);

		return {...this.LTFeature, geometry: latLngSegmentsToGeoJSONGeometry(segments)};
	}

	setLineTransectGeometry(geometry) {

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
					L.polyline(segment, i === this._activeLTIdx ? activeLineStyle : lineStyle)
						.setText("→", {repeat: true, attributes: {dy: 5, "font-size": 18}})
				);

				pointLayer.push(L.circleMarker(segment[0], pointStyle));

				corridorLayer.push(L.polygon(
					this._getCorridorCoordsForLine(segment),
					_i === this._activeLTIdx ? activeCorridorStyle : corridorStyle
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

		this._setLineTransectEvents();
		if (this.keepActiveTooltipOpen) this._openTooltipFor(this._activeLTIdx);

		provide(this, "lineTransect");
	}

	_openTooltipFor(i) {
		const that = this;
		function getTooltipFor(idx) {
			const prevDistance = Math.round(parseInt(that.pointIdxsToDistances[idx]) / 10) * 10;
			const distance = Math.round(parseInt(that.pointIdxsToDistances[idx + 1]) / 10) * 10;
			return 	`${idx + 1}. ${that.translations.interval} (${prevDistance}-${distance}m)`;
		}

		let tooltip = getTooltipFor(i);
		const line = this._allLines[i];
		if (!line._tooltip) line.bindTooltip(tooltip, {direction: "top", permanent: true});
		line.openTooltip();
	}


	_closeTooltipFor(i) {
		const line = this._allLines[i];
		if (i !== this._activeLTIdx || !this.keepActiveTooltipOpen) line.closeTooltip().unbindTooltip();
	}

	_setLineTransectEvents() {
		const leafletIdsToFlatCorridorSegmentIdxs = {};
		const leafletIdsToCorridorLineIdxs = {};
		const leafletIdsToCorridorSegmentIdxs = {};

		let i = 0;
		this._corridorLayers.forEach((corridors, lineIdx) => corridors.forEach((corridor, segmentIdx) => {
			const id = corridor._leaflet_id;
			leafletIdsToFlatCorridorSegmentIdxs[id] = i;
			leafletIdsToCorridorLineIdxs[id] = lineIdx;
			leafletIdsToCorridorSegmentIdxs[id] = segmentIdx;
			i++;
		}));

		this.pointIdxsToDistances = {};
		const leafletIdsToFlatPointIdxs = {};

		let distance = 0;
		let prevLatLng = undefined;
		i = 0;
		this._pointLayers.forEach(points => {
			prevLatLng = undefined;
			points.forEach(point => {
				const latlng = point.getLatLng();
				distance += prevLatLng ? latlng.distanceTo(prevLatLng) : 0;
				this.pointIdxsToDistances[i] = distance;
				leafletIdsToFlatPointIdxs[point._leaflet_id] = i;
				prevLatLng = latlng;
				i++;
			});
		});

		function getIdxsFromEvent({layer}) {
			const {_leaflet_id} = layer;
			return (layer instanceof L.CircleMarker) ? {
				i: leafletIdsToFlatPointIdxs[_leaflet_id]
			} : {
				i: leafletIdsToFlatCorridorSegmentIdxs[_leaflet_id],
				lineIdx: leafletIdsToCorridorLineIdxs[_leaflet_id],
				segmentIdx: leafletIdsToCorridorSegmentIdxs[_leaflet_id]
			};
		}

		this._pointLayerGroup.on("dblclick", e => {
			const {i} = getIdxsFromEvent(e);
			if (this._overlappingPointIdxs[i] !== undefined) {
				const firstLTIdx = flatIdxToLTIdx(this._overlappingPointIdxs[i], this._pointLayers);
				const lastLTIdx = flatIdxToLTIdx(i, this._pointLayers);
				const firstPoint = this._allPoints[this._overlappingPointIdxs[i]];
				const lastPoint = this._allPoints[i];

				const translateHooks = [];

				const popup = document.createElement("div");
				popup.className = "text-center";

				const question = document.createElement("span");
				translateHooks.push(this.addTranslationHook(question, "FirstOrLastPoint"));

				const firstButton = document.createElement("button");
				firstButton.addEventListener("click", () => {
					lastPoint.setStyle(pointStyle);
					this._setLTPointEditable(...parseIdxsFromLTIdx(firstLTIdx));
					lastPoint.closePopup();
				});
				translateHooks.push(this.addTranslationHook(firstButton, "FirstPartitive"));

				const lastButton = document.createElement("button");
				lastButton.addEventListener("click", () => {
					firstPoint.setStyle(pointStyle);
					this._setLTPointEditable(...parseIdxsFromLTIdx(lastLTIdx));
					lastPoint.closePopup();
				});
				translateHooks.push(this.addTranslationHook(lastButton, "LastPartitive"));

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
				this._allPoints[i].on("dblclick", () => {this._setLTPointEditable(...parseIdxsFromLTIdx(flatIdxToLTIdx(i, this._pointLayers)));});
			}
		});

		this._corridorLayerGroup.on("click", e => {
			const {i} = getIdxsFromEvent(e);

			if (this._removeLTMode) {
				this._hoveredLTLineIdx = undefined;
				this.commitRemoveLTSegment(i);
			} else {
				this._triggerEvent(this._getOnActiveSegmentChangeEvent(i), this._onLTChange);
			}
		}).on("mouseover", e => {
			const {i} = getIdxsFromEvent(e);

			const prevHoverIdx = this._hoveredLTLineIdx;
			this._hoveredLTLineIdx = i;
			this._updateStyleForLTIdx(prevHoverIdx);
			this._updateStyleForLTIdx(this._hoveredLTLineIdx);
			this._openTooltipFor(i);
		}).on("mouseout", e => {
			const {i} = getIdxsFromEvent(e);

			this._hoveredLTLineIdx = undefined;
			this._updateStyleForLTIdx(i);
			if (i !== this._activeLTIdx) this._closeTooltipFor(i);
		}).on("dblclick", e => {
			const {latlng} = e;
			const {lineIdx, segmentIdx} = getIdxsFromEvent(e);

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
			const contextmenuItems = [
				{
					text: translations.SplitLine,
					callback: () => this.startLTLineSplitForIdx(idx),
					iconCls: "glyphicon glyphicon-scissors"
				},
				{
					text: translations.DeleteLineSegment,
					callback: () => this.commitRemoveLTSegment(idx),
					iconCls: "glyphicon glyphicon-remove-sign"
				}
			];

			corridor.bindContextMenu({
				contextmenuInheritItems: false,
				contextmenuItems
			});
		});
	}

	_setLTPointEditable(lineIdx, pointIdx) {
		if (this.lineTransectEditIdx !== undefined) {
			const prevIdxs = parseIdxsFromLTIdx(this.lineTransectEditIdx);
			const editableLayer = this._pointLayers[prevIdxs[0]][prevIdxs[1]];
			editableLayer.setStyle(pointStyle);
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
		this.setLineTransectGeometry(feature.geometry);

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
		const prevIdx = this._activeLTIdx;
		this._activeLTIdx = idx;
		[prevIdx, idx].forEach(i => this._updateStyleForLTIdx(i));
		return {type: "active", idx: this._activeLTIdx};
	}

	// Doesn't handle points.
	_getStyleForLTLayer(layer, idx) {
		const isActive = idx === this._activeLTIdx;
		const isEdit = idx === this._splitLTIdx || (this._removeLTMode && idx === this._hoveredLTLineIdx);
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

	_updateStyleForLTIdx(idx) {
		if (idx === undefined) return;
		[this._allLines, this._allCorridors].forEach(layerGroup => {
			const layer = layerGroup[idx];
			layer.setStyle(this._getStyleForLTLayer(layer, idx));
		});
		(idx === this._activeLTIdx && this.keepActiveTooltipOpen) ? this._openTooltipFor(idx) : this._closeTooltipFor(idx);
	}

	_commitLTLineCut() {
		const splitIdx = this._splitLTIdx;
		this.stopLTLineSplit();

		const splitLine = this._allLines[splitIdx];
		const cutLineLatLng = splitLine.getLatLngs();
		const splittedTail = [cutLineLatLng[0], this._splitPoint];
		splitLine.setLatLngs(splittedTail);

		const splittedHead = [this._splitPoint, cutLineLatLng[1]];
		this._allLines.splice(splitIdx + 1, 0, L.polyline(splittedHead));

		const feature = this._formatLTFeatureOut();
		this.setLineTransectGeometry(feature.geometry);

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

		if (splitIdx < this._activeLTIdx) {
			events.push(this._getOnActiveSegmentChangeEvent(this._activeLTIdx + 1));
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
		this._updateStyleForLTIdx(lastLineCutIdx);
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
		this._updateStyleForLTIdx(prevCutIdx);
		this._updateStyleForLTIdx(this._splitLTIdx);

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

	startRemoveLTSegmentMode() {
		this._removeLTMode = true;
		this._createTooltip("DeleteLineSegmentTooltip");
	}

	stopRemoveLTSegmentMode() {
		this._removeLTMode = false;
		this._updateStyleForLTIdx(this._hoveredLTLineIdx);
		this._disposeTooltip();
	}

	commitRemoveLTSegment(i) {
		this._allLines.splice(i, 1);
		const feature = this._formatLTFeatureOut();

		const events = [
			{type: "delete", feature, idx: i},
		];
		if (this._activeLTIdx !== undefined && i - 1 <= this._activeLTIdx) {
			events.push(this._getOnActiveSegmentChangeEvent(this._activeLTIdx - 1));
		}

		this._triggerEvent(events, this._onLTChange);
		this.stopRemoveLTSegmentMode();
		this.setLineTransectGeometry(feature.geometry);
		this.map.fire("lineTransect:delete");
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

