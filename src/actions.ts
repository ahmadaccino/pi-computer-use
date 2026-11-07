import type { CoordinateSpace, DragEndpoint, MouseButtonName, UiAction } from "./contract.ts";
import { INCIDENTAL_ACTIONS, type OutlineNode } from "./outline.ts";
import { toFiniteNumber } from "./platform/coerce.ts";

/** `window` = deliver keyboard input to the acting root's focused control (raises the root first). */
export type ActionTarget = { ref: string } | { x: number; y: number; space?: "screen" } | { focus: { x: number; y: number } } | { window: true };

/**
 * A drag waypoint. Native grounding owns every coordinate transform: plain
 * points are pixels of the acting look, `lookId` points are pixels of another
 * (still cached) look, and `space: "screen"` points are global screen points.
 */
export type DragPoint = { x: number; y: number; lookId?: string; pid?: number; space?: "screen" };

export interface PreparedDragParams {
	path: DragPoint[];
	holdMs: number;
	dwellMs: number;
}

export type PreparedAction =
	| { action: "press" | "click"; target: ActionTarget; params: { button?: MouseButtonName; clickCount?: number }; establishesFocus: boolean; usesCurrentFocus: false; needsForeground: boolean }
	| { action: "setText"; target: ActionTarget; params: { text: string }; establishesFocus: false; usesCurrentFocus: false; needsForeground: false }
	| { action: "typeText"; target: ActionTarget; params: { text: string }; establishesFocus: false; usesCurrentFocus: boolean; needsForeground: boolean }
	| { action: "keypress"; target: ActionTarget; params: { keys: string[] }; establishesFocus: false; usesCurrentFocus: boolean; needsForeground: boolean }
	| { action: "scroll"; target: ActionTarget; params: { scrollX: number; scrollY: number }; establishesFocus: false; usesCurrentFocus: false; needsForeground: false }
	| { action: "drag"; target: ActionTarget; params: PreparedDragParams; establishesFocus: false; usesCurrentFocus: false; needsForeground: boolean }
	| { action: "moveMouse"; target: ActionTarget; params: Record<string, never>; establishesFocus: false; usesCurrentFocus: false; needsForeground: false }
	| { action: "wait"; params: { ms: number }; establishesFocus: false; usesCurrentFocus: false; needsForeground: false }
	| { action: "menu"; params: { command: string }; establishesFocus: false; usesCurrentFocus: false; needsForeground: false };

export interface ActionState {
	currentFocus: boolean;
}

export interface ActionEnvironment {
	headless: boolean;
	image?: { width: number; height: number };
	node(ref: string): OutlineNode;
	center(node: OutlineNode): { x: number; y: number };
	validatePoint(x: number, y: number, label?: string): void;
	/** Resolve visible label/OCR text to exactly one target of the acting state. `point` is set for OCR-only hits. */
	resolveText?(text: string, label: string): TextResolution;
	/** Resolve a drag endpoint owned by another state to a point in that state's look. */
	foreignEndpoint?(endpoint: DragEndpoint, label: string): { x: number; y: number; lookId: string; pid: number };
	/** Whether native input accepts screen-space points and points from other looks (cross-window drags). */
	supportsScreenPoints?: boolean;
	/** Whether native input accepts a `{ window: true }` keyboard target (keys to the root's focused control). */
	supportsWindowKeyboard?: boolean;
	/** Whether unreferenced keyboard input can be delivered to the window in the background (macOS SkyLight). */
	supportsBackgroundInput?: boolean;
	/** Whether coordinate clicks can be delivered in the background (macOS SkyLight, opt-in). */
	supportsBackgroundPointer?: boolean;
	/** Whether menu-bar commands can be pressed by path. */
	supportsMenuCommands?: boolean;
}

export interface TextResolution {
	node: OutlineNode;
	/** Image-pixel point to use instead of the node (e.g. the matched OCR run inside a larger node). */
	point?: { x: number; y: number };
}

export const MAX_WAIT_ACTION_MS = 10_000;
const DEFAULT_DRAG_HOLD_MS = 250;
const DEFAULT_DRAG_DWELL_MS = 400;

function mouseButton(value: unknown): MouseButtonName {
	return value === "right" || value === "middle" ? value : "left";
}

function clickCount(value: unknown, fallback = 1): number {
	return Math.max(1, Math.min(3, Math.round(toFiniteNumber(value, fallback))));
}

function scrollDelta(value: unknown): number {
	return Math.max(-10_000, Math.min(10_000, Math.round(toFiniteNumber(value, 0))));
}

function boundedMs(value: unknown, fallback: number, max = 5_000): number {
	return Math.max(0, Math.min(max, Math.round(toFiniteNumber(value, fallback))));
}

function keys(value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0) throw new Error("keypress.keys must contain at least one key.");
	return value.map((key) => String(key));
}

function spaceOf(value: unknown): CoordinateSpace {
	return value === "screen" ? "screen" : "image";
}

/** Validates a model-supplied point. Screen points are grounded (and bounds-checked) natively. */
function pointTarget(x: number, y: number, space: CoordinateSpace, env: ActionEnvironment, label?: string): { x: number; y: number; space?: "screen" } {
	if (space === "screen") {
		if (!env.supportsScreenPoints) throw new Error(`${label ?? "Coordinates"} with space "screen" are not supported on this platform; use image coordinates from the state.`);
		if (!env.image) env.validatePoint(x, y, label);
		return { x, y, space: "screen" };
	}
	env.validatePoint(x, y, label);
	return { x, y };
}

function nodeTarget(node: OutlineNode, operation: PreparedAction["action"], env: ActionEnvironment): ActionTarget {
	const semanticClick = operation === "click" || operation === "press";
	if (semanticClick && node.isTextInput) {
		const point = env.center(node);
		env.validatePoint(point.x, point.y);
		return point;
	}
	const onlyIncidentalActions = node.actions.every((candidate) => INCIDENTAL_ACTIONS.has(candidate));
	if (node.wireRef && !node.pictureOnly && (!semanticClick || node.canPress || node.canFocus || node.canSetValue || !onlyIncidentalActions)) {
		return { ref: node.wireRef };
	}
	const point = env.center(node);
	env.validatePoint(point.x, point.y);
	return point;
}

function textTarget(action: UiAction, env: ActionEnvironment): TextResolution | undefined {
	if (action.ref?.trim() || (action.action !== "click" && action.action !== "moveMouse")) return undefined;
	const text = action.text?.trim();
	if (!text) return undefined;
	if (!env.resolveText) throw new Error(`${action.action} by text is unavailable for this state.`);
	return env.resolveText(text, `${action.action} text`);
}

function nativeTarget(action: UiAction, operation: PreparedAction["action"], env: ActionEnvironment): ActionTarget {
	if (action.ref?.trim()) return nodeTarget(env.node(action.ref.trim()), operation, env);
	const byText = textTarget(action, env);
	if (byText?.point) {
		env.validatePoint(byText.point.x, byText.point.y, `${operation} text ${JSON.stringify(action.text)}`);
		return byText.point;
	}
	if (byText) return nodeTarget(byText.node, operation, env);
	const x = toFiniteNumber(action.x, NaN);
	const y = toFiniteNumber(action.y, NaN);
	if (Number.isFinite(x) && Number.isFinite(y)) return pointTarget(x, y, spaceOf(action.space), env);
	throw new Error(`${operation} requires a ref, text, or both x and y.`);
}

function endpointLocalPoint(endpoint: DragEndpoint, env: ActionEnvironment, label: string): { x: number; y: number } | undefined {
	if (endpoint.ref?.trim()) return env.center(env.node(endpoint.ref.trim()));
	if (endpoint.text?.trim()) {
		if (!env.resolveText) throw new Error(`${label} by text is unavailable for this state.`);
		const resolved = env.resolveText(endpoint.text.trim(), label);
		return resolved.point ?? env.center(resolved.node);
	}
	return undefined;
}

/** Resolves one drag endpoint to a native-groundable point. */
function dragPoint(endpoint: DragEndpoint, env: ActionEnvironment, label: string, localStateId?: string): DragPoint {
	const foreign = endpoint.stateId?.trim() && endpoint.stateId.trim() !== localStateId;
	if (foreign) {
		if (!env.foreignEndpoint || !env.supportsScreenPoints) throw new Error(`${label} owned by another state (cross-window drag) is not supported on this platform.`);
		return env.foreignEndpoint(endpoint, label);
	}
	const local = endpointLocalPoint(endpoint, env, label);
	if (local) {
		env.validatePoint(local.x, local.y, label);
		return local;
	}
	const x = toFiniteNumber(endpoint.x, NaN);
	const y = toFiniteNumber(endpoint.y, NaN);
	if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${label} requires ref, text, or both x and y.`);
	return pointTarget(x, y, spaceOf(endpoint.space), env, label);
}

function dragParams(action: UiAction, env: ActionEnvironment, localStateId?: string): PreparedDragParams {
	const endpoints: Array<{ endpoint: DragEndpoint; label: string }> = [];
	if (action.from || action.to) {
		if (!action.from || !action.to) throw new Error("drag requires both from and to (or a path of at least two points).");
		if (action.path?.length) throw new Error("drag accepts either from/to or path, not both.");
		endpoints.push({ endpoint: action.from, label: "drag.from" }, { endpoint: action.to, label: "drag.to" });
	} else {
		if (!Array.isArray(action.path) || action.path.length < 2) throw new Error("drag requires from/to or a path of at least two points.");
		for (const [index, point] of action.path.entries()) {
			const x = Array.isArray(point) ? point[0] : point?.x;
			const y = Array.isArray(point) ? point[1] : point?.y;
			endpoints.push({ endpoint: { x, y, space: action.space }, label: `Drag point ${index + 1}` });
		}
	}
	const path = endpoints.map(({ endpoint, label }) => dragPoint(endpoint, env, label, localStateId));
	// The source must be in the acting root: native delivery focuses that root first.
	if (path[0].lookId) {
		throw new Error("drag.from must belong to the acting root. Call act_ui with the source window's stateId and point drag.to at the other window (to.stateId).");
	}
	return {
		path,
		holdMs: boundedMs(action.holdMs, DEFAULT_DRAG_HOLD_MS),
		dwellMs: boundedMs(action.dwellMs, DEFAULT_DRAG_DWELL_MS),
	};
}

function focusedTarget(env: ActionEnvironment): ActionTarget {
	if (!env.image) throw new Error("Focused keyboard input requires an image-bearing state.");
	return { focus: { x: Math.floor(env.image.width / 2), y: Math.floor(env.image.height / 2) } };
}

function containsEditable(node: OutlineNode): boolean {
	if (node.canSetValue || node.role.toLowerCase().includes("text")) return true;
	return node.children.some(containsEditable);
}

export function prepareAction(action: UiAction, state: ActionState, env: ActionEnvironment, localStateId?: string): PreparedAction {
	const operation = action.action;
	if (operation === "wait") {
		return { action: "wait", params: { ms: boundedMs(action.ms, 0, MAX_WAIT_ACTION_MS) }, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
	}
	if (operation === "menu") {
		const command = action.command?.trim();
		if (!command) throw new Error('menu requires command, e.g. "File > New Folder".');
		if (!env.supportsMenuCommands) throw new Error("menu commands are not supported on this platform.");
		return { action: "menu", params: { command }, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
	}
	if (operation === "choosePath") throw new Error("choosePath must be expanded before preparation.");
	if (operation === "drag") {
		const params = dragParams(action, env, localStateId);
		const { lookId: _lookId, pid: _pid, ...source } = params.path[0];
		return { action: "drag", target: source, params, establishesFocus: false, usesCurrentFocus: false, needsForeground: !env.headless };
	}
	const keyboard = operation === "typeText" || operation === "keypress";
	const usesCurrentFocus = !env.headless && state.currentFocus && !action.ref && keyboard;
	// Unreferenced keyboard input goes to whatever control the root has focused,
	// matching the documented "omit ref to send keys to the focused control".
	const toWindow = !usesCurrentFocus && keyboard && !action.ref && !env.headless && Boolean(env.supportsWindowKeyboard);
	const target: ActionTarget = usesCurrentFocus ? focusedTarget(env) : toWindow ? { window: true } : nativeTarget(action, operation, env);
	const focusNode = action.ref ? env.node(action.ref) : undefined;
	const establishesFocus = !env.headless && Boolean(focusNode) && (operation === "click" || operation === "press") && containsEditable(focusNode!);
	const needsForeground = !env.headless && !env.supportsBackgroundPointer && (operation === "click" || operation === "press") && "x" in target;

	switch (operation) {
		case "press":
		case "click": return { action: operation, target, params: { button: mouseButton(action.button), clickCount: clickCount(action.clickCount) }, establishesFocus, usesCurrentFocus: false, needsForeground };
		case "setText": return { action: operation, target, params: { text: action.text ?? "" }, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
		case "typeText": return { action: operation, target, params: { text: action.text ?? "" }, establishesFocus: false, usesCurrentFocus, needsForeground: toWindow && !env.supportsBackgroundInput };
		case "keypress": return { action: operation, target, params: { keys: keys(action.keys) }, establishesFocus: false, usesCurrentFocus, needsForeground: toWindow && !env.supportsBackgroundInput };
		case "scroll": return { action: operation, target, params: { scrollX: scrollDelta(action.scrollX), scrollY: scrollDelta(action.scrollY) }, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
		case "moveMouse": return { action: operation, target, params: {}, establishesFocus: false, usesCurrentFocus: false, needsForeground: false };
	}
}

/**
 * Expands `choosePath` into the Open/Save panel recipe: Go to Folder
 * (Cmd+Shift+G), replace its field, Return; optionally Return again to confirm.
 * Everything stays in one transaction, so later steps act on the panel as it is.
 */
export function expandMacroActions(actions: UiAction[]): UiAction[] {
	return actions.flatMap((action): UiAction[] => {
		if (action.action !== "choosePath") return [action];
		const location = action.location?.trim();
		if (!location) throw new Error("choosePath requires location (a folder or file path).");
		const steps: UiAction[] = [
			{ action: "keypress", keys: ["cmd+shift+g"] },
			{ action: "wait", ms: 500 },
			{ action: "keypress", keys: ["cmd+a"] },
			{ action: "typeText", text: location },
			{ action: "wait", ms: 200 },
			{ action: "keypress", keys: ["return"] },
			{ action: "wait", ms: 500 },
		];
		if (action.confirm) steps.push({ action: "keypress", keys: ["return"] }, { action: "wait", ms: 400 });
		return steps;
	});
}

export function canRetryInForeground(action: PreparedAction, outcome: "worked" | "didnt" | "unknown", headless: boolean): boolean {
	return !headless && outcome === "didnt" && (action.action === "typeText" || action.action === "keypress");
}

export function outcomeAfterCheck(current: "worked" | "didnt" | "unknown", check: "verified" | "preexisting" | "failed"): "worked" | "didnt" | "unknown" {
	if (check === "verified") return "worked";
	if (check === "failed") return "didnt";
	return current;
}

export function outcomeAfterObservedValues(
	current: "worked" | "didnt" | "unknown",
	actions: UiAction[],
	valueForRef: (ref: string) => string | undefined,
): "worked" | "didnt" | "unknown" {
	if (actions.length === 0 || actions.some((action) => action.action !== "setText" || !action.ref)) return current;
	const matches = actions.every((action) => valueForRef(action.ref!) === (action.text ?? ""));
	return matches ? "worked" : current;
}
