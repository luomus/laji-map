import React, { Component, PropTypes } from 'react';

import MapComponent from './map-component';

import './styles.js';

const style = {
  map: {
    width: '800px',
    height: '600px',
  }
}

const data = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[24.94117255463528,60.17994558364109],[24.94743538755845,60.17436615002091]]}}]}'

class App extends Component {

  handleChange(e) {
    console.log(e.type, JSON.stringify(e.data));
  }

  render () {
    return (
      <div style={style.map}>
        <MapComponent
          data={JSON.parse(data)}
          longitude={60.4353462}
          latitude={22.2285623}
          zoom={6}
          onChange={this.handleChange.bind(this)} />
      </div>
    );
  }
}

export default App;
