import * as L from "leaflet";
import {TileLayer as _TileLayer} from "leaflet";

declare module "leaflet" {
    namespace TileLayer {
        namespace MML {
            function get3067Proj(): L.CRS;
        }
	}
	namespace tileLayer {
	    function mml_wmts(options: any): _TileLayer
        function mml(name: "TaustaKartta" | "Peruskartta" | "Ortokuva" | "Ortokuva_3067"): _TileLayer
    }
}
