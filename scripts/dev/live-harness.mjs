// Calls the checkout's real tool executors (the same code pi runs) from a
// plain script, for live end-to-end tests on macOS. Use with dev-helper.sh:
//
//   source scripts/dev/dev-env.sh && npx tsx my-test.mjs
//
//   import { call, stateOf, done, quiet } from "./scripts/dev/live-harness.mjs";
//   const roots = await call("find", { app: "Calculator", launch: true });
//   const s = stateOf(await call("observe", { root: roots.details.windows[0].windowRef }));
//   await call("act", { stateId: s, observe: "visual", actions: [{ action: "click", text: "7" }] });
//   await done();
//
// Each result gets `.ms` (wall time). Errors are returned as `{ error, ms }`.
// Never call act and observe on the same root in parallel (states go stale).
const root = new URL("../..", import.meta.url).pathname;
const b = await import(`${root}src/bridge.ts`);
const ctx = { cwd: root, hasUI: false, ui: { notify: (m) => console.error("[notify]", m), confirm: async () => false, select: async () => undefined }, sessionManager: { getBranch: () => [] } };
const tools = {
	find: b.executeFind, observe: b.executeObserve, act: b.executeAct, wait: b.executeWaitFor,
	search: b.executeSearchUi, inspect: b.executeInspectUi, expand: b.executeExpandUi, read: b.executeReadText,
	menu: b.executeMenuCommands, app: b.executeAppControl,
};
let n = 0;
export const quiet = { on: false };
export async function call(name, params) {
	const fn = tools[name];
	if (!fn) throw new Error(`unknown tool ${name}; one of ${Object.keys(tools).join(", ")}`);
	const started = Date.now();
	try {
		const result = await fn(`live-${++n}`, params, undefined, undefined, ctx);
		result.ms = Date.now() - started;
		if (!quiet.on) {
			const text = result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
			const images = result.content.filter((c) => c.type === "image").length;
			console.log(`\n### ${name} ${JSON.stringify(params).slice(0, 240)} (${result.ms}ms, images=${images})\n${text.slice(0, 2000)}`);
		}
		return result;
	} catch (error) {
		console.log(`\n### ${name} ${JSON.stringify(params).slice(0, 240)} -> ERROR ${error.message}`);
		return { error, ms: Date.now() - started };
	}
}
export const stateOf = (r) => r?.details?.capture?.stateId ?? r?.details?.stateId;
export async function done() { await b.shutdownComputerUseSession(); }
