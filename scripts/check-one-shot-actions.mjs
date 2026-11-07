#!/usr/bin/env node
// Pure checks for the one-shot ergonomics: text targets, coordinate spaces,
// from/to drags (including cross-state), the wait action, transaction
// preflight, successor observation, and stale-state recovery hints.
import assert from "node:assert/strict";

const { prepareAction, expandMacroActions } = await import("../src/actions.ts");
const { resolveTextTarget } = await import("../src/outline.ts");
const { testing } = await import("../src/bridge.ts");
const { StaleResourceStateError } = await import("../src/runtime.ts");

const node = (ref, title, fields = {}) => ({ ref, wireRef: `w${ref}`, role: "AXButton", subrole: "", identifier: "", title, description: "", value: "", actions: ["AXPress"], canPress: true, canFocus: false, canSetValue: false, canScroll: false, canIncrement: false, canDecrement: false, isTextInput: false, focused: false, offscreen: false, pictureOnly: false, truncated: false, text: [], children: [], ...fields });
const outlineOf = (root) => {
	const nodes = [];
	const visit = (current, parent) => {
		current.parent = parent;
		nodes.push(current);
		for (const child of current.children) visit(child, current);
	};
	visit(root, undefined);
	return { lookId: "look", root, nodes, refToWireRef: new Map(), wireRefToRef: new Map() };
};

// --- resolveTextTarget -----------------------------------------------------
{
	// A button and its own static label collapse to one target (the button).
	const label = node("@e3", "IMPORT", { role: "AXStaticText", actions: [], canPress: false, wireRef: "w3", rect: { x: 200, y: 40, w: 60, h: 16 } });
	const button = node("@e2", "IMPORT", { rect: { x: 190, y: 32, w: 90, h: 30 }, children: [label] });
	// OCR text attached to the (huge) root must target the OCR run, not the root center.
	const root = node("@e1", "Engine DJ", { role: "AXWindow", rect: { x: 0, y: 0, w: 1600, h: 854 }, text: [{ string: "DRIVES", confidence: 0.9, rect: { x: 60, y: 748, w: 60, h: 18 } }, { string: "Collection", confidence: 0.9, rect: { x: 80, y: 352, w: 70, h: 16 } }, { string: "Collection", confidence: 0.9, rect: { x: 330, y: 424, w: 70, h: 16 } }], children: [button] });
	const outline = outlineOf(root);

	let result = resolveTextTarget(outline, "import");
	assert.equal(result.kind, "ok");
	assert.equal(result.candidate.node.ref, "@e2");
	assert.equal(result.candidate.source, "label");

	result = resolveTextTarget(outline, "DRIVES");
	assert.equal(result.kind, "ok");
	assert.equal(result.candidate.source, "ocr");
	assert.deepEqual(result.candidate.point, { x: 90, y: 757 });

	result = resolveTextTarget(outline, "Collection");
	assert.equal(result.kind, "ambiguous");
	assert.equal(result.candidates.length, 2);

	assert.equal(resolveTextTarget(outline, "Drivez").kind, "none", "fuzzy matches are never auto-targeted");

	// An actionable control beats inert text showing the same string (Calculator's "7" vs its display).
	const display = node("@e5", "", { role: "AXStaticText", value: "7", actions: [], canPress: false, rect: { x: 10, y: 10, w: 200, h: 40 } });
	const seven = node("@e6", "7", { rect: { x: 10, y: 200, w: 40, h: 40 } });
	const calc = outlineOf(node("@e4", "Calculator", { role: "AXWindow", rect: { x: 0, y: 0, w: 230, h: 400 }, children: [display, seven] }));
	result = resolveTextTarget(calc, "7");
	assert.equal(result.kind, "ok");
	assert.equal(result.candidate.node.ref, "@e6");
	assert.equal(resolveTextTarget(outline, "Engine DJ").kind, "none", "the root itself is not a click target");
}

// --- prepareAction ---------------------------------------------------------
const finderLook = { image: { width: 1500, height: 1578 }, window: { framePoints: { x: 1800, y: 311, w: 750, h: 789 } } };
const folder = node("@e9", "sunset-haus", { role: "AXTextField", rect: { x: 510, y: 452, w: 164, h: 36 } });
const finderOutline = outlineOf(node("@e1", "DJUSB", { role: "AXWindow", rect: { x: 0, y: 0, w: 1500, h: 1578 }, children: [folder] }));
const env = (currentLook, outline, extra = {}) => ({
	headless: false,
	image: currentLook.image,
	node: (ref) => {
		const found = outline.nodes.find((candidate) => candidate.ref === ref);
		if (!found) throw new Error(`no ${ref}`);
		return found;
	},
	center: (target) => ({ x: target.rect.x + target.rect.w / 2, y: target.rect.y + target.rect.h / 2 }),
	validatePoint: (x, y, label = "Coordinates") => {
		if (x < 0 || y < 0 || x >= currentLook.image.width || y >= currentLook.image.height) throw new Error(`${label} (${Math.round(x)},${Math.round(y)}) are outside the latest look image bounds`);
	},
	resolveText: (text) => {
		const result = resolveTextTarget(outline, text);
		if (result.kind !== "ok") throw new Error(`text ${result.kind}`);
		return result.candidate.source === "label" ? { node: result.candidate.node } : { node: result.candidate.node, point: result.candidate.point };
	},
	supportsScreenPoints: true,
	...extra,
});
const fresh = () => ({ currentFocus: false });
{
	const waited = prepareAction({ action: "wait", ms: 99_999 }, fresh(), env(finderLook, finderOutline));
	assert.deepEqual(waited.params, { ms: 10_000 });

	const byText = prepareAction({ action: "click", text: "sunset-haus" }, fresh(), env(finderLook, finderOutline));
	assert.deepEqual(byText.target, { ref: "w@e9" }, "labelled semantic nodes are pressed semantically");

	// Screen points pass through untouched: native grounding owns the transform and the bounds check.
	const screenClick = prepareAction({ action: "click", x: 2080, y: 546, space: "screen" }, fresh(), env(finderLook, finderOutline));
	assert.deepEqual(screenClick.target, { x: 2080, y: 546, space: "screen" });
	assert.equal(screenClick.needsForeground, true);
	assert.throws(() => prepareAction({ action: "click", x: 5, y: 5, space: "screen" }, fresh(), env(finderLook, finderOutline, { supportsScreenPoints: false })), /not supported on this platform/);

	// Cross-app drop: Finder folder → Engine DJ "Collection" owned by another state.
	const drag = prepareAction(
		{ action: "drag", from: { ref: "@e9" }, to: { text: "Collection", stateId: "engine-state" } },
		fresh(),
		env(finderLook, finderOutline, { foreignEndpoint: (endpoint) => { assert.equal(endpoint.stateId, "engine-state"); return { x: 360, y: 431, lookId: "engine-look", pid: 42 }; } }),
		"finder-state",
	);
	assert.equal(drag.needsForeground, true, "drags use physical (HID) input so the OS drag session starts");
	assert.deepEqual(drag.params.path, [{ x: 592, y: 470 }, { x: 360, y: 431, lookId: "engine-look", pid: 42 }]);
	assert.deepEqual(drag.target, { x: 592, y: 470 });
	assert.equal(drag.params.holdMs, 250);
	assert.equal(drag.params.dwellMs, 400);

	// A stateId equal to the acting state is just a local endpoint.
	const local = prepareAction({ action: "drag", from: { ref: "@e9" }, to: { x: 20, y: 30, stateId: undefined }, dwellMs: 900 }, fresh(), env(finderLook, finderOutline), "finder-state");
	assert.deepEqual(local.params.path, [{ x: 592, y: 470 }, { x: 20, y: 30 }]);
	assert.equal(local.params.dwellMs, 900);

	// Cross-window endpoints need native support.
	assert.throws(() => prepareAction(
		{ action: "drag", from: { ref: "@e9" }, to: { text: "Collection", stateId: "engine-state" } },
		fresh(),
		env(finderLook, finderOutline, { supportsScreenPoints: false, foreignEndpoint: () => ({ x: 1, y: 1, lookId: "l" }) }),
		"finder-state",
	), /cross-window drag\) is not supported/);

	// The drag source has to belong to the acting root.
	assert.throws(() => prepareAction(
		{ action: "drag", from: { text: "Collection", stateId: "engine-state" }, to: { ref: "@e9" } },
		fresh(),
		env(finderLook, finderOutline, { foreignEndpoint: () => ({ x: 1, y: 1, lookId: "engine-look" }) }),
		"finder-state",
	), /drag\.from must belong to the acting root/);

	// Local image points are still bounds-checked before anything is sent.
	assert.throws(() => prepareAction({ action: "drag", path: [{ x: 10, y: 10 }, { x: 4000, y: 100 }] }, fresh(), env(finderLook, finderOutline)), /Drag point 2 .* outside the latest look image bounds/);
	const legacy = prepareAction({ action: "drag", path: [{ x: 10, y: 10 }, { x: 100, y: 100 }] }, fresh(), env(finderLook, finderOutline));
	assert.deepEqual(legacy.params.path, [{ x: 10, y: 10 }, { x: 100, y: 100 }]);
}

// --- stale state hint --------------------------------------------------------
{
	const message = testing.staleStateMessage(new StaleResourceStateError("desktop-pid:1", 2, 3));
	assert.match(message, /expected epoch 2, current epoch 3/);
	assert.match(message, /parallel/);
	testing.rememberLatestState("desktop-pid:1", "latest-id", 3);
	assert.match(testing.staleStateMessage(new StaleResourceStateError("desktop-pid:1", 2, 3)), /latest state for this root is latest-id/);
}

// --- preflight rejects before any write -------------------------------------
{
	const outline = outlineOf(node("@e1", "Root", { role: "AXWindow", rect: { x: 0, y: 0, w: 100, h: 100 } }));
	const outlineOnlyLook = { lookId: "look", window: { framePoints: { x: 0, y: 0, w: 100, h: 100 } }, parsedOutline: outline };
	assert.throws(
		() => testing.runInOperation(() => testing.preflightUiTransaction([{ action: "wait", ms: 10 }, { action: "click", x: 5, y: 5 }], outlineOnlyLook, false), { currentOutline: outline }),
		/actions\[1\] \(click\) was rejected before anything was sent: .*image-bearing root/,
	);
}

// --- macros, menu commands, background delivery ------------------------------
{
	const expanded = expandMacroActions([{ action: "click", ref: "@e1" }, { action: "choosePath", location: "/Volumes/DJUSB", confirm: true }]);
	assert.deepEqual(expanded.map((action) => action.action), ["click", "keypress", "wait", "keypress", "typeText", "wait", "keypress", "wait", "keypress", "wait"]);
	assert.deepEqual(expanded[1].keys, ["cmd+shift+g"]);
	assert.equal(expanded[4].text, "/Volumes/DJUSB");
	assert.throws(() => expandMacroActions([{ action: "choosePath" }]), /choosePath requires location/);

	const base = env(finderLook, finderOutline, { supportsMenuCommands: true });
	assert.deepEqual(prepareAction({ action: "menu", command: " File > New Folder " }, fresh(), base).params, { command: "File > New Folder" });
	assert.throws(() => prepareAction({ action: "menu", command: "Edit > Copy" }, fresh(), env(finderLook, finderOutline)), /not supported on this platform/);
	assert.throws(() => prepareAction({ action: "menu" }, fresh(), base), /menu requires command/);

	// Keyboard goes to the window in the background when SkyLight is available; pointer stays foreground unless opted in.
	const keyEnv = env(finderLook, finderOutline, { supportsWindowKeyboard: true, supportsBackgroundInput: true });
	assert.equal(prepareAction({ action: "keypress", keys: ["escape"] }, fresh(), keyEnv).needsForeground, false);
	assert.deepEqual(prepareAction({ action: "keypress", keys: ["escape"] }, fresh(), keyEnv).target, { window: true });
	assert.equal(prepareAction({ action: "keypress", keys: ["escape"] }, fresh(), env(finderLook, finderOutline, { supportsWindowKeyboard: true })).needsForeground, true);
	assert.equal(prepareAction({ action: "click", x: 10, y: 10 }, fresh(), keyEnv).needsForeground, true);
	assert.equal(prepareAction({ action: "click", x: 10, y: 10 }, fresh(), { ...keyEnv, supportsBackgroundPointer: true }).needsForeground, false);
}

console.log("one-shot action checks passed");
