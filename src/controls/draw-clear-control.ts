import LajiMap from "../map";

export default (lajiMap: LajiMap) => {
	const container = document.createElement("div");
	const translateHooks = [];

	const yesButton = document.createElement("button");
	yesButton.className = "btn btn-block btn-danger";
	translateHooks.push(lajiMap.addTranslationHook(yesButton, "Yes"));
	yesButton.addEventListener("click", e => {
		lajiMap.clearDrawData();
		lajiMap._closeDialog(e);
	});

	const noButton = document.createElement("button");
	noButton.className = "btn btn-block btn-default";
	translateHooks.push(lajiMap.addTranslationHook(noButton, "No"));
	noButton.addEventListener("click", e => lajiMap._closeDialog(e));

	const question = document.createElement("h5");
	translateHooks.push(lajiMap.addTranslationHook(question, "ConfirmDrawClear"));

	container.appendChild(question);
	container.appendChild(yesButton);
	container.appendChild(noButton);

	lajiMap._showDialog(container, () => {
		translateHooks.forEach(hook => {
			lajiMap.removeTranslationHook(hook);
		});
	});

	yesButton.focus();
}
