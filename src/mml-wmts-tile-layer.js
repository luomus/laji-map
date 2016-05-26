import { TileLayer, Util, LatLng } from 'leaflet';

export default TileLayer.extend({
  options: {
    url: "http://avoindata.maanmittauslaitos.fi/mapcache/wmts",
    layer: "taustakartta",
    tileMatrixSet: "ETRS-TM35FIN",
    style: "default",
    tileSize: 256,
    maxZoom: 14,
    minZoom: 2,
    attribution : '&copy; <a href="http://www.maanmittauslaitos.fi/avoindata_lisenssi_versio1_20120501" target=new>Maanmittauslaitos</a>'
  },
  initialize: function (options) {
    this.options.matrixIds = this.getMMLMatrix();
    Util.setOptions(this, options);
  },
  getTileUrl: function(tilePoint) {
    var map = this._map;
    var crs = map.options.crs;
    var tileSize = this.options.tileSize;
    var zoom = map.getZoom();
    var point = tilePoint.multiplyBy(tileSize);
    var id = this.options.matrixIds[zoom].identifier;
    var cornerX = this.options.matrixIds[zoom].topLeftCorner.lng;
    var cornerY = this.options.matrixIds[zoom].topLeftCorner.lat;

    point.x+=1;
    point.y-=1;

    var tileCoord = crs.project(map.unproject(point, zoom));
    var col = Math.floor((tileCoord.x - cornerX)/ (tileSize * this.options.matrixIds[zoom].resolution));
    var row = -Math.floor((tileCoord.y - cornerY)/ (tileSize * this.options.matrixIds[zoom].resolution));
    var url = Util.template(this.options.url, {s: this._getSubdomain(tilePoint)});

    return url + "/1.0.0/" + this.options.layer +  "/" + this.options.style + "/ETRS-TM35FIN/"  + id + "/" + row +"/" + col +".png";
  },
  getMMLMatrix: function() {
    var matrixIds = [];

    for (var i = 0; i < 15; i++) {
      matrixIds[i] = {
        identifier : "" + i,
        topLeftCorner: new LatLng(8388608, -548576),
        resolution: Math.pow(2, 13 - i)
      };
    }

    return matrixIds;
  }
});
