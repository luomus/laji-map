import * as L from "leaflet";

export interface ContextmenuItemOptions {
	text: string;
	iconCls: string;
	callback: () => void;
}

export interface ContextMenuOptions {
	contextmenu?: boolean;
	contextmenuInheritItems?: boolean;
	contextmenuItems?: ContextmenuItemOptions[];
	contextmenuWidth?: number;
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
	interface MapOptions extends ContextMenuOptions { }

	interface Path {
		bindContextMenu(options: ContextMenuOptions): Path;
        unbindContextMenu();
	}

	interface Marker {
		bindContextMenu(options: ContextMenuOptions): Marker;
        unbindContextMenu();
	}
	interface Map {
		contextmenu: Contextmenu;
	}
}
