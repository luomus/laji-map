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
    const drawnItems = this.props.data ? geoJson(this.props.data) : new FeatureGroup();

    this.map.addLayer(drawnItems);

    // Initialise the draw control and pass it the FeatureGroup of editable layers
    const drawControl = new Control.Draw({
      position: 'topright',
      draw: {
        marker: false,
      },
      edit: {
        featureGroup: drawnItems
      }
    });

    this.map.addControl(drawControl);

    this.map.on('draw:created', e => {

      const { layer, layerType } = e;

      const { options } = new Path();

      layer.setStyle(options);

      // Do whatever else you need to. (save to db, add to map etc)
      drawnItems.addLayer(layer);

      if(this.props.onChange) {
        this.props.onChange({
          type: 'create',
          data: drawnItems.toGeoJSON(),
        });
      }

      drawnItems.resetStyle();
    });

    this.map.on('draw:edited', e => {

      const { layer, layerType } = e;

      if(this.props.onChange) {
        this.props.onChange({
          type: 'edit',
          data: drawnItems.toGeoJSON(),
        });
      }
    });

    this.map.on('draw:deleted', e => {

      const { layer, layerType } = e;

      if(this.props.onChange) {
        this.props.onChange({
          type: 'delete',
          data: drawnItems.toGeoJSON(),
        });
      }
    });
  }

  componentWillUnmount() {
    this.map.off();
    this.map = null;
  }

  render() {
    return (
      <div ref="map" style={ style.map } />
    );
  }

}
