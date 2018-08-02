import * as L from "leaflet";

export interface ContextmenuItemOptions {
	text: string;
	iconCls: string;
	callback: () => void;
}

export class ContextmenuItem {
}

export class Contextmenu {
	addItem(options: ContextmenuItemOptions | "-"): HTMLElement;
	removeAllItems(): void;
	setDisabled(elem: HTMLElement | number, disabled: boolean): this;
	isVisible(): boolean;
}

export interface ContextmenuEvent extends L.LeafletEvent {
	relatedTarget: L.Layer;
	contextmenu: Contextmenu
}

declare module "leaflet" {
	interface MapOptions extends ContextmenuOptions { }

	interface Path {
		bindContextMenu(options: ContextmenuOptions): Path;
        unbindContextMenu();
	}

	interface Marker {
		bindContextMenu(options: ContextmenuOptions): Marker;
        unbindContextMenu();
	}
	interface Map {
		contextmenu: Contextmenu;
	}
	export interface ContextmenuOptions {
		contextmenu?: boolean;
		contextmenuInheritItems?: boolean;
		contextmenuItems?: ContextmenuItemOptions[];
		contextmenuWidth?: number;
	}

}
