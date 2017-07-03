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
customControls                                  | Object               | -                                        | An array of custom controls. See custom control options.
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
availableTileLayerNamesWhitelist                | String[]                  | -                                   | List of tile layer names to show in the layer control. See the possible values of tileLayerName option.
availableTileLayerNamesBlacklist                | String[]                  | -                                   | List of tile layer names not to show in the layer control. See the possible values of tileLayerName option.
availableOverlayNamesWhitelist                  | String[]                  | -                                   | List of overlay names to show in the layer control. See the possible values of overlayNames option.
availableOverlayNamesBlacklist                  | String[]                  | -                                   | List of overlay names not to show in the layer control. See the possible values of overlayNames option.
tileLayerOpacity                                | Float                     | -                                   | Tile layer opacity. Range: 0.0-1.0
on                                              | Object                    | -                                   | Leaflet events to listen for. Must be an object with event names as keys and value as callbacks. You can also use setEventListeners().

### Data options ###


Option                                          | Type                      |  Default                            | Description
------------------------------------------------|---------------------------|-------------------------------------|------------------------------------
featureCollection                               | GeoJSON featureCollection | Empty feature collection            | The feature collection to render.
getPopup(idx, geometry, callback)               | Function                  | -                                   | Function that returns a popup string, or calls the callback with the popup string.
getTooltip(idx, geometry, callback)             | Function                  | -                                   | Function that returns a tooltip string, or calls the callback with the tooltip string.
getFeatureStyle({dataIdx, featureIdx, feature}) | Function                  | see `lajiMap._getDefaultDataStyle()`| A function that returns a Path style to use for the feature described by the input parameters. (Note that draw data doesn't receive `dataIdx` input).
cluster                                         | Boolean                   | false                               | Controls whether the features should cluster.
getClusterStyle({count))                        | Function                  | see `lajiMap._getClusterIcon()`     | A function that returns a Path style to use for feature clusters. The returned path style extends the default style. the `count` parameter is the number of features in the cluster.
on                                              | Object                    | -                                   | An object containing event name -> event handler pairs. Event handler arguments look like this: (e, {idx, layer, feature}). Example: {click: function(e, {idx, layer, feature}) { //handle event }}


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
onChange                                        | Function             | -                                        | A callback function that fires events for draw data changes. Receives an array of event objects.

### Line transect options ###

Option                                          | Type                 |  Default                                 | Description
------------------------------------------------|----------------------|------------------------------------------|------------------------------------
feature                                         | GeoJSON Feature      | -                                        | The GeoJSON feature to use as the data.
activeIdx                                       | Integer              | -                                        | The index of the active line transect segment.
onChange                                        | Function             | -                                        | A function that fires events for line transect changes. Receives an array of event objects.

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
layerOpacity                                    | Boolean                  | true                                 | Adds a tile layer opacity range slider to the layer control.

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


### Custom control options ###

An array or custom control items. A control item is either a singular control, or a collection of control items (the control items in a collection must be singular control items).

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
layerOpacity                                    | Boolean                  | true                                 | Adds a tile layer opacity range slider to the layer control.

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

## Events ##

LajiMap provides the following events in addition to the Leaflet events.

Option                                          | Data property in event
------------------------------------------------|-----------------------
tileLayerChange                                 | tileLayerName        
tileLayerOpacityChange                          | tileLayerOpacity     
tileLayerOpacityChangeEnd                       | tileLayerOpacity     
overlaysChange                                  | overlayNames         
lineTransect:split                              | -                    
lineTransect:delete                             | -                    
lineTransect:pointdrag                          | -                    

## Development ##

Start the development playground with `npm start`.

To release a new version, run `npm run publish-to-npm`.

Try to keep the code style consistent - ```npm run lint``` should pass without errors.
