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
		validator = etrsValidator;
	}
	if (validator && validator.formatter) latlng = latlng.map(c => `${c}`).map((c, i) => +ykjValidator[i].formatter(c));

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

export function ISO6709ToGeoJSON(ISO) {
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
		return line.match(/^\d+.*\//g);
	}

	return textualFormatToGeoJSON(ISO, lineToCoordinates, lineIsPolygon, lineIsLineString, lineIsPoint, "CRS");
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
		return "ISO";
	} else if (typeof data === "object" || typeof data === "string" && data.match(/{.*}/)) {
		return "GeoJSON";
	}
}

export function detectCRS(data) {
	const format = detectFormat(data);
	let crs = undefined;
	let geoJSON = undefined;
	if (format === "WKT") {
		let detection = data.match(/(PROJCS.*)/);
		if (detection) {
			if (detection[1] === EPSG2393WKTString) crs = "EPSG:2393";
			else if (detection[1] === EPSG3067WKTString) crs = "EPSG:3067";
		} else {
			geoJSON = WKTToGeoJSON(data);
		}
	} else if (format === "ISO") {
		const detection = data.match(/CRS(.*)/);
		if (detection) crs = detection[1];
		else {
			geoJSON = ISO6709ToGeoJSON(data);
		}
	} else if (typeof data === "object" || typeof data === "string" && data.match(/{.*}/)) {
		geoJSON = (typeof data === "object") ? data : parseJSON(data);
		if (geoJSON.crs) {
			const name = geoJSON.crs.properties.name;
			if (name === EPSG2393String) crs = "EPSG:2393";
			else if (name === EPSG3067String) crs = "EPSG:3067";
		}
	}

	if (!crs && geoJSON && geoJSON.features && geoJSON.features[0] && geoJSON.features[0].geometry && geoJSON.features[0].geometry.coordinates) {
		let coordinateSample = geoJSON.features[0].geometry.coordinates;
		while (Array.isArray(coordinateSample[0])) coordinateSample = coordinateSample[0];
		coordinateSample = coordinateSample.map(c => `${c}`).reverse();
		if (validateLatLng(coordinateSample, wgs84Validator)) {
			crs = "WGS84";
		} else if (validateLatLng(coordinateSample, ykjValidator)) {
			crs = "EPSG:2393";
		} else if (validateLatLng(coordinateSample, etrsValidator)) {
			crs = "EPSG:3067";
		}
	}
	return crs;
}

export function convertAnyToWGS84GeoJSON(data) {
	return convert(data, "GeoJSON", "WGS84");
}

export function convert(input, outputFormat, outputCRS) {
	const inputFormat = detectFormat(input);
	const inputCRS = detectCRS(input);

	if (!inputCRS) {
		throw new LajiMapError("Couldn't detect geo data CRS", "GeoDataCRSDetectionError");
	}

	let geoJSON = undefined;
	if (inputFormat === "WKT") {
		geoJSON = WKTToGeoJSON(input);
	} else if (inputFormat === "ISO") {
		geoJSON = ISO6709ToGeoJSON(input);
	} else if (inputFormat === "GeoJSON") {
		geoJSON = (typeof input === "object") ? input : parseJSON(input);
	} else {
		throw new LajiMapError("Couldn't detect geo data format", "GeoDataFormatDetectionError");
	}

	if (inputCRS !== outputCRS) geoJSON = convertGeoJSON(geoJSON, inputCRS, outputCRS);

	if (outputCRS !== "WGS84") geoJSON.crs = getCRSObjectForGeoJSON(geoJSON, outputCRS);

	switch (outputFormat) {
	case "WKT":
		return geoJSONToWKT(geoJSON);
	case "ISO":
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
	return  value => (value.length < length ? value + "0".repeat(length - value.length) : value);
}
const ykjRegexp = /^[0-9]{3,7}$/;
const ykjFormatter = formatterForLength(7);
const ykjValidator = [
	{regexp: ykjRegexp, range: [6600000, 7800000], formatter: ykjFormatter},
	{regexp: ykjRegexp, range: [3000000, 3800000], formatter: ykjFormatter}
];
const etrsValidator = [
	{regexp: ykjRegexp, range: [6600000, 7800000], formatter: ykjFormatter},
	{regexp: /^[0-9]{3,6}$/, range: [50000, 760000], formatter: formatterForLength(6)}
];

export {wgs84Validator, ykjValidator, etrsValidator};

export function validateLatLng(latlng, latLngValidator) {
	return latlng.every((value, i) => {
		const validator = latLngValidator[i];
		const formatted = +(validator.formatter ? validator.formatter(value) : value);
		return (
		value !== "" && value.match(validator.regexp) &&
		formatted >= validator.range[0] && formatted <= validator.range[1]
		);
	});
}
