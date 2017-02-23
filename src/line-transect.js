import { dependsOn, depsProvided, provide, reflect, isProvided } from "./map";
import "leaflet-geometryutil";

const lineStyle = {color: "#000", weight: 1};
const activeLineStyle = {...lineStyle, color: "#f0f"};
const editLineStyle = {...lineStyle, color: "#f00"};
const corridorStyle = {...lineStyle, opacity: 0.5, weight: 0, fillColor: lineStyle.color};
const activeCorridorStyle = {...corridorStyle, fillColor: activeLineStyle.color};
const editCorridorStyle = {...corridorStyle, fillColor: editLineStyle.color};
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
					this._stopLTDragPointHandler();
					this.lineTransectEditIdx = undefined;

					const feature = this._formatLTFeatureOut();
					this.setLineTransectGeometry(feature.geometry);
					this._triggerEvent({type: "edit", feature}, this._onLTChange);

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

			let _i = 0;
			lineLayers.forEach(lines => lines.forEach(line => {
				line.bindTooltip(`${_i}`, {permanent: true}).openTooltip();
				_i++;
			}));

			_i = 0;
			corridorLayers.forEach(corridors => corridors.forEach(corridor => {
				const __i = _i;
				corridor.on("click", () => {
					this._allLines[this._activeLTIdx].setStyle(lineStyle);
					this._allLines[__i].setStyle(activeLineStyle);
					this._allCorridors[this._activeLTIdx].setStyle(corridorStyle);
					this._allCorridors[__i].setStyle(activeCorridorStyle);
					this._activeLTIdx = __i;
					this._triggerEvent({type: "active", idx: this._activeLTIdx}, this._onLTChange);
				});
				_i++;
			}));

			/** TODO multiple segments cumulate distance from the first segment (and also add the distance between
			 segments to the sum distance) - is this the right way? **/
			let distance = 0;
			let prevLatLng = undefined;
			pointLayers.forEach(points => points.forEach(point => {
				distance += prevLatLng ? point._latlng.distanceTo(prevLatLng) : 0;
				if (distance) point.bindTooltip(`${parseInt(distance)}m`, {direction: "top"});
				prevLatLng = point._latlng;
			}));
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

		// Doesn't handle points.
		_getStyleForLTLayer(layer, idx) {
			const isActive = idx === this._activeLTIdx;
			if (layer instanceof L.Polygon) {
				return isActive ? activeCorridorStyle : corridorStyle;
			} else if (layer instanceof L.Polyline) {
				return isActive ? activeLineStyle : lineStyle;
			}
		}

		_executeLTLineCut() {
			this.stopLTLineCut();
			const cutIdx = this._cutIdx;

			[this._allLines, this._allCorridors].forEach(layerGroup => {
				layerGroup[cutIdx].setStyle(this._getStyleForLTLayer(layerGroup[cutIdx], cutIdx));
			});

			const cutLine = this._allLines[cutIdx];
			const cutLineLatLng = cutLine.getLatLngs();
			cutLine.setLatLngs([cutLineLatLng[0], this._cutPoint]);
			this._allLines.splice(cutIdx + 1, 0, L.polyline([this._cutPoint, cutLineLatLng[1]]));

			const feature = this._formatLTFeatureOut();
			this.setLineTransectGeometry(feature.geometry);
			this._triggerEvent({type: "edit", feature}, this._onLTChange);
		}

		stopLTLineCut() {
			this._lineCutting = false;
			this._cutLine.removeFrom(this.map);
			this._cutLine = undefined;
			this.map.off("mousemove", this._mouseMoveLTLineCutHandler);
		}

		_mouseMoveLTLineCutHandler({latlng}) {
			const allLines = this._allLines;
			const allCorridors = this._allCorridors;
			const prevClosestIdx = this._cutIdx;

			const closestLine = L.GeometryUtil.closestLayer(this.map, allLines, latlng).layer;
			const closestIdx = allLines.indexOf(closestLine);
			const closestCorridor = flattenMatrix(this._corridorLayers)[closestIdx];

			// Update closest style.
			if (prevClosestIdx && prevClosestIdx !== closestIdx) {
				allLines[prevClosestIdx].setStyle(this._getStyleForLTLayer(closestLine, prevClosestIdx));
				allCorridors[prevClosestIdx].setStyle(this._getStyleForLTLayer(closestCorridor, prevClosestIdx));
			}
			closestLine.setStyle(editLineStyle);
			closestCorridor.setStyle(editCorridorStyle);
			this._cutIdx = closestIdx;

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
	}

}
