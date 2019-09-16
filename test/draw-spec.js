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

		const addMarker = async () => {
			await control.$getMarkerButton().click();
			await map.clickAt(0, 0);
		};

		it("can be drawn", async () => {
			await addMarker();
			const geometry = await getLastGeometry();
			expect(geometry.type).toBe("Point");
		});

		it("coordinates length", async () => {
			const geometry = await getLastGeometry();
			expect(geometry.type).toBe("Point");
			expect(`${geometry.coordinates[0]}`.split(".")[1].length).toBeLessThan(7);
			expect(`${geometry.coordinates[1]}`.split(".")[1].length).toBeLessThan(7);
		});

		it("coordinates are wrapped", async () => {
			await clear();
			await map.e("setCenter([60, 300])");
			await addMarker();
			const geometry = await getLastGeometry();
			for (const c of geometry.coordinates) {
				expect(c).toBeLessThan(180);
				expect(c).toBeGreaterThan(-180);
			}
		});

		it("can be set editable", async () => {
			await clear();
			await addMarker();
			await map.doubleClickAt(0, 0);
			expect(await $(".leaflet-marker-draggable").isPresent()).toBe(true);
		});


		// Drag doesn't work...
		//it("can be moved when editing", async () => {
		//	await map.drag([0, 0], [-100, -100]);
		//});

		it("can finish editing", async () => {
			await map.clickAt(20, 20);
			expect(await $(".leaflet-marker-draggable").isPresent()).toBe(false);
		});
	});

	describe("polyline", () => {
		afterAll(clear);

		const addLine = async () => {
			await control.$getPolylineButton().click();
			await map.clickAt(0, 0);
			await map.clickAt(10, 0);
			await map.clickAt(20, 10);
			await map.clickAt(20, 10);
		};

		it("can be drawn", async () => {
			await addLine();
			const geometry = await getLastGeometry();
			expect(geometry.type).toBe("LineString");
		});

		it("can be set editable", async () => {
			await map.doubleClickAt(0, 0);
			expect(await $$(".leaflet-marker-draggable").count()).toBeGreaterThan(0);
		});

		it("can finish editing", async () => {
			await map.clickAt(-30, -30);
			expect(await $$(".leaflet-marker-draggable").count()).toBe(0);
		});

		it("coordinates length", async () => {
			const geometry = await getLastGeometry();
			expect(geometry.coordinates.length).toBe(3);
			for (const c of geometry.coordinates) {
				expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			}
		});

		it("coordinates are wrapped", async () => {
			await clear();
			await map.e("setCenter([60, 300])");
			await addLine();
			const geometry = await getLastGeometry();
			for (const coords of geometry.coordinates) {
				for (const c of coords) {
					expect(c).toBeLessThan(180);
					expect(c).toBeGreaterThan(-180);
				}
			}
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
			traveller.initial()
		];

		const addPolygon = async () => {
			await control.$getPolygonButton().click();
			for (const c of coordinates) {
				await map.clickAt(...c);
			}
		};

		it("can be drawn", async () => {
			await addPolygon();
			const geometry = await getLastGeometry();
			expect(geometry.type).toBe("Polygon");
			expect(geometry.coordinates.length).toBe(1);
			expect(geometry.coordinates[0].length).toBe(coordinates.length);
		});

		it("can be set editable", async () => {
			await map.doubleClickAt(0, 0);
			expect(await $$(".leaflet-marker-draggable").count()).toBeGreaterThan(0);
		});

		it("can finish editing", async () => {
			await map.clickAt(-30, -30);
			expect(await $$(".leaflet-marker-draggable").count()).toBe(0);
		});

		it("coordinates length", async () => {
			const geometry = await getLastGeometry();
			for (const c of geometry.coordinates[0]) {
				expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			}
		});

		it("coordinates are clockwise", async () => {
			const geometry = await getLastGeometry();
			expect(utils.coordinatesAreClockWise(geometry.coordinates)).toBe(true);
		});

		it("coordinates are clockwise when drawn counter clockwise direction", async () => {
			await clear();
			await control.$getPolygonButton().click();
			for (const c of coordinates.slice(0).reverse()) {
				await map.clickAt(...c);
			}
			const geometry = await getLastGeometry();
			expect(utils.coordinatesAreClockWise(geometry.coordinates)).toBe(true);
		});

		it("coordinates are wrapped", async () => {
			await clear();
			await map.e("setCenter([60, 300])");
			await addPolygon();
			const geometry = await getLastGeometry();
			for (const coords of geometry.coordinates[0]) {
				for (const c of coords) {
					expect(c).toBeLessThan(180);
					expect(c).toBeGreaterThan(-180);
				}
			}
		});
	});

	describe("rectangle", () => {
		afterAll(clear);

		const addRectangle = async () => {
			await control.$getRectangleButton().click();
			await map.drag([0, 0], [10, 10]);
		};

		it("can be drawn", async () => {
			await addRectangle();
			const geometry = await getLastGeometry();
			expect(geometry.type).toBe("Polygon");
			expect(geometry.coordinates.length).toBe(1);
			expect(geometry.coordinates[0].length).toBe(5);
		});

		it("coordinates length", async () => {
			const geometry = await getLastGeometry();
			await geometry.coordinates[0].forEach(async (c) => {
				expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			});
		});

		it("coordinates are wrapped", async () => {
			await clear();
			await map.e("setCenter([60, 300])");
			await addRectangle();
			const geometry = await getLastGeometry();
			for (const coords of geometry.coordinates[0]) {
				for (const c of coords) {
					expect(c).toBeLessThan(180);
					expect(c).toBeGreaterThan(-180);
				}
			}
		});

		it("coordinates are clockwise", async () => {
			const geometry = await getLastGeometry();
			expect(utils.coordinatesAreClockWise(geometry.coordinates)).toBe(true);
		});

		it("coordinates are clockwise when drawn from any direction", async () => {
			const geometry = await getLastGeometry();
			expect(utils.coordinatesAreClockWise(geometry.coordinates)).toBe(true);

			const drags = [
				[-10, 10],
				[10, -10],
				[-10, -10]
			];
			for (const drag of drags) {
				await clear();
				await control.$getRectangleButton().click();
				const traveller = new PointTraveller();
				await map.drag(traveller.initial(), traveller.travel(...drag));
				const geometry = await getLastGeometry();
				expect(utils.coordinatesAreClockWise(geometry.coordinates)).toBe(true);
			}
		});
	});

	describe("circle", () => {
		afterAll(clear);


		const addCircle = async () => {
			await control.$getCircleButton().click();
			await map.drag([0, 0], [10, 0]);
		};

		it("can be drawn", async () => {
			await addCircle();
			const geometry = await getLastGeometry();
			expect(geometry.type).toBe("Point");
			expect(geometry.radius).toBeGreaterThan(0);
			expect(geometry.coordinates.length).toBe(2);
		});

		it("can be set editable", async () => {
			await map.doubleClickAt(0, 0);
			expect(await $$(".leaflet-marker-draggable").count()).toBeGreaterThan(0);
		});

		it("can finish editing", async () => {
			await map.clickAt(-10, -10);
			expect(await $$(".leaflet-marker-draggable").count()).toBe(0);
		});

		it("coordinates length", async () => {
			const {coordinates} = await getLastGeometry();
			expect(`${coordinates[0]}`.split(".")[1].length).toBeLessThan(7);
			expect(`${coordinates[1]}`.split(".")[1].length).toBeLessThan(7);
		});

		it("coordinates are wrapped", async () => {
			await clear();
			await map.e("setCenter([60, 300])");
			await addCircle();
			const geometry = await getLastGeometry();
			for (const c of geometry.coordinates) {
				expect(c).toBeLessThan(180);
				expect(c).toBeGreaterThan(-180);
			}
		});

	});
});
