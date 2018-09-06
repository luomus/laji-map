import * as  proj4 from "proj4";
import {
	EPSG2393String,
	EPSG3067String,
	EPSG2393WKTString,
	EPSG3067WKTString
} from "./globals";
import * as G from "geojson";
import {LineTransectFeature, LineTransectGeometry} from "./line-transect.defs";

export function reverseCoordinate(c: [number, number]): [number, number] {
	return <[number, number]> c.slice(0).reverse();
}

export type CRSString = "WGS84" | "EPSG:2393" | "EPSG:3067";
export type CoordinateSystem = "GeoJSON" | "WKT" | "ISO 6709";

export function convertLatLng(latlng: [number, number], from: CRSString, to: CRSString) {
	function formatToProj4Format(format) {
		switch (format) {
		case "EPSG:2393": return EPSG2393String;
		case "EPSG:3067": return EPSG3067String;
		default: return proj4.defs(format);
		}
	}

	let validator = undefined;
	if (from === "EPSG:2393") {
		validator = ykjValidator;
	} else if (from === "EPSG:3067") {
		validator = etrsTm35FinValidator;
	}
	if (validator && validator.formatter) {
		latlng = <[number, number]> latlng.map(c => `${c}`).map((c, i) => +validator[i].formatter(c));
	}

	const converted = proj4(formatToProj4Format(from), formatToProj4Format(to), reverseCoordinate(latlng));
	return (to === "WGS84") ? converted : converted.map(c => parseInt(c));
}

function updateImmutablyRecursivelyWith(obj: any, fn: (key: string, value: any) => any): any {
	function _updater(_obj) {
		if (typeof _obj === "object" && _obj !== null) {
			Object.keys(_obj).forEach(key => {
				_obj[key] = fn(key, _obj[key]);
				_updater(_obj[key]);
			});
		}
		return obj;
	}

	return _updater(parseJSON(JSON.stringify(obj)));
}

export function convertGeoJSON(geoJSON: G.GeoJSON, from: CRSString, to: CRSString): G.GeoJSON {
	const convertCoordinates = coords => (typeof coords[0] === "number") ?
			convertLatLng(reverseCoordinate(coords), from, to) :
			coords.map(convertCoordinates);

	return updateImmutablyRecursivelyWith(geoJSON, (key, obj) => {
		if (key === "coordinates") obj = convertCoordinates(obj);
		return obj;
	});
}

/* Taken from https://github.com/arg20/circle-to-radius
 * (Copied here because the library didn't act nice with exporting)
 */
export function circleToPolygon(center, radius, numberOfSegments) {
	function toRadians(angleInDegrees) {
		return angleInDegrees * Math.PI / 180;
	}

	function toDegrees(angleInRadians) {
		return angleInRadians * 180 / Math.PI;
	}

	function offset(c1, distance, bearing) {
		var lat1 = toRadians(c1[1]); // tslint:disable-line
		var lon1 = toRadians(c1[0]); // tslint:disable-line
		// distance divided by 6378137 (radius of the earth) wgs84
		var dByR = distance / 6378137;// tslint:disable-line
		var lat = Math.asin( // tslint:disable-line
			Math.sin(lat1) * Math.cos(dByR) +
			Math.cos(lat1) * Math.sin(dByR) * Math.cos(bearing));
		var lon = lon1 + Math.atan2( // tslint:disable-line
				Math.sin(bearing) * Math.sin(dByR) * Math.cos(lat1),
				Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat));
		return [toDegrees(lon), toDegrees(lat)];
	}

	var n = numberOfSegments ? numberOfSegments : 32; // tslint:disable-line
	var flatCoordinates = []; // tslint:disable-line
	var coordinates = []; // tslint:disable-line
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

export function standardizeGeoJSON(geoJSON: G.GeoJSON): G.GeoJSON {

	function standardizeGeometry(geom) {
		let {coordinateVerbatim, radius, ...standardized} = geom;
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

export function geoJSONToTextualFormatWith(
		geoJSON: G.GeoJSON,
		name: string,
		latLngCoordConverter: (latlng: number[]) => string,
		coordinateJoiner: (latlng: number[]) => string,
		coordinateStrToPoint: (coordinate: string) => string,
		coordinateStrToLine: (coordinate: string) => string,
		coordinateStrToPolygon: (coordinate: string) => string): string {
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
		case "GeometryCollection":
				return geometry.geometries.reduce((collStr, _geom) => `${collStr}${geometryConverterFn(_geom)}\n`, "");
		case "Point":
				return coordinateStrToPoint(geoJSONCoordToTextual(geometry.coordinates));
		case "LineString":
				return coordinateStrToLine(geoJSONCoordsJoin(geometry.coordinates));
		case "Polygon": {
			if (geometry.coordinates.length > 1) throw new Error(`${name} doesn't support polygons with interior rings.`);
			return coordinateStrToPolygon(geoJSONCoordsToTextualArea(geometry.coordinates[0]));
		}
		default:
				throw new Error(`Unknown geometry type ${geometry.type} for ${name} conversion`);
		}
	}

	function recursiveConvert(geometry, coordinateStr = "") {
		const reducer = (_coordinateStr, geoObject) => {
			if (geoObject.features) {
				geoObject.features.forEach(feature => {
					_coordinateStr += `${recursiveConvert(feature)}`;
				});
			} else if (geoObject.geometry) {
				_coordinateStr += `${geometryConverterFn(geoObject.geometry)}\n`;
			} else if (geoObject.geometries) {
				geoObject.geometries.forEach(_geometry => {
					_coordinateStr += `${geometryConverterFn(_geometry)}\n`;
				});
			} else if (geoObject.coordinates) {
				_coordinateStr += `${geometryConverterFn(geoObject)}\n`;
			} else {
				throw new Error(`Ran into an unknown geoJSON object "${geoObject}"`);
			}
			return _coordinateStr;
		};
		return (Array.isArray(geometry) ? geometry : [geometry]).reduce(reducer, coordinateStr);
	}

	return recursiveConvert(geoJSON).replace(/\n$/, "");
}

// Pads zeros to start of integer and end of decimal.
function fixWgs84Length(coordinateHalf: string, intLength: number, decLength: number): string {
	const coordHalfStr = `${coordinateHalf}`;
	const parts = coordHalfStr.split(".");

	const integerPart = `${"0".repeat(intLength)}${parts[0]}`.slice(-intLength);
	const decimalPart = `${parts[1]}${"0".repeat(decLength)}`.slice(0, decLength);
	return `${integerPart}.${decimalPart}`;
}

export function geoJSONToISO6709(geoJSON: G.GeoJSON): string {
	function latLngToISO6709String(latLng) {
		function formatCoordHalf(coordHalf, intAmount) {
			let coordHalfStr = `${coordHalf}`;

			// Don't add sign to YKJ.
			if (detectCRSFromLatLng(latLng) === "EPSG:2393") {
				return coordHalfStr;
			}

			let sign = "+";
			if (coordHalfStr.indexOf("-") !== -1) {
				sign = "-";
				coordHalfStr = coordHalfStr.slice(1);
			}

			const numberPart = detectCRSFromLatLng(latLng) === "WGS84"
				? fixWgs84Length(coordHalfStr, intAmount, 6)
				: coordHalfStr;
			coordHalfStr = `${sign}${numberPart}`;

			return coordHalfStr;
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

	let ISOGeo = geoJSONToTextualFormatWith(
		geoJSON,
		"ISO 6709",
		latLngToISO6709String,
		coordinateJoiner,
		coordinateStrToPoint,
		coordinateStrToLine,
		coordinateStrToPolygon
	);

	if ((<any> geoJSON).crs) {
		const projString = (<any> geoJSON).crs.properties.name;
		ISOGeo += `\nCRS${(projString === EPSG2393String) ? "EPSG:2393" : "EPSG:3067"}`;
	}

	return ISOGeo;
}

function textualFormatToGeoJSON(
		text: string,
		lineToCoordinates: (line: string) => string[],
		lineIsPolygon: (line: string) => boolean,
		lineIsLineString: (line: string) => boolean,
		lineIsPoint: (line: string) => boolean,
		crsPrefix: string): G.GeoJSON {
	const _lineToCoordinates = (line, idx): number[] => {
		try  {
			const coords = lineToCoordinates(line);
			if (!coords || coords.length < 1 || coords.some(coord => coord.length < 2)) {
				throw new LajiMapError("Coordinate parsing failed", "coordinateParsingError", idx);
			}
			return coords.map(c => +c);
		} catch (e) {
			throw new LajiMapError("Line coordinate parsing failed", "CoordinateParsingError", idx);
		}
	};

	const features: G.Feature[] = <G.Feature[]> text
		.split("\n")
		.map(line => line.trim())
		.filter(line => line && !line.startsWith(crsPrefix))
		.map((line, idx) => {
			if (lineIsPolygon(line)) {
				return {type: "Polygon", coordinates: [_lineToCoordinates(line, idx)]};
			} else if (lineIsLineString(line)) {
				return {type: "LineString", coordinates: _lineToCoordinates(line, idx)};
			} else if (lineIsPoint(line)) {
				return {type: "Point", coordinates: _lineToCoordinates(line, idx)[0]};
			} else {
				throw new LajiMapError(`Couldn't detect geo data line format. Line: ${idx + 1}`, "LineGeoDataFormatError", idx);
			}
	}).map(geometry => ({type: "Feature", properties: {}, geometry}));

	return {type: "FeatureCollection", features};
}

export function ISO6709ToGeoJSON(ISO6709: string): G.GeoJSON {
	function lineToCoordinates(line) {
		return line.split("/").filter(l => l).map(coordString => {
			return coordString.match(/-?\d+\.?\d*/g).map(n => +n).reverse();
		});
	}

	function lineIsPolygon(line) {
		return line.match(/^\//);
	}

	function lineIsLineString(line) {
		const result = line.match(/^(.+(\+|-|:).+\/){2,}$/g);
		return result;
	}

	function lineIsPoint(line) {
		return line.match(/^(\+|-)?\d+\.?\d*(\+|-|:)\d+\.?\d*\/$/);
	}

	return textualFormatToGeoJSON(ISO6709, lineToCoordinates, lineIsPolygon, lineIsLineString, lineIsPoint, "CRS");
}

export function geoJSONToWKT(geoJSON: G.GeoJSON): string {
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
		return `POLYGON((${coords}))`;
	}

	let WKTGeo = geoJSONToTextualFormatWith(
		geoJSON,
		"ISO 6709",
		latLngToWKTString,
		coordinateJoiner,
		coordinateStrToPoint,
		coordinateStrToLine,
		coordinateStrToPolygon
	);

	if ((<any> geoJSON).crs) {
		const projString = (<any> geoJSON).crs.properties.name;
		WKTGeo += "\n" + ((projString === EPSG2393String) ? EPSG2393WKTString : EPSG3067WKTString);
	}

	return WKTGeo;
}

export function WKTToGeoJSON(WKT: string): G.GeoJSON {
	function lineToCoordinates(line) {
		return line.match(/.+\({1,2}([^\(\)]*)\){1,2}/)[1].split(",").map(spacedPair => spacedPair.split(" ").map(c => +c));
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

export function latLngOrTupleToTuple(latLng) {
	if (isObject(latLng)) {
		return [latLng.lat, latLng.lng];
	}
	return latLng;
}

export function latLngTuplesEqual(first, second) {
	return [0, 1].every(idx => first[idx] === second[idx]);
}

// Copy pasted from leaflet/src/geo/crs/CRS.Earth.js for headless usage.
// distance between two geographical points using spherical law of cosines approximation
function distance(latlng1, latlng2) {
	var rad = Math.PI / 180, // tslint:disable-line
		lat1 = latlng1.lat * rad,
		lat2 = latlng2.lat * rad,
		sinDLat = Math.sin((latlng2.lat - latlng1.lat) * rad / 2),
		sinDLon = Math.sin((latlng2.lng - latlng1.lng) * rad / 2),
		a = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon,
		c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	// return this.R * c;
	return 6371000 * c;
}

export function latLngTuplesDistance(first, second) {
	[first, second] = [first, second].map(([lat, lng]) => ({lat, lng}));
	return distance(first, second);
}

export function latLngSegmentsToGeoJSONGeometry(_lines): LineTransectGeometry {
	let lines: G.Position[][] = [];
	_lines.forEach(segments => {
		lines.push([]);
		const segmentPairs = segments.map((segment, i) => {
			const next = segments[i + 1];
			return [segment, next];
		});

		segmentPairs.forEach(pair => {
			const line = lines[lines.length - 1];
			const [first, last] = pair;
			line.push(first[0]);
			if (pair[1] && !latLngTuplesEqual(first[1], last[0])) {
				line.push(first[1]);
				lines.push([]);
			} else if (!last) {
				line.push(first[1]);
			}
		});
	});

	lines = lines.filter(line => line.length);

	// TODO we aren't checking for length of zero
	const isMulti = lines.length > 1;

	return isMulti ? {
		type: "MultiLineString",
		coordinates: lines
	} as G.MultiLineString : {
		type: "LineString",
		coordinates: lines[0]
	} as G.LineString;
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

export function detectFormat(data): CoordinateSystem {
	if (typeof data === "string" && !data.match(/{.*}/) && data.indexOf("(") !== -1) {
		return "WKT";
	} else if (typeof data === "string" && !data.match(/{.*}/) && data.indexOf("/") !== -1) {
		return "ISO 6709";
	} else if (typeof data === "object" || typeof data === "string" && data.match(/{.*}/)) {
		return "GeoJSON";
	}
}

export function detectCRSFromLatLng(latLng): CRSString {
	if (isObject(latLng) && latLng.lat && latLng.lng) {
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

export function detectCRS(data: string | G.GeoJSON): CRSString {
	try {
		return detectCRSFromLatLng(data);
	} catch (e) {
		const format = detectFormat(data);
		let geoJSON = undefined;
		if (format === "WKT") {
			data = <string> data;
			let detection = data.match(/(PROJCS.*)/);
			if (detection) {
				if (detection[1] === EPSG2393WKTString) return "EPSG:2393";
				else if (detection[1] === EPSG3067WKTString) return "EPSG:3067";
			} else {
				geoJSON = WKTToGeoJSON(data);
			}
		} else if (format === "ISO 6709") {
			data = <string> data;
			const detection = data.match(/CRS(.*)/);
			if (detection) return <CRSString> detection[1];
			else {
				geoJSON = ISO6709ToGeoJSON(data);
			}
		} else if (typeof data === "object" || typeof data === "string" && data.match(/{.*}/)) {
			geoJSON = (typeof data === "object") ? data : parseJSON(data);
			if (geoJSON.crs) {
				const name = geoJSON.crs.properties.name;
				if (name === EPSG2393String) return "EPSG:2393";
				else if (name.indexOf("ETRS-TM35FIN") !== -1) return "EPSG:3067";
			}
		}

		let geometrySample = geoJSON;
		while (geometrySample) {
			if (geometrySample.geometries) {
				geometrySample = geometrySample.geometries[0];
			}	else if (geometrySample.geometry) {
				geometrySample = geometrySample.geometry;
			} else if (geometrySample.features && geometrySample.features[0]) {
				geometrySample = geometrySample.features[0];
			} else if (!geometrySample.coordinates) {
				geometrySample = undefined;
			}

			if (geometrySample && geometrySample.coordinates) {
				let coordinateSample = geometrySample.coordinates;
				while (Array.isArray(coordinateSample[0])) coordinateSample = coordinateSample[0];
				coordinateSample = coordinateSample.map(c => `${c}`).reverse();
				return detectCRSFromLatLng(coordinateSample);
			}
		}
	}
}

export function convertAnyToWGS84GeoJSON(data: string | G.GeoJSON): G.GeoJSON {
	return convert(data, "GeoJSON", "WGS84");
}

export function convert(input: string | G.GeoJSON, outputFormat: "WKT" | "ISO 6709", outputCRS: CRSString): string;
export function convert(input: string | G.GeoJSON, outputFormat: "GeoJSON", outputCRS: CRSString): G.GeoJSON;
export function convert(input: string | G.GeoJSON, outputFormat: CoordinateSystem, outputCRS: CRSString): G.GeoJSON;
export function convert(input: string | G.GeoJSON, outputFormat: CoordinateSystem, outputCRS: CRSString): string;
export function convert(input: string | G.GeoJSON, outputFormat: CoordinateSystem, outputCRS: CRSString): string | G.GeoJSON {
	const inputFormat = detectFormat(input);
	const inputCRS = detectCRS(input);

	let geoJSON = undefined;
	if (inputFormat === "WKT") {
		geoJSON = WKTToGeoJSON(<string> input);
	} else if (inputFormat === "ISO 6709") {
		geoJSON = ISO6709ToGeoJSON(<string> input);
	} else if (inputFormat === "GeoJSON") {
		geoJSON = (typeof input === "object") ? input : parseJSON(input);
	} else {
		throw new LajiMapError("Couldn't detect geo data format", "GeoDataFormatDetectionError");
	}

	if (geoJSON && (geoJSON.features && geoJSON.features.length > 0 || geoJSON.geometry) && !inputCRS) {
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

export function getCRSObjectForGeoJSON(geoJSON: G.GeoJSON, crs: CRSString): {type: "name", properties: {name: string}} {
	return (!crs || crs === "WGS84") ? undefined : {
		type: "name",
		properties: {
			name: crs === "EPSG:2393" ? EPSG2393String : EPSG3067String
		}
	};
}

export class LajiMapError extends Error {
	public _lajiMapError = true;
	public translationKey: string;
	public lineIdx?: number;

	constructor(message: string, translationKey: string, lineIdx?: number) {
		super(message);
		this.translationKey = translationKey;
		if (lineIdx !== undefined) this.lineIdx = lineIdx;
	}
}

export function stringifyLajiMapError(error: LajiMapError, translations: any): string {
	let msg = `${translations.errorHTML} ${error.translationKey && translations[error.translationKey] ? translations[error.translationKey] : error.message}.`; // tslint:disable-line
	if ("lineIdx" in error) msg  += ` ${translations.Line}: ${error.lineIdx}`;
	return msg;
}

export function parseJSON(json: string): any {
	try {
		return JSON.parse(json);
	} catch (e) {
		throw new LajiMapError(e.message, "JsonParseError");
	}
}

interface CoordinateValidator {
	regexp: RegExp;
	range: number[];
	formatter? (value: string): string;
}

const wgs84Check: CoordinateValidator = {
	regexp: /^-?([0-9]{1,3}|[0-9]{1,3}\.[0-9]*)$/,
	range: [-180, 180]
};
const wgs84Validator = [wgs84Check, wgs84Check];

function formatterForLength(length) {
	return value => (value.length < length ? value + "0".repeat(length - value.length) : value);
}
const ykjRegexp = /^[0-9]{7}$/;

const ykjValidator: CoordinateValidator[] = [
	{regexp: ykjRegexp, range: [6600000, 7800000]},
	{regexp: ykjRegexp, range: [3000000, 3800000]}
];

const etrsTm35FinValidator: CoordinateValidator[] = [
	{regexp: ykjRegexp, range: [6600000, 7800000]},
	{regexp: /^[0-9]{5,6}$/, range: [50000, 760000]}
];
const etrsValidator = etrsTm35FinValidator; // For backward compability

// Valid ykj grid input can not overlap etrsTm35Fin coordinate point. Unvalidate cases where x-coordinate length is 7
// digits or y-coordinate doesn't start with '3' or y-coordinate length is 7 digits. This leaves an unlikely corner
// case where the user wants to input 1 m wide or 1 m long rectangle.
const ykjGridStrictValidator: CoordinateValidator[] = ykjValidator.map(validator => ({
	...validator,
	regexp: /^[0-9]{3,6}$/,
	formatter: formatterForLength(7)
}));
const ykjGridValidator = ykjGridStrictValidator; // For backward compability

export {wgs84Validator, ykjValidator, ykjGridValidator, ykjGridStrictValidator, etrsTm35FinValidator, etrsValidator};

export function validateLatLng(latlng: string[], latLngValidator: CoordinateValidator[]) {
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

export function roundMeters(meters: number, accuracy: number = 1): number {
	return accuracy ?  Math.round(Math.round(meters) / accuracy) * accuracy : meters;
}

export function createTextInput(): HTMLInputElement {
	const input = document.createElement("input");
	input.type = "text";
	input.className = "form-control laji-map-input";
	return input;
}

export function createTextArea(rows: number = 10, cols: number = 10): HTMLTextAreaElement {
	const input = document.createElement("textarea");
	input.setAttribute("rows", `${rows}`);
	input.setAttribute("cols", `${cols}`);
	input.className = "form-control laji-map-input";
	return input;
}

export function isObject(obj): boolean {
	return typeof obj === "object" && obj !== null && !Array.isArray(obj) && obj.constructor === Object;
}

export function combineColors(...colors: any[]): string {
	function toDecimal(hex) {
		return parseInt(hex, 16);
	}

	let max = undefined;
	const last = colors[colors.length - 1];
	if (typeof last === "number" || last === undefined) {
		max = typeof last === "number" ? last : 255;
		colors = colors.slice(0);
		colors.pop();
	}

	colors = colors.map(color => {
		if (color.length === 4) {
			const [hash, r, g, b] = color.split("");
			color = `#${r}${r}${g}${g}${b}${b}`;
		}
		return color;
	});

	const rv = colors.map(color => color.substring(1, 3));
	const gv = colors.map(color => color.substring(3, 5));
	const bv = colors.map(color => color.substring(5, 7));
	return [rv, gv, bv].reduce((rgb, hexVector) => {
		let value = hexVector.reduce((combinedDecimal, hex) => {
			if (hex === "--") {
				return combinedDecimal;
			}
			if (combinedDecimal === undefined) {
				return toDecimal(hex);
			}
			const decimal = toDecimal(hex);
			const combinedDecimalInt = parseInt(combinedDecimal);
			const newCombined = Math.round(combinedDecimalInt - ((combinedDecimalInt - decimal) / 2));
			return Math.max(Math.min(newCombined, 255), 0);
		}, undefined);

		if (max !== undefined) {
			const initial = toDecimal(hexVector[0]);
			if (value > initial + max) {
				value = initial + max;
			} else if (value < initial - max) {
				value = initial - max;
			}
			value = Math.min(value, initial + max);
		}
		let hex = value.toString(16);
		if (hex.length === 1) hex = `0${hex}`;
		return rgb + hex;
	}, "#");
}

export function getLineTransectStartEndDistancesForIdx(LTFeature: LineTransectFeature, idx: number, round?: number): number[] {
	const lines = geoJSONLineToLatLngSegmentArrays(LTFeature.geometry);
	let i = 0;
	let distance = 0;
	let prevDistance = distance;
	lines.some(line => {
		prevDistance = distance;
		line.some(([start, end]) => {
			distance += latLngTuplesDistance(start, end);
		});
		if (i === idx) {
			return true;
		}
		i++;
	});

	return [prevDistance, distance].map(m => roundMeters(m, round));
}

export const capitalizeFirstLetter = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
