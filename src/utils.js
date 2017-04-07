import proj4 from "proj4";
import {
	EPSG2393String,
	EPSG3067String,
} from "./globals";

export function reverseCoordinate(c) {
	return c.slice(0).reverse();
}

export function convertLatLng(latlng, from, to) {
	function formatToProj4Format(format) {
		switch(format) {
		case "EPSG:2393": return EPSG2393String;
		case "EPSG:3067": return EPSG3067String;
		default: return proj4.defs(format);
		}
	}

	const converted = proj4(formatToProj4Format(from), formatToProj4Format(to), reverseCoordinate(latlng.map(c => +c)));
	return (to === "WGS84") ? converted : converted.map(c => parseInt(c));
}

export function convertGeoJSON(obj, from, to) {
	function _convertGeoJSON(obj, from, to) {
		function convertCoordinates(coords) {
			if (typeof coords[0] === "number") {
				return convertLatLng(reverseCoordinate(coords), from, to);
			} else {
				return coords.map(convertCoordinates);
			}
		}

		if (typeof obj === "object" && obj !== null) {
			Object.keys(obj).forEach(key => {
				if (key === "coordinates") {
					obj[key] = convertCoordinates(obj[key]);
				}
				else _convertGeoJSON(obj[key], from, to);
			});
		}
		return obj;
	}

	return _convertGeoJSON(JSON.parse(JSON.stringify(obj)), from, to);
}

export function geoJSONToTextualFormatWith(geoJSON, name, latLngCoordConverter, coordinateJoiner, coordinateStrToPoint, coordinateStrToPolygon) {
	function geoJSONCoordToTextual(coords) {
		return latLngCoordConverter(reverseCoordinate(coords));
	}

	function geoJSONCoordsJoin(coords) {
		return coordinateJoiner(coords.map(geoJSONCoordToTextual));
	}

	function geoJSONCoordsToTextualArea(coords) {
		let _coords = coords.slice(0);
		_coords.pop();
		return geoJSONCoordsJoin(_coords);
	}

	function geometryConverterFn(geometry) {
		switch (geometry.type) {
		case "Circle":
		case "Point": return coordinateStrToPoint(geoJSONCoordToTextual(geometry.coordinates));
		case "LineString": return coordinateStrToPoint(geoJSONCoordsJoin(geometry.coordinates));
		case "Rectangle": return coordinateStrToPolygon(geoJSONCoordsJoin(geoJSONCoordsToTextualArea(geometry.coordinates)));
		case "Polygon": {
			if (geometry.coordinates.length > 1) throw new Error(`${name} doesn't support polygons with interior rings.`);
			return coordinateStrToPolygon(geoJSONCoordsToTextualArea(geometry.coordinates[0]));
		}
		default: throw new Error(`Unknown geometry type ${geometry.type} for ${name} conversion`);
		}
	}

	return geoJSON.features.reduce((coordinateStr, feature) => {
		if (!feature.geometry) {
			throw new Error(`Can't convert geoJSON feature without geometry to ${name}. Are you perhaps using nested feature collections? GeoJSON spec doesn't recommend using them.`);
		}
		coordinateStr += `${geometryConverterFn(feature.geometry)}\n`;
		return coordinateStr;
	}, "");
}

export function geoJSONToISO6709(geoJSON) {
	function latLngToISO6709String(latLng) {
		function formatCoordHalf(coordHalf, intAmount) {
			let coordHalfStr = `${coordHalf}`;
			let sign = "+";
			if (coordHalfStr.includes("-")) {
				sign = "-";
				coordHalfStr = coordHalfStr.slice(1);
			}

			if (coordHalfStr.includes(".")) { // Detect WGS84
				const parts = coordHalfStr.split(".");

				// Integer part length must be three, padded with prepended zeros.
				const integerPart = `${"0".repeat(intAmount)}${parts[0]}`.slice(-intAmount);

				// In our current domain the length of the decimal part of WGS84 is always more than 6.
				// If this changes in the future, should we make sure the length is always 6?
				const decimalPart = parts[1].slice(0,6);

				coordHalfStr = `${integerPart}.${decimalPart}`;
			}

			return `${sign}${coordHalfStr}`;
		}

		return `${formatCoordHalf(latLng[0], 2)}${formatCoordHalf(latLng[1], 3)}\\`;
	}

	function coordinateJoiner(coords) {
		return coords.join("");
	}

	function coordinateStrToPoint(coords) {
		return coords;
	}

	const coordinateStrToLine = coordinateStrToPoint;

	function coordinateStrToPolygon(coords) {
		return `/${coords}`;
	}

	return geoJSONToTextualFormatWith(geoJSON, "ISO 6709", latLngToISO6709String, coordinateJoiner, coordinateStrToPoint, coordinateStrToLine, coordinateStrToPolygon);
}

export function geoJSONToWKT(geoJSON) {
	function latLngToWKTString(latLng) {
		return latLng.reverse().join(" ");
	}
	function coordinateJoiner(coords) {
		return coords.join(",");
	}

	function coordinateStrToPoint(coords) {
		return `POINT(${coords})`;
	}

	function coordinateStrToLine(coords) {
		return `LINESTRING(${coords})`;
	}

	function coordinateStrToPolygon(coords) {
		return `POLYGON(${coords})`;
	}

	return geoJSONToTextualFormatWith(geoJSON, "ISO 6709", latLngToWKTString, coordinateJoiner, coordinateStrToPoint, coordinateStrToLine, coordinateStrToPolygon);
}


export function latLngSegmentsToGeoJSONGeometry(segments) {
	const segmentPairs = segments.map((segment, i) => {
		const next = segments[i + 1];
		return [segment, next];
	});

	const lines = [[]];
	segmentPairs.forEach(pair => {
		const line = lines[lines.length - 1];
		line.push(pair[0][0]);
		if (pair[1] && !L.latLng(pair[0][1]).equals(L.latLng(pair[1][0]))) {
			line.push(pair[0][1]);
			lines.push([]);
		} else if (!pair[1]) {
			line.push(pair[0][1]);
		}
	});

	// TODO we aren't checking for length of zero
	const isMulti = lines.length > 1;

	return {
		type: isMulti ? "MultiLineString" : "LineString",
		coordinates: isMulti ? lines : lines[0]
	};
}

export function geoJSONLineToLatLngSegmentArrays(geometry) {
	function lineStringToSegments(lineString) {
		return lineString.map((c, i) => {
			const next = lineString[i + 1];
			if (next) return [reverseCoordinate(c), reverseCoordinate(next)];
		}).filter(c => c);
	}
	return (geometry.type === "MultiLineString" ?
		geometry.coordinates : [geometry.coordinates]).map(lineStringToSegments);
}
