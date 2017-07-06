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

	let validator = undefined;
	if (from === "EPSG:2393") {
		validator = ykjValidator;
	} else if (from === "EPSG:2393") {
		validator = etrsTm35FinValidator;
	}
	if (validator && validator.formatter) latlng = latlng.map(c => `${c}`).map((c, i) => +validator[i].formatter(c));

	const converted = proj4(formatToProj4Format(from), formatToProj4Format(to), reverseCoordinate(latlng));
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

	return _updater(parseJSON(JSON.stringify(obj)));
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
		return geoJSONCoordsJoin(_coords);
	}

	function geometryConverterFn(geometry) {
		switch (geometry.type) {
		case "GeometryCollection": return geometry.geometries.reduce((collStr, _geom) => `${collStr}${geometryConverterFn(_geom)}\n`, "");
		case "Point": return coordinateStrToPoint(geoJSONCoordToTextual(geometry.coordinates));
		case "LineString": return coordinateStrToLine(geoJSONCoordsJoin(geometry.coordinates));
		case "Polygon": {
			if (geometry.coordinates.length > 1) throw new Error(`${name} doesn't support polygons with interior rings.`);
			return coordinateStrToPolygon(geoJSONCoordsToTextualArea(geometry.coordinates[0]));
		}
		default: throw new Error(`Unknown geometry type ${geometry.type} for ${name} conversion`);
		}
	}

	function recursiveConvert(geometry, coordinateStr = "") {
		const reducer = (coordinateStr, geoObject) => {
			if (geoObject.features) {
				geoObject.features.forEach(feature => {
					coordinateStr += `${recursiveConvert(feature)}`;
				});
			} else if (geoObject.geometry) {
				coordinateStr += `${geometryConverterFn(geoObject.geometry)}\n`;
			} else if (geoObject.geometries) {
				geoObject.geometries.forEach(geometry => {
					coordinateStr += `${geometryConverterFn(geometry)}\n`;
				});
			} else if (geoObject.coordinates) {
				coordinateStr += `${geometryConverterFn(geoObject)}\n`;
			} else {
				throw new Error(`Ran into an unknown geoJSON object "${geoObject}"`);
			}
			return coordinateStr;
		};
		return (Array.isArray(geometry) ? geometry : [geometry]).reduce(reducer, coordinateStr);
	}

	return recursiveConvert(geoJSON).replace(/\n$/, "");
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

			if (detectCRSFromLatLng(latLng) !== "EPSG:2393") { // Don't add sign to YKJ.
				let sign = "+";
				if (coordHalfStr.includes("-")) {
					sign = "-";
					coordHalfStr = coordHalfStr.slice(1);
				}

				const numberPart = detectCRSFromLatLng(latLng) === "WGS84" ? fixWgs84Length(coordHalfStr, intAmount, 6) : coordHalfStr;
				coordHalfStr = `${sign}${numberPart}`;
			}

			return `${coordHalfStr}`;
		}

		const delimiter = (detectCRSFromLatLng(latLng) !== "EPSG:2393") ? "" : ":"; // Use ':' delimiter for YKJ.
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
		ISOGeo += `\nCRS${(projString === EPSG2393String) ? "EPSG:2393" : "EPSG:3067"}`;
	}

	return ISOGeo;
}

export function textualFormatToGeoJSON(text, lineToCoordinates, lineIsPolygon, lineIsLineString, lineIsPoint, crsPrefix) {
	const _lineToCoordinates = (line, idx) => {
		try  {
			const coords = lineToCoordinates(line);
			if (!coords || coords.length < 1 || coords.some(coord => coord.length < 2)) throw new LajiMapError("Coordinate parsing failed", "coordinateParsingError", {lineIx: idx});
			return coords;
		} catch (e) {
			throw new LajiMapError("Line coordinate parsing failed", "CoordinateParsingError", {lineIdx: idx});
		}
	};

	const features = text.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith(crsPrefix)).map((line, idx) => {
		if (lineIsPolygon(line)) {
			return {type: "Polygon", coordinates: [_lineToCoordinates(line, idx)]};
		} else if (lineIsLineString(line)) {
			return {type: "LineString", coordinates: _lineToCoordinates(line, idx)};
		} else if (lineIsPoint(line)) {
			return {type: "Point", coordinates: _lineToCoordinates(line, idx)[0]};
		} else {
			throw new LajiMapError(`Couldn't detect geo data line format. Line: ${idx + 1}`, "LineGeoDataFormatError", {lineIdx: idx});
		}
	}).map(geometry => {return {type: "Feature", properties: {}, geometry};});

	return {type: "FeatureCollection", features};
}

export function ISO6709ToGeoJSON(ISO6709) {
	function lineToCoordinates(line) {
		return line.split("/").filter(line => line).map(coordString => {
			return coordString.match(/-?\d+\.*\d*/g).map(number => +number).reverse();
		}
		);
	}

	function lineIsPolygon(line) {
		return line.match(/^\//);
	}

	function lineIsLineString(line) {
		const match = line.match(/.+\//g);
		return match && match.length > 1;
	}

	function lineIsPoint(line) {
		return line.match(/^(\+|-)?\d+\.?\d*(\+|-|:)?\d+\.?\d*\//);
	}

	return textualFormatToGeoJSON(ISO6709, lineToCoordinates, lineIsPolygon, lineIsLineString, lineIsPoint, "CRS");
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

	let WKTGeo = geoJSONToTextualFormatWith(geoJSON, "ISO 6709", latLngToWKTString, coordinateJoiner, coordinateStrToPoint, coordinateStrToLine, coordinateStrToPolygon);


	if (geoJSON.crs) {
		const projString = geoJSON.crs.properties.name;
		WKTGeo += "\n" + ((projString === EPSG2393String) ? EPSG2393WKTString : EPSG3067WKTString);
	}

	return WKTGeo;
}

export function WKTToGeoJSON(WKT) {
	function lineToCoordinates(line) {
		return line.match(/.+\((.*)\)/)[1].split(",").map(spacedPair => spacedPair.split(" ").map(c => +c));
	}

	function lineIsPolygon(line) {
		return line.startsWith("POLYGON");
	}
	function lineIsLineString(line) {
		return line.startsWith("LINESTRING");
	}
	function lineIsPoint(line) {
		return line.startsWith("POINT");
	}
	return textualFormatToGeoJSON(WKT, lineToCoordinates, lineIsPolygon, lineIsLineString, lineIsPoint, "PROJCS");
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

export function detectFormat(data) {
	if (typeof data === "string" && !data.match(/{.*}/) && data.includes("(")) {
		return "WKT";
	} else if (typeof data === "string" && !data.match(/{.*}/) && data.includes("/")) {
		return "ISO 6709";
	} else if (typeof data === "object" || typeof data === "string" && data.match(/{.*}/)) {
		return "GeoJSON";
	}
}

export function detectCRSFromLatLng(latLng) {
	if (latLng instanceof L.LatLng) {
		latLng = [latLng.lat, latLng.lng];
	}
	if (validateLatLng(latLng, wgs84Validator)) {
		return "WGS84";
	} else if (validateLatLng(latLng, ykjValidator)) {
		return "EPSG:2393";
	} else if (validateLatLng(latLng, etrsTm35FinValidator)) {
		return "EPSG:3067";
	}
}

export function detectCRS(data) {
	try {
		return detectCRSFromLatLng(data);
	} catch (e) {
		const format = detectFormat(data);
		let geoJSON = undefined;
		if (format === "WKT") {
			let detection = data.match(/(PROJCS.*)/);
			if (detection) {
				if (detection[1] === EPSG2393WKTString) return "EPSG:2393";
				else if (detection[1] === EPSG3067WKTString) return "EPSG:3067";
			} else {
				geoJSON = WKTToGeoJSON(data);
			}
		} else if (format === "ISO 6709") {
			const detection = data.match(/CRS(.*)/);
			if (detection) return detection[1];
			else {
				geoJSON = ISO6709ToGeoJSON(data);
			}
		} else if (typeof data === "object" || typeof data === "string" && data.match(/{.*}/)) {
			geoJSON = (typeof data === "object") ? data : parseJSON(data);
			if (geoJSON.crs) {
				const name = geoJSON.crs.properties.name;
				if (name === EPSG2393String) return "EPSG:2393";
				else if (name.includes("ETRS-TM35FIN")) return "EPSG:3067";
			}
		}

		if (geoJSON && geoJSON.features && geoJSON.features[0] && geoJSON.features[0].geometry && geoJSON.features[0].geometry.coordinates) {
			let coordinateSample = geoJSON.features[0].geometry.coordinates;
			while (Array.isArray(coordinateSample[0])) coordinateSample = coordinateSample[0];
			coordinateSample = coordinateSample.map(c => `${c}`).reverse();
			return detectCRSFromLatLng(coordinateSample);
		}
	}
}

export function convertAnyToWGS84GeoJSON(data) {
	return convert(data, "GeoJSON", "WGS84");
}

export function convert(input, outputFormat, outputCRS) {
	const inputFormat = detectFormat(input);
	const inputCRS = detectCRS(input);

	let geoJSON = undefined;
	if (inputFormat === "WKT") {
		geoJSON = WKTToGeoJSON(input);
	} else if (inputFormat === "ISO 6709") {
		geoJSON = ISO6709ToGeoJSON(input);
	} else if (inputFormat === "GeoJSON") {
		geoJSON = (typeof input === "object") ? input : parseJSON(input);
	} else {
		throw new LajiMapError("Couldn't detect geo data format", "GeoDataFormatDetectionError");
	}

	if (geoJSON && geoJSON.features && geoJSON.features.length > 0 && !inputCRS) {
		throw new LajiMapError("Couldn't detect geo data CRS", "GeoDataCRSDetectionError");
	}

	if (inputCRS !== outputCRS) geoJSON = convertGeoJSON(geoJSON, inputCRS, outputCRS);

	if (outputCRS !== "WGS84") geoJSON.crs = getCRSObjectForGeoJSON(geoJSON, outputCRS);

	switch (outputFormat) {
	case "WKT":
		return geoJSONToWKT(geoJSON);
	case "ISO 6709":
		return geoJSONToISO6709(geoJSON);
	case "GeoJSON":
		return geoJSON;
	default:
		throw new Error("Unknown output format");
	}
}

export function getCRSObjectForGeoJSON(geoJSON, crs) {
	return (!crs || crs === "WGS84") ? undefined : {
		type: "name",
		properties: {
			name: crs === "EPSG:2393" ? EPSG2393String : EPSG3067String
		}
	};
}

export class LajiMapError extends Error {
	constructor(message, translationKey, additional = {}) {
		super(message);
		this._lajiMapError = true;
		this.translationKey = translationKey;
		Object.keys(additional).forEach(key => this[key] = additional[key]);
	}
}

export function stringifyLajiMapError(error, translations) {
	let msg = `${translations.errorHTML} ${error.translationKey && translations[error.translationKey] ? translations[error.translationKey] : error.message}.`;
	if ("lineIdx" in error) msg  += ` ${translations.Line}: ${error.lineIdx}`;
	return msg;
}

export function parseJSON(json) {
	try {
		return JSON.parse(json);
	} catch (e) {
		throw new LajiMapError(e.message, "JsonParseError");
	}
}

const wgs84Check = {
	regexp: /^-?([0-9]{1,3}|[0-9]{1,3}\.[0-9]*)$/,
	range: [-180, 180]
};
const wgs84Validator = [wgs84Check, wgs84Check];

function formatterForLength(length) {
	return value => (value.length < length ? value + "0".repeat(length - value.length) : value);
}
const ykjRegexp = /^[0-9]{3,7}$/;
const ykjFormatter = formatterForLength(7);
const ykjValidator = [
	{regexp: ykjRegexp, range: [6600000, 7800000], formatter: ykjFormatter},
	{regexp: ykjRegexp, range: [3000000, 3800000], formatter: ykjFormatter}
];
const etrsTm35FinValidator = [
	{regexp: ykjRegexp, range: [6600000, 7800000], formatter: ykjFormatter},
	{regexp: /^[0-9]{3,6}$/, range: [50000, 760000], formatter: formatterForLength(6)}
];
const etrsValidator = etrsTm35FinValidator; // For backward compability

export {wgs84Validator, ykjValidator, etrsTm35FinValidator, etrsValidator};

export function validateLatLng(latlng, latLngValidator) {
	return latlng.every((value, i) => {
		value = `${value}`;
		const validator = latLngValidator[i];
		const formatted = +(validator.formatter ? validator.formatter(value) : value);
		return (
			value !== "" && value.match(validator.regexp) &&
			formatted >= validator.range[0] && formatted <= validator.range[1]
		);
	});
}

export function roundMeters(meters, accuracy = 1) {
	return Math.round(parseInt(meters) / accuracy) * accuracy;
}

export function createTextInput() {
	const input = document.createElement("input");
	input.type = "text";
	input.className = "form-control laji-map-input";
	return input;
}

export function createTextArea(rows = 10, cols = 10) {
	const input = document.createElement("textarea");
	input.setAttribute("rows", rows);
	input.setAttribute("cols", cols);
	input.className = "form-control laji-map-input";
	return input;
}
