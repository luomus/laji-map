import LajiMap from "../map";
import { LajiMapEvent, DrawOptions } from "../map.defs";
import { WithControls } from "../controls.defs";
import { createTextArea, stringifyLajiMapError } from "../utils";

export default (lajiMap: LajiMap & WithControls) => {
	const container = document.createElement("form");
	container.className = "laji-map-coordinate-upload";

	const textarea = createTextArea(10, 50);
	textarea.className += " form-group";

	const button = document.createElement("button");
	button.setAttribute("type", "submit");
	button.className = "btn btn-block btn-primary";

	let translationsHooks = [];
	translationsHooks.push(lajiMap.addTranslationHook(button, "UploadDrawnFeatures"));
	button.setAttribute("disabled", "disabled");

	const {elem: formatDetectorElem, validate, unmount: unmountFormatDetector} = lajiMap.createFormatDetectorElem();

	let fixedGeoJSON = undefined;

	textarea.oninput = (e) => {
		const {value} = <HTMLInputElement> e.target;
		const {valid, geoJSON} = validate(value);
		fixedGeoJSON = geoJSON;
		if (valid) {
			button.removeAttribute("disabled");
			if (alert) {
				container.removeChild(alert);
				alert = undefined;
			}
		} else {
			button.setAttribute("disabled", "disabled");
		}
		if (container.className.indexOf(" has-error") !== -1) {
			container.className = container.className.replace(" has-error", "");
		}
	};

	let alert = undefined;
	let alertTranslationHook = undefined;

	const updateAlert = (error) => {
		if (alert) container.removeChild(alert);
		alert = document.createElement("div");
		alert.className = "alert alert-danger";
		if (alertTranslationHook) lajiMap.removeTranslationHook(alertTranslationHook);
		alertTranslationHook = lajiMap.addTranslationHook(alert, () => stringifyLajiMapError(error, lajiMap.translations));
		container.appendChild(alert);
	};

	const convertText = (e) => {
		e.preventDefault();
		try {
			const prevFeatureCollection = {
				type: "FeatureCollection",
				features: lajiMap.cloneFeatures(lajiMap.getDraw().featureCollection.features)
			};
			const events: LajiMapEvent[] = [{
				type: "delete",
				idxs: Object.keys(lajiMap.idxsToIds[lajiMap.drawIdx]).map(idx => parseInt(idx)),
				features: lajiMap.cloneFeatures(lajiMap.getDraw().featureCollection.features)
			}];
			lajiMap.updateDrawData(<DrawOptions> {...lajiMap.getDraw(), featureCollection: undefined, geoData: fixedGeoJSON || textarea.value});
			lajiMap.getDraw().featureCollection.features.forEach(feature => {
				events.push({type: "create", feature});
			});
			lajiMap._triggerEvent(events, lajiMap.getDraw().onChange);
			lajiMap._updateDrawUndoStack(events, prevFeatureCollection);
			lajiMap._closeDialog(e);
		} catch (e) {
			if (e.stringify) updateAlert(e);
			throw e;
		}
		const bounds = lajiMap.getDraw().group.getBounds();
		if (Object.keys(bounds).length) lajiMap.map.fitBounds(bounds);
	};

	button.addEventListener("click", convertText);

	container.appendChild(textarea);
	container.appendChild(formatDetectorElem);
	container.appendChild(button);

	lajiMap._showDialog(container, () => {
		translationsHooks.forEach(hook => lajiMap.removeTranslationHook(hook));
		if (alertTranslationHook) lajiMap.removeTranslationHook(alertTranslationHook);
		unmountFormatDetector();
	});

	textarea.focus();
	textarea.select();
};
