import React, { Component } from 'react';
import deepEquals from "deeper";
import { MenuItem } from "react-bootstrap";

// These are imported at componentDidMount, so they won't be imported on server side rendering.
let L;
let map, Control, FeatureGroup, geoJson, Path;
let draw;

const NORMAL_COLOR = "#257ECA";
const ACTIVE_COLOR = "#06840A";

const style = {
  map: {
    width: '100%',
    height: '100%'
  },
};

export default class MapComponent extends Component {
  constructor(props) {
    super(props);
    this.map = null;
    this.data = undefined;
    this.activeId = undefined;
    this.updateFromProps(props);
  }
  
  componentWillReceiveProps(props) {
    this.updateFromProps(props)
  }

  componentWillUnmount() {
    this.map.off();
    this.map = null;
    this.mounted = false;
  }

  render() {
    return (
      <div style={ style.map }>
        <div ref='map' style={ style.map } />
      </div>
    );
  }

  updateFromProps(props) {
    this.prevData = this.data ? this.data.slice(0) : undefined;
    this.data = props.data.slice(0);
    this.activeId = props.activeId;
    if (this.activateAfterUpdate !== undefined) {
      this.setActive(this.activateAfterUpdate);
      this.activateAfterUpdate = undefined;
    }
    if (this.mounted) this.redrawFeatures();
    else this.shouldUpdateAfterMount = true;
  }

  redrawFeatures() {
    if (!this.mounted) throw "map wasn't mounted";

    const shouldResetLayers = (!this.prevData && this.data || this.prevData.length !== this.data.length ||
                               !deepEquals(this.prevData, this.data));

    let drawnItems = shouldResetLayers ? geoJson(this.data) : this.drawnItems;
	  console.log(drawnItems);

    if (shouldResetLayers) this.drawnItems.clearLayers();
    
    this.idsToLeafletIds = {};
    this.leafletIdsToIds = {};
    
    let id = 0;
    drawnItems.eachLayer(layer => {
      this.idsToLeafletIds[id] = layer._leaflet_id;
      this.leafletIdsToIds[layer._leaflet_id] = id;

      if (shouldResetLayers) {
	      let j = id;

	      layer.on('click', () => {
		      if (!this.interceptClick()) this.setActive(j);
	      });
	      layer.on('dblclick', () => this.setEditable(j));

	      layer.bindContextMenu({
		      contextmenuItems: [{
			      text: 'Edit feature',
			      callback: () => this.setEditable(j)
		      }, {
			      text: 'Remove feature',
			      callback: () => this.onDelete(j)
		      }]
	      });
      }

      if (shouldResetLayers) this.drawnItems.addLayer(layer);
	    this.updateLayerStyle(id);
      id++;
    });

  }

  componentDidMount() {
    this.mounted = true;
    
    L = require('leaflet');
    ({ map, Control, FeatureGroup, geoJson, Path } = L);
    draw = require('leaflet-draw');
    require('proj4leaflet');
    require('./lib/Leaflet.MML-layers/mmlLayers.js');
    require('leaflet-contextmenu');
	  require('Leaflet.vector-markers');

    L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

    this.map = map(this.refs.map, {
      crs: L.TileLayer.MML.get3067Proj(),
      contextmenu: true,
      contextmenuItems: []
    });

    this.map.setView([
      this.props.longitude || 60.1718699,
      this.props.latitude || 24.9419917
    ], this.props.zoom || 10);

    const tileLayer = L.tileLayer.mml_wmts({
      layer: 'maastokartta'
    });

    this.map.addLayer(tileLayer);
    
    this.drawnItems = geoJson();
    this.map.addLayer(this.drawnItems);
    if (this.shouldUpdateAfterMount) this.redrawFeatures();

	  const drawOptions = {
      position: 'topright',
      draw: {
        circle: false
      },
      edit: {
        featureGroup: this.drawnItems,
	      edit: false,
	      remove: false
      }
    };

	  ['polyline', 'polygon', 'rectangle'].forEach(type => {
		  drawOptions.draw[type] = {shapeOptions: this.getStyleForType(type, {opacity: 0.8})}
	  });
	  console.log(drawOptions);

    // Initialise the draw control and pass it the FeatureGroup of editable layers
    const drawControl = new Control.Draw(drawOptions);

    this.map.addControl(drawControl);

    this.map.on('click', () => {
      this.interceptClick();
    });
    this.map.on('dblclick', (e) => {
      this.onAdd(new L.marker(e.latlng));
    });
    this.map.on('draw:created', ({ layer }) => this.onAdd(layer));
  }

  getLayerById = id => {
    return this.drawnItems._layers[this.idsToLeafletIds[id]];
  }

  onChange = change => {
    if (this.props.onChange) this.props.onChange(change);
  }

  onAdd = layer => {
    this.activateAfterUpdate = this.data.length;
    this.onChange({
      type: 'create',
      data: layer.toGeoJSON()
    });
  };

  onEdit = data => {
	  for (let id in data) {
      data[id] = data[id].toGeoJSON();
    }

    this.onChange({
      type: 'edit',
      data: data
    });
  }

  onDelete = ids => {
	  if (!Array.isArray(ids)) ids = [ids];
    if (this.data && this.data.filter((item, id) => !ids.includes(id)).length === 0) {
      this.setActive(undefined)
    } else if (this.activeId !== undefined && ids.includes(this.activeId)) {
      let newActiveId = undefined;
      if (this.activeId === 0 && ids.length != this.data.length) newActiveId = 0;
      else {
        newActiveId = this.activeId;
        let idxOfActive = ids.indexOf(this.activeId);
        for (let idx = idxOfActive; idx >= 0; idx--) {
          if (ids[idx] <= this.activeId) newActiveId--;
        }
        if (newActiveId === -1) newActiveId = 0;
      }
      this.setActive(newActiveId);

    } else if (this.activeId) {
      let newActiveId = this.activeId;
      ids.forEach(id => {
        if (id < newActiveId) newActiveId--;
      })
      if (newActiveId !== this.activeId) this.setActive(newActiveId);
    }

    this.onChange({
      type: 'delete',
      ids: ids
    });
  }

  setActive = id => {
    this.onChange({
      type: 'active',
      id: id
    });
  }

  focusToLayer = id => {
    if (id === undefined) {
      this.activeId = id;
      return;
    }

    let layer = this.getLayerById(id);
    if (!layer) return;

    if (layer instanceof L.Marker) {
      this.map.setView(layer.getLatLng());
    } else  {
      this.map.fitBounds(layer.getBounds());
    }

    this.setActive(id);
  }

  setEditable = id => {
    this.editId = id;
    this.getLayerById(this.editId).editing.enable();
  }

  clearEditable = () => {
    this.getLayerById(this.editId).editing.disable();
    this.editId = undefined;
  }

  commitEdit = () => {
    this.onEdit({[this.editId]: this.getLayerById(this.editId)});
    this.clearEditable();
  }

  interceptClick = () => {
    if (this.editId !== undefined) {
      this.commitEdit();
      return true;
    }
  }

	getStyleForType = (type, overrideStyles) => {
		const styles = {
			weight: type.toLowerCase().includes("line") ? 8 : 14,
			opacity: 1,
			fillOpacity: 0.4,
			color: NORMAL_COLOR
		};

		if (overrideStyles) for (let style in overrideStyles) {
			styles[style] = overrideStyles[style];
		}

		return styles;
	}

	getStyleForId = id => {
		return this.getStyleForType(this.data[id].geometry.type,
			{color: this.activeId === id ? ACTIVE_COLOR : NORMAL_COLOR});
	}

  updateLayerStyle = id => {
	  const layer = this.getLayerById(id);


    if (layer instanceof L.Marker) {
	    layer.setIcon(
		    L.VectorMarkers.icon({
					prefix: 'glyphicon',
					icon: 'record',
					markerColor: this.activeId === id ? ACTIVE_COLOR : NORMAL_COLOR
				})
	    );
    } else {
	    if (this.activeId === id) style.color = ACTIVE_COLOR;
      layer.setStyle(this.getStyleForId(id));
    }
  }

}
