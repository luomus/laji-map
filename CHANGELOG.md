## 5.0.0
* `rectangle` `maxFillOpacity` and `controlFillOpacity` removed. Rectangles use the respective `polygon` options instead.

## 4.0.0
* protractor -> playwright migration: `test-export` moved to `test`. Includes only the `test-utils.ts`.
	* reverted in `4.0.1`

## 3.23.0
* typings from `*defs.ts` files can be now imported without Leaflet being imported

## 3.22.0
* `maxFillOpacity` can be controlled per layer type
* Add `controlFillOpacity` option

## 3.19.0
* Add `maxFillOpacity` to data options

## 3.18.1
* Data opacity controllable via the layer control, if `label` option is provided.
* Add `label`, `opacity`, `visible`, `onOpacityChange` and   `onVisibleChange` to data options

## 3.18.0
* There was a git conflict, please use 3.18.1

## 3.16.0
* Add layers to draw change events 'create', 'insert' and 'edit'

## 3.15.0
* Add birdAtlasSocietyGridZones layer

## 3.14.0
* Add atlasGrid layer

## 3.13.0
* Add flyingSquirrelPredictionModel layer
* Enable cadastral-units (kiinteistotunnukset) to mml geosearch

## 3.12.0
* Remove plannedProtectedAreasRegional layer
* Add help link to layer control
* Update on accessibility: tabbing stops on map container but skips everything else

## 3.11.0
* Add plannedProtectedAreas layer
* Add plannedProtectedAreasRegional layer

## 3.10.0
* Add currentProtectedAreas layer

## 3.9.0
* Add AFE grid layers
* Add `lajiGeoServerAddress` option

## 3.8.0
* Add kiinteistojaotus & kiinteistotunnukset layers (blacklisted by default)

## 3.7.0
* Add MML provider for geocoding

## 3.6.0
* Municipalities layer is always up to date
* Added county (maakunnat) & ELY area layers

## 3.5.0
* Export tests to npm package

## 3.4.0
* Add `featureIdxs` and `cluster` to getClusterStyle

## 3.3.0
* Add fullscreen control
* Add `showMeasurements` Data option

## 3.2.1
* Fix smooth scrolling for Firefox

## 3.2.0
* Add smooth scrolling

## 3.1.0
* Add line transect compass point snap mode

## 3.0.14
* Fix forest and mire vegetation zone layers

## 3.0.9
* All resources served through https

## 3.0.7
* `delete` event emits `feature`
* Data layers are ordered on map, draw on top

## 3.0.0
** BREAKING CHANGES **
* `tileLayersChange` event data isn't inline inside the event, but under `tileLayers` property

## 2.1.1
* Add missing layer attributions

## 2.1.0
* Add panOnFound option to locate options

## 2.0.0
* Started using semver
