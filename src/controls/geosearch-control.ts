import * as L from "leaflet";
import SearchControl from "leaflet-geosearch/lib/SearchControl";
import { Provider } from "leaflet-geosearch/lib/providers";

/**
 * Monkey-patched leaflet-geosearch control that handles switching the provider.
 */
export default function _SearchControl(...options: any[]) {
	const [_options, ...restOptions] = options;
	const [primaryProviderLabel, primaryProvider] = options[0].providers[0];
	const control = new (SearchControl as any)({
		// These are defaultOptions from SearchControl. Leaflet-geosearch should default to them, but for some reason it
		// doesn't work. {
		position: "topleft",
		style: "button",
		showMarker: true,
		showPopup: false,
		popupFormat: ({ result }) => `${result.label}`,
		resultFormat: ({ result }) => `${result.label}`,
		marker: {
			icon: L && L.Icon ? new L.Icon.Default() : undefined,
			draggable: false,
		},
		maxMarkers: 1,
		maxSuggestions: 5,
		retainZoomLevel: false,
		animateZoom: true,
		notFoundMessage: "Sorry, that address could not be found.",
		messageHideDelay: 3000,
		zoomLevel: 18,
		classNames: {
			container: "leaflet-bar leaflet-control leaflet-control-geosearch",
			button: "leaflet-bar-part leaflet-bar-part-single",
			resetButton: "reset",
			msgbox: "leaflet-bar message",
			form: "",
			input: "",
		},
		autoComplete: true,
		autoCompleteDelay: 250,
		autoClose: false,
		keepResult: false,
		updateMap: true,
		// }
		..._options,
		provider: primaryProvider,
		searchLabel: `${_options.searchLabel} (${primaryProviderLabel})`
	}, ...restOptions);
	const {onAdd} = control.__proto__;
	control.__proto__.onAdd = function(map) {
		const container = onAdd.call(this, map);
		L.DomEvent.disableClickPropagation(container);
		const {resetButton} = this;
		resetButton.parentElement.removeChild(resetButton);

		const buttonsContainer = document.createElement("div");
		buttonsContainer.className = "laji-map-geosearch-provider-toggle-container btn-group";
		const {providers: providerModels}: {providers: [string, Provider][]} = this.options;
		const buttons = providerModels.map(([label, provider], idx) => {
			const b = document.createElement("button");
			b.innerHTML = label;
			b.className = "btn btn-xs";
			if (idx === 0) {
				b.className += " active";
			}
			buttonsContainer.appendChild(b);
			b.onclick = (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.options.provider = provider;
				this.searchElement.input.placeholder = this.searchElement.input.placeholder.replace(/\(.*\)$/, `(${label})`);
				this.autoSearch({target: this.searchElement.input});
				this.searchElement.input.focus();
				buttons.forEach((_b, i) => {
					if (i === idx) {
						_b.className += " active";
					} else if (_b.className.includes("active")) {
						_b.className = _b.className.replace(" active", "");
					}
				});
			};
			return b;
		});
		this.searchElement.form.appendChild(buttonsContainer);

		control.searchElement.input.addEventListener("blur", (e) => {
			if (buttons.includes(e.relatedTarget)) {
				return;
			}
			setTimeout(() => {
				control.closeResults();
				map.dragging.enable();
			}, 300);
		});

		return container;
	};
	// https://github.com/smeijer/leaflet-geosearch/issues/288
	control.__proto__.onSubmit = function({data}) {
		this.showResult(data);
	};
	return control;
}
