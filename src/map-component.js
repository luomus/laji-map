import React, { Component } from 'react';

// These are imported at componentDidMount, so they won't be imported on server side rendering.
let L;
let map, Control, FeatureGroup, geoJson, Path;
let draw;

const style = {
  map: {
    height: '100%'
  },
};

export default class MapComponent extends Component {
  constructor(props) {
    super(props);
    this.map = null;
    this.data = undefined;
		this.activeId = undefined;
    this.updateFromProps(props)
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
			<div ref='map' style={ style.map } />
		);
	}

  updateFromProps(props) {
    this.data = props.data;
	  this.activeId = props.activeId;
		if (this.activateAfterUpdate !== undefined) {
			//this.activeId = this.activateAfterUpdate;
			this.setActive(this.activateAfterUpdate);
			this.activateAfterUpdate = undefined;
		}
    if (this.mounted) this.redrawFeatures();
    else this.shouldUpdateAfterMount = true;
  }

  redrawFeatures() {
    if (!this.mounted) throw "map wasn't mounted";

    let drawnItems = geoJson(this.data);

    this.drawnItems.clearLayers();
    
    this.idsToLeafletIds = {};
    this.leafletIdsToIds = {};
    
    let id = 0;
    drawnItems.eachLayer(layer => {
      this.idsToLeafletIds[id] = layer._leaflet_id;
      this.leafletIdsToIds[layer._leaflet_id] = id;
			
			let j = id;
      layer.on('click', () => {
				if (this.preventActivatingByClick) return;
        this.focusToLayer(j);
      });
			
			this.setOpacity(layer);
      this.drawnItems.addLayer(layer);
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

	  L.Icon.Default.imagePath = "http://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/";

    this.map = map(this.refs.map, {
	    crs: L.TileLayer.MML.get3067Proj()
    });

    this.map.setView([
      this.props.longitude || 60.1718699,
      this.props.latitude || 24.9419917
    ], this.props.zoom || 10);

    const layer = L.tileLayer.mml_wmts({
      layer: 'maastokartta',
    });

    this.map.addLayer(layer);
    
    this.drawnItems = geoJson();
    this.map.addLayer(this.drawnItems);
    if (this.shouldUpdateAfterMount) this.redrawFeatures();

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

    this.map.on('draw:created', this.onAdd);
    this.map.on('draw:edited', this.onEdit);
    this.map.on('draw:deleted', this.onDelete);
		
		['deletestart', 'editstart'].forEach(start => this.map.on('draw:' + start, e => {
			this.preventActivatingByClick = true;
		}));
		['deletestop', 'editstop'].forEach(stop => this.map.on('draw:' + stop, e => {
			this.preventActivatingByClick = false;
		}));
  }
	
	onChange = change => {
		if (this.props.onChange) this.props.onChange(change);
	}

  onAdd = e => {
    const { layer } = e;

	  this.activateAfterUpdate = this.data.length;
    this.onChange({
			type: 'create',
			data: layer.toGeoJSON()
		});
  };

  onEdit = e => {
		const { layers } = e;

		let data = {};
		Object.keys(layers._layers).map(id => {
      data[this.leafletIdsToIds[id]] = layers._layers[id].toGeoJSON();
		});

    this.onChange({
			type: 'edit',
			data: data
		});
  }

	onDelete = e => {
		const { layers } = e;

		const ids = Object.keys(layers._layers).map(id => this.leafletIdsToIds[id]);

		if (this.activeId !== undefined && ids.includes(this.activeId)) {
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
		
		let layer = this.drawnItems._layers[this.idsToLeafletIds[id]];
    if (!layer) return;

    if (layer instanceof L.Marker) {
      this.map.setView(layer.getLatLng());
    } else  {
      this.map.fitBounds(layer.getBounds());
    }

	  this.setActive(id);
  }


	setOpacity = layer => {
		let id = this.leafletIdsToIds[layer._leaflet_id];

		let opacitySubtract = 0.4;

		if (layer instanceof L.Marker) {
			let opacity = 1;
			if (this.activeId !== id) opacity -= opacitySubtract;
			layer.setOpacity(opacity)
		} else {
			let options = new Path().options;
			let opacity = 1;
			let fillOpacity = options.fillOpacity;
			if (this.activeId !== id) {
				opacity -= opacitySubtract;
				fillOpacity = 0.1;
			}
			layer.setStyle({opacity, fillOpacity});
		}
	}

}
