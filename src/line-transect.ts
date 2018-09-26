import * as L from "leaflet";
import * as G from "geojson";
import { dependsOn, depsProvided, provide, reflect } from "./dependency-utils";
import { latLngSegmentsToGeoJSONGeometry, geoJSONLineToLatLngSegmentArrays, createTextInput, combineColors,
	getLineTransectStartEndDistancesForIdx, capitalizeFirstLetter } from "./utils";
import "leaflet-geometryutil";
import {
	NORMAL_COLOR,
	ACTIVE_COLOR,
	ESC
} from "./globals";
import { isPolyline } from "./map";
import LajiMap from "./map";
import {
	LineTransectEvent,
	LineTransectFeature, LineTransectGeometry, LineTransectHistoryEntry, LineTransectIdx, LineTransectOptions,
	PointIdxTuple,
	SegmentIdxTuple, SegmentLayer, SegmentLayers, TooltipMessages
} from "./line-transect.defs";
import { IdxTuple } from "./map.defs";

const POINT_DIST_TRESHOLD = 50;
const ODD_AMOUNT = 30;

const lineStyle: L.PathOptions = {color: NORMAL_COLOR, weight: 2};
const activeLineStyle: L.PathOptions = {...lineStyle, color: ACTIVE_COLOR};
const hoverLineStyle: L.PathOptions = {...lineStyle, color: combineColors(lineStyle.color, activeLineStyle.color)};
const editLineStyle: L.PathOptions = {...lineStyle, color: "#f00"};
const defaultLineStyle: L.PathOptions = {...lineStyle, weight: 1, fillColor: "#99b"};

const corridorStyle: L.PathOptions = {...lineStyle, fillOpacity: 0.6, weight: 0, fillColor: lineStyle.color};
const oddCorridorStyle: L.PathOptions = {...corridorStyle, weight: 2, fillColor: combineColors(lineStyle.color, "#000000", ODD_AMOUNT)}; // tslint:disable-line
const activeCorridorStyle: L.PathOptions = {...corridorStyle, fillColor: activeLineStyle.color};
const editCorridorStyle: L.PathOptions = {...corridorStyle, fillColor: editLineStyle.color, fillOpacity: 0.5};
const hoverCorridorStyle: L.PathOptions = {...corridorStyle, fillColor: hoverLineStyle.color};

const pointStyle: L.CircleMarkerOptions = {weight: 0, radius: 3, fillColor: "#154EAA", fillOpacity: 1};
const oddPointStyle: L.CircleMarkerOptions = {...pointStyle, fillColor: combineColors(pointStyle.fillColor, "#000000", ODD_AMOUNT)}; // tslint:disable-line
const activePointStyle: L.CircleMarkerOptions = {...pointStyle, fillColor: combineColors(activeLineStyle.color, "#000000", 40)}; // tslint:disable-line
const editPointStyle: L.CircleMarkerOptions = {...pointStyle, fillColor: editLineStyle.color};
const hoverPointStyle: L.CircleMarkerOptions = {...pointStyle, fillColor: hoverLineStyle.color};
const editablePointStyle: L.CircleMarkerOptions = {...pointStyle, radius: 5, fillColor: "#f00", fillOpacity: 0.7};
const overlappingPointStyle: L.CircleMarkerOptions = {...pointStyle, radius: 5, weight: 3, color: "#000"};
const firstOverlappingPointStyle: L.CircleMarkerOptions = {...overlappingPointStyle, fillColor: "#f00"};
const seamPointStyle: L.CircleMarkerOptions = {...pointStyle, radius: 7};
const closebyEditPointStyle: L.CircleMarkerOptions = {...editPointStyle, radius: 9};
const closebyPointStyle: L.CircleMarkerOptions = {...pointStyle, fillColor: editablePointStyle.fillColor, radius: 9, fillOpacity: editablePointStyle.fillOpacity}; // tslint:disable-line
const hintPointStyle: L.CircleMarkerOptions = {...closebyPointStyle, radius: 7};

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

function idxTupleToIdxTupleStr(idxTuple: IdxTuple): string {
	const [i, j] = idxTuple;
	return i !== undefined && j !== undefined ? `${i}-${j}` : undefined;
}

type Constructor<LM> = new(...args: any[]) => LM;

export default function LajiMapWithLineTransect<LM extends Constructor<LajiMap>>(Base: LM) { class LajiMapWithLineTransect extends Base { // tslint:disable-line
	_hoveredIdxTuple: SegmentIdxTuple;
	LTFeature: LineTransectFeature;
	_LTEditPointIdxTuple: PointIdxTuple;
	_splitIdxTuple: PointIdxTuple;
	_splitPoint: L.LatLng;
	_lineLayers: L.Polyline<G.LineString>[][];
	_pointLayers: L.CircleMarker[][];
	_pointIdsToIdxTuples: {[id: number]: PointIdxTuple};
	_corridorLayers: L.Polygon<G.Polygon>[][];
	_allSegments: L.Polyline<G.LineString>[];
	_allCorridors: L.Polygon<G.Polygon>[];
	_allPoints: L.CircleMarker[];
	_lineSplitFn: (idxTuple: SegmentIdxTuple, splitPoint: L.LatLng) => void;
	_selectLTMode: "segment" | "line";
	_LTActiveIdx: number;
	_onLTChange: LineTransectOptions["onChange"];
	_LTDragging: boolean;
	_getLTFeatureStyle: LineTransectOptions["getFeatureStyle"];
	_getLTTooltip: LineTransectOptions["getTooltip"];
	_LTHistory: LineTransectHistoryEntry[];
	_LTHistoryPointer: number;
	_LTPrintMode: boolean;
	_LTEditable: boolean;
	_origLineTransect: L.FeatureGroup;
	_pointLayerGroup: L.FeatureGroup;
	_lineLayerGroup: L.FeatureGroup;
	_corridorLayerGroup: L.FeatureGroup;
	_overlappingNonadjacentPointIdxTuples: {[idxTupleString: string]: PointIdxTuple};
	_overlappingAdjacentPointIdxTuples: {[idxTupleString: string]: PointIdxTuple};
	_lineIdxsTupleStringsToLineGroupIdxs: {[idxTupleString: string]: number};
	_groupIdxsToLineIdxs: {[groupIdx: number]: number[]};
	_LTStartText: L.Polyline;
	_LTGroups: L.FeatureGroup[];
	_tooltipIdx: number;
	_overlappingPointDialogSegmentIdxTuple: SegmentIdxTuple;
	leafletIdsToCorridorLineIdxs: {[id: string]: number};
	leafletIdsToCorridorSegmentIdxs: {[id: string]: number};
	leafletIdsToFlatCorridorSegmentIdxs: {[id: string]: number};
	leafletIdsToFlatPointIdxs: {[id: string]: number};
	lineIdsToCorridorIds: {[id: string]: number};
	corridorFlatIdxsToLeafletIds: {[id: string]: number};
	_hoveredIsMarker: boolean;
	_editCorridorHovered: boolean;
	_LTClickTimeout: number;
	_closebyPointIdxTuple: PointIdxTuple;
	_pointLTShiftMode: boolean;
	_onSelectLT: (idxTuple: SegmentIdxTuple) => void;
	_firstLTSegmentToRemoveIdx: SegmentIdxTuple;
	_LTPointExpander: L.CircleMarker;
	_LTdragPoint: L.CircleMarker;
	_LTContextMenuLayer: SegmentLayer;
	_featureBeforePointDrag: LineTransectFeature;
	_LTPointLatLngBeforeDrag: L.LatLng;
	_hoveringDragPoint: boolean;
	_dragPointStart: L.LatLng;
	_dragMouseStart: L.LatLng;
	_cutLine: L.Polygon;
	_lineCutIdx: SegmentIdxTuple;
	_ltTooltip: L.Draw.Tooltip;
	messages: TooltipMessages;

	constructor(...props: any[]) {
		super(...props);
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
			if (this._LTEditPointIdxTuple) {
				this._commitPointDrag();
				return true;
			} else if (this._lineSplitFn) {
				this.stopLTLineSplit();
				return true;
			} else if (this._selectLTMode) {
				this.stopSelectLTSegmentMode();
				return true;
			}
			return false;
		});
	}

	getOptionKeys(): any {
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
		if (super._interceptClick()) return;
		if (this._LTEditPointIdxTuple !== undefined && !this._LTDragging) {
			this._commitPointDrag();
			return true;
		} else if (this._lineSplitFn) {
			this._lineSplitFn(this._splitIdxTuple, this._splitPoint);
			return true;
		}
		return false;
	}

	_getAllData() {
		return this._lineLayerGroup ? [...super._getAllData(), {group: this._lineLayerGroup}] : super._getAllData();
	}

	@dependsOn("map")
	setLineTransect(data: LineTransectOptions) {
		if (!depsProvided(this, "setLineTransect", arguments)) return;
		if (!data) return;

		let {feature, activeIdx, onChange, getFeatureStyle, getTooltip, printMode, editable = true} = data;
		this.LTFeature = feature;
		this._onLTChange = onChange;
		this._LTActiveIdx = activeIdx;
		this._getLTFeatureStyle = getFeatureStyle;
		this._getLTTooltip = getTooltip;

		this._LTHistory = [{geometry: feature.geometry}];
		this._LTHistoryPointer = 0;

		if (printMode) this._LTPrintMode = true;

		this._LTEditable = this._LTPrintMode ? false : editable;

		this.setLineTransectGeometry(feature.geometry);
		if (this._LTEditable) {
			if (this._origLineTransect) {
				this._origLineTransect.remove();
			}
			this._origLineTransect = L.featureGroup(this._allSegments.map(line =>
				L.polyline(<L.LatLngExpression[]> line.getLatLngs(), defaultLineStyle).setText("→", {
					repeat: true,
					attributes: {...defaultLineStyle, "dy": 5, "font-size": 18},
					below: true
				})
			)).addTo(this.map).bringToBack();
		}

		if (this.getOptions().zoomToData) this.zoomToData(this.getOptions().zoomToData);
	}

	setLTActiveIdx(idx: number) {
		const prevIdx = this._LTActiveIdx;
		this._LTActiveIdx = idx;
		[prevIdx, this._LTActiveIdx].forEach(i => this._updateLTStyleForLineIdx(i));
	}

	_formatLTFeatureOut(): LineTransectFeature {
		const segments = this._lineLayers.map(
			line => line.map(segment => (<L.LatLng[]> segment.getLatLngs()).map(({lat, lng}) => [lng, lat]))
		);

		return {...this.LTFeature, geometry: latLngSegmentsToGeoJSONGeometry(segments)};
	}

	setLineTransectGeometry(geometry: LineTransectGeometry, events?: LineTransectEvent[]) {
		if (events) {
			if (this._LTHistoryPointer < this._LTHistory.length - 1) {
				this._LTHistory = this._LTHistory.splice(0).splice(0, this._LTHistoryPointer + 1);
			}
			const undoEvents = [];
			events.forEach(e => {
				switch (e.type) {
				case "edit": {
					undoEvents.push({
						type: "edit",
						idx: e.idx,
						feature: e.prevFeature,
						geometry: {type: "LineString", coordinates: e.prevFeature.geometry.coordinates[e.idx]}
					});
					break;
				}
				case "insert": {
					undoEvents.push({
						type: "delete",
						idx: e.idx,
						feature: e.prevFeature
					});
					break;
				}
				case "delete": {
					undoEvents.push({
						type: "insert",
						idx: e.idx,
						feature: e.prevFeature,
						geometry: {type: "LineString", coordinates: e.prevFeature.geometry.coordinates[e.idx]}
					});
					break;
				}
				case "merge": {
					undoEvents.push({
						type: "edit",
						idx: e.idxs[1],
						feature: e.prevFeature,
						geometry: {type: "LineString", coordinates: e.prevFeature.geometry.coordinates[e.idxs[1]]}
					});
					undoEvents.push({
						type: "insert",
						idx: e.idxs[0],
						feature: e.prevFeature,
						geometry: {type: "LineString", coordinates: e.prevFeature.geometry.coordinates[e.idxs[0]]}
					});
					break;
				}
				case "move": {
					undoEvents.push({
						type: "move",
						idx: e.target,
						target: e.idx + 1
					});
					break;
				}
				}
			});
			this._LTHistory.push({geometry, undoEvents, redoEvents: events});
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

		this._overlappingNonadjacentPointIdxTuples = {};
		this._overlappingAdjacentPointIdxTuples = {};
		const overlappingsCoordsToIdxs = {};
		this._pointIdsToIdxTuples = {};

		const indexPoint = (lat, lng, lineIdx, segmentIdx) => {
			const stringCoords = `${lat}-${lng}`;
			const overlapping = overlappingsCoordsToIdxs[stringCoords];
			if (overlapping) {
				const [overlappingLineIdx] = overlapping;

				const pointIdxTuple: PointIdxTuple = [lineIdx, segmentIdx];
				const pointIdxTupleStr = idxTupleToIdxTupleStr(pointIdxTuple);
				const overlappingPointIdxTuple = overlappingsCoordsToIdxs[stringCoords];
				const overlappingPointIdxTupleStr = idxTupleToIdxTupleStr(overlappingPointIdxTuple);
				if (overlappingLineIdx !== undefined && overlappingLineIdx !== lineIdx - 1) {
					this._overlappingNonadjacentPointIdxTuples[pointIdxTupleStr] = overlappingPointIdxTuple;
					this._overlappingNonadjacentPointIdxTuples[overlappingPointIdxTupleStr] = pointIdxTuple;
				} else {
					this._overlappingAdjacentPointIdxTuples[pointIdxTupleStr] = overlappingPointIdxTuple;
					this._overlappingAdjacentPointIdxTuples[overlappingPointIdxTupleStr] = pointIdxTuple;
				}
			}
			overlappingsCoordsToIdxs[stringCoords] = [lineIdx, segmentIdx];
		};

		let prevEnd = undefined;
		this._lineIdxsTupleStringsToLineGroupIdxs = {};
		let groupIdx = 0;
		const indexSegment = (segment, lineIdx) => {
			const [start, end] = segment.map(c => L.latLng(c));
			if (prevEnd && !start.equals(prevEnd)) {
				groupIdx++;
			}
			this._lineIdxsTupleStringsToLineGroupIdxs[lineIdx] = groupIdx;
			prevEnd = end;
		};

		wholeLinesAsSegments.forEach((wholeLineAsSegments, lineIdx) => {
			[pointLayers, lineLayers, corridorLayers].forEach((layers: SegmentLayers[]) => {
				layers.push([]);
			});
			const pointLayer = pointLayers[lineIdx];
			const lineLayer = lineLayers[lineIdx];
			const corridorLayer = corridorLayers[lineIdx];

			wholeLineAsSegments.forEach((segment, segmentIdx) => {
				const lngLat = segment[0];
				indexPoint(lngLat[1], lngLat[0], lineIdx, segmentIdx);

				const line = <L.Polyline<G.LineString>> L.polyline(
					segment,
					this._getStyleForLTIdxTupleAndType([lineIdx, segmentIdx], L.Polyline)
				);
				if (!this._LTPrintMode) {
					line.setText("→", {repeat: true, attributes: {"dy": 5, "font-size": 18}});
				} else if (!L.latLng(segment[0]).equals(prevEnd)) {
					const degree = this._degreesFromNorth(segment);
					const direction = L.GeometryUtil.destination(L.latLng(segment[0]), degree, 500);
					L.polyline([segment[0], direction], {opacity: 0, fillOpacity: 0})
						.setText("→", {repeat: false, attributes: {"dy": 5, "font-size": 50}})
						.addTo(this.map);
				}
				if (lineIdx === 0 && segmentIdx === 0) {
					if (this._LTStartText) {
						this._LTStartText.remove();
					}
					this._LTStartText = L.polyline(this._getLTStartTextCoordinates(segment), {opacity: 0, fillOpacity: 0})
						.setText("Alku", {repeat: false, attributes: {"dy": 5, "font-size": 20}})
						.addTo(this.map);
				}
				indexSegment(segment, lineIdx);
				lineLayer.push(line);

				corridorLayer.push(L.polygon(
					this._getCorridorCoordsForLine(segment),
					this._getStyleForLTIdxTupleAndType([lineIdx, segmentIdx], L.Polygon)
				));

				const point = L.circleMarker(
					segment[0],
					this._getStyleForLTIdxTupleAndType([lineIdx, segmentIdx], L.CircleMarker)
				);
				pointLayer.push(point);
				this._pointIdsToIdxTuples[L.Util.stamp(point)] = [lineIdx, segmentIdx];

				if (segmentIdx === wholeLineAsSegments.length - 1) {
					const _lngLat = segment[1];
					indexPoint(_lngLat[1], _lngLat[0], lineIdx, segmentIdx + 1);
					const _point = L.circleMarker(_lngLat, this._getStyleForLTIdxTupleAndType([lineIdx, segmentIdx + 1], L.CircleMarker));
					pointLayer.push(_point);
					this._pointIdsToIdxTuples[L.Util.stamp(_point)] = [lineIdx, segmentIdx + 1];
				}
			});
		});

		this._allSegments = flattenMatrix(lineLayers);
		this._allCorridors = flattenMatrix(corridorLayers);
		this._allPoints = flattenMatrix(pointLayers);

		this._lineLayerGroup = L.featureGroup(this._allSegments).addTo(this.map);
		this._corridorLayerGroup = L.featureGroup(this._allCorridors).addTo(this.map);
		this._pointLayerGroup = L.featureGroup(this._allPoints).addTo(this.map);

		this._LTGroups = this._lineLayers.map((_, lineIdx) => {
			return L.featureGroup([
				...this._lineLayers[lineIdx],
				...this._pointLayers[lineIdx], ...this._corridorLayers[lineIdx]
			]);
		});

		this._groupIdxsToLineIdxs = Object.keys(this._lineIdxsTupleStringsToLineGroupIdxs).reduce((d, _lineIdx) => {
			const group = d[this._lineIdxsTupleStringsToLineGroupIdxs[_lineIdx]] || [];
			d[this._lineIdxsTupleStringsToLineGroupIdxs[_lineIdx]] = group;
			group.push(+_lineIdx);
			return d;
		}, {});

		this._setIdxTupleMappings();
		this._setLineTransectEvents();

		this._setLTPrintLines();

		provide(this, "lineTransect");
	}

	_getLTStartTextCoordinates(segment: L.LatLng[]) {
		segment = segment.map(L.latLng);
		const degree = this._degreesFromNorth(segment);
		const length = degree > -50 && degree < 50 ? 120 : 60;
		return [
			segment[0],
			L.GeometryUtil.destination(segment[0], 90, 500)
		].map(c => L.GeometryUtil.destination(c, degree - 90, length));
	}

	LTUndo() {
		if (this._LTHistoryPointer <= 0) return;
		const {undoEvents} = this._LTHistory[this._LTHistoryPointer];
		this._LTHistoryPointer--;
		const {geometry} = this._LTHistory[this._LTHistoryPointer];
		this.setLineTransectGeometry(geometry);
		if (undoEvents) {
			this._triggerEvent(undoEvents.slice(0).reverse(), this._onLTChange);
		}
	}

	LTRedo() {
		if (this._LTHistoryPointer >= this._LTHistory.length - 1) return;
		this._LTHistoryPointer++;
		const {geometry, redoEvents} = this._LTHistory[this._LTHistoryPointer];
		this.setLineTransectGeometry(geometry);
		if (redoEvents) {
			this._triggerEvent(redoEvents, this._onLTChange);
		}
	}

	_getTooltipForPointIdxTuple = (type, idxTuple: PointIdxTuple) => {
		const [lineIdx, pointIdx] = idxTuple;
		const getTooltipForLineIdx = _lineIdx => {
			const [prevDistance, distance] = getLineTransectStartEndDistancesForIdx(this._formatLTFeatureOut(), _lineIdx, 10);
			return `<b>${prevDistance}-${distance}m</b>`;
		};

		return getTooltipForLineIdx(lineIdx);
	}

	_clearTooltipDescription() {
		this._updateLTTooltip();
		this._tooltipIdx = undefined;
	}

	flatIdxToIdxTuple(idx: number) {
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
	_getPoint(
		idxTuple: PointIdxTuple,
		callback: (idxTuple) => void,
		questionTranslationKey = "FirstOrLastPoint",
		firstTranslationKey = "FirstPartitive",
		lastTranslationKey = "LastPartitive"
	) {
		const [lineIdx, pointIdx] = idxTuple;
		const overlappingPointIdxTuple =
			this._overlappingNonadjacentPointIdxTuples[idxTupleToIdxTupleStr([lineIdx, pointIdx])];
		const latLng = this._getLTLayerForIdxTuple(this._pointLayers, [lineIdx, pointIdx]).getLatLng();
		const _latLng = overlappingPointIdxTuple
			?  this._getLTLayerForIdxTuple(this._pointLayers, overlappingPointIdxTuple).getLatLng()
			: undefined;
		if (overlappingPointIdxTuple !== undefined && latLng.equals(_latLng)) {
			const firstIdxTuple = overlappingPointIdxTuple;
			const lastIdxTuple: PointIdxTuple = [lineIdx, pointIdx];
			const lastPoint = this._getLTLayerForIdxTuple(this._pointLayers, lastIdxTuple);

			const translateHooks = [];

			const popup = document.createElement("div");
			popup.className = "text-center";

			const question = document.createElement("span");
			translateHooks.push(this.addTranslationHook(question, questionTranslationKey));

			const precedingIdxTuple = this._getIdxTuplePrecedingPoint(firstIdxTuple);
			const followingIdxTuple = this._getIdxTupleFollowingPoint([lineIdx, pointIdx]);

			const onClick = (_idxTuple) => (e) => {
				e.preventDefault();
				const point = this._getLTLayerForIdxTuple(this._pointLayers, _idxTuple);
				this._overlappingPointDialogSegmentIdxTuple = undefined;
				point.setStyle(pointStyle);
				lastPoint.closePopup();
				callback(_idxTuple);
			};

			const onMouseOver = (_idxTuple) => () => {
				if (!_idxTuple) return;
				this._overlappingPointDialogSegmentIdxTuple = _idxTuple;
				this._updateLTStyleForIdxTuple(_idxTuple);
			};
			const onMouseOut = (_idxTuple) => () => {
				if (!_idxTuple) return;
				this._overlappingPointDialogSegmentIdxTuple = undefined;
				this._updateLTStyleForIdxTuple(_idxTuple);
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
			callback(idxTuple);
		}
	}

	getIdxsFromLayer(layer: SegmentLayer): LineTransectIdx {
		if (!layer) return undefined;
		const getIdxsForId = (id): LineTransectIdx => {
			const lineIdx = this.leafletIdsToCorridorLineIdxs[id];
			const segmentIdx = this.leafletIdsToCorridorSegmentIdxs[id];
			return {
				i: this.leafletIdsToFlatCorridorSegmentIdxs[id],
				lineIdx,
				segmentIdx,
				idxTuple: [lineIdx, segmentIdx]
			};
		};
		const id = L.Util.stamp(layer);
		if (layer instanceof L.CircleMarker) {
			const i = this.leafletIdsToFlatPointIdxs[id];
			const [lineIdx, segmentIdx] = this.flatIdxToIdxTuple(i);
			return {
				i,
				lineIdx,
				segmentIdx,
				idxTuple: [lineIdx, segmentIdx]
			};
		} else if (isPolyline(layer)) {
			const corridorId = this.lineIdsToCorridorIds[L.Util.stamp(layer)];
			return getIdxsForId(corridorId);
		} else {
			return getIdxsForId(id);
		}
	}

	getIdxsFromEvent({layer}: L.LayerEvent) {
		return this.getIdxsFromLayer(<SegmentLayer> layer);
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
			const id = L.Util.stamp(corridor);
			this.leafletIdsToFlatCorridorSegmentIdxs[id] = i;
			this.leafletIdsToCorridorLineIdxs[id] = lineIdx;
			this.leafletIdsToCorridorSegmentIdxs[id] = segmentIdx;
			this.corridorFlatIdxsToLeafletIds[i] = id;
			i++;
		}));

		i = 0;
		this._lineLayers.forEach((lines) => lines.forEach((line) => {
			this.lineIdsToCorridorIds[L.Util.stamp(line)] = this.corridorFlatIdxsToLeafletIds[i];
			i++;
		}));

		this.leafletIdsToFlatPointIdxs = {};

		i = 0;
		this._pointLayers.forEach((points) => {
			points.forEach(point => {
				this.leafletIdsToFlatPointIdxs[L.Util.stamp(point)] = i;
				i++;
			});
		});
	}

	_setLineTransectEvents() {
		const onMouseOver = (e) => {
			L.DomEvent.stopPropagation(e);

			const isPoint = e.layer instanceof L.Marker;
			const {lineIdx, segmentIdx} = this.getIdxsFromEvent(e);

			const prevHoverIdx = this._hoveredIdxTuple;
			this._hoveredIdxTuple = [lineIdx, segmentIdx];
			this._hoveredIsMarker = isPoint;
			if (prevHoverIdx) this._updateLTStyleForLineIdx(prevHoverIdx[0]);
			this._updateLTStyleForLineIdx(this._hoveredIdxTuple[0]);
			this._updateLTTooltip();
		};
		const onMouseOut = (e) => {
			L.DomEvent.stopPropagation(e);

			const {lineIdx} = this.getIdxsFromEvent(e);

			this._hoveredIdxTuple = undefined;
			this._updateLTStyleForLineIdx(lineIdx);
			this._editCorridorHovered = false;
			this._updateLTTooltip();
		};
		const pointIsMiddlePoint = (e) => {
			const {lineIdx, segmentIdx} = this.getIdxsFromEvent(e);
			if (segmentIdx === 0 || segmentIdx === this._pointLayers[lineIdx].length - 1) {
				return false;
			}
			return true;
		};

		const delayClick = (fn) => {
			if (this._LTClickTimeout) clearTimeout(this._LTClickTimeout);
			if (this._closebyPointIdxTuple) {
				this._LTClickTimeout = setTimeout(fn, 500);
			} else {
				fn();
			}
		};

		this._pointLayerGroup.on("dblclick", (e: L.LayerEvent) => {
			L.DomEvent.stopPropagation(<any> e);
			clearTimeout(this._LTClickTimeout);

			const {idxTuple} = this.getIdxsFromEvent(e);
			this._getPoint(idxTuple, (_idxTuple) => this._setLTPointEditable(_idxTuple));
		}).on("click", (e: L.LayerEvent)  => {
			L.DomEvent.stopPropagation(<any> e);
			const {lineIdx, segmentIdx, idxTuple} = this.getIdxsFromEvent(e);
			if (this._pointLTShiftMode && this._pointCanBeShiftedTo(idxTuple)) {
				this.commitLTPointShift([segmentIdx === 0 ? lineIdx : lineIdx + 1, 0]);
				return;
			}
			this._interceptClick();

			const idxTupleStr = idxTuple ? idxTupleToIdxTupleStr(idxTuple) : undefined;
			if (this._overlappingNonadjacentPointIdxTuples[idxTupleStr]
				|| this._overlappingAdjacentPointIdxTuples[idxTupleStr]
			) {
				return;
			}

			delayClick(() => {
				const {lineIdx: _lineIdx} = this.getIdxsFromEvent(e);

				if (!this._selectLTMode) {
					this._triggerEvent(this._getOnActiveSegmentChangeEvent(_lineIdx), this._onLTChange);
					this._updateLTTooltip();
				}
			});
		}).on("mouseover", e => {
			pointIsMiddlePoint(e) && onMouseOver(e);
		}).on("mouseout", e => {
			pointIsMiddlePoint(e) && onMouseOut(e);
		});

		this._corridorLayerGroup.on("click", (e: L.LayerEvent) => {
			L.DomEvent.stopPropagation(<any> e);
			delayClick(() => {
				if (this._interceptClick()) return;
				const {lineIdx, idxTuple} = this.getIdxsFromEvent(e);

				if (this._closebyPointIdxTuple && this._pointLTShiftMode && this._pointCanBeShiftedTo(this._closebyPointIdxTuple)) {
					const [closebyLineIdx, closebySegmentIdx] = this._closebyPointIdxTuple;
					this.commitLTPointShift([closebySegmentIdx === 0 ? closebyLineIdx : closebyLineIdx + 1, 0]);
					return;
				}
				if (this._selectLTMode) {
					this._hoveredIdxTuple = undefined;
					if (this._onSelectLT) this._onSelectLT(idxTuple);
				} else {
					this._triggerEvent(this._getOnActiveSegmentChangeEvent(lineIdx), this._onLTChange);
					this._updateLTTooltip();
				}
			});
		}).on("mouseover", onMouseOver)
			.on("mouseout", onMouseOut);

		this.map.on("mousemove", ({latlng}: L.LeafletMouseEvent) => {
			if (this._splitIdxTuple
				|| this._firstLTSegmentToRemoveIdx
				|| this._selectLTMode
				|| this.map.contextmenu.isVisible()
			) {
				return;
			}
			const closestPoint: L.CircleMarker =
				<L.CircleMarker> L.GeometryUtil.closestLayer(this.map, this._allPoints, latlng).layer;
			const {idxTuple} = this.getIdxsFromLayer(closestPoint);
			const idxTupleStr = idxTuple ? idxTupleToIdxTupleStr(idxTuple) : undefined;
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
					layer.remove();
					(<any> this)._updateContextMenu && (<any> this)._updateContextMenu();
				}
				if (this._closebyPointIdxTuple) {
					this._LTPointExpander = new L.CircleMarker(closestPoint.getLatLng(), {
						radius: POINT_DIST_TRESHOLD,
						opacity: 0,
						fillOpacity: 0
					})
						.addTo(this.map)
						.bringToBack();
					this.map.contextmenu.removeAllItems();
					this._getContextMenuForPoint(this._closebyPointIdxTuple).contextmenuItems
						.forEach(item => this.map.contextmenu.addItem(item));
					const layer = this._getLTLayerForIdxTuple(this._pointLayers, this._closebyPointIdxTuple);
					if (layer && this.map.hasLayer(layer)) layer.bringToFront();
					if (this._LTdragPoint) this._LTdragPoint.bringToFront();
				}
				[prevClosestPointIdxTuple, this._closebyPointIdxTuple].forEach(_idxTuple => {
					if (!_idxTuple) return;
					const layers = this._layerExistsForIdxTuple(this._pointLayers, _idxTuple)
						? [this._getLTLayerForIdxTuple(this._pointLayers, _idxTuple)]
						: [];
					const overlappingNonadjacentIdxTuple = this._overlappingNonadjacentPointIdxTuples[idxTupleStr];
					const overlappingAdjacentIdxTuple = this._overlappingAdjacentPointIdxTuples[idxTupleStr];
					if (overlappingNonadjacentIdxTuple) {
						layers.push(this._getLTLayerForIdxTuple(this._pointLayers, overlappingNonadjacentIdxTuple));
					} else if (overlappingAdjacentIdxTuple) {
						layers.push(this._getLTLayerForIdxTuple(this._pointLayers, overlappingAdjacentIdxTuple));
					}
					layers.forEach(layer => layer && this._setStyleForLTLayer(layer));
				});
				this._updateLTTooltip();
			}
		}).on("click", (e: L.LeafletMouseEvent) => {
			L.DomEvent.stopPropagation(<any> e);
			if (this._closebyPointIdxTuple && this._pointLTShiftMode) {
				this._getPoint(this._closebyPointIdxTuple, (idxTuple) => this.commitLTPointShift(idxTuple));
			}
		}).on("dblclick", (e: L.LeafletMouseEvent) => {
			L.DomEvent.stopPropagation(<any> e);
			if (this._closebyPointIdxTuple) {
				clearTimeout(this._LTClickTimeout);
				this._disableDblClickZoom = true;
				this._getPoint(this._closebyPointIdxTuple, (idxTuple) => this._setLTPointEditable(idxTuple));
				setTimeout(() => {
					this._disableDblClickZoom = false;
				}, 10);
			}
		}).on("contextmenu.show", (e: any) => {
			if (e.relatedTarget) this._LTContextMenuLayer = e.relatedTarget;
		}).on("contextmenu.hide", () => {
			const {lineIdx} = this.getIdxsFromLayer(this._LTContextMenuLayer) || <LineTransectIdx> {};
			if (lineIdx !== undefined) this._updateLTStyleForLineIdx(lineIdx);
		}).on("controlClick", () => {
			if (this._LTEditPointIdxTuple) {
				this._commitPointDrag();
			}
		});
	}

	@reflect()
	@dependsOn("lineTransect", "translations")
	_updateLTLayerContextMenus() {
		if (!depsProvided(this, "_updateLTLayerContextMenus", arguments)) return;

		this._pointLayers.forEach((points, lineIdx) => points.forEach((point, pointIdx) => {
			point.bindContextMenu(this._getContextMenuForPoint([lineIdx, pointIdx]));
		}));
	}

	_getContextMenuForPoint(idxTuple: PointIdxTuple): L.Contextmenu.Options {
		const [lineIdx, pointIdx] = idxTuple;
		if (!this._LTEditable) return {contextmenuItems: []};
		const contextmenuItems = [
			{
				text: this.translations.RemovePoint,
				callback: () => {
					this._getPoint(
						[lineIdx, pointIdx],
						_idxTuple => this.removeLTPoint(_idxTuple), "RemoveFirstOrLastPoint", "First", "Last"
					);
				},
				iconCls: "glyphicon glyphicon-remove-sign"
			},
			{
				text: this.translations.EditPoint,
				callback: () => {
					this._getPoint(
						[lineIdx, pointIdx],
						_idxTuple => this._setLTPointEditable(_idxTuple), "RemoveFirstOrLastPoint", "First", "Last"
					);
				},
				iconCls: "glyphicon glyphicon-remove-sign"
			}
		];

		if (this._pointCanBeShiftedTo([lineIdx, pointIdx])) {
			contextmenuItems.push({
				text: this.translations.ShiftPoint,
				callback: () => this.commitLTPointShift([lineIdx, pointIdx]),
				iconCls: "laji-map-line-transect-shift-point-glyph"
			});
		}

		return {
			contextmenuInheritItems: false,
			contextmenuItems
		};
	}

	// @param 'commit' can be an array of events that are triggered
	// at the same time as the event that this function triggers.
	removeLTPoint(idxTuple: PointIdxTuple, commit: boolean | LineTransectEvent[] = true) {
		const [lineIdx] = idxTuple;
		this._commitPointDrag();

		let events = [];
		const that = this;

		const prevFeature = this._formatLTFeatureOut();

		const precedingIdxTuple = this._getIdxTuplePrecedingPoint(idxTuple);
		const followingIdxTuple = this._getIdxTupleFollowingPoint(idxTuple);
		const [precedingLineIdx, precedingSegmentIdx] = precedingIdxTuple || <PointIdxTuple> [undefined, undefined];
		const [followingLineIdx, followingSegmentIdx] = followingIdxTuple || <PointIdxTuple> [undefined, undefined];

		let precedingSegment = precedingIdxTuple ? this._getLTLayerForIdxTuple(this._lineLayers, precedingIdxTuple) : undefined;
		let followingSegment = followingIdxTuple ? this._getLTLayerForIdxTuple(this._lineLayers, followingIdxTuple) : undefined;
		let precedingLine = this._lineLayers[precedingLineIdx];
		let followingLine = this._lineLayers[followingLineIdx];
		if (precedingLine === followingLine) {
			const start = (<L.LatLng[]> precedingSegment.getLatLngs())[0];
			const end = (<L.LatLng[]> followingSegment.getLatLngs())[1];
			precedingSegment.setLatLngs([start, end]);
			this._lineLayers[precedingLineIdx] = precedingLine.filter(l => l !== followingSegment);
			events = addMiddlePointRemoveEvent(events);
		} else if (precedingLine && !followingLine) {
			precedingLine.splice(precedingSegmentIdx, 1);
			events = addMiddlePointRemoveEvent(events);
		} else if (!precedingLine && followingLine) {
			followingLine.splice(followingSegmentIdx, 1);
			events = addMiddlePointRemoveEvent(events);
		} else if (precedingLine && followingLine) {
			const _precedingSegment = precedingLine[precedingSegmentIdx];
			const _followingSegment = followingLine[followingSegmentIdx];
			_precedingSegment.setLatLngs([
				<L.LatLngExpression> _precedingSegment.getLatLngs()[0],
				<L.LatLngExpression> _followingSegment.getLatLngs()[1]
			]);
			followingLine.splice(followingSegmentIdx, 1);
			this._lineLayers[precedingLineIdx] = [...precedingLine, ...followingLine];
			this._lineLayers.splice(followingLineIdx, 1);
			const feature = this._formatLTFeatureOut();
			events = [
				{
					type: "merge",
					idxs: [precedingLineIdx, followingLineIdx],
					feature,
					geometry: {type: "LineString", coordinates: feature.geometry.coordinates[precedingLineIdx]},
					prevFeature
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
			this.setLineTransectGeometry(this._formatLTFeatureOut().geometry, events);
			this._triggerEvent(events, this._onLTChange);
		} else {
			return events;
		}

		function addMiddlePointRemoveEvent(_events: LineTransectEvent[]) {
			const feature = that._formatLTFeatureOut();
			return [..._events, {
				type: "edit",
				idx: precedingLineIdx,
				feature,
				geometry: {type: "LineString", coordinates: feature.geometry.coordinates[precedingLineIdx]},
				prevFeature
			}];
		}
	}

	_setLTPointEditable(idxTuple: PointIdxTuple) {
		const [lineIdx, pointIdx] = idxTuple;
		if (!this._LTEditable || this._pointLTShiftMode) return;
		if (idxTuplesEqual(this._LTEditPointIdxTuple, [lineIdx, pointIdx])) return;

		if (this._LTEditPointIdxTuple !== undefined) {
			const [_lineIdx, _segmentIdx] = this._LTEditPointIdxTuple;
			const editableLayer = this._pointLayers[_lineIdx][_segmentIdx];
			editableLayer.setStyle(pointStyle);
			this._commitPointDrag();
		}

		const overlappingSeamPointIdx = this._overlappingAdjacentPointIdxTuples[idxTupleToIdxTupleStr([lineIdx, pointIdx])];
		if (overlappingSeamPointIdx) {
			const overlappingPoint = this._getLTLayerForIdxTuple(this._pointLayers, overlappingSeamPointIdx);
			overlappingPoint.remove();
		}

		this._LTEditPointIdxTuple = [lineIdx, pointIdx];
		this._featureBeforePointDrag = this._formatLTFeatureOut();

		if (pointIdx === undefined) {
			return;
		}
		const point = this._getLTLayerForIdxTuple(this._pointLayers, [lineIdx, pointIdx]);
		this._LTPointLatLngBeforeDrag = point.getLatLng();
		const style = {color: "#ff0000", opacity: 0.5, fillColor: "#ffffff", fillOpacity: 0.3};
		this._LTdragPoint = new L.CircleMarker(point.getLatLng(), {radius: POINT_DIST_TRESHOLD, ...style});
		this._LTdragPoint.addTo(this.map)
			.bringToFront()
			.on("mouseover", () => {
				this._hoveringDragPoint = true;
				this._LTdragPoint.setStyle(style);
				this._setStyleForLTLayer(point);
				this._hoveredIsMarker = true;
				this._updateLTTooltip();
			})
			.on("mouseout", () => {
				this._hoveringDragPoint = false;
				this._LTdragPoint.setStyle({...style, opacity: 0.3});
				this._setStyleForLTLayer(point);
				this._updateLTTooltip();
			})
			.on("remove", () => this._setStyleForLTLayer(point))
			.on("mousedown", this._startLTDragPointHandler)
			.on("mouseup", this._stopLTDragPointHandler);

		[pointIdx, pointIdx - 1].filter(i => i >= 0).forEach(idx => {
			const corridor = this._corridorLayers[lineIdx][idx];
			if (corridor) corridor.on("mousedown", this._startLTDragCorridorHandler);
		});
		this.map.on("mouseup", this._stopLTDragCorridorHandler);

		this._clearTooltipDescription();
		this._setStyleForLTLayer(point);
		[
			this._getIdxTuplePrecedingEditPoint(),
			this._getIdxTupleFollowingEditPoint()
		].filter(i => i)
			.map(_idxTuple => [this._lineLayers, this._corridorLayers].map(layers => {
				return layers === this._lineLayers
				? this._getLTLayerForIdxTuple(<L.Polyline<G.LineString>[][]> layers, _idxTuple)
				: this._getLTLayerForIdxTuple(<L.Polygon[][]> layers, _idxTuple);
			}))
			.forEach(layerPair => layerPair.forEach(layer => this._setStyleForLTLayer(layer)));

		this._updateLTTooltip();
	}

	_commitPointDrag() {
		if (!this._LTEditPointIdxTuple) return;

		this._stopLTDragPointHandler();
		const precedingIdxTuple = this._getIdxTuplePrecedingEditPoint();
		const followingIdxTuple = this._getIdxTupleFollowingEditPoint();
		this._LTEditPointIdxTuple = undefined;
		this._updateLTTooltip();
		const dragPointLatLng = this._LTdragPoint.getLatLng();
		this._LTdragPoint.remove();
		this._LTdragPoint = undefined;

		[precedingIdxTuple, followingIdxTuple].forEach(tuple => {
			if (tuple) {
				this._getLTLayerForIdxTuple(this._corridorLayers, tuple).off("mousedown").off("mouseup");
				this._updateLTStyleForIdxTuple(tuple);
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
					prevFeature: this._featureBeforePointDrag,
					idx: lineIdx,
					geometry: lineToGeoJSONLine(this._lineLayers[lineIdx])
				});
			}
		});

		this.setLineTransectGeometry(feature.geometry, events);

		this._triggerEvent(events, this._onLTChange);
		this.map.fire("lineTransect:pointdrag");
		this._updateLTTooltip();
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
			this._updateLTTooltip();
		});
	}

	_startLTDragPointHandler({latlng}: L.LeafletMouseEvent) {
		const [lineIdx, pointIdx] = this._LTEditPointIdxTuple;
		const point = this._pointLayers[lineIdx][pointIdx];
		this._dragPointStart = point.getLatLng();
		this._dragMouseStart = latlng;

		this._startLTDragHandler(this._dragLTPointHandler);
	}

	_stopLTDragPointHandler() {
		this._stopLTDragHandler(this._dragLTPointHandler);
	}

	_dragLTPointHandler({latlng}: L.LeafletMouseEvent) {
		if (!this._dragMouseStart) return;

		this._updateLTTooltip();

		const mouseMovedDistance = this._dragMouseStart.distanceTo(latlng);
		const mouseRotatedAngle = this._degreesFromNorth([this._dragMouseStart, latlng]);
		const offsetDragPoint = L.GeometryUtil.destination(this._dragPointStart, mouseRotatedAngle, mouseMovedDistance);
		this._dragLTHandler(offsetDragPoint);
	}

	_startLTDragCorridorHandler(e: L.LeafletMouseEvent) {
		const {latlng} = e;
		this._startLTDragHandler(this._dragLTCorridorHandler);

		const [lineIdx, pointIdx] = this._LTEditPointIdxTuple;
		const point = this._pointLayers[lineIdx][pointIdx];

		this._dragPointStart = point.getLatLng();
		this._dragMouseStart = latlng;
	}

	_stopLTDragCorridorHandler() {
		this._stopLTDragHandler(this._dragLTCorridorHandler);
		this._dragPointStart = undefined;
		this._dragMouseStart = undefined;
	}

	_dragLTCorridorHandler({latlng}: L.LeafletMouseEvent) {
		if (!this._dragMouseStart) return;
		const mouseMovedDistance = this._dragMouseStart.distanceTo(latlng);
		const mouseRotatedAngle = this._degreesFromNorth([this._dragMouseStart, latlng]);

		const offsetDragPoint = L.GeometryUtil.destination(this._dragPointStart, mouseRotatedAngle, mouseMovedDistance);
		this._dragLTHandler(offsetDragPoint);
	}

	_dragLTHandler(latlng: L.LatLng) {
		const idxs = this._LTEditPointIdxTuple;
		const [lineIdx, pointIdx] = idxs;

		const pointLayer = this._pointLayers[lineIdx];
		const point = pointLayer[pointIdx];

		const precedingIdxTuple = this._getIdxTuplePrecedingEditPoint();

		let precedingLine, precedingCorridor;
		if (precedingIdxTuple) {
			precedingLine = this._getLTLayerForIdxTuple(this._lineLayers, precedingIdxTuple);
			precedingCorridor = this._getLTLayerForIdxTuple(this._corridorLayers, precedingIdxTuple);
		}

		const followingIdxTuple = this._getIdxTupleFollowingEditPoint();

		let followingLine, followingCorridor;
		if (followingIdxTuple) {
			followingLine = this._getLTLayerForIdxTuple(this._lineLayers, followingIdxTuple);
			followingCorridor = this._getLTLayerForIdxTuple(this._corridorLayers, followingIdxTuple);
		}

		if (this._LTPointIdxTupleIsGroupFirstOrLast(idxs)) {
			const closestPoint: L.CircleMarker =
				<L.CircleMarker> L.GeometryUtil.closestLayer(this.map, this._allPoints.filter(p => p !== point), latlng).layer;
			const closestIdxTuple = this._pointIdsToIdxTuples[L.Util.stamp(closestPoint)];
			if (closestIdxTuple
				&& this._LTPointIdxTupleIsGroupFirstOrLast(closestIdxTuple)
				&& this._LTIdxTuplesAreFromSameGroup(idxs, closestIdxTuple)
			) {
				const precedingToClosest = this._getIdxTuplePrecedingPoint(closestIdxTuple);
				const followingToClosest = this._getIdxTupleFollowingPoint(closestIdxTuple);
				const closestPointPixelPoint = this.map.latLngToLayerPoint(closestPoint.getLatLng());
				const latLngPixelPoint = this.map.latLngToLayerPoint(latlng);
				if ((!precedingToClosest || !followingToClosest) && closestPointPixelPoint.distanceTo(latLngPixelPoint) <= 20) {
					latlng = closestPoint.getLatLng();
				}
			}
		}

		if (precedingIdxTuple) {
			const lineCoords = [precedingLine.getLatLngs()[0], latlng];
			precedingLine.setLatLngs(lineCoords);
			precedingCorridor.setLatLngs(this._getCorridorCoordsForLine(lineCoords));
		}

		const getFollowingLineCoords = () => [latlng, followingLine.getLatLngs()[1]];

		if (followingIdxTuple) {
			const lineCoords = getFollowingLineCoords();
			followingLine.setLatLngs(lineCoords);
			followingCorridor.setLatLngs(this._getCorridorCoordsForLine(lineCoords));
		}

		point.setLatLng(latlng);
		this._LTdragPoint.setLatLng(latlng);

		if (lineIdx === 0 && pointIdx === 0) {
			this._LTStartText.setLatLngs(this._getLTStartTextCoordinates(getFollowingLineCoords()));
		}
	}

	_getLTLayerForIdxTuple<T extends SegmentLayer>(layers: T[][], idxTuple: IdxTuple): T {
		const [lineIdx, segmentIdx] = idxTuple;
		return layers[lineIdx][segmentIdx];
	}

	_layerExistsForIdxTuple<T extends SegmentLayer>(layer: T[][], idxTuple: IdxTuple): T {
		const [lineIdx, segmentIdx] = idxTuple;
		return layer && layer[lineIdx] && layer[lineIdx][segmentIdx];
	}

	_getIdxTuplePrecedingPoint(idxTuple: PointIdxTuple): PointIdxTuple {
		const [lineIdx, pointIdx] = idxTuple;
		if (lineIdx === undefined || pointIdx === undefined) return undefined;
		const pointLayer = this._pointLayers[lineIdx];
		const point = pointLayer[pointIdx];

		let precedingLineIdx, precedingIdx = undefined;

		if (pointIdx - 1 >= 0) {
			precedingLineIdx = lineIdx;
			precedingIdx = pointIdx - 1;
		} else if (lineIdx - 1 >= 0) {
			const precedingLineLayer = this._lineLayers[lineIdx - 1];
			const endLatLng = <L.LatLng> precedingLineLayer[precedingLineLayer.length - 1].getLatLngs()[1];
			if (endLatLng.equals(point.getLatLng())) {
				precedingLineIdx = lineIdx - 1;
				precedingIdx = precedingLineLayer.length - 1;
			}
		}

		return precedingLineIdx !== undefined && precedingIdx !== undefined ? [precedingLineIdx, precedingIdx] : undefined;
	}

	_getIdxTuplePrecedingEditPoint(): PointIdxTuple {
		return this._LTEditPointIdxTuple
			? this._getIdxTuplePrecedingPoint(this._LTEditPointIdxTuple)
			: undefined;
	}

	_getIdxTupleFollowingPoint(idxTuple: PointIdxTuple): PointIdxTuple {
		const [lineIdx, pointIdx] = idxTuple;
		if (lineIdx === undefined || pointIdx === undefined) return undefined;

		const pointLayer = this._pointLayers[lineIdx];
		const point = pointLayer[pointIdx];

		let followingLineIdx, followingIdx = undefined;

		if (pointIdx < pointLayer.length - 1) {
			followingLineIdx = lineIdx;
			followingIdx = pointIdx;
		} else if (lineIdx + 1 <= this._lineLayers.length - 1) {
			const followingLineLayer = this._lineLayers[lineIdx + 1];
			const startLatLng = <L.LatLng> followingLineLayer[0].getLatLngs()[0];
			if (startLatLng.equals(point.getLatLng())) {
				followingLineIdx = lineIdx + 1;
				followingIdx = 0;
			}
		}

		return followingLineIdx !== undefined && followingIdx !== undefined ? [followingLineIdx, followingIdx] : undefined;
	}

	_getIdxTupleFollowingEditPoint(): PointIdxTuple {
		return this._LTEditPointIdxTuple
			? this._getIdxTupleFollowingPoint(this._LTEditPointIdxTuple)
			: undefined;
	}

	_degreesFromNorth(lineCoords: L.LatLngExpression[]): number {
		const latLngs = lineCoords.map(L.latLng).map(latlng => L.CRS.EPSG3857.project(latlng));

		// Line angle horizontally.
		const lineAngle = L.GeometryUtil.computeAngle(latLngs[0], latLngs[1]);

		// Line angle clockwise from north.
		return 90 - lineAngle;
	}

	_getCorridorCoordsForLine(lineCoords: L.LatLngExpression[]): [L.LatLng, L.LatLng, L.LatLng, L.LatLng] {
		const latLngs = lineCoords.map(L.latLng);
		const lineAngleFromNorth = this._degreesFromNorth(lineCoords);

		// Variables are named as if the line was pointing towards north.
		const SWCorner = L.GeometryUtil.destination(latLngs[0], lineAngleFromNorth - 90, LT_WIDTH_METERS);
		const NWCorner = L.GeometryUtil.destination(latLngs[1], lineAngleFromNorth - 90, LT_WIDTH_METERS);
		const SECorner = L.GeometryUtil.destination(latLngs[0], lineAngleFromNorth + 90, LT_WIDTH_METERS);
		const NECorner = L.GeometryUtil.destination(latLngs[1], lineAngleFromNorth + 90, LT_WIDTH_METERS);

		return [SWCorner, NWCorner, NECorner, SECorner];
	}

	_getOnActiveSegmentChangeEvent(lineIdx: number): LineTransectEvent {
		const prevIdx = this._LTActiveIdx;
		this._LTActiveIdx = lineIdx;
		[prevIdx, lineIdx].forEach(i => this._updateLTStyleForLineIdx(i));
		return {type: "active", idx: this._LTActiveIdx};
	}

	_getStyleForLTIdxTupleAndType(idxTuple: IdxTuple, type: Function): L.PathOptions {
		const [lineIdx, segmentIdx] = idxTuple;

		const isPoint = type === L.CircleMarker;
		const isActive =
			lineIdx === this._LTActiveIdx
			&& (!isPoint || (segmentIdx !== 0 && segmentIdx !== this._pointLayers[lineIdx].length - 1));
		const [hoveredLineIdx, hoveredSegmentIdx] = this._hoveredIdxTuple || <IdxTuple> [undefined, undefined];
		const contextMenuLineIdx = (this.getIdxsFromLayer(<SegmentLayer> this._contextMenuLayer)
			|| <LineTransectIdx> {}).lineIdx;
		const isEditPoint = isPoint && idxTuplesEqual(idxTuple, this._LTEditPointIdxTuple);
		const isHintPoint = isPoint && this._pointLTShiftMode && this._pointCanBeShiftedTo(idxTuple);
		const isClosebyPoint = isPoint
			&& idxTuplesEqual(idxTuple, this._closebyPointIdxTuple)
			&& (!this._pointLTShiftMode || (isHintPoint));
		const isFirstOverlappingEndOrStartPoint = isPoint && (
			(!this._overlappingNonadjacentPointIdxTuples["0-0"] && idxTuplesEqual(idxTuple, [0, 0])) ||
			(this._overlappingNonadjacentPointIdxTuples["0-0"]
				&& (
					Object.keys(this._overlappingNonadjacentPointIdxTuples)[0] === idxTupleToIdxTupleStr(idxTuple)
					|| idxTuplesEqual([0, 0], idxTuple)
				)
			)
		);
		const isOverlappingEndOrStartPoint = isPoint &&
			!isFirstOverlappingEndOrStartPoint &&
			this._overlappingNonadjacentPointIdxTuples.hasOwnProperty(idxTupleToIdxTupleStr(idxTuple));

		const isSeamPoint = isPoint
			&& this._overlappingAdjacentPointIdxTuples.hasOwnProperty(idxTupleToIdxTupleStr(idxTuple));

		const _isHover = lineIdx === hoveredLineIdx || lineIdx === contextMenuLineIdx;
		const isEdit = isPoint
			? isEditPoint
			: idxTuplesEqual(idxTuple, this._splitIdxTuple)
			|| idxTuplesEqual(idxTuple, this._firstLTSegmentToRemoveIdx)
			|| idxTuplesEqual(idxTuple, this._overlappingPointDialogSegmentIdxTuple)
			|| idxTuplesEqual(idxTuple, this._getIdxTuplePrecedingEditPoint())
			|| idxTuplesEqual(idxTuple, this._getIdxTupleFollowingEditPoint())
			|| (this._selectLTMode === "segment" && _isHover && segmentIdx === hoveredSegmentIdx)
			|| (this._selectLTMode === "line" && _isHover);
		const isHover = this._splitIdxTuple || this._firstLTSegmentToRemoveIdx || this._selectLTMode
			? false
			: isPoint
				? !isSeamPoint && !isOverlappingEndOrStartPoint && _isHover && !isActive
				: _isHover && !isActive;

		function createPrintStylesFor(styles: L.PathOptions): L.PathOptions {
			return Object.keys(styles).reduce((o, key) => {
				o[key] = {opacity: 0, fillOpacity: 0};
				return o;
			}, {});
		}

		const lineStyles: any = {
			normal: lineStyle,
			odd: lineStyle,
			active: activeLineStyle,
			edit: editLineStyle,
			hover: hoverLineStyle
		};
		lineStyles.print = createPrintStylesFor(lineStyles);
		lineStyles.print.normal = {weight: 1, color: "#000"};
		lineStyles.print.odd = {weight: 1, color: "#000"};

		const corridorStyles: any = {
			normal: corridorStyle,
			odd: oddCorridorStyle,
			active: activeCorridorStyle,
			edit: editCorridorStyle,
			hover: hoverCorridorStyle
		};
		corridorStyles.print = createPrintStylesFor(corridorStyles);

		const pointStyles: any = {
			normal: pointStyle,
			odd: oddPointStyle,
			active: activePointStyle,
			edit: editPointStyle,
			editPoint: editablePointStyle,
			hover: hoverPointStyle,
			closebyEdit: closebyEditPointStyle,
			closeby: closebyPointStyle,
			hint: hintPointStyle,
			seam: seamPointStyle,
			overlappingSeam: overlappingPointStyle,
			firstOverlappingSeam: firstOverlappingPointStyle
		};
		pointStyles.print = createPrintStylesFor(pointStyles);
		pointStyles.print.firstOverlappingSeam = {...firstOverlappingPointStyle, weight: 0};
		pointStyles.print.overlappingSeam = {...overlappingPointStyle, fillColor: "#f77", weight: 0};

		let styleObject = undefined;
		if (type === L.Polygon) {
			styleObject = corridorStyles;
		} else if (type === L.Polyline) {
			styleObject = lineStyles;
		} else if (type === L.CircleMarker) {
			styleObject = pointStyles;
		}
		if (this._LTPrintMode) {
			styleObject = styleObject.print;
		}

		if (isEditPoint && isClosebyPoint && this._LTEditable) {
			return styleObject.closebyEdit;
		} else if (isClosebyPoint && this._LTEditable) {
			return styleObject.closeby;
		} else if (isHintPoint) {
			return styleObject.hint;
		} else if (isEditPoint) {
			return styleObject.editPoint;
		} else if (isFirstOverlappingEndOrStartPoint) {
			return styleObject.firstOverlappingSeam;
		} else if (isOverlappingEndOrStartPoint) {
			return styleObject.overlappingSeam;
		} else if (isSeamPoint) {
			return styleObject.seam;
		} else if (isEdit && this._LTEditable) {
			return styleObject.edit;
		} else if (isHover && this._LTEditable) {
			return styleObject.hover;
		} else if (isActive && this._LTEditable) {
			return styleObject.active;
		} else {
			if (this._getLTFeatureStyle) {
				const style = this._getLTFeatureStyle({lineIdx, segmentIdx, type, style: styleObject.normal});
				if (style) return style;
			}
			return lineIdx % 2 === 0 ? styleObject.normal : styleObject.odd;
		}
	}

	_setStyleForLTLayer(layer: SegmentLayer) {
		const {lineIdx, segmentIdx} = this.getIdxsFromLayer(layer);
		layer.setStyle(this._getStyleForLTIdxTupleAndType([lineIdx, segmentIdx], layer.constructor));
	}

	_updateLTStyleForLineIdx(lineIdx: number) {
		if (lineIdx === undefined) return;
		this._corridorLayers[lineIdx].forEach(corridorLayer => {
			const {segmentIdx} = this.getIdxsFromLayer(corridorLayer);
			this._updateLTStyleForIdxTuple([lineIdx, segmentIdx]);
		});
	}

	_updateLTStyleForIdxTuple(idxTuple: IdxTuple) {
		const [lineIdx, segmentIdx] = idxTuple;
		if (this._LTPrintMode || lineIdx === undefined || segmentIdx === undefined) return;
		[this._lineLayers, this._corridorLayers, this._pointLayers].forEach(layerGroup => {
			if (layerGroup === this._pointLayers && segmentIdx === 0
				|| (this._pointLayers[lineIdx] && segmentIdx === this._pointLayers[lineIdx].length - 1)) return;
			const lineGroup = layerGroup[lineIdx] || [];
			const layer = lineGroup[segmentIdx];
			if (layer) this._setStyleForLTLayer(layer);
		});
	}

	_idxTupleToFlatIdx(idxTuple: IdxTuple) {
		const [lineIdx, segmentIdx] = idxTuple;
		if (lineIdx === undefined || segmentIdx === undefined) return undefined;
		return this.getIdxsFromLayer(this._lineLayers[lineIdx][segmentIdx]).i;
	}

	_commitLTLineSplit(idxTuple: SegmentIdxTuple, splitPoint: L.LatLng) {
		this.stopLTLineSplit();

		const prevFeature = this._formatLTFeatureOut();

		const [lineIdx, segmentIdx] = idxTuple;
		const splitLine = this._lineLayers[lineIdx][segmentIdx];

		const [start, end] = <L.LatLng[]> splitLine.getLatLngs();
		// Tail is the part prepending the split and head the following part.
		const splittedSegmentTail = [start, splitPoint];
		const splittedSegmentHead = [splitPoint, end];

		splitLine.setLatLngs(splittedSegmentTail);
		this._lineLayers[lineIdx].splice(segmentIdx + 1, 0, <L.Polyline<G.LineString>> L.polyline(splittedSegmentHead));

		const splittedLineTail = this._lineLayers[lineIdx].slice(0, segmentIdx + 1);
		const splittedLineHead = this._lineLayers[lineIdx].slice(segmentIdx + 1);
		this._lineLayers[lineIdx] = splittedLineTail;
		this._lineLayers.splice(lineIdx + 1, 0, splittedLineHead);

		const feature = this._formatLTFeatureOut();

		const events: LineTransectEvent[] = [
			{
				type: "edit",
				feature,
				prevFeature,
				idx: lineIdx,
				geometry: lineToGeoJSONLine(splittedLineTail)
			},
			{
				type: "insert",
				idx: lineIdx + 1,
				geometry: lineToGeoJSONLine(splittedLineHead),
				prevFeature,
			}
		];

		this.setLineTransectGeometry(feature.geometry, events);

		if (lineIdx < this._LTActiveIdx) {
			events.push(this._getOnActiveSegmentChangeEvent(this._LTActiveIdx + 1));
		}
		this._triggerEvent(events, this._onLTChange);

		this.map.fire("lineTransect:split");
	}

	_commitLTPointAdd(idxTuple: PointIdxTuple, splitPoint) {
		this.stopLTLineSplit();

		const prevFeature = this._formatLTFeatureOut();

		const [lineIdx, segmentIdx] = idxTuple;
		const splitLine = this._lineLayers[lineIdx][segmentIdx];

		const [start, end] = splitLine.getLatLngs();
		// Tail is the part prepending the split and head the following part.
		const splittedSegmentTail = [start, splitPoint];
		const splittedSegmentHead = [splitPoint, end];

		splitLine.setLatLngs(splittedSegmentTail);
		this._lineLayers[lineIdx].splice(segmentIdx + 1, 0, <L.Polyline<G.LineString>> L.polyline(splittedSegmentHead));

		const feature = this._formatLTFeatureOut();

		const events = [
			{
				type: "edit",
				feature,
				idx: lineIdx,
				geometry: lineToGeoJSONLine(this._lineLayers[lineIdx]),
				prevFeature
			},
		];

		this.setLineTransectGeometry(feature.geometry, events);
		this._triggerEvent(events, this._onLTChange);

		this.map.fire("lineTransect:pointadd");
	}

	stopLTLineSplit() {
		const lastLineCutIdx = this._splitIdxTuple;
		this._lineSplitFn = undefined;
		if (this._cutLine) this._cutLine.removeFrom(this.map);
		this._cutLine = undefined;
		this._lineCutIdx = undefined;
		this._splitIdxTuple = undefined;
		this.map.off("mousemove", this._mouseMoveLTLineSplitHandler);
		if (lastLineCutIdx) this._updateLTStyleForIdxTuple(lastLineCutIdx);
		this._disposeTooltip();
	}

	_mouseMoveLTLineSplitHandler({latlng}: any) {
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
		if (prevCutIdx) this._updateLTStyleForIdxTuple(prevCutIdx);
		if (this._splitIdxTuple) this._updateLTStyleForIdxTuple(this._splitIdxTuple);

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

	startLTLineSplitForIdx(idxTuple: SegmentIdxTuple) {
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

	startLTPointAddSplitForIdx(idxTuple: PointIdxTuple) {
		this._lineCutIdx = idxTuple;
		this._lineSplitFn = this._commitLTPointAdd;
		this.map.on("mousemove", this._mouseMoveLTLineSplitHandler);
		this._mouseMoveLTLineSplitHandler({latlng: this._mouseLatLng});
		this._createTooltip("SplitLineTooltip");
	}

	_LTPointIdxTupleIsGroupFirstOrLast(idxTuple: PointIdxTuple): boolean {
		const [lineIdx, segmentIdx] = idxTuple;
		const groupIdx = this._lineIdxsTupleStringsToLineGroupIdxs[lineIdx];
		const group = this._groupIdxsToLineIdxs[groupIdx];
		return !!(lineIdx === group[0] && segmentIdx === 0
			|| lineIdx === group[group.length - 1] && segmentIdx === this._pointLayers[lineIdx].length - 1);
	}

	_LTIdxTuplesAreFromSameGroup(idxTuple: IdxTuple, idxTuple2: IdxTuple): boolean {
		const [lineIdx, segmentIdx] = idxTuple;
		const [lineIdx2, segmentIdx2] = idxTuple2;
		return this._lineIdxsTupleStringsToLineGroupIdxs[lineIdx] === this._lineIdxsTupleStringsToLineGroupIdxs[lineIdx2];
	}

	_pointCanBeShiftedTo(idxTuple: PointIdxTuple): boolean {
		const [lineIdx, pointIdx] = idxTuple;
		return this._lineIdxsTupleStringsToLineGroupIdxs[lineIdx] === 0
			&& (pointIdx === 0 || pointIdx === this._pointLayers[lineIdx].length - 1);
	}

	startLTPointShift() {
		this._pointLTShiftMode = true;
		for (const _lineIdx of Object.keys(this._lineIdxsTupleStringsToLineGroupIdxs)) {
			const lineIdx = parseInt(_lineIdx);
			const groupIdx = this._lineIdxsTupleStringsToLineGroupIdxs[lineIdx];
			if (groupIdx === 0) {
				this._setStyleForLTLayer(this._getLTLayerForIdxTuple(this._pointLayers, [lineIdx, 0]));
				this._setStyleForLTLayer(this._getLTLayerForIdxTuple(
					this._pointLayers,
					[lineIdx, this._pointLayers[lineIdx].length - 1]
				));
			}
		}
		this._createTooltip("ShiftPointTooltip");
	}

	stopLTPointShift() {
		this._pointLTShiftMode = false;
		for (let _lineIdx of Object.keys(this._lineIdxsTupleStringsToLineGroupIdxs)) {
			const lineIdx = parseInt(_lineIdx);
			const groupIdx = this._lineIdxsTupleStringsToLineGroupIdxs[lineIdx];
			if (groupIdx === 0) {
				this._setStyleForLTLayer(this._getLTLayerForIdxTuple(this._pointLayers, [lineIdx, 0]));
				this._setStyleForLTLayer(this._getLTLayerForIdxTuple(
					this._pointLayers,
					[lineIdx, this._pointLayers[lineIdx].length - 1]
				));
			}
		}
		this._disposeTooltip();
	}

	commitLTPointShift(idxTuple: PointIdxTuple) {
		const [_lineIdx, pointIdx] = idxTuple;
		this.stopLTPointShift();

		let lineIdx = pointIdx === 0
			? _lineIdx
			: pointIdx === this._pointLayers[_lineIdx].length - 1
				? _lineIdx + 1
				: _lineIdx;

		let prevEnd = undefined;
		let idx = 0;
		for (let _idx in this._lineLayers) {
			idx = parseInt(_idx);
			const line = this._lineLayers[idx];
			const start = <L.LatLng> line[0].getLatLngs()[0];
			const end = line[line.length - 1].getLatLngs()[1];
			if (prevEnd && !start.equals(prevEnd)) {
				break;
			} else if (idx === this._lineLayers.length - 1) {
				idx = undefined;
			}
			prevEnd = end;
		}

		const connectedLines = this._lineLayers.slice(0, idx);
		const disconnectedLines = idx !== undefined
			? this._lineLayers.slice(idx, this._lineLayers.length)
			: [];

		const headLines = connectedLines.slice(0, lineIdx);
		const tailLines = connectedLines.slice(lineIdx, connectedLines.length);

		const prevFeature = this._formatLTFeatureOut();
		this._lineLayers = [...tailLines, ...headLines, ...disconnectedLines];

		const events = [];

		for (let i = lineIdx + tailLines.length - 1; i >= lineIdx; i--) {
			events.push({
				type: "move",
				idx: lineIdx + tailLines.length - 1,
				target: 0,
				prevFeature
			});
		}

		this.setLineTransectGeometry(this._formatLTFeatureOut().geometry, events);
		this._triggerEvent(events, this._onLTChange);
	}

	startSelectLTSegmentMode(onSelect, tooltip, mode: "segment" |  "line" = "segment") {
		this._selectLTMode = mode;
		this._onSelectLT = (idxTuple) => {
			if (onSelect(idxTuple) !== false) this.stopSelectLTSegmentMode(idxTuple);
		};
		if (tooltip) this._createTooltip(tooltip);
	}

	stopSelectLTSegmentMode(idxTuple: SegmentIdxTuple = [undefined, undefined]) {
		const [lineIdx, segmentIdx] = idxTuple;
		this._selectLTMode = undefined;
		this._onSelectLT = undefined;
		if (this._hoveredIdxTuple) this._updateLTStyleForIdxTuple(this._hoveredIdxTuple);
		if (lineIdx !== undefined && segmentIdx !== undefined) this._updateLTStyleForIdxTuple([lineIdx, segmentIdx]);
		this._disposeTooltip();
	}

	startRemoveLTPointMode() {
		this.startSelectLTSegmentMode(this.chooseFirstSegmentToConnect, "startLineConnectFirstPointHelp");
	}

	stopRemoveLTPointMode() {
		const _idxTuple = this._firstLTSegmentToRemoveIdx;
		this._firstLTSegmentToRemoveIdx = undefined;
		if (_idxTuple) this._updateLTStyleForIdxTuple(_idxTuple);
		this.stopSelectLTSegmentMode();
	}

	chooseFirstSegmentToConnect(idxTuple: SegmentIdxTuple): boolean {
		this._firstLTSegmentToRemoveIdx = idxTuple;
		this._updateLTStyleForIdxTuple(idxTuple);
		this.startSelectLTSegmentMode(this.chooseLastSegmentToConnectAndCommit, "startLineConnectLastPointHelp");
		return false;
	}

	chooseLastSegmentToConnectAndCommit(idxTuple: SegmentIdxTuple) {
		const [first, last] = [this._firstLTSegmentToRemoveIdx, idxTuple]
			.map(tuple => this._idxTupleToFlatIdx(tuple)).sort((a, b) => a - b);

		let timeout = undefined;
		let prevLatLng = undefined;
		for (let i = first; i <= last; i++) {
			const segment = this._allSegments[i];
			if (!prevLatLng) {
				prevLatLng = segment.getLatLngs()[1];
				continue;
			}
			if (!(<L.LatLng[]> segment.getLatLngs())[0].equals(prevLatLng)) {
				this._createTooltip("SegmentsMustBeOfSameLine", !!"error");
				if (timeout) clearTimeout(timeout);
				timeout = setTimeout(() => {
					if (!this._firstLTSegmentToRemoveIdx) return;
					this._createTooltip("startLineConnectLastPointHelp");
					timeout = undefined;
				}, 2000);
				return false;
			}
			prevLatLng = segment.getLatLngs()[1];
		}
		this._firstLTSegmentToRemoveIdx = undefined;

		const flatIdxToIdxTuple = (idx): SegmentIdxTuple => {
			return (idx === undefined) ? undefined : this.getIdxsFromLayer(this._allSegments[idx]).idxTuple;
		};

		let i = last;
		let events = [];
		while (i !== first) {
			const _events = this.removeLTPoint(flatIdxToIdxTuple(i), i === first + 1 ? events : false);
			if (_events) {
				events = [...events, ..._events];
			}
			i--;
		}
	}

	splitLTByMeters() {
		const splitByMeters = (e) => {
			e.preventDefault();

			const value = parseInt(input.value);

			let distance = 0;
			let distanceLessThanLength;
			let currentSegmentIdx = 0;
			let currentLineIdx = 0;
			let currentSegment;
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
			this._commitLTLineSplit([currentLineIdx, currentSegmentIdx], splitPoint);
			if (this._selectLTMode) this.stopSelectLTSegmentMode();
			this._closeDialog(e);
		};

		const translateHooks = [];
		const container = document.createElement("form");

		const feature = this._formatLTFeatureOut();
		const [start, length] = getLineTransectStartEndDistancesForIdx(feature, 99999); // eslint-disable-line no-unused-vars

		const help = document.createElement("span");
		help.className = "help-block";
		translateHooks.push(this.addTranslationHook(help, () => `${this.translations.SegmentSplitByLengthHelp}: ${length}m`));

		const input = createTextInput();
		input.className += " form-group";

		let prevVal = "";
		input.oninput = (e: Event) => {
			const target = <HTMLInputElement> e.target;
			target.value = target.value.replace(",", ".");
			if (!target.value.match(/^\d*\.?\d*$/)) {
				target.value = prevVal;
			}
			prevVal = target.value;

			if (target.value === "" || parseInt(target.value) < 0 || parseInt(target.value) > length) {
				submit.setAttribute("disabled", "disabled");
			} else {
				submit.removeAttribute("disabled");
			}
		};

		const submit = document.createElement("button");
		submit.setAttribute("type", "submit");
		submit.className = "btn btn-block btn-primary";
		translateHooks.push(this.addTranslationHook(submit, "SplitWholeLine"));
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

	// Computes the messages to display.
	_updateLTTooltip() {
		if (!this._LTEditable) return;

		const messages: TooltipMessages = {
			text: undefined,
			click: undefined,
			dblclick: undefined,
			rightclick: undefined,
			drag: undefined
		};

		const hoveredIdxTuple = this._hoveredIdxTuple || this._hoveringDragPoint && this._LTEditPointIdxTuple;
		if (hoveredIdxTuple) {
			messages.text = this._getTooltipForPointIdxTuple(this._hoveredIdxTuple ? L.Marker : L.Polygon, hoveredIdxTuple);
		}

		if (this._LTEditPointIdxTuple) {
			if (this._hoveringDragPoint || this._editCorridorHovered || this._dragPointStart) {
				messages.drag = this.translations.toMovePoint;
			}
			if (!this._hoveringDragPoint && !this._editCorridorHovered) {
				messages.click = this.translations.toCommitEdit;
			}
		} else if (this._hoveredIdxTuple) {
			messages.click = this.translations.toActivate;
		}

		if (this._closebyPointIdxTuple) {
			messages.dblclick = this.translations.toEditPoint;
			messages.rightclick = this.translations.toDeletePoint;
		}
		this.__updateLTTooltip(messages);

		if (hoveredIdxTuple && this._getLTTooltip) {
			const [lineIdx] = hoveredIdxTuple;
			this._tooltipIdx = lineIdx;
			const result = this._getLTTooltip(lineIdx, messages.text, (callbackText) => {
				if (this._tooltipIdx === lineIdx) this.__updateLTTooltip({text: callbackText});
			});
			if (result !== undefined && typeof result !== "function") {
				this.__updateLTTooltip({text: result});
			}
		}
	}

	// Displays the given messages.
	__updateLTTooltip(messages: TooltipMessages) {
		let message = "";
		if (this._tooltip && this._tooltip !== this._ltTooltip) return;

		this.messages = {...this.messages, ...messages};
		const order = ["text", "drag", "click", "dblclick", "rightclick"];
		Object.keys(this.messages)
			.sort((a, b) => order.indexOf(a) - order.indexOf(b))
			.forEach(key => {
				if (this.messages[key]) {
					const prefix = message ? "<br />" : "";
					const actionTranslation = this.translations[capitalizeFirstLetter(key)];
					const actionText = actionTranslation ? `<b>${actionTranslation}</b> ` : "";
					message += `${prefix}${actionText}${this.messages[key]}`;
				}
			});

		if (message && !this._ltTooltip) {
			this._ltTooltip = this._createTooltip(message);
		} else if (message) {
			this._ltTooltip.updateContent({text: message});
		} else {
			this._disposeTooltip();
			this._ltTooltip = undefined;
		}
	}

	_setLTPrintLines() {
		if (!this._LTPrintMode) {
			return;
		}

		let nonusedDist = 0;
		let counter = 0;
		this._allSegments.forEach((segment, i) => {
			let lengths = i === 0 ? [0] : [];
			let [start, end] = <L.LatLng[]> segment.getLatLngs();
			const segmentLength = start.distanceTo(end);
			let _segmentLength = segmentLength;
			while (_segmentLength + nonusedDist > 100) {
				const length = 100 - nonusedDist;
				_segmentLength -= length;
				lengths.push(length);
				nonusedDist = 0;
			}
			nonusedDist = lengths.reduce((total, l) => total - l, segmentLength + nonusedDist);

			const lineAngleFromNorth = this._degreesFromNorth(<L.LatLng[]> segment.getLatLngs());
			let accumulatedLength = 0;
			lengths.forEach(length => {
				const major = counter === 0 || counter % 5 === 0;
				accumulatedLength += length;
				const lineCenter = L.GeometryUtil.destination(
					(<L.LatLng[]> segment.getLatLngs())[0],
					lineAngleFromNorth,
					accumulatedLength
				);
				const lineStart = L.GeometryUtil.destination(
					lineCenter,
					lineAngleFromNorth - 90,
					(major ? 2 : 1) * LT_WIDTH_METERS
				);
				const lineEnd = L.GeometryUtil.destination(lineCenter, lineAngleFromNorth + 90, (major ? 2 : 1) * LT_WIDTH_METERS);
				L.polyline([lineStart, lineEnd], {color: "#000", weight: 1}).addTo(this.map);
				counter++;
			});
		});

		this._allPoints[0].bringToFront();
	}
} return LajiMapWithLineTransect; } // tslint:disable-line
