import { test, expect } from "@playwright/test";
import { navigateToMapPage, MapPageObject, PointTraveller } from "./test-utils";
import * as utils from "@luomus/laji-map/lib/utils";
import G from "geojson";

test.describe.configure({ mode: "serial" });

test.describe("Drawing", () => {

	const getLastGeometry = <T extends G.Geometry = G.Geometry>(): Promise<T> => map.e(
		"getDraw().featureCollection.features[map.getDraw().featureCollection.features.length - 1].geometry"
	);

	let map: MapPageObject;
	let control: MapPageObject["controls"]["draw"];
	test.beforeAll(async ({browser}) => {
		const page = await browser.newPage();
		map = await navigateToMapPage(page, {
			draw: true,
			controls: {
				draw: true
			}
		});
		control = map.controls.draw;
	});

	const clear = () => map.e("clearDrawData()");

	test.describe("point", () => {
		test.afterAll(clear);

		test("can be drawn", async () => {
			await map.drawMarker();
			const geometry = await getLastGeometry();
			expect(geometry.type).toBe("Point");
		});

		test("coordinates length", async () => {
			const geometry = await getLastGeometry<G.Point>();
			expect(geometry.type).toBe("Point");
			expect(`${geometry.coordinates[0]}`.split(".")[1].length).toBeLessThan(7);
			expect(`${geometry.coordinates[1]}`.split(".")[1].length).toBeLessThan(7);
		});

		test("coordinates are wrapped", async () => {
			await clear();
			await map.e("setCenter([60, 300])");
			await map.drawMarker();
			const geometry = await getLastGeometry<G.Point>();
			for (const c of geometry.coordinates) {
				expect(c).toBeLessThan(180);
				expect(c).toBeGreaterThan(-180);
			}
		});

		test("can be set editable", async ({browserName}) => {
			test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
			await clear();
			await map.drawMarker();
			await map.doubleClickAt(0, -10);
			await expect(map.$getEditableMarkers()).toBeVisible();
		});

		// Drag doesn't work...
		test("can be moved when editing", async ({browserName}) => {
			test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
			const $marker = map.$getEditableMarkers().first(); // There's only one.
			const positionBefore = await $marker.boundingBox();
			await map.drag([0, -10], [-100, -100]);
			const positionAfter = await $marker.boundingBox();
			expect(positionBefore!.x).not.toBe(positionAfter!.x);
		});

		test("can finish editing", async () => {
			await map.clickAt(20, 20);
			await expect(map.$getEditableMarkers()).not.toBeVisible();
		});
	});

	test.describe("polyline", () => {
		test.afterAll(clear);

		const addLine = () => map.drawLine(
			[0, 0],
			[40, 0],
			[80, 30]
		);

		test("can be drawn", async () => {
			await addLine();
			const geometry = await getLastGeometry();
			expect(geometry.type).toBe("LineString");
		});

		test("can be set editable", async ({browserName}) => {
			test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
			await map.doubleClickAt(0, 0);
			expect(await map.$getEditableMarkers().count()).toBeGreaterThan(0);
		});

		test("can finish editing", async ({browserName}) => {
			test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
			await map.clickAt(-30, -30); // Click somewhere else than the line layer.
			expect(await map.$getEditableMarkers().count()).toBe(0);
		});

		test("coordinates length", async () => {
			const geometry = await getLastGeometry<G.LineString>();
			expect(geometry.coordinates.length).toBe(3);
			for (const c of geometry.coordinates) {
				expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			}
		});

		test("coordinates are wrapped", async () => {
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

	test.describe("polygon", () => {
		test.afterAll(clear);

		const traveller = new PointTraveller();

		// Clockwise
		const coordinates = [
			traveller.travel(0, 0),
			traveller.travel(0, -30),
			traveller.travel(30, 0),
			traveller.travel(0, 30),
		];

		const addPolygon = () => map.drawPolygon(...coordinates);

		test("can be drawn", async () => {
			await addPolygon();
			const geometry = await getLastGeometry<G.Polygon>();
			expect(geometry.type).toBe("Polygon");
			expect(geometry.coordinates.length).toBe(1);
			expect(geometry.coordinates[0].length).toBe(coordinates.length + 1);
		});

		test("can be set editable", async ({browserName}) => {
			test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
			await map.doubleClickAt(0, 0);
			expect(await map.$getEditableMarkers().count()).toBeGreaterThan(0);
		});

		test("can finish editing", async ({browserName}) => {
			test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
			await map.clickAt(-30, -30);
			expect(await map.$getEditableMarkers().count()).toBe(0);
		});

		test("coordinates length", async () => {
			const geometry = await getLastGeometry<G.Polygon>();
			for (const c of geometry.coordinates[0]) {
				expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			}
		});

		test("coordinates are counter clockwise", async () => {
			const geometry = await getLastGeometry<G.Polygon>();
			expect(utils.coordinatesAreClockWise(geometry.coordinates[0])).toBe(false);
		});

		test("coordinates are counter clockwise when drawn counter clockwise direction", async () => {
			await clear();
			await map.drawPolygon(...coordinates.slice(0).reverse());
			const geometry = await getLastGeometry<G.Polygon>();
			expect(utils.coordinatesAreClockWise(geometry.coordinates[0])).toBe(false);
		});

		test("coordinates are wrapped", async () => {
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

	test.describe("rectangle", () => {
		test.afterAll(clear);

		test("can be drawn", async () => {
			await map.drawRectangle();
			const geometry = await getLastGeometry<G.Polygon>();
			expect(geometry.type).toBe("Polygon");
			expect(geometry.coordinates.length).toBe(1);
			expect(geometry.coordinates[0].length).toBe(5);
		});

		test("coordinates length", async () => {
			const geometry = await getLastGeometry<G.Polygon>();
			geometry.coordinates[0].forEach(async (c: number[]) => {
				expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
				expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
			});
		});

		test("coordinates are wrapped", async () => {
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

		test("coordinates are counter clockwise", async () => {
			const geometry = await getLastGeometry<G.Polygon>();
			expect(utils.coordinatesAreClockWise(geometry.coordinates[0])).toBe(false);
		});

		const drags = [
			[-10, 10],
			[10, -10],
			[-10, -10]
		] as [number, number][];

		test("coordinates are counter clockwise when drawn from any direction", async () => {
			const geometry = await getLastGeometry<G.Polygon>();
			expect(utils.coordinatesAreClockWise(geometry.coordinates[0])).toBe(false);

			for (const drag of drags) {
				await clear();
				await control.$rectangleButton.click();
				const traveller = new PointTraveller();
				await map.drag(traveller.initial(), traveller.travel(...drag));
				const lastGeometry = await getLastGeometry<G.Polygon>();
				expect(utils.coordinatesAreClockWise(lastGeometry.coordinates[0])).toBe(false);
			}
		});

		test.describe("editing", () => {
			const lastDestination = drags[drags.length - 1];
			let geometryBeforeEdit: G.Polygon;

			test.beforeAll(async () => {
				geometryBeforeEdit = await getLastGeometry<G.Polygon>();
			});

			test("can be started", async ({browserName}) => {
				test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
				await map.doubleClickAt(...lastDestination);
				expect(await map.$getEditableMarkers().count()).toBeGreaterThan(0);
			});

			test("can be finished", async ({browserName}) => {
				test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
				const traveller = new PointTraveller(...lastDestination);
				await map.drag(traveller.initial(), traveller.travel(-10, -10));
				await map.clickAt(...traveller.travel(-10, -10));
			});

			test("geometry is changed", async ({browserName}) => {
				test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
				const lastGeometry = await getLastGeometry<G.Polygon>();
				expect(lastGeometry).not.toEqual(geometryBeforeEdit);
			});

			test("coordinates are counter clockwise", async () => {
				const lastGeometry = await getLastGeometry<G.Polygon>();
				expect(utils.coordinatesAreClockWise(lastGeometry.coordinates[0])).toBe(false);
			});

			test("coordinates length", async () => {
				const lastGeometry = await getLastGeometry<G.Polygon>();
				lastGeometry.coordinates[0].forEach(async (c: number[]) => {
					expect(`${c[0]}`.split(".")[1].length).toBeLessThan(7);
					expect(`${c[1]}`.split(".")[1].length).toBeLessThan(7);
				});
			});
		});
	});

	test.describe("circle", () => {
		test.afterAll(clear);

		const addCircle = async () => {
			await control.$circleButton.click();
			await map.drag([0, 0], [10, 0]);
		};

		test("can be drawn", async () => {
			await addCircle();
			const geometry = await getLastGeometry<G.Point>();
			expect(geometry.type).toBe("Point");
			expect((geometry as any).radius).toBeGreaterThan(0);
			expect(geometry.coordinates.length).toBe(2);
		});

		test("can be set editable", async ({browserName}) => {
			test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
			await map.doubleClickAt(0, 0);
			expect(await map.$getEditableMarkers().count()).toBeGreaterThan(0);
		});

		test("can finish editing", async ({browserName}) => {
			test.skip(["firefox", "webkit"].includes(browserName), "Double click clicks three times in headless firefox/webkit");
			await map.clickAt(-10, -10);
			expect(await map.$getEditableMarkers().count()).toBe(0);
		});

		test("coordinates length", async () => {
			const {coordinates} = await getLastGeometry<G.Point>();
			expect(`${coordinates[0]}`.split(".")[1].length).toBeLessThan(7);
			expect(`${coordinates[1]}`.split(".")[1].length).toBeLessThan(7);
		});

		test("coordinates are wrapped", async () => {
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
