import proj4 from "proj4";
import {
	EPSG2393String,
	EPSG3067String,
	EPSG2393WKTString,
	EPSG3067WKTString
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

function updateImmutablyRecursivelyWith(obj, fn) {
	function _updater(obj, from, to) {
		if (typeof obj === "object" && obj !== null) {
			Object.keys(obj).forEach(key => {
				obj[key] = fn(key, obj[key]);
				_updater(obj[key], from, to);
			});
		}
		return obj;
	}

	return _updater(JSON.parse(JSON.stringify(obj)));
}

export function convertGeoJSON(geoJSON, from, to) {
	const convertCoordinates = coords => (typeof coords[0] === "number") ?
			convertLatLng(reverseCoordinate(coords), from, to) :
			coords.map(convertCoordinates);

	return updateImmutablyRecursivelyWith(geoJSON, (key, obj) => {
		if (key === "coordinates") obj = convertCoordinates(obj);
		return obj;
	});
}

/** Taken from https://github.com/arg20/circle-to-radius
 *  (Copied here because the library didn't act nice with exporting)
**/
function circleToPolygon(center, radius, numberOfSegments) {
	function toRadians(angleInDegrees) {
		return angleInDegrees * Math.PI / 180;
	}

	function toDegrees(angleInRadians) {
		return angleInRadians * 180 / Math.PI;
	}

	function offset(c1, distance, bearing) {
		var lat1 = toRadians(c1[1]);
		var lon1 = toRadians(c1[0]);
		var dByR = distance / 6378137; // distance divided by 6378137 (radius of the earth) wgs84
		var lat = Math.asin(
			Math.sin(lat1) * Math.cos(dByR) +
			Math.cos(lat1) * Math.sin(dByR) * Math.cos(bearing));
		var lon = lon1 + Math.atan2(
				Math.sin(bearing) * Math.sin(dByR) * Math.cos(lat1),
				Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat));
		return [toDegrees(lon), toDegrees(lat)];
	}

	var n = numberOfSegments ? numberOfSegments : 32;
	var flatCoordinates = [];
	var coordinates = [];
	for (let i = 0; i < n; ++i) {
		flatCoordinates.push.apply(flatCoordinates, offset(center, radius, 2 * Math.PI * i / n));
	}
	flatCoordinates.push(flatCoordinates[0], flatCoordinates[1]);

	for (let i = 0, j = 0; j < flatCoordinates.length; j += 2) {
		coordinates[i++] = flatCoordinates.slice(j, j + 2);
	}

	return {
		type: "Polygon",
		coordinates: [coordinates]
	};
}

export function standardizeGeoJSON(geoJSON) {

	function standardizeGeometry(geom) {
		let {coordinateVerbatim, radius, ...standardized} = geom; //eslint-disable-line
		if (radius !== undefined) {
			standardized = circleToPolygon(standardized.coordinates, radius, 8);
		}
		return standardized;
	}

	return updateImmutablyRecursivelyWith(geoJSON, (key, obj) => {
		if (key === "geometry") obj = standardizeGeometry(obj);
		return obj;
	});
}

export function geoJSONToTextualFormatWith(geoJSON, name, latLngCoordConverter, coordinateJoiner, coordinateStrToPoint, coordinateStrToLine, coordinateStrToPolygon) {
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
		case "Point": return coordinateStrToPoint(geoJSONCoordToTextual(geometry.coordinates));
		case "LineString": return coordinateStrToLine(geoJSONCoordsJoin(geometry.coordinates));
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

// Pads zeros to start of integer and end of decimal.
function fixWgs84Length(coordinateHalf, intLength, decLength) {
	const coordHalfStr = `${coordinateHalf}`;
	const parts = coordHalfStr.split(".");

	const integerPart = `${"0".repeat(intLength)}${parts[0]}`.slice(-intLength);
	const decimalPart = `${parts[1]}${"0".repeat(decLength)}`.slice(0, decLength);
	return `${integerPart}.${decimalPart}`;
}

export function geoJSONToISO6709(geoJSON) {
	function latLngToISO6709String(latLng) {
		function formatCoordHalf(coordHalf, intAmount) {
			let coordHalfStr = `${coordHalf}`;

			if (coordHalfStr.includes(".")) { // Detect WGS84
				let sign = "+";
				if (coordHalfStr.includes("-")) {
					sign = "-";
					coordHalfStr = coordHalfStr.slice(1);
				}

				coordHalfStr = `${sign}${fixWgs84Length(coordHalfStr, intAmount, 6)}`;
			}

			return `${coordHalfStr}`;
		}

		const delimiter = `${latLng[0]}`.includes(".") ? "" : ":";
		return `${formatCoordHalf(latLng[0], 2)}${delimiter}${formatCoordHalf(latLng[1], 3)}/`;
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

	let ISOGeo = geoJSONToTextualFormatWith(geoJSON, "ISO 6709", latLngToISO6709String, coordinateJoiner, coordinateStrToPoint, coordinateStrToLine, coordinateStrToPolygon);

	if (geoJSON.crs) {
		const projString = geoJSON.crs.properties.name;
		ISOGeo += `\CRS${(projString === EPSG2393String) ? "EPSG:2393" : "EPSG:3067"}`;
	}

	return ISOGeo;
}

export function geoJSONToWKT(geoJSON) {
	function latLngToWKTString(latLng) {
		function formatter(coordHalf) {
			return (`${coordHalf}`.includes(".")) ? fixWgs84Length(coordHalf, 6) : coordHalf;
		}
		return latLng.map(formatter).reverse().join(" ");
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

	let WKTGeo = geoJSONToTextualFormatWith(geoJSON, "ISO 6709", latLngToWKTString, coordinateJoiner, coordinateStrToPoint, coordinateStrToLine, coordinateStrToPolygon);


	if (geoJSON.crs) {
		const projString = geoJSON.crs.properties.name;
		WKTGeo += (projString === EPSG2393String) ? EPSG2393WKTString : EPSG3067WKTString;
	}

	return WKTGeo;
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
