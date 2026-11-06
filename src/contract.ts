export type RootSelector = string;
export type ImageMode = "auto" | "always" | "never";
export type MouseButtonName = "left" | "right" | "middle";
export type ObserveDetail = "compact" | "outline";

export interface ObserveTargetParams {
	root?: RootSelector;
}

export interface FindParams {
	text?: string;
	/** Launch the app (by `app` name or `bundleId`) when no matching root exists yet. */
	launch?: boolean;
	/** Poll for a matching root for up to this many milliseconds. */
	waitMs?: number;
	app?: string;
	bundleId?: string;
	/** Exact positive process id. */
	pid?: number;
	/** Filters on the platform's best-effort presentation hint; only window vs transient is guaranteed. */
	kind?: "window" | "menu" | "sheet" | "popover" | "dialog" | "browser_page";
}

export interface StateTargetParams {
	stateId?: string;
}

export interface NavigateBrowserParams extends StateTargetParams {
	url: string;
}

export interface LaunchBrowserParams {
	url?: string;
}

export interface EvaluateBrowserParams {
	stateId: string;
	expression: string;
}

export interface ObserveParams extends ObserveTargetParams {
	mode?: "semantic" | "visual" | "fused";
	detail?: ObserveDetail;
	/** Internal capture override; not part of the model-facing schema. */
	readText?: "auto" | "always" | "never";
}

export interface SearchUiParams extends StateTargetParams {
	text?: string;
	role?: string;
	capability?: string;
}

export interface ExpandUiParams extends StateTargetParams {
	ref: string;
	depth?: number;
}

export interface InspectUiParams extends StateTargetParams {
	ref: string;
}

export interface UiCondition {
	ref?: string;
	scopeRef?: string;
	text?: string;
	role?: string;
	value?: string;
	until?: "present" | "absent";
	timeoutMs?: number;
}

/**
 * Coordinate space for x/y values.
 * - `image` (default): pixels of the state's screenshot, origin at the root's top-left.
 * - `screen`: global display points (macOS points / Windows+Linux virtual-screen pixels).
 */
export type CoordinateSpace = "image" | "screen";

/** One end of a drag. Exactly one of ref, text, or x/y is required. */
export interface DragEndpoint {
	ref?: string;
	/** State owning `ref` or `text`; defaults to the act_ui stateId. Use another root's state for cross-app drags. */
	stateId?: string;
	/** Visible label/OCR text to target instead of a ref. */
	text?: string;
	x?: number;
	y?: number;
	space?: CoordinateSpace;
}

export interface UiAction {
	action: "press" | "click" | "setText" | "typeText" | "keypress" | "scroll" | "drag" | "moveMouse" | "wait";
	ref?: string;
	x?: number;
	y?: number;
	space?: CoordinateSpace;
	/** click/moveMouse: visible label or OCR text to target; typeText/setText: text to enter. */
	text?: string;
	keys?: string[];
	scrollX?: number;
	scrollY?: number;
	path?: Array<{ x: number; y: number } | [number, number]>;
	from?: DragEndpoint;
	to?: DragEndpoint;
	/** drag: press-and-hold before moving, default 250ms (lets AppKit/Qt start a drag session). */
	holdMs?: number;
	/** drag: hover over the drop target before releasing, default 400ms. */
	dwellMs?: number;
	/** wait: milliseconds to pause inside the transaction. */
	ms?: number;
	button?: MouseButtonName;
	clickCount?: number;
}

/** Successor observation returned by act_ui / wait_for. `visual` attaches the successor screenshot. */
export type SuccessorObserveMode = "semantic" | "visual" | "fused";

export interface ActParams extends StateTargetParams {
	actions: UiAction[];
	expect?: UiCondition;
	observe?: SuccessorObserveMode;
}

export interface ReadTextParams extends StateTargetParams {
	ref: string;
	offset?: number;
}

export interface WaitForParams extends StateTargetParams, UiCondition {
	observe?: SuccessorObserveMode;
}

export const AGENT_TOOL_NAMES = new Set([
	"find_roots",
	"read_text",
	"wait_for",
	"observe_ui",
	"search_ui",
	"expand_ui",
	"inspect_ui",
	"act_ui",
	"navigate_browser",
	"evaluate_browser",
	"launch_browser",
]);
