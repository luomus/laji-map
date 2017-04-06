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
		if (typeof obj === "object" && obj !== null) {
			Object.keys(obj).forEach(key => {
				if (key === "coordinates") {
					obj[key] = Array.isArray(obj[key][0]) ?
						[obj[key].map(coords => convertLatLng(reverseCoordinate(coords), from, to))] :
						_convertGeoJSON(reverseCoordinate(obj[key]), from, to);
				}
				else _convertGeoJSON(obj[key], from, to);
			});
		}
		return obj;
	}

	return _convertGeoJSON(JSON.parse(JSON.stringify(obj)), from, to);
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
