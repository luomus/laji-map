export interface ContextMenuOptions {
	contextmenu?: boolean;
	contextmenuInheritItems?: boolean;
	contextmenuItems?: any[];
	contextmenuWidth?: number;
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
}
