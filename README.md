# README #

LajiMap is a configurable map component built on Leaflet. The main focus is on rendering geoJSON features and drawing & editing geoJSON features. It has built-in support for EPSG:3857 and EPSG:3067 projections.

## Installing ##

```
npm install laji-map --save
```

## Usage ##

```
var LajiMap = require("laji-map");
var map = new LajiMap(options);
```

## Options ##

Option                                          | Type                      |  Default                            | Description
------------------------------------------------|---------------------------|-------------------------------------|------------------------------------
rootElem                                        | HTML elem                 | -                                   | The node where to mount.
lang                                            | String                    | "en"                                | one of "en", "fi", "sv".
data                                            | Data options[]            | -                                   | Noneditable data to draw on map.
draw                                            | Draw options              | -                                   | Options for the editable feature collection.
controlSettings                                 | Control options           | -                                   | An option object that defines which control should be shown.
tileLayerName                                   | String                    | "taustakartta"                      | The default tile layer. One of "taustakartta", "pohjakartta", "maastokartta", "openStreetMap" or "googleSatellite".
overlayNames                                    | String[]                  | -                                   | The default overlay layers. Possible values:  "geobiologicalProvinces", "forestVegetationZones", "mireVegetationZones", "threatenedSpeciesEvaluationZones", "ykjGrid" and "ykjGridLabels".
center                                          | LatLng                    | [65, 26]                            | The coordinates for the initial center of the map.
zoom                                            | Int                       | 2                                   | The initial zoom level for the map.
locate                                          | Boolean                   | false                               | The map is centered to the user location if found.
onPopupClose()                                  | Function                  | -                                   | Function to call when a popup is closed
markerPopupOffset                               | Int                       | 0                                   | Offset (towards up) for popups for markers.
featurePopupOffset                              | Int                       | 0                                   | Offset (towards up) for popups for features other than markers.
popupOnHover                                    | Boolean                   | false                               | Controls whether the popups are shown on hovering a feature or by clicking a feature.
onInitializeDrawLayer                           | Function                  | -                                   | A callback function that is triggered after the draw layer is initialized.
lineTransect                                    | Linetransect options      | -                                   | Options for a line transect layer.

### Data options ###

Option                                          | Type                      |  Default                            | Description
------------------------------------------------|---------------------------|-------------------------------------|------------------------------------
featureCollection                               | GeoJSON featureCollection | Empty feature collection            | The feature collection to render.
getPopup(idx, geometry, callback)               | Function                  | -                                   | Function that returns a popup string, or calls the callback with the popup string.
getTooltip(idx, geometry, callback)             | Function                  | -                                   | Function that returns a tooltip string, or calls the callback with the tooltip string.
getFeatureStyle({dataIdx, featureIdx, feature}) | Function                  | see `lajiMap._getDefaultDataStyle()`| A function that returns a Path style to use for the feature described by the input parameters. (Note that draw data doesn't receive `dataIdx` input).
cluster                                         | Boolean                   | false                               | Controls whether the features should cluster.
getClusterStyle({count))                        | Function                  | see `lajiMap._getClusterIcon()`     | A function that returns a Path style to use for feature clusters. The returned path style extends the default style. the `count` parameter is the number of features in the cluster.


### Draw options ###

Option                                          | Type                 |  Default                                 | Description
------------------------------------------------|----------------------|------------------------------------------|------------------------------------
data                                            | Data options         | Data with empty feature collection       | The GeoJSON feature collection to use as the data.
editable                                        | Boolean              | true                                     | Controls whether the data is editable.
hasActive                                       | Boolean              | false                                    | Controls whether a feature can be activated. Activating is controlled by clicking a feature and `lajiMap.setActiveIdx(idx)`
activeIdx                                       | Integer              | -                                        | The initial active idx. Works only if `hasActive` is `true`.
rectangle                                       | Boolean              | true                                     | Controls whether the draw data can contain a rectangle. Adding new rectangles is prevented. Map controls are affected by this option.
polygon                                         | Boolean              | true                                     | Controls whether the draw data can contain a polygon. Adding new polygons is prevented. Map controls are affected by this option.
polyline                                        | Boolean              | true                                     | Controls whether the draw data can contain a polyline. Adding new polylines is prevented. Map controls are affected by this option.
circle                                          | Boolean              | true                                     | Controls whether the draw data can contain a circle. Adding new circles is prevented. Map controls are affected by this option.
marker                                          | Boolean              | true                                     | Controls whether the draw data can contain a marker. Adding new markers is prevented. Map controls are affected by this option.
getDraftStyle                                   | Function             | true                                     | A function that returns a Path style to use for the feature during drawing & editing a feature.

### Control options ###

If control options is `true`, it is interpreted as a control options object with all default options.

Option                                          | Type                     |  Default                             | Description
------------------------------------------------|--------------------------|--------------------------------------|------------------------------------
draw                                            | Draw control options     | true                                 | Shows a map control for adding new features.
layer                                           | Boolean                  | true                                 | Shows a tile/baselayer control.
zoom                                            | Boolean                  | true                                 | Shows a zoom control.
scale                                           | Integer                  | true                                 | Shows a scale control as meters.
location                                        | Location control options | true                                 | Shows a location control.
coordinateInput                                 | Boolean                  | true                                 | Shows a control for entering a new feature to the draw layer by coordinates. Only shown if main options  `draw` option is set.
drawCopy                                        | Boolean                  | false                                | Shows a control for copying the draw data. Only shown if `draw` option is set.
drawClear                                       | Boolean                  | false                                | Shows a control for clearing all draw data. Only shown if `draw` option is set.
coordinates                                     | Boolean                  | false                                | Shows a control that shows the mouse position's coordinates in various formats.
lineTransect                                    | Line transect options    | true                                 | Shows a control for editing a line transect. Only shown if main options `lineTransect`is set.

#### Draw control options ####

If draw control is `true`, it is interpreted as a draw control options object with all default options.

Option                                          | Type                     |  Default                             | Description
------------------------------------------------|--------------------------|--------------------------------------|------------------------------------
rectangle                                       | Boolean                  | true                                 | Controls whether to show the rectangle drawing button. Shown only if main options `draw.rectangle` is `true`.
polygon                                         | Boolean                  | true                                 | Controls whether to show the polygon drawing button Shown only if main options `draw.polygon` is `true`..
polyline                                        | Boolean                  | true                                 | Controls whether to show the polyline drawing button. Shown only if main options `draw.polyline` is `true`.
circle                                          | Boolean                  | true                                 | Controls whether to show the circle drawing button. Shown only if main options `draw.circle` is `true`.
marker                                          | Boolean                  | true                                 | Controls whether to show the marker drawing button. Shown only if main options `draw.marker` is `true`.

#### Location control options ####

If location control is `true`, it is interpreted as a location control options object with all default options.

Option                                          | Type                     |  Default                             | Description
------------------------------------------------|--------------------------|--------------------------------------|------------------------------------
userLocation                                    | Boolean                  | true                                 | Controls whether to show the user locating button.
search (NOT SUPPORTED YET)                      | Boolean                  | true                                 | Controls whether to show a place name search input.

#### Line transect control options ####

If line transect control is true, it is interpreted as a line transect control options object with all default options.

Option                                          | Type                     |  Default                             | Description
------------------------------------------------|--------------------------|--------------------------------------|------------------------------------
split                                           | Boolean                  | true                                 | Controls whether to show the segment splitting button.
delete                                          | Boolean                  | true                                 | Controls whether to show the segment deletion button

## Methods ##

TODO.

The methods that are supposed to be used as private methods, and could break LajiMap's internal state if used wrong, start with an underscore.

`src/utils.js` contains some utilities for geoJSON and coordinate conversion.

## Development ##

Start the development playground with `npm start`.

To release a new version, run `npm run publish-to-npm`.

Try to keep the code style consistent - ```npm run lint``` should pass without errors.
