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
	}

	interface Marker {
		bindContextMenu(options: ContextMenuOptions): Marker;
	}
}
