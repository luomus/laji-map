// Doesn't work for some reason in compiled code. Included in src/map.ts.

//import * as L from "leaflet";
//
//interface ContextmenuItemOptions {
//	text: string;
//	iconCls: string;
//	callback: () => void;
//}
//
//interface ContextmenuOptions {
//	contextmenu?: boolean;
//	contextmenuInheritItems?: boolean;
//	contextmenuItems?: ContextmenuItemOptions[];
//	contextmenuWidth?: number;
//}
//
//export class ContextmenuItem {
//}
//
//interface Contextmenu {
//	addItem(options: ContextmenuItemOptions | "-"): HTMLElement;
//	removeAllItems(): void;
//	setDisabled(elem: HTMLElement | number, disabled: boolean): this;
//	isVisible(): boolean;
//}
//
//declare module "leaflet" {
//	interface MapOptions extends ContextmenuOptions { }
//
//	interface Path {
//		bindContextMenu(options: ContextmenuOptions): Path;
//		unbindContextMenu();
//	}
//
//	interface Marker {
//		bindContextMenu(options: ContextmenuOptions): Marker;
//		unbindContextMenu();
//	}
//
//	interface Map {
//		contextmenu: Contextmenu;
//	}

//	namespace Contextmenu {
//		interface Options extends ContextmenuOptions {}
//		interface ItemOptions extends ContextmenuItemOptions {}
//	}
//}
import * as L from "leaflet";
import "leaflet-draw";

declare module "leaflet" {
	interface LeafletEventHandlerFnMap extends L.LeafletEventHandlerFnMap {
		"contextmenu.show": (event: any) => void;
		"contextmenu.hide": (event: any) => void;
	}
}
