import * as L from "leaflet";
import LajiMap from "../map";
import { WithControls } from "../controls.defs";
import { createTextInput, latLngGridToGeoJSON } from "../utils";

export default (lajiMap: LajiMap & WithControls) => {
	const translateHooks = [];

	function createCoordinateInput(id, translationKey) {
		const input = createTextInput();
		input.id = `laji-map-${id}`;

		const label = document.createElement("label");
		label.setAttribute("for", input.id);
		translateHooks.push(lajiMap.addTranslationHook(label, translationKey));

		const row = document.createElement("div");
		row.className = "form-group row";

		const col = document.createElement("div");
		col.className = "col-xs-12";

		[label, input].forEach(elem => col.appendChild(elem));
		row.appendChild(col);

		return row;
	}

	function formatter(input) {
		return e => {
			let charCode = (typeof e.which === "undefined") ? e.keyCode : e.which;

			if (charCode >= 48 && charCode <= 57) { // Is a number
				// The input cursor isn't necessary at the EOL, but this validation works regardless.
				inputValidate(e, input.value + String.fromCharCode(charCode));
			} else if (charCode === 58) { // is colon
				lngInput.focus();
				lngInput.select();
			}
		};
	}

	const inputRegexp = lajiMap.getDraw().marker ? /^(-?[0-9]+(\.|,)?[0-9]*|-?)$/ : /^[0-9]*$/;

	function inputValidate(e, value) {
		if (!value.match(inputRegexp)) {
			e && e.preventDefault && e.preventDefault();
			return false;
		}
		return true;
	}

	const container = document.createElement("form");
	container.className = "laji-map-coordinates";

	const latLabelInput = createCoordinateInput("coordinate-input-lat", "Latitude");
	const lngLabelInput = createCoordinateInput("coordinate-input-lng", "Longitude");
	const latInput = latLabelInput.getElementsByTagName("input")[0];
	const lngInput = lngLabelInput.getElementsByTagName("input")[0];

	const submitButton = document.createElement("button");
	submitButton.setAttribute("type", "submit");
	submitButton.className = "btn btn-block btn-primary";
	translateHooks.push(lajiMap.addTranslationHook(submitButton, "Add"));
	submitButton.setAttribute("disabled", "disabled");

	let helpSpan = document.createElement("span");
	helpSpan.className = "help-block";

	function getHelpTxt() {
		let help = `${lajiMap.translations.Enter} ${lajiMap.translations.yKJRectangle}`;
		const rectangleAllowed = lajiMap.getDraw().rectangle || lajiMap.getDraw().polygon;
		const {or} = lajiMap.translations;
		help += (rectangleAllowed && !lajiMap.getDraw().marker ? ` ${or} ` : ", ") + lajiMap.translations.ETRSRectangle;
		if (lajiMap.getDraw().marker) {
			help += ` ${or} ${rectangleAllowed ? lajiMap.translations.wGS84PointCoordinates : lajiMap.translations.WGS84Coordinates}`;
		}
		help += ".";
		return help;
	}

	translateHooks.push(lajiMap.addTranslationHook(helpSpan, getHelpTxt));

	const {
		validate,
		elem: formatDetectorElem,
		unmount: unmountFormatDetector
	} = lajiMap.createFormatDetectorElem({
		displayFormat: false,
		displayErrors: false,
		allowGrid: lajiMap.getDraw().rectangle || lajiMap.getDraw().polygon
	});

	const inputValues = ["", ""];
	[latInput, lngInput].forEach((input, i) => {
		let prevVal = "";
		input.addEventListener("keypress", formatter(input));
		input.onpaste = (e) => {
			const matches = (e.clipboardData || (<any> window).clipboardData).getData("text")
				.match(/-?[0-9]+((\.|,)?[0-9]+)/g) || ["", ""];
			const [latMatch, lngMatch] = document.activeElement === lngInput
				? matches.reverse()
				: matches;
			if ([latMatch, lngMatch].every(match => typeof match === "string" && match.length > 0)) {
				[[latInput, latMatch], [lngInput, lngMatch]].forEach(([_input, match]: [HTMLInputElement, string]) => {
					_input.value = match;
					_input.oninput(<any> {target: _input});
				});
				submitButton.focus();
			}
		};
		input.oninput = (e) => {
			const target = <HTMLInputElement> e.target;
			const value = target.value.replace(",", ".").trim();
			if (!inputValidate(e, value)) {
				target.value = prevVal;
			}
			target.value = value;
			prevVal = value;

			inputValues[i] = value;

			const {valid} = validate(`${inputValues[0]}:${inputValues[1]}/`);
			if (valid) {
				submitButton.removeAttribute("disabled");
			} else {
				submitButton.setAttribute("disabled", "disabled");
			}
		};
	});

	container.addEventListener("submit", e => {
		e.preventDefault();

		const feature = latLngGridToGeoJSON([latInput.value, lngInput.value]);
		const layer = lajiMap._featureToLayer(lajiMap.getDraw().getFeatureStyle)(feature);
		const isMarker = layer instanceof L.Marker;

		lajiMap._onAdd(lajiMap.drawIdx, layer, latInput.value + ":" + lngInput.value);
		const center = (isMarker) ? layer.getLatLng() : layer.getBounds().getCenter();
		lajiMap.map.setView(center, lajiMap.map.getZoom(), {animate: false});
		if (isMarker) {
			if (lajiMap.getDraw().cluster) (<L.MarkerClusterGroup> lajiMap.getDraw().groupContainer).zoomToShowLayer(layer);
			else lajiMap.setNormalizedZoom(9);
		} else {
			lajiMap.map.fitBounds(layer.getBounds());
		}
		lajiMap._closeDialog(e);
	});

	container.appendChild(helpSpan);
	container.appendChild(latLabelInput);
	container.appendChild(lngLabelInput);
	container.appendChild(formatDetectorElem);
	container.appendChild(submitButton);

	lajiMap._showDialog(container, () => {
		translateHooks.forEach(hook => {
			lajiMap.removeTranslationHook(hook);
		});
		unmountFormatDetector();
	});

	latInput.focus();
};
