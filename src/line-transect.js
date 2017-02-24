import { dependsOn, depsProvided, provide, reflect } from "./map";
import "leaflet-geometryutil";
import { ESC } from "./globals";

const lineStyle = {color: "#000", weight: 1};
const hoverLineStyle = {...lineStyle, color: "#0ff"};
const activeLineStyle = {...lineStyle, color: "#f0f"};
const editLineStyle = {...lineStyle, color: "#f00"};
const corridorStyle = {...lineStyle, opacity: 0.5, weight: 0, fillColor: lineStyle.color};
const activeCorridorStyle = {...corridorStyle, fillColor: activeLineStyle.color};
const editCorridorStyle = {...corridorStyle, fillColor: editLineStyle.color};
const hoverCorridorStyle = {...corridorStyle, fillColor: hoverLineStyle.color};
const pointStyle = {color: "#fff", radius: 5, fillColor: "#ff0", fillOpacity: 0.7};
const editablePointStyle = {...pointStyle, fillColor: "#00f", color: "#00f"};

const LT_WIDTH_METERS = 50;

function flattenMatrix(m) {
	return m.reduce((flattened, array) => [...flattened, ...array], []);
}

function parseIdxsFromLTIdx(idx) {
	return idx ? idx.split("-").map(i => +i) : undefined;
}

export default function lineTransect(LajiMap) {
	return class LajiMapWithLineTransect extends LajiMap {

		constructor(props) {
			super(props);
			this._startLTDragPointHandler = this._startLTDragPointHandler.bind(this);
			this._stopLTDragPointHandler = this._stopLTDragPointHandler.bind(this);
			this._dragLTPointHandler = this._dragLTPointHandler.bind(this);
			this._mouseMoveLTLineCutHandler = this._mouseMoveLTLineCutHandler.bind(this);
			this.startLTLineSplit = this.startLTLineSplit.bind(this);
			this.stopLTLineCut = this.stopLTLineCut.bind(this);
			this.startRemoveLTSegmentMode = this.startRemoveLTSegmentMode.bind(this);
			this.stopRemoveLTSegmentMode = this.stopRemoveLTSegmentMode.bind(this);

			this._addKeyListener(ESC, () => {
				if (this.lineTransectEditIdx) {
					this._commitPointDrag();
					return true;
				} else if (this._lineCutting) {
					this.stopLTLineCut();
					return true;
				} else if (this._removeLTMode) {
					this.stopRemoveLTSegmentMode();
					return true;
				}
			});
		}

		setOption(option, value) {
			super.setOption(option, value);
			if (option === "lineTransect") {
				this.setLineTransect(value);
			}
		}

		_interceptClick() {
			return super._interceptClick() || (() => {
				if (this.lineTransectEditIdx !== undefined && !this._LTDragging) {
					this._commitPointDrag();
					return true;
				} else if (this._lineCutting) {
					this._executeLTLineCut();
				}
				return false;
			})();
		}

		setLineTransect(data) {
			let {feature, activeIdx, onChange} = data;
			this.LTFeature = feature;
			this._onLTChange = onChange;
			this._activeLTIdx = activeIdx;

			this.setLineTransectGeometry(feature.geometry);
		}

		// Formats this._allLines to a geoJSON feature.
		_formatLTFeatureOut() {
			function getCoordinatesFrom({lat, lng}) {
				return [lng, lat];
			}
			const allLines = this._allLines;

			const layerPairs = allLines.map((layer, i) => {
				const next = allLines[i + 1];
				return [layer, next];
			});

			const lines = [[]];
			layerPairs.forEach(pair => {
				const line = lines[lines.length - 1];
				line.push(getCoordinatesFrom(pair[0]._latlngs[0]));
				if (pair[1] && !pair[0]._latlngs[1].equals(pair[1]._latlngs[0])) {
					line.push(getCoordinatesFrom(pair[0]._latlngs[1]));
					lines.push([]);
				} else if (!pair[1]) {
					line.push(getCoordinatesFrom(pair[0]._latlngs[1]));
				}
			});

			// TODO we aren't checking for length of zero
			const isMulti = lines.length > 1;

			const geometry = {
				type: isMulti ? "MultiLineString" : "LineString",
				coordinates: isMulti ? lines : lines[0]
			};


			return {...this.LTFeature, geometry};
		}

		@dependsOn("map")
		setLineTransectGeometry(geometry) {
			if (!depsProvided(this, "setLineTransectGeometry", arguments)) return;

			function lineStringToSegments(lineString) {
				return lineString.map((c, i) => {
					const next = lineString[i + 1];
					if (next) return [c.slice(0).reverse(), next.slice(0).reverse()];
				}).filter(c => c);
			}

			const wholeLinesAsSegments = (geometry.type === "MultiLineString" ?
				geometry.coordinates : [geometry.coordinates]).map(lineStringToSegments);

			if (this._pointLayer) this.map.removeLayer(this._pointLayer);
			if (this._lineLayer) this.map.removeLayer(this._lineLayer);
			if (this._corridorLayer) this.map.removeLayer(this._corridorLayer);
			this._pointLayers = [];
			this._lineLayers = [];
			this._corridorLayers = [];

			const pointLayers = this._pointLayers;
			const lineLayers = this._lineLayers;
			const corridorLayers = this._corridorLayers;

			let i = 0;
			let j = 0;
			let _segmentI = undefined;
			wholeLinesAsSegments.forEach(wholeLineAsSegments => {
				const _j = j;
				[pointLayers, lineLayers, corridorLayers].forEach(layers => {
					layers.push([]);
				});
				const pointLayer = pointLayers[j];
				const lineLayer = lineLayers[j];
				const corridorLayer = corridorLayers[j];

				wholeLineAsSegments.forEach((segment, segmentI) => {
					const _i = i;

					lineLayer.push(L.polyline(segment, i === this._activeLTIdx ? activeLineStyle : lineStyle));

					pointLayer.push(
						L.circleMarker(segment[0], pointStyle)
							.on("dblclick", () => {this._setLTPointEditable(_j, segmentI)})
					);

					corridorLayer.push(this._getCorridorForLine(segment, _i));
					_segmentI = segmentI;
					i++;
				});

				const translateHooks = [];

				const __segmentI = _segmentI;
				pointLayer.push(
					L.circleMarker(wholeLineAsSegments[wholeLineAsSegments.length - 1][1], pointStyle)
						.on("dblclick", () => {
							const firstPoint = pointLayer[0];
							const lastPoint = pointLayer[pointLayer.length - 1];

							if (firstPoint.getLatLng().distanceTo(lastPoint.getLatLng()) <= 2) {
								const popup = document.createElement("div");
								popup.className = "text-center";

								const question = document.createElement("span");
								translateHooks.push(this.addTranslationHook(question, "FirstOrLastPoint"));

								const firstButton = document.createElement("button");
								firstButton.addEventListener("click", () => {
									this._setLTPointEditable(_j, 0);
									lastPoint.closePopup();
								});
								translateHooks.push(this.addTranslationHook(firstButton, "FirstPartitive"));

								const lastButton = document.createElement("button");
								lastButton.addEventListener("click", () => {
									this._setLTPointEditable(_j, __segmentI + 1);
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
								});
							} else {
								this._setLTPointEditable(_j, __segmentI + 1);
							}
						})
				);
				j++;
			});

			this._allLines = flattenMatrix(lineLayers);
			this._allCorridors = flattenMatrix(corridorLayers);
			this._allPoints = flattenMatrix(pointLayers);

			this._lineLayer = L.layerGroup(this._allLines).addTo(this.map);
			this._corridorLayer = L.layerGroup(this._allCorridors).addTo(this.map);
			this._pointLayer = L.layerGroup(this._allPoints).addTo(this.map);

			/** TODO multiple segments cumulate distance from the first segment (and also add the distance between
			 segments to the sum distance) - is this the right way? **/
			const distances = [];
			let distance = 0;
			let prevLatLng = undefined;
			pointLayers.forEach(points => points.forEach(point => {
				distance += prevLatLng ? point._latlng.distanceTo(prevLatLng) : 0;
				distances.push(distance);
				prevLatLng = point._latlng;
			}));

			let _i = 0;
			corridorLayers.forEach((corridors, lineIdx) => corridors.forEach((corridor, segmentI) => {
				const __i = _i;
				corridor.on("click", () => {
					if (this._removeLTMode) {
						this._hoveredLTLineIdx = undefined;
						this.commitRemoveLTSegment(__i);
					} else {
						this._triggerEvent(this._getOnActiveSegmentChangeEvent(__i), this._onLTChange);
					}
				}).on("mouseover", () => {
					const prevHoverIdx = this._hoveredLTLineIdx;
					this._hoveredLTLineIdx = __i;
					this._updateStyleForLTIdx(prevHoverIdx);
					this._updateStyleForLTIdx(this._hoveredLTLineIdx);
					this._pointLayers[lineIdx][segmentI + 1].bindTooltip(`${__i + 1}. (${parseInt(distances[__i  + 1])}m)`, {direction: "top"}).openTooltip();
				}).on("mouseout", () => {
					this._hoveredLTLineIdx = undefined;
					this._updateStyleForLTIdx(__i);
					this._pointLayers[lineIdx][segmentI + 1].closeTooltip().unbindTooltip();
				});
				_i++;
			}));

			provide(this, "lineTransect");
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
				]

				corridor.bindContextMenu({
					contextmenuInheritItems: false,
					contextmenuItems
				});
			})
		}

		_setLTPointEditable(lineIdx, segmentIdx) {
			if (this.lineTransectEditIdx !== undefined) {
				const prevIdxs = parseIdxsFromLTIdx(this.lineTransectEditIdx);
				const editableLayer = this._pointLayers[prevIdxs[0]][prevIdxs[1]];
				editableLayer.setStyle(pointStyle);
			}

			this.lineTransectEditIdx = `${lineIdx}-${segmentIdx}`;
			if (segmentIdx !== undefined) {
				const layer = this._pointLayers[lineIdx][segmentIdx];
				layer.setStyle(editablePointStyle)
					.on("mousedown", this._startLTDragPointHandler)
					.on("mouseup", this._stopLTDragPointHandler)
					.bringToFront();

				this._pointLayers.forEach(points => points.forEach(point => {
					point.closeTooltip()
						.unbindTooltip();
				}));
			}
		}

		_commitPointDrag() {
			this._stopLTDragPointHandler();
			this.lineTransectEditIdx = undefined;

			const feature = this._formatLTFeatureOut();
			this.setLineTransectGeometry(feature.geometry);
			this._triggerEvent({type: "edit", feature}, this._onLTChange);
		}


		_startLTDragPointHandler() {
			this._LTDragging = true;
			this.map.dragging.disable();
			this.map.on("mousemove", this._dragLTPointHandler);
		}

		_stopLTDragPointHandler() {
			// _interceptClick is triggered after mouseup - we delay drag stopping until map click is handled.
			setTimeout(() => {
				this._LTDragging = false;
				this.map.dragging.disable();
				this.map.dragging.enable();
				this.map.off("mousemove", this._dragLTPointHandler);
			}, 0);
		}

		_dragLTPointHandler(e) {
			const idxs = parseIdxsFromLTIdx(this.lineTransectEditIdx);
			const lineIdx = idxs[0];
			const pointIdx = idxs[1];

			const pointLayer = this._pointLayers[lineIdx];
			const lineLayer = this._lineLayers[lineIdx];
			const corridorLayer = this._corridorLayers[lineIdx];

			const point = pointLayer[pointIdx];
			point.setLatLng(e.latlng);

			let precedingIdx = pointIdx - 1 >= 0 ? pointIdx - 1 : undefined;
			let precedingLine, precedingCorridor, precedingPoint;
			if (precedingIdx !== undefined) {
				precedingLine = lineLayer[precedingIdx];
				precedingCorridor = corridorLayer[precedingIdx];
				precedingPoint = pointLayer[precedingIdx]
			}

			const followingIdx = pointIdx < pointLayer.length ? pointIdx : undefined;
			let followingLine, followingCorridor, followingPoint;
			if (followingIdx !== undefined) {
				followingLine = lineLayer[followingIdx];
				followingCorridor = corridorLayer[followingIdx];
				followingPoint = pointLayer[followingIdx + 1];
			}

			if (precedingIdx !== undefined) {
				precedingLine.setLatLngs([precedingLine.getLatLngs()[0], e.latlng]).openTooltip();
				precedingCorridor.removeFrom(this._corridorLayer);
				corridorLayer[precedingIdx] = this._getCorridorForLine(precedingLine.getLatLngs(), precedingIdx)
					.addTo(this._corridorLayer);
			}

			if (followingIdx !== undefined && followingLine) {
				followingLine.setLatLngs([e.latlng, followingLine.getLatLngs()[1]]).openTooltip();
				followingCorridor.removeFrom(this._corridorLayer);
				corridorLayer[followingIdx] = this._getCorridorForLine(followingLine.getLatLngs(), followingIdx)
					.addTo(this._corridorLayer);
			}

			[precedingPoint, point, followingPoint].forEach(p => {
				if (p) p.bringToFront();
			})
		}

		_degreesFromNorth(lineCoords) {
			const latLngs = lineCoords.map(L.latLng);

			// Line angle horizontally.
			const lineAngle = L.GeometryUtil.computeAngle(...latLngs.map(
				latlng => this.map.options.crs.project(latlng)
			));

			// Line angle clockwise from north.
			return 90 - lineAngle;
		}

		_getCorridorForLine(lineCoords, idx) {
			const latLngs = lineCoords.map(L.latLng);
			const lineAngleFromNorth = this._degreesFromNorth(lineCoords);

			// Variables are named as if the line was pointing towards north.
			const SWCorner = L.GeometryUtil.destination(latLngs[0], lineAngleFromNorth - 90, LT_WIDTH_METERS);
			const NWCorner = L.GeometryUtil.destination(latLngs[1], lineAngleFromNorth - 90, LT_WIDTH_METERS);
			const SECorner = L.GeometryUtil.destination(latLngs[0], lineAngleFromNorth + 90, LT_WIDTH_METERS);
			const NECorner = L.GeometryUtil.destination(latLngs[1], lineAngleFromNorth + 90, LT_WIDTH_METERS);

			return L.polygon(
				[SWCorner, NWCorner, NECorner, SECorner],
				idx === this._activeLTIdx ? activeCorridorStyle : corridorStyle
			);
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
			const isEdit = idx === this._cutLTIdx  || (this._removeLTMode && idx === this._hoveredLTLineIdx);
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
		}

		_executeLTLineCut() {
			const cutIdx = this._cutLTIdx;
			this.stopLTLineCut();

			const cutLine = this._allLines[cutIdx];
			const cutLineLatLng = cutLine.getLatLngs();
			cutLine.setLatLngs([cutLineLatLng[0], this._cutPoint]);
			this._allLines.splice(cutIdx + 1, 0, L.polyline([this._cutPoint, cutLineLatLng[1]]));

			const feature = this._formatLTFeatureOut();
			this.setLineTransectGeometry(feature.geometry);
			this._triggerEvent({type: "edit", feature}, this._onLTChange);
		}

		stopLTLineCut() {
			const lastLineCutIdx = this._cutLTIdx;
			this._lineCutting = false;
			if (this._cutLine) this._cutLine.removeFrom(this.map);
			this._cutLine = undefined;
			this._lineCutIdx = undefined;
			this._cutLTIdx = undefined;
			this.map.off("mousemove", this._mouseMoveLTLineCutHandler);
			this._updateStyleForLTIdx(lastLineCutIdx);
		}

		_mouseMoveLTLineCutHandler({latlng}) {
			const allLines = this._allLines;

			let closestLine, closestIdx;
			if (this._lineCutIdx !== undefined) {
				closestIdx = this._lineCutIdx;
				closestLine = allLines[closestIdx];
			} else {
				closestLine = L.GeometryUtil.closestLayer(this.map, allLines, latlng).layer;
				closestIdx = allLines.indexOf(closestLine);
			}

			const prevCutIdx = this._cutLTIdx;
			this._cutLTIdx = closestIdx;
			this._updateStyleForLTIdx(prevCutIdx);
			this._updateStyleForLTIdx(this._cutLTIdx);

			// Update cut line.
			const closestLatLngOnLine = L.GeometryUtil.closest(this.map, closestLine, latlng);
			this._cutPoint = closestLatLngOnLine;
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
			this.map.on("mousemove", this._mouseMoveLTLineCutHandler);
		}

		startLTLineSplitForIdx(idx) {
			this._lineCutting = true;
			this._lineCutIdx = idx;
			this.map.on("mousemove", this._mouseMoveLTLineCutHandler);
		}

		startRemoveLTSegmentMode() {
			this._removeLTMode = true;
		}

		stopRemoveLTSegmentMode() {
			this._removeLTMode = false;
			this._updateStyleForLTIdx(this._hoveredLTLineIdx);
		}

		commitRemoveLTSegment(i) {
			const events = [
				{type: "edit", feature},
			];
			if (i - 1 >= 0) {
				events.push(this._getOnActiveSegmentChangeEvent(i - 1));
			}

			this._allLines.splice(i, 1);
			const feature = this._formatLTFeatureOut();
			this.setLineTransectGeometry(feature.geometry);

			this._triggerEvent(events, this._onLTChange);
			this.stopRemoveLTSegmentMode();
		}
	}

}
