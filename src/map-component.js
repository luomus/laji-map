import React, { Component } from 'react';

import { map, Proj, Control, FeatureGroup, geoJson, Path } from 'leaflet';

import draw from 'leaflet-draw';

import 'proj4leaflet';

import MMLWmtsLayer from './mml-wmts-tile-layer.js';

const style = {
  map: {
    height: '100%',
  },
};

export default class MapComponent extends Component {
  constructor(props) {
    super(props);
    this.map = null;
    this.layer = null;
  }

  componentDidMount() {
    L.Icon.Default.imagePath = 'http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images';

    this.map = map(this.refs.map, {
      crs: new Proj.CRS.TMS('EPSG:3067',
      '+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
      [
        -548576,
        6291456,
        1548576,
        8388608
      ],
      {
        origin: [
          0,
          0
        ],
        resolutions: [
          8192,
          4096,
          2048,
          1024,
          512,
          256,
          128,
          64,
          32,
          16,
          8,
          4,
          2,
          1,
          0.5,
          0.25,
          0.125,
          0.0625,
          0.03125,
          0.015625,
        ]
      }),
    });

    this.map.setView([
      this.props.longitude || 60.1718699,
      this.props.latitude || 24.9419917
    ], this.props.zoom || 10);

    const layer = new MMLWmtsLayer({
      layer: 'maastokartta',
    });

    this.map.addLayer(layer);

    // Initialise the FeatureGroup to store editable layers
    this.drawnItems = geoJson(this.props.data);

    let ids = [];
    this.drawnItems.eachLayer(layer => {
      ids.push(layer._leaflet_id);
      this.initializeFeatureLayer(layer)
    });
    if (this.props.getInitialIds) this.props.getInitialIds(ids);

    this.map.addLayer(this.drawnItems);

    // Initialise the draw control and pass it the FeatureGroup of editable layers
    const drawControl = new Control.Draw({
      position: 'topright',
      draw: {
        circle: false
      },
      edit: {
        featureGroup: this.drawnItems
      }
    });

    this.map.addControl(drawControl);

    function layersToIds(layers) {
      return Object.keys(layers._layers).map( id => { return parseInt(id); });
    }

    this.map.on('draw:created', e => {

      const { layer, layerType } = e;

      this.initializeFeatureLayer(layer);

      if (layerType !== 'marker') {
        const { options } = new Path();
        layer.setStyle(options);
      }

      // Do whatever else you need to. (save to db, add to map etc)
      this.drawnItems.addLayer(layer);

      let id = layer._leaflet_id;
      if(this.props.onChange) {
        this.props.onChange({
          type: 'create',
          id: id,
          data: layer.toGeoJSON()
        });
      }

      this.drawnItems.resetStyle();
    });

    this.map.on('draw:edited', e => {
      const { layers, layerType } = e;

      let data = {};
      Object.keys(layers._layers).map(id => {
        data[id] = layers._layers[id].toGeoJSON();
      });

      if(this.props.onChange) {
        this.props.onChange({
          type: 'edit',
          data: data
        });
      }
    });

    this.map.on('draw:deleted', e => {
      const { layers, layerType } = e;

      if(this.props.onChange) {
        this.props.onChange({
          type: 'delete',
          ids: layersToIds(layers)
        });
      }
    });
  }

  initializeFeatureLayer = (layer)  => {
    layer.on('click', () => {
      if (this.props.onFeatureClick) this.props.onFeatureClick(layer._leaflet_id);
    });
  }

  componentWillUnmount() {
    this.map.off();
    this.map = null;
  }

  render() {
    return (
      <div ref='map' style={ style.map } />
    );
  }

}
