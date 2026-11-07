#!/usr/bin/env node
// Live macOS driver benchmark: medians for observe/act/menu operations against
// Calculator, plus a check that background keyboard input leaves the user's
// front app alone. It drives real apps, so run it on a machine you are not
// using (a sandbox Mac or VM).
//
//   npx tsx scripts/bench-macos.mjs [--runs 7] [--out bench.json]
//
// To benchmark a checkout's helper without installing it, start the helper
// yourself and point the runtime at it:
//   PI_COMPUTER_USE_HELPER_APP_PATH=/path/to/pi-computer-use.app \
//   PI_CU_SOCKET_PATH=/tmp/picu.sock npx tsx scripts/bench-macos.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

if (process.platform !== "darwin") {
	console.error("bench-macos runs on macOS only.");
	process.exit(2);
}

const argValue = (name, fallback) => {
	const index = process.argv.indexOf(name);
	return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};
const runs = Math.max(1, Number(argValue("--runs", "7")));
const outPath = argValue("--out", undefined);
const root = new URL("..", import.meta.url).pathname;
const bridge = await import(`${root}src/bridge.ts`);
const ctx = { cwd: root, hasUI: false, ui: { notify: () => {}, confirm: async () => false, select: async () => undefined }, sessionManager: { getBranch: () => [] } };

let callIndex = 0;
async function call(tool, params) {
	const fn = { find: bridge.executeFind, observe: bridge.executeObserve, act: bridge.executeAct, search: bridge.executeSearchUi, menu: bridge.executeMenuCommands, app: bridge.executeAppControl }[tool];
	const started = performance.now();
	const result = await fn(`bench-${++callIndex}`, params, undefined, undefined, ctx);
	return { result, ms: performance.now() - started };
}
const stateOf = (result) => result?.details?.capture?.stateId ?? result?.details?.stateId;
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const frontApp = () => execFileSync("/usr/bin/osascript", ["-e", 'tell application "System Events" to get name of first process whose frontmost is true']).toString().trim();
const activate = (app) => execFileSync("/usr/bin/osascript", ["-e", `tell application ${JSON.stringify(app)} to activate`]);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = { runs, macOS: execFileSync("/usr/bin/sw_vers", ["-productVersion"]).toString().trim(), measures: {}, checks: {} };
const measure = async (name, fn) => {
	const samples = [];
	for (let index = 0; index < runs; index += 1) samples.push(await fn());
	results.measures[name] = { medianMs: Math.round(median(samples) * 10) / 10, samples: samples.map((value) => Math.round(value)) };
	console.log(`${name.padEnd(42)} ${results.measures[name].medianMs} ms`);
};

try {
	const launched = await call("app", { action: "launch", app: "Calculator" });
	const calculatorRoot = launched.result.details.roots?.[0]?.windowRef;
	if (!calculatorRoot) throw new Error("Calculator did not show a window.");

	await measure("observe semantic (Calculator)", async () => (await call("observe", { root: calculatorRoot, mode: "semantic" })).ms);
	await measure("observe visual (Calculator)", async () => (await call("observe", { root: calculatorRoot, mode: "visual" })).ms);
	await measure("menu_commands list (Calculator)", async () => (await call("menu", { app: "Calculator" })).ms);

	let state = stateOf((await call("observe", { root: calculatorRoot, mode: "semantic" })).result);
	await measure("act press by text, successor semantic", async () => {
		const { result, ms } = await call("act", { stateId: state, observe: "semantic", actions: [{ action: "click", text: "7" }] });
		state = stateOf(result);
		return ms;
	});
	await measure("act 4 presses in one call", async () => {
		const { result, ms } = await call("act", { stateId: state, observe: "semantic", actions: ["1", "2", "Add", "3"].map((text) => ({ action: "click", text })) });
		state = stateOf(result);
		return ms;
	});

	// Background keyboard: Finder in front, type into Calculator, check the front app and the result.
	activate("Finder");
	await pause(500);
	state = stateOf((await call("observe", { root: calculatorRoot, mode: "semantic" })).result);
	const frontBefore = frontApp();
	const typed = await call("act", { stateId: state, observe: "semantic", actions: [{ action: "keypress", keys: ["escape"] }, { action: "typeText", text: "12+30=" }] });
	const display = (await call("search", { stateId: stateOf(typed.result), text: "Edit field" })).result.content[0].text.match(/Edit field" = "([^"]*)"/)?.[1];
	const frontAfter = frontApp();
	results.checks.backgroundKeyboard = { frontBefore, frontAfter, frontUnchanged: frontBefore === frontAfter, display, correct: display === "42", ms: Math.round(typed.ms), deliveries: typed.result.details?.execution?.steps?.map((step) => step.performed?.delivery) };
	console.log(`background keyboard: display=${display} front ${frontBefore} -> ${frontAfter} (${Math.round(typed.ms)} ms)`);
} finally {
	await bridge.shutdownComputerUseSession();
}

if (outPath) writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
const failed = Object.values(results.checks).some((check) => !check.frontUnchanged || !check.correct);
if (failed) console.error("A background check failed; see the output above.");
process.exit(failed ? 1 : 0);
