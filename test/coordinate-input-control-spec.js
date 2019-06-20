const { createMap } = require("./test-utils");

describe("Coordinate control", () => {

	let map, control;
	beforeAll(async () => {
		map = await createMap({
			draw: true,
			controls: true
		});
		control = map.getCoordinateControl();
	});

	it("opens on click", async () => {
		const $button = control.$getButton();
		await $button.click();
		await expect((await control.$getContainer()).isPresent()).toBe(true);
	});

	it("closes on close button click", async () => {
		await control.$getCloseButton().click();
		await expect((await control.$getContainer()).isPresent()).toBe(false);
	});
});


