const { createMap, PointTraveller } = require("./test-utils");
const utils = require("../lib/utils");

describe("Drawing", () => {

	const getLastGeometry = () => map.e(
		"getDraw().featureCollection.features[map.getDraw().featureCollection.features.length - 1].geometry"
	);

	let map, control;
	beforeAll(async () => {
		map = await createMap({
			draw: true,
			controls: {
				draw: true
			}
		});
		control = map.getDrawControl();
	});

	const clear = () => map.e("clearDrawData()");


	describe("point", () => {
		afterAll(clear);

		it("works", async () => {
			await control.$getMarkerButton().click();
			await map.clickAt(0, 0);
			const geometry = await getLastGeometry();
			await expect(geometry.type).toBe("Point");
		});

		it("coordinates length", async () => {
			const geometry = await getLastGeometry();
			await expect(geometry.type).toBe("Point");
			await expect(`${geometry.coordinates[0]}`.split(".")[1].length).toBeLessThan(7);
			await expect(`${geometry.coordinates[1]}`.split(".")[1].length).toBeLessThan(7);
		});
	});

	describe("polyline", () => {
		afterAll(clear);

		it("works", async () => {
			await control.$getPolylineButton().click();
			await map.clickAt(0, 0);
			await map.clickAt(10, 0);
			await map.clickAt(20, 10);
			await map.clickAt(20, 10);
			const geometry = await getLastGeometry();
			await expect(geometry.type).toBe("LineString");
		});

		it("coordinates length", async () => {
			const geometry = await getLastGeometry();
			await expect(geometry.coordinates.length).toBe(3);
			geometry.coordinates.forEach(async (c) => {
				await expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				await expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			});
		});
	});

	describe("polygon", () => {
		afterAll(clear);

		const traveller = new PointTraveller();

		// Clockwise
		const coordinates = [
			traveller.travel(0, 0),
			traveller.travel(0, -10),
			traveller.travel(10, 0),
			traveller.travel(0, 10),
			traveller.start()
		];

		it("works", async () => {
			await control.$getPolygonButton().click();
			for (const c of coordinates) {
				await map.clickAt(...c);
			}
			const geometry = await getLastGeometry();
			await expect(geometry.type).toBe("Polygon");
			await expect(geometry.coordinates.length).toBe(1);
			await expect(geometry.coordinates[0].length).toBe(coordinates.length);
		});

		it("coordinates length", async () => {
			const geometry = await getLastGeometry();
			await geometry.coordinates[0].forEach(async (c) => {
				await expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				await expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			});
		});

		it("coordinates are clockwise", async () => {
			const geometry = await getLastGeometry();
			await expect(utils.coordinatesAreClockWise(geometry.coordinates)).toBe(true);
		});

		it("coordinates are clockwise when drawn counter clockwise direction", async () => {
			await clear();
			await control.$getPolygonButton().click();
			for (const c of coordinates.slice(0).reverse()) {
				await map.clickAt(...c);
			}
			const geometry = await getLastGeometry();
			await expect(utils.coordinatesAreClockWise(geometry.coordinates)).toBe(true);
		});
	});

	describe("rectangle", () => {
		afterAll(clear);

		it("works", async () => {
			await control.$getRectangleButton().click();
			const traveller = new PointTraveller();
			await map.drag(traveller.start(), traveller.travel(10, 10));
			const geometry = await getLastGeometry();
			await expect(geometry.type).toBe("Polygon");
			await expect(geometry.coordinates.length).toBe(1);
			await expect(geometry.coordinates[0].length).toBe(5);
		});

		it("coordinates length", async () => {
			const geometry = await getLastGeometry();
			await geometry.coordinates[0].forEach(async (c) => {
				await expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				await expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			});
		});

		it("coordinates are clockwise", async () => {
			const geometry = await getLastGeometry();
			await expect(utils.coordinatesAreClockWise(geometry.coordinates)).toBe(true);
		});

		it("coordinates are clockwise when drawn from any direction", async () => {
			const geometry = await getLastGeometry();
			await expect(utils.coordinatesAreClockWise(geometry.coordinates)).toBe(true);

			const drags = [
				[-10, 10],
				[10, -10],
				[-10, -10]
			];
			for (const drag of drags) {
				await clear();
				await control.$getRectangleButton().click();
				const traveller = new PointTraveller();
				await map.drag(traveller.start(), traveller.travel(...drag));
				const geometry = await getLastGeometry();
				await expect(utils.coordinatesAreClockWise(geometry.coordinates)).toBe(true);
			}
		});
	});

	describe("circle", () => {
		afterAll(clear);

		it("works", async () => {
			await control.$getCircleButton().click();
			await map.drag([0, 0], [10, 0]);
			const geometry = await getLastGeometry();
			await expect(geometry.type).toBe("Point");
			await expect(geometry.radius).toBeGreaterThan(0);
			await expect(geometry.coordinates.length).toBe(2);
		});

		it("coordinates length", async () => {
			const {coordinates} = await getLastGeometry();
			await expect(`${coordinates[0]}`.split(".")[1].length).toBeLessThan(7);
			await expect(`${coordinates[1]}`.split(".")[1].length).toBeLessThan(7);
		});
	});
});
