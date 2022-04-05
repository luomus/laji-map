import { createMap, DrawControlPageObject, MapPageObject, PointTraveller, SAFE_CLICK_WAIT } from "./test-utils";
import * as utils from "laji-map/lib/utils";
import { $, $$, browser } from "protractor";
import G from "geojson";

describe("Drawing", () => {

	const getLastGeometry = <T extends G.Geometry = G.Geometry>(): Promise<T> => map.e(
		"getDraw().featureCollection.features[map.getDraw().featureCollection.features.length - 1].geometry"
	);

	let map: MapPageObject;
	let control: DrawControlPageObject;
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

		it("can be drawn", async () => {
			await map.drawMarker();
			const geometry = await getLastGeometry();
			expect(geometry.type).toBe("Point");
		});

		it("coordinates length", async () => {
			const geometry = await getLastGeometry<G.Point>();
			expect(geometry.type).toBe("Point");
			expect(`${geometry.coordinates[0]}`.split(".")[1].length).toBeLessThan(7);
			expect(`${geometry.coordinates[1]}`.split(".")[1].length).toBeLessThan(7);
		});

		it("coordinates are wrapped", async () => {
			await clear();
			await map.e("setCenter([60, 300])");
			await map.drawMarker();
			const geometry = await getLastGeometry<G.Point>();
			for (const c of geometry.coordinates) {
				expect(c).toBeLessThan(180);
				expect(c).toBeGreaterThan(-180);
			}
		});

		it("can be set editable", async () => {
			await clear();
			await map.drawMarker();
			await map.doubleClickAt(0, -10);
			expect(await $(".leaflet-marker-draggable").isPresent()).toBe(true);
		});

		// Drag doesn't work...
		// it("can be moved when editing", async () => {
		// 	await map.drag([0, 0], [-100, -100]);
		// });

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
			await browser.sleep(SAFE_CLICK_WAIT);
			await map.clickAt(10, 0);
			await browser.sleep(SAFE_CLICK_WAIT);
			await map.clickAt(20, 10);
			await browser.sleep(SAFE_CLICK_WAIT);
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
			const geometry = await getLastGeometry<G.LineString>();
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
			const geometry = await getLastGeometry<G.LineString>();
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
			traveller.travel(0, -30),
			traveller.travel(30, 0),
			traveller.travel(0, 30),
			traveller.initial()
		];

		const addPolygon = async () => {
			await control.$getPolygonButton().click();
			for (const c of coordinates) {
				await browser.sleep(SAFE_CLICK_WAIT);
				await map.clickAt(...c);
			}
		};

		it("can be drawn", async () => {
			await addPolygon();
			const geometry = await getLastGeometry<G.Polygon>();
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
			const geometry = await getLastGeometry<G.Polygon>();
			for (const c of geometry.coordinates[0]) {
				expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			}
		});

		it("coordinates are counter clockwise", async () => {
			const geometry = await getLastGeometry<G.Polygon>();
			expect(utils.coordinatesAreClockWise(geometry.coordinates[0])).toBe(false);
		});

		it("coordinates are counter clockwise when drawn counter clockwise direction", async () => {
			await clear();
			await control.$getPolygonButton().click();
			for (const c of coordinates.slice(0).reverse()) {
				await browser.sleep(SAFE_CLICK_WAIT);
				await map.clickAt(...c);
			}
			const geometry = await getLastGeometry<G.Polygon>();
			expect(utils.coordinatesAreClockWise(geometry.coordinates[0])).toBe(false);
		});

		it("coordinates are wrapped", async () => {
			await clear();
			await map.e("setCenter([60, 300])");
			await addPolygon();
			const geometry = await getLastGeometry<G.Polygon>();
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

		it("can be drawn", async () => {
			await map.drawRectangle();
			const geometry = await getLastGeometry<G.Polygon>();
			expect(geometry.type).toBe("Polygon");
			expect(geometry.coordinates.length).toBe(1);
			expect(geometry.coordinates[0].length).toBe(5);
		});

		it("coordinates length", async () => {
			const geometry = await getLastGeometry<G.Polygon>();
			geometry.coordinates[0].forEach(async (c: number[]) => {
				expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			});
		});

		it("coordinates are wrapped", async () => {
			await clear();
			await map.e("setCenter([60, 300])");
			await map.drawRectangle();
			const geometry = await getLastGeometry<G.Polygon>();
			for (const coords of geometry.coordinates[0]) {
				for (const c of coords) {
					expect(c).toBeLessThan(180);
					expect(c).toBeGreaterThan(-180);
				}
			}
		});

		it("coordinates are counter clockwise", async () => {
			const geometry = await getLastGeometry<G.Polygon>();
			expect(utils.coordinatesAreClockWise(geometry.coordinates[0])).toBe(false);
		});

		const drags = [
			[-10, 10],
			[10, -10],
			[-10, -10]
		] as [number, number][];

		it("coordinates are counter clockwise when drawn from any direction", async () => {
			const geometry = await getLastGeometry<G.Polygon>();
			expect(utils.coordinatesAreClockWise(geometry.coordinates[0])).toBe(false);

			for (const drag of drags) {
				await clear();
				await control.$getRectangleButton().click();
				const traveller = new PointTraveller();
				await map.drag(traveller.initial(), traveller.travel(...drag));
				const lastGeometry = await getLastGeometry<G.Polygon>();
				expect(utils.coordinatesAreClockWise(lastGeometry.coordinates[0])).toBe(false);
			}
		});

		describe("editing", () => {
			const lastDestination = drags[drags.length - 1];
			let geometryBeforeEdit: G.Polygon;

			beforeAll(async() => {
				geometryBeforeEdit = await getLastGeometry<G.Polygon>();
			});

			it("can be started", async () => {
				await map.doubleClickAt(...lastDestination);
				expect(await $$(".leaflet-marker-draggable").count()).toBeGreaterThan(0, "Rectangle wasn't editable");
			});

			it("can be finished", async () => {
				const traveller = new PointTraveller(...lastDestination);
				await map.drag(traveller.initial(), traveller.travel(-10, -10));
				await map.clickAt(...traveller.travel(-10, -10));
			});

			it("geometry is changed", async () => {
				const lastGeometry = await getLastGeometry<G.Polygon>();
				expect(lastGeometry).not.toEqual(geometryBeforeEdit);
			});

			it("coordinates are counter clockwise", async () => {
				const lastGeometry = await getLastGeometry<G.Polygon>();
				expect(utils.coordinatesAreClockWise(lastGeometry.coordinates[0])).toBe(false);
			});

			it("coordinates length", async () => {
				const lastGeometry = await getLastGeometry<G.Polygon>();
				lastGeometry.coordinates[0].forEach(async (c: number[]) => {
					expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
					expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
				});
			});
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
			const geometry = await getLastGeometry<G.Point>();
			expect(geometry.type).toBe("Point");
			expect((geometry as any).radius).toBeGreaterThan(0);
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
			const {coordinates} = await getLastGeometry<G.Point>();
			expect(`${coordinates[0]}`.split(".")[1].length).toBeLessThan(7);
			expect(`${coordinates[1]}`.split(".")[1].length).toBeLessThan(7);
		});

		it("coordinates are wrapped", async () => {
			await clear();
			await map.e("setCenter([60, 300])");
			await addCircle();
			const geometry = await getLastGeometry<G.Point>();
			for (const c of geometry.coordinates) {
				expect(c).toBeLessThan(180);
				expect(c).toBeGreaterThan(-180);
			}
		});

	});
});
