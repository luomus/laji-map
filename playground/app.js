import React, { Component, PropTypes } from 'react';
import { render } from "react-dom"

import MapComponent from '../src/map-component';

import '../src/styles.js';

const style = {
  map: {
    width: '800px',
    height: '600px'
  }
}

class App extends Component {

  constructor(props) {
    super(props);
    this.state = {};
    this.state.data = [
      {"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[22.19795098463816,60.47883388654405]}},
      {"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[22.311658377997933,60.43453495634962]}}
    ]
    this.state.activeId = 0;
  }

  onMapChange = (e) => {
    let data = this.state.data;
    console.log(e);
    switch (e.type) {
      case "create":
        data.push(e.data);
        this.setState({data});
        break;
      case "delete":
        data = this.state.data.filter((item, i) => !e.ids.includes(i));
        this.setState({data});
        break;
      case "edit":
        for (let idx in e.data) {
          data[idx] = e.data[idx];
        }
        this.setState({data});
        break;
      case "active":
        this.setState({activeId: e.id})
    }
  }

  render () {
    return (
      <div style={style.map}>
        <MapComponent
          data={this.state.data}
          activeId={this.state.activeId}
          longitude={60.4353462}
          latitude={22.2285623}
          zoom={6}
          onChange={this.onMapChange} />
      </div>
    );
  }
}

render((<App />), document.getElementById("root"));
