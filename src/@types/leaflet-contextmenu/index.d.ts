export interface ContextMenuItemOptions {
	text: string;
	iconCls: string;
	callback: () => void;
}

export interface ContextMenuOptions {
	contextmenu?: boolean;
	contextmenuInheritItems?: boolean;
	contextmenuItems?: ContextmenuItem[];
	contextmenuWidth?: number;
}

export class ContextmenuItem {
}

export class Contextmenu {
	addItem(options: ContextMenuItemOptions | "-"): HTMLElement;
	removeAllItems(): void;
	setDisabled(elem: HTMLElement | number, disabled: boolean): this;
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
