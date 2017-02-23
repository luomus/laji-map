import { dependsOn, depsProvided, provide, reflect, isProvided } from "./map";
import "leaflet-geometryutil";

const lineStyle = {color: "#000", weight: 1};
const activeLineStyle = {...lineStyle, color: "#f0f"};
const corridorStyle = {...lineStyle, opacity: 0.5, weight: 0, fillColor: lineStyle.color};
const activeCorridorStyle = {...activeLineStyle, ...corridorStyle, fillColor: activeLineStyle.color};
const pointStyle = {color: "#fff", radius: 5, fillColor: "#ff0", fillOpacity: 0.7};
const editablePointStyle = {...pointStyle, fillColor: "#00f", color: "#00f"};

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
			this.startLTDragHandler = this.startLTDragHandler.bind(this);
			this.stopLTDragHandler = this.stopLTDragHandler.bind(this);
			this.dragLTHandler = this.dragLTHandler.bind(this);
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
					this.stopLTDragHandler();
					this.lineTransectEditIdx = undefined;

					const feature = this.formatLTFeatureOut();
					this.setLineTransectGeometry(feature.geometry);
					this._triggerEvent({type: "edit", feature}, this._onLTChange);

					return true;
				}
				return false;
			})();
		}

		dragLTHandler(e) {
			const idxs = parseIdxsFromLTIdx(this.lineTransectEditIdx);
			const lineIdx = +idxs[0];
			const pointIdx = +idxs[1];

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
				precedingLine.setLatLngs([precedingLine._latlngs[0], e.latlng]).openTooltip();
				precedingCorridor.removeFrom(this._corridorLayer);
				corridorLayer[precedingIdx] = this._getCorridorForLine(precedingLine._latlngs, precedingIdx)
					.addTo(this._corridorLayer);
			}

			if (followingIdx !== undefined && followingLine) {
				followingLine.setLatLngs([e.latlng, followingLine._latlngs[1]]).openTooltip();
				followingCorridor.removeFrom(this._corridorLayer);
				corridorLayer[followingIdx] = this._getCorridorForLine(followingLine._latlngs, followingIdx)
					.addTo(this._corridorLayer);
			}

			[precedingPoint, point, followingPoint].forEach(p => {
				if (p) p.bringToFront();
			})
		}

		startLTDragHandler() {
			this._LTDragging = true;
			this.map.dragging.disable();
			this.map.on("mousemove", this.dragLTHandler);
		}

		stopLTDragHandler() {
			// _interceptClick is triggered after mouseup - we delay drag stopping until map click is handled.
			setTimeout(() => {
				this._LTDragging = false;
				this.map.dragging.disable();
				this.map.dragging.enable();
				this.map.off("mousemove", this.dragLTHandler);
			}, 0);
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
				     .on("mousedown", this.startLTDragHandler)
				     .on("mouseup", this.stopLTDragHandler)
				     .bringToFront();

				this._pointLayers.forEach(points => points.forEach(point => {
					point.closeTooltip()
					     .unbindTooltip();
				}));
			}
		}

		_getCorridorForLine(lineCoords, idx) {
			const latLngs = lineCoords.map(L.latLng);

			// Line angle horizontally counter clockwise
			const lineAngle = L.GeometryUtil.computeAngle(...latLngs.map(
				latlng => this.map.options.crs.project(latlng)
			));

			// Line angle clockwise from north
			const lineAngleFromNorth = 90 - lineAngle;

			// Variables are named as if the line was pointing towards north.
			const SWCorner = L.GeometryUtil.destination(latLngs[0], lineAngleFromNorth - 90, 50);
			const NWCorner = L.GeometryUtil.destination(latLngs[1], lineAngleFromNorth - 90, 50);
			const SECorner = L.GeometryUtil.destination(latLngs[0], lineAngleFromNorth + 90, 50);
			const NECorner = L.GeometryUtil.destination(latLngs[1], lineAngleFromNorth + 90, 50);

			return L.polygon(
				[SWCorner, NWCorner, NECorner, SECorner],
				idx === this._activeLTIdx ? activeCorridorStyle : corridorStyle
			);
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
			let _segment = undefined;
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
					_segment = segment;
					_segmentI = segmentI;
					i++;
				});

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
								question.innerHTML = this.translations.FirstOrLastPoint;

								const firstButton = document.createElement("button");
								firstButton.addEventListener("click", () => {
									this._setLTPointEditable(_j, 0);
									lastPoint.closePopup();
								});
								firstButton.innerHTML = this.translations.FirstPartitive;

								const lastButton = document.createElement("button");
								lastButton.addEventListener("click", () => {
									this._setLTPointEditable(_j, __segmentI + 1);
									lastPoint.closePopup();
								});
								lastButton.innerHTML = this.translations.LastPartitive;

								const buttonContainer = document.createElement("div");
								buttonContainer.className = "btn-group";
								[firstButton, lastButton].forEach(button => {
									button.className = "btn btn-primary btn-xs";
									buttonContainer.appendChild(button);
								});

								popup.appendChild(question);
								popup.appendChild(buttonContainer);

								lastPoint.bindPopup(popup).openPopup();
							} else {
								this._setLTPointEditable(_j, __segmentI + 1);
							}
						})
				);
				j++;
			});

			const flattenedLineLayers = flattenMatrix(lineLayers);
			const flattenedCorridorLayers = flattenMatrix(corridorLayers);
			const flattenedPointLayers = flattenMatrix(pointLayers);

			this._lineLayer = L.layerGroup(flattenedLineLayers).addTo(this.map);
			this._corridorLayer = L.layerGroup(flattenedCorridorLayers).addTo(this.map);
			this._pointLayer = L.layerGroup(flattenedPointLayers).addTo(this.map);

			let _i = 0;
			lineLayers.forEach(lines => lines.forEach(line => {
				line.bindTooltip(`${_i}`, {permanent: true}).openTooltip();
				_i++;
			}));


			_i = 0;
			corridorLayers.forEach(corridors => corridors.forEach(corridor => {
				const __i = _i;
				corridor.on("click", () => {
					flattenedLineLayers[this._activeLTIdx].setStyle(lineStyle);
					flattenedLineLayers[__i].setStyle(activeLineStyle);
					flattenedCorridorLayers[this._activeLTIdx].setStyle(corridorStyle);
					flattenedCorridorLayers[__i].setStyle(activeCorridorStyle);
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

		setLineTransect(data) {
			let {feature, activeIdx, onChange} = data;
			this.LTFeature = feature;
			this._onLTChange = onChange;
			this._activeLTIdx = activeIdx;

			this.setLineTransectGeometry(feature.geometry);
		}

		formatLTFeatureOut() {
			function getCoordinatesFrom({lat, lng}) {
				return [lng, lat];
			}
			const allLines = flattenMatrix(this._lineLayers);

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
	}

}
