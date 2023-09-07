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

You can also pass any options that Leaflet accepts when initializing LajiMap. Setting Leaflet options after initialization doesn't work.

Option                                          | Type                      |  Default                                                                                      | Description
------------------------------------------------|---------------------------|-----------------------------------------------------------------------------------------------|------------------------------------
rootElem                                        | HTML elem                 | -                                                                                             | The node where to mount.
lang                                            | String                    | "en"                                                                                          | One of "en", "fi", "sv".
data                                            | Data options[]            | -                                                                                             | Data to draw on map.
draw                                            | Draw options              | -                                                                                             | Options for data that can be controlled with the draw control buttons.
controls                                        | Control options           | -                                                                                             | An option object that defines which control should be shown.
customControls                                  | Custom controls options[] | -                                                                                             | An array of custom controls. See custom control options.
tileLayerName                                   | String                    | "taustakartta"                                                                                | The default tile layer name. Possible values listed under section "Tile layer options". Overridden by `tileLayers`.
overlayNames                                    | String[]                  | -                                                                                             | The default overlay layers. Possible values listed under section "Tile layer options". Overridden by `tileLayers`
tileLayers                                      | TileLayers options        | -                                                                                             | Options for the tile layers, which allows multiple active layers. Overrides `tileLayerName`.
center                                          | LatLng                    | [65, 26]                                                                                      | The coordinates for the initial center of the map.
zoom                                            | Int                       | 2                                                                                             | The initial zoom level for the map.
zoomToData                                      | FitBounds options         | false                                                                                         | Zooms the map to given data & draw data. Additional options are: {paddingInMeters: number, minZoom: number, dataIdxs: number[], draw: boolean}.
locate                                          | Object                    | false                                                                                         | Show  user location on map. Options: {on: boolean, onLocationFound: fn(latlng, radius), onLocationError: fn(event), userLocation: {latlng, accuracy}, panOnFound: boolean (true by default)}
onPopupClose()                                  | Function                  | -                                                                                             | Function to call when a popup is closed
markerPopupOffset                               | Int                       | 40                                                                                            | Offset (towards up) for popups for markers.
featurePopupOffset                              | Int                       | 5                                                                                             | Offset (towards up) for popups for features other than markers.
popupOnHover                                    | Boolean                   | false                                                                                         | Controls whether the popups are shown on hovering a feature or by clicking a feature.
onInitializeDrawLayer                           | Function                  | -                                                                                             | A callback function that is triggered after the draw layer is initialized.
lineTransect                                    | Linetransect options      | -                                                                                             | Options for a line transect layer.
availableTileLayerNamesWhitelist                | String[]                  | -                                                                                             | List of tile layer names to show in the layer control. See the possible values of tileLayerName option.
availableTileLayerNamesBlacklist                | String[]                  | -                                                                                             | List of tile layer names not to show in the layer control. See the possible values of tileLayerName option.
availableOverlayNamesWhitelist                  | String[]                  | -                                                                                             | List of overlay names to show in the layer control. See the possible values of overlayNames option.
availableOverlayNamesBlacklist                  | String[]                  | ["kiinteistojaotus", "kiinteistotunnukset", "flyingSquirrelPredictionModel", "barentsRegion"] | List of overlay names not to show in the layer control. See the possible values of overlayNames option.
tileLayerOpacity                                | Float                     | -                                                                                             | Tile layer opacity. Range: 0.0-1.0
on                                              | Object                    | -                                                                                             | Leaflet events to listen for. Must be an object with event names as keys and value as callbacks. You can also use setEventListeners().
polygon                                         | Object                    | -                                                                                             | Polygon options: {allowIntersection: Boolean, Path style options}
polyline                                        | Object                    | -                                                                                             | Polyline options: {showStart: Boolean (displays a dot at the start of the line. Default: false). showDirection: Boolean (displays arrows to show the direction. Default: true), Path style options}.
rectangle                                       | Object                    | -                                                                                             | Global path style options.
circle                                          | Object                    | -                                                                                             | Global Path style options.
marker                                          | Object                    | -                                                                                             | Global Path style options.
bodyAsDialogRoot                                | Boolean                   | true                                                                                          | If true, body will be used as root DOM node for dialogs & blocker element. Otherwise the map container will be used as the root DOM node for dialogs.
clickBeforeZoomAndPan                           | Boolean                   | false                                                                                         | Block wheel and touchstart events before map is clicked/touched.
viewLocked                                      | Boolean                   | false                                                                                         | Prevent all view interaction (panning, zooming).
googleApikey                                    | String                    | -                                                                                             | Needed for geocoding control.
lajiGeoServerAddress                            | String                    | "https://geoserver.laji.fi"                                                                   | Override the laji.fi geoserver address

### Data options ###

Option                                                                                      | Type                              |  Default                            | Description
--------------------------------------------------------------------------------------------|-----------------------------------|-------------------------------------|------------------------------------
featureCollection                                                                           | GeoJSON featureCollection         | Empty feature collection            | The feature collection to render.
getPopup({dataIdx, featureIdx, feature, item}, callback)                                    | Function                          | -                                   | Function that returns a popup string, or calls the callback with the popup string.
getTooltip({dataIdx, featureIdx, feature, item}, callback)                                  | Function                          | -                                   | Function that returns a tooltip string, or calls the callback with the tooltip string.
getFeatureStyle({dataIdx, featureIdx, feature, item, hovered, editable, active})            | Function                          | See `lajiMap._getDefaultDataStyle()`| A function that returns a Path style to use for the feature described by the input parameters.
cluster                                                                                     | Boolean                           | false                               | Controls whether the features should cluster.
getClusterStyle({count, featureIdxs, cluster))                                              | Function                          | See `lajiMap._getClusterIcon()`     | A function that returns a Path style to use for feature clusters. The returned path style extends the default style. the `count` parameter is the number of features in the cluster. `featureIdxs` is an array of featureIdxs of the cluster and `cluster` is the Leaflet cluster object.
getClusterClassName({count, featureIdxs, cluster))                                          | Function                          | -                                   | A function that returns a class name to use for feature clusters. The `count` parameter is the number of features in the cluster. `featureIdxs` is an array of featureIdxs of the cluster and `cluster` is the Leaflet cluster object.
getDraftStyle                                                                               | Function                          | true                                | A function that returns a Path style to use for the feature during drawing & editing a feature.
on                                                                                          | Object                            | -                                   | An object containing event name -> event handler pairs. Supports both basic Leaflet layer events and cluster container events.  Event handler arguments look like this: (e, {idx, layer, feature}). Example: {click: function(e, {idx, layer, feature}) { //handle event }}
editable                                                                                    | Boolean                           | true                                | Controls whether the data is editable.
hasActive                                                                                   | Boolean                           | -                                   | Whether features can be activated.
activeIdx                                                                                   | Integer                           | -                                   | The initial active idx. If not given, the data doesn't allow activating any feature. If 'undefined', features can be activated but there is initially no active features.
marker                                                                                      | Object                            | -                                   | Marker options: {icon: (options: style options, feature: GeoJSON feature) => L.Icon (the icon should implement `setStyle({color, opacity})` so laji-map can style it according to getfeatureStyle() etc., maxFillOpacity: number, controlFillOpacity }
polygon                                                                                     | Object                            | -                                   | Polygon options: {allowIntersection: Boolean, maxFillOpacity: Number, controlFillOpacity: Boolean}
polyline                                                                                    | Object                            | -                                   | Polyline options: {showStart: Boolean (displays a dot at the start of the line. Default: false). showDirection: Boolean (displays arrows to show the direction. Default: true), maxFillOpacity: Number, controlFillOpacity: Boolean}.
rectangle                                                                                   | Object                            | -                                   | Rectangle options: {maxFillOpacity: Number, controlFillOpacity: Boolean}.
circle                                                                                      | Object                            | -                                   | Circle options: {maxFillOpacity: Number, controlFillOpacity: Boolean}.
onChange                                                                                    | Function                          | -                                   | A callback function that fires events for draw data changes. Receives an array of event objects.
highlightOnHover                                                                            | Boolean                           | false                               | Highlights layers on hover even if the item isn't editable or doesn't have an active idx.
single                                                                                      | Boolean                           | false                               | Allows only a single feature on the data. Adding new feature removes all other features.
showMeasurements                                                                            | Boolean \| {showOnHover: boolean} | false                               | Shows feature measurements.
opacity                                                                                     | number (0 - 1)                    | 1                                   | Opacity of the data.
maxFillOpacity                                                                              | number (0 - 1)                    | 0.4                                 | Max fill opacity (for polygons & circles) that the layer control can adjust the opacity to. Overridable with layer type options (see options for data options marker, polygon etc).
visible                                                                                     | Boolean                           | true                                | Whether the data is visible.
onOpacityChange                                                                             | Function                          | -                                   | Callback for opacity change
onVisibleChange                                                                             | Function                          | -                                   | Whether the data is visible.
label                                                                                       | String                            | -                                   | If provided, the data visibility/opacity will be controllable in the layer control.
controlFillOpacity                                                                          | Boolean                           | -                                   | If provided, the data visibility/opacity controlling will control layer fillOpacity instead of opacity. Overridable with layer type options (see options for data options marker, polygon etc).


### Draw options ###

Draw options extend data options with `editable: true` as default.

Option                                          | Type                 |  Default                                 | Description
------------------------------------------------|----------------------|------------------------------------------|------------------------------------
rectangle                                       | Boolean              | true                                     | Controls whether the draw data can contain a rectangle. Adding new rectangles is prevented. Map controls are affected by this option.
polygon                                         | Boolean              | true                                     | Controls whether the draw data can contain a polygon. Adding new polygons is prevented. Map controls are affected by this option.
polyline                                        | Boolean              | true                                     | Controls whether the draw data can contain a polyline. Adding new polylines is prevented. Map controls are affected by this option.
circle                                          | Boolean              | true                                     | Controls whether the draw data can contain a circle. Adding new circles is prevented. Map controls are affected by this option.
marker                                          | Boolean              | true                                     | Controls whether the draw data can contain a marker. Adding new markers is prevented. Map controls are affected by this option.

### Line transect options ###

Option                                                                                                                                          | Type                 |  Default                                 | Description
------------------------------------------------------------------------------------------------------------------------------------------------|----------------------|------------------------------------------|------------------------------------
feature                                                                                                                                         | GeoJSON Feature      | -                                        | The GeoJSON feature to use as the data.
activeIdx                                                                                                                                       | Integer              | -                                        | The index of the active line transect segment.
onChange                                                                                                                                        | Function             | -                                        | A function that fires events for line transect changes. Receives an array of event objects.
getFeatureStyle({lineIdx, segmentIdx, style = &lt;the default style object for this layer&gt;, type = L.Polyline | L.Polygon | L.CircleMarker}) | Function             | -                                        | A function that returns a Path style to use for the line layer components. Signature: 
getTooltip(lineIdx, callback)                                                                                                                   | Function             | -                                        | Function that returns a popup string, or calls the callback with the popup string.
printMode                                                                                                                                       | Boolean              | False                                    | If true, line will be styled for printing.
editable                                                                                                                                        | Boolean              | True                                     | If false, line can't be edited.

### Control options ###

If control options is `true`, it is interpreted as a control options object with all default options.

Option                                          | Type                     |  Default                             | Description
------------------------------------------------|--------------------------|--------------------------------------|------------------------------------
draw                                            | Draw control options     | true                                 | Shows a map control for adding new features.
layer                                           | Boolean                  | true                                 | Shows a tile/baselayer control.
zoom                                            | Boolean                  | true                                 | Shows a zoom control.
scale                                           | Boolean                  | true                                 | Shows a scale control as meters.
location                                        | Boolean                  | true                                 | Shows a location control.
geocoding                                       | Boolean                  | true                                 | Shows a geocoding control. You need to provide `googleApiKey` also to the map options.
coordinates                                     | Boolean                  | false                                | Shows a control that shows the mouse position's coordinates in various formats.
lineTransect                                    | Line transect options    | true                                 | Shows a control for editing a line transect. Only shown if main options `lineTransect`is set.
fullscreen                                      | Boolean                  | false                                | Shows a fullscreen control.

#### Draw control options ####

If draw control is `true`, it is interpreted as a draw control options object with all default options. If draw-option isn't set, the draw controls won't be shown.

Option                                          | Type                     |  Default                             | Description
------------------------------------------------|--------------------------|--------------------------------------|------------------------------------
rectangle                                       | Boolean                  | true                                 | Controls whether to show the rectangle drawing button. Shown only if main options `draw.rectangle` is `true`.
polygon                                         | Boolean                  | true                                 | Controls whether to show the polygon drawing button Shown only if main options `draw.polygon` is `true`..
polyline                                        | Boolean                  | true                                 | Controls whether to show the polyline drawing button. Shown only if main options `draw.polyline` is `true`.
circle                                          | Boolean                  | true                                 | Controls whether to show the circle drawing button. Shown only if main options `draw.circle` is `true`.
marker                                          | Boolean                  | true                                 | Controls whether to show the marker drawing button. Shown only if main options `draw.marker` is `true`.
coordinateInput                                 | Boolean                  | true                                 | Shows a control for entering a new feature to the draw layer by coordinates.
copy                                            | Boolean                  | false                                | Shows a control for copying the draw data.
clear                                           | Boolean                  | false                                | Shows a control for clearing all draw data.
reverse                                         | Boolean                  | false                                | Shows a control for reversing polyline features.
delete                                          | Boolean                  | false                                | Shows a control for deleting features.
undo                                            | Boolean                  | true                                 | Shows a control for undoing draw actions.
redo                                            | Boolean                  | true                                 | Shows a control for redoing draw actions.

#### Line transect control options ####

If line transect control is true, it is interpreted as a line transect control options object with all default options.

Option                                          | Type                     |  Default                             | Description
------------------------------------------------|--------------------------|--------------------------------------|------------------------------------
split                                           | Boolean                  | true                                 | Controls whether to show the segment splitting button.
delete                                          | Boolean                  | true                                 | Controls whether to show the segment deletion button

### Custom control options ###

An array of custom control items. A control item is either a singular control, or a collection of control items (the control items in a collection must be singular control items).

Option                                          | Type                     |  Default                             | Description
------------------------------------------------|--------------------------|--------------------------------------|------------------------------------
controls                                        | Control items[]          | -                                    | Sets this control item to a collection of contor items.
text                                            | String                   | -                                    | Text to show in control button tooltip and in the context menu.
position                                        | String                   | "topleft"                            | The corner where the control is shown at.
fn                                              | Function                 | -                                    | A callback function that is called upon control click.
stopFn                                          | Function                 | -                                    | A callback function that is called upon control action cancel (an action cancel handler is created if stopFn is given). Useful for functions that start a continuous action that should be cancellable.
eventName                                       | String                   | -                                    | A name for the event that is triggered on action stop.
iconCls                                         | String                   | -                                    | A class that is added to the button icon.
onAdd                                           | Function                 | -                                    | A callback that is called when the control is added to the map.
contextMenu                                     | Boolean                  | true                                 | If true, control is added to the context menu.
group                                           | String                   | -                                    | A pre-existing control group to add the group to. Will be displayed according to the groups rules.

### Tile layer options ###

Tile layer options which combine tile layers and overlays into single options object. Allows multiple layers with different opacity.

Option | Type                     |  Default  | Description
-------|--------------------------|-----------|------------------------------------
active | "finnish" | "world"      | "finnish" | The projection to use.
layers | Object                   | -         | Signature: {[tile layer or overlay name]: boolean \| {opacity: 0-1, visible: boolean}}

Possible layer names are:

```
maastokartta
taustakartta
ortokuva
laser
openStreetMap
googleSatellite
afeGrid
cgrsGrid
geobiologicalProvinces
geobiologicalProvincesBorders
municipalities
counties
ely
forestVegetationZones
mireVegetationZones
threatenedSpeciesEvaluationZones
biodiversityForestZones
habitat
ageOfTrees
ykjGrid
ykjGridLabels
kiinteistojaotus
kiinteistotunnukset
currentProtectedAreas
plannedProtectedAreas
flyingSquirrelPredictionModel
birdAtlasSocietyGridZones
```

## Methods ##

TODO.

The methods that are supposed to be used as private methods, and could break LajiMap's internal state if used wrong, start with an underscore.

`src/utils.js` contains some utilities for geoJSON and coordinate conversion.

## Events ##

LajiMap provides the following events in addition to the Leaflet events.

Option                                           | Data property in event
-------------------------------------------------|-----------------------
tileLayersChange                                 | tileLayers        
tileLayerChange                                  | tileLayerName        
tileLayerOpacityChange                           | tileLayerOpacity     
tileLayerOpacityChangeEnd                        | tileLayerOpacity     
overlaysChange                                   | overlayNames         
lineTransect:split                               | -                    
lineTransect:delete                              | -                    
lineTransect:pointdrag                           | -                    

## Development ##

Install the dependencies with `npm start`.

Start the development playground with `npm start`.

To release a new version, run `npm run publish-to-npm`.

Try to keep the code style consistent - ```npm run lint``` should pass without errors.

In order to use the geocoding widget, you should provide the Google API key to properties.json. See properties.json.example.

The map options can be controlled with query parameters. In addition, `testMode` query param will start the map with the default options.

## Tests ##

You need to update the webdriver before testing: 

```
webdriver-manager update
```

The playground server must be running before running the tests.

Run the tests with `npm test`. For more robust testing, run `npm run test:slow`. It runs test after 500ms delay after the map has been initialized.

### Test parameters ###

Parameters are given as envirnment variables, i.e. `TEST_BROWSER=chrome npm test`

Option         | Default | Description
---------------|---------|-----------------------------------------------------------------------------------------------
TEST_BROWSER   | -       | `chrome` or `firefox`. Tests are run for both by default.
HEADLESS       | `true`  | Run the tests in a visible browser window if `true`.
VERBOSE        | `false` | Logs the playground URI's used by tests so you can get debug the test cases in playground easier.
DELAY          | -       | Makes all tests wait DELAY milliseconds ebetween the map being initialized and the test run.
