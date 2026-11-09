# Handoff to grokbot: pi-computer-use driver work

Written by the previous agent (pi, Claude) for grokbot, the agent that continues this work. The owner is Ahmad (`ahmadaccino` on GitHub). Read this whole file before touching code.

> ## ⚠️ Test only on a Mac
>
> Everything here is macOS-specific: the native helper is Swift + Accessibility + ScreenCaptureKit + private SkyLight calls. **Run every live test on a macOS machine you control** (a sandbox Mac or a macOS VM; Apple silicon preferred, macOS 14+, ideally macOS 27 since that is where the behavior below was observed). Do not attempt live tests on Linux or Windows, and do not use Ahmad's personal Mac — he is using it, and his mouse/keyboard activity corrupted several of the previous agent's test runs. Unit tests (`npm test`) also expect macOS for the Swift typecheck invariants.

---

## 1. Repository and branches

- Fork: https://github.com/ahmadaccino/pi-computer-use (upstream: https://github.com/injaneity/pi-computer-use, MIT).
- `main` on the fork = `feat/driver-wins` = commit `1570a97`. It contains, on top of upstream `main` (`67e9e2f`):
  1. `6cbd345`, `3ced72c` — dependabot bumps (tsx 4.23.15, @types/node 26.6.6), the only fork-branch content not already upstream.
  2. `118935d` `feat(act): one-shot actions, cross-window drags, and stale-safe transactions`
  3. `1570a97` `feat(macos): background keys, freshness guard, menus, app control, annotations`
- `handoff/grokbot` (this branch) = `main` + this document + `scripts/dev/` helpers. **Work from this branch** (or branch off it). Keep `main` fast-forwardable.
- Every one of the fork's other remote branches was audited: each is identical to an upstream branch whose content is already squash-merged into upstream `main` (#95, #101, #102, #103, …). Nothing else needs consolidating.

Commit message format is enforced (`npm run test:commits -- <base>..HEAD`): `feat|fix|chore|refactor(<scope>): <summary>`.

---

## 2. How we got here (conversation summary)

1. **The original task.** Ahmad asked how to prep a USB in rekordbox for his Denon Prime 4. Answer: the Prime 4 reads an *Engine DJ* library (`Engine Library/Database2/m.db`, SQLite), not rekordbox's `PIONEER/` export. The USB (`DJUSB`, FAT32, ~500 WAVs in folders) had a stale Engine DB covering 135 songs. The agent installed Engine DJ (`brew install --cask engine-dj`), backed up the DB, and imported each folder by dragging it from Finder onto *DJUSB → Collection* in Engine DJ. Result: 509 local tracks, all analyzed (BPM/key), one playlist per folder, verified directly in SQLite. The USB was not formatted (explicit user requirement).
2. **What went wrong with computer use during that task** (the reason for everything below):
   - Engine DJ is custom-drawn; almost every control is an unlabeled `AXButton ""`, so the outline was useless and every step needed a visual observe.
   - Coordinate confusion: x/y are *screenshot pixels* of the root (scale 1.075 for Engine, 2.0 for Finder), while `find_roots` reports *screen points*. Several clicks missed.
   - **Cross-app drag (Finder → Engine DJ) was impossible**: `drag` rejected any point outside the acting root's image, and the native drag had no hold/interpolation/dwell anyway. The agent had to compile a throwaway Swift CGEvent script to do the drag.
   - Constant `State is stale … expected epoch N, current epoch N+1` errors. Two causes: (a) a *rejected* act_ui (validation error) still advanced the root's epoch, invalidating every state; (b) the agent ran `act_ui` and `observe_ui` in parallel on the same root.
   - App launch/quit, waiting, and sleeps all went through bash (`open -a`, `osascript`, `sleep`).
   - Roughly 60 tool calls; most latency was big-model turns, not the driver.
3. **Round 1 of improvements** (`118935d`): one-shot ergonomics (§4.1).
4. **Research round.** Ahmad shared: awlevin/typesafe-computer-use, ZJU-REAL/CUA-JEV, FluidInference/FluidUse, Daily-AC/opencu, openclaw/Peekaboo, shhivv/arc-cua, trycua/cua (CUA-S1, cua-driver). The previous agent cloned and read all of them. **Decision: no System 1 / decision-model work for now** — Ahmad explicitly said "forget system one". Focus is purely on driver wins learned from arc-cua, cua-driver, OpenCU, Peekaboo.
5. **Round 2** (`1570a97`): driver wins (§4.2). Live testing on Ahmad's Mac was cut short ("test this on your own sandbox machine"), so most of round 2 is **compiled and unit-tested but not live-verified**. That is your first job.

---

## 3. Architecture crash course

- `extensions/computer-use.ts` — the pi extension: tool schemas (TypeBox) and prompt guidance. Model-facing.
- `src/bridge.ts` — the runtime: state store, resource scheduler (epochs), target resolution, observe/act/wait/search/expand/inspect, plus the new `menu_commands` / `app_control`. Also holds the source of the generated contract doc (`PI_DOCS_REFERENCE_BEGIN reference/agent/contract`).
- `src/actions.ts` — pure action preparation (`prepareAction`, `expandMacroActions`): target resolution, coordinate spaces, drags, focus/foreground decisions. Testable without a Mac.
- `src/outline.ts` — outline parsing, search, and the new pure `resolveTextTarget`.
- `src/config.ts` — config + env; holds the source of the generated configuration doc.
- `src/platform/macos/*` — TS side of the macOS helper protocol (`helper.ts`, `backend.ts`).
- `native/macos/bridge.swift` — the helper daemon: AX walking, capture, OCR, act, root-event journal, settling, menus, annotation.
- `native/macos/skylight_input.swift` — **new**: SkyLight background input (port of arc-cua `macos_background.py`, MIT, with fixes from cua-driver).
- `prebuilt/macos/{arm64,x64}/bridge` — committed helper binaries (ad-hoc signed locally; upstream releases are Developer-ID signed by injaneity).
- Docs: `docs/content/docs/**` — partly **generated** (`npm run docs:generate`) from source blocks. Never hand-edit generated `.mdx`; edit the source block and regenerate. `npm test` runs `docs:check`.

Key invariants (enforced by `scripts/check-invariants.mjs`): immutable state-scoped observations; `@e` refs always paired with their `stateId`; per-resource epoch scheduling (writes bump the epoch); the public tool list is fixed in INV-11 (update it if you add a tool); **native grounding owns coordinate transforms** — TS must not convert image↔screen points (pass `lookId`/`space` to native instead).

---

## 4. What exists now

### 4.1 Round 1 — one-shot ergonomics (live-verified unless noted)

| Feature | Where | Verified |
|---|---|---|
| `click`/`moveMouse` `{text}` targets labels or OCR text; OCR hits click the OCR run (not its container); controls beat inert text showing the same string; fuzzy never auto-targets; ambiguity lists refs+points | `resolveTextTarget` (outline.ts), `actionEnvironment` (bridge.ts) | Calculator ✅ |
| `{action:"wait", ms}` inside a transaction | actions.ts | ✅ |
| `act_ui`/`wait_for` `observe: semantic\|visual\|fused`; visual attaches the successor screenshot | `successorObservation` | ✅ |
| Coordinate legend on image results; `space:"screen"` points grounded natively (point must be inside the root) | `coordinateLegend`, Swift `act` target parsing | partially |
| `drag` `from`/`to` endpoints (ref/text/x+y); endpoint with another root's `stateId` → cross-window/app drop via that look's `lookId`; hold 250 ms, interpolated moves, 400 ms dwell; destination root raised first; refuses drops onto another app (`occluded_target`) | actions.ts `dragParams`, `foreignDragEndpoint`, Swift `postMouseDrag` | Finder→Finder 8/8 ✅ (incl. with Ghostty covering a window). **Finder→Engine DJ not re-tested with the tool.** |
| Transaction preflight: validation errors no longer bump the epoch | `preflightUiTransaction` | ✅ |
| Stale-state error names the latest state for the root and warns about parallel act/observe | `staleStateMessage` | unit ✅ |
| `keypress`/`typeText` with no ref and no prior click go to the window's focused control (`{window:true}` target) | actions.ts, Swift | Calculator ✅ |
| `find_roots {launch:true, waitMs}`; app-name fallback (strong match) | `performListWindows`, `launchApp` | Calculator ✅ |
| Auto-attach image when most interactive controls are unlabeled | `imageFallbackReason` | not live |

### 4.2 Round 2 — driver wins (mostly NOT live-verified)

| Feature | Where | Status |
|---|---|---|
| **Background keyboard (SkyLight)**, config `background_input` (default true): window-addressed key events via `SLEventPostToPid` + auth message; key focus lent with focus records + make-key records, then handed back | `skylight_input.swift`, Swift `act` keypress/typeText branches, TS `backgroundInputAvailable` | ✅ Calculator `12+30=` → 42 with Finder frontmost, cursor and front app unchanged |
| Cmd shortcuts routed through the owning menu item in background (`pressMenuShortcut`) | bridge.swift extension | ❓ In the one test, `cmd+c` went out as a SkyLight key, not the menu item (clipboard still correct). Investigate why the menu match returned nil. |
| **Background pointer** (`background_pointer`, default **false**, experimental): SkyLight click recipe (stamped move, off-screen primer, window-routed down/up, fields 0/1/3/7/40/51/91/92/58, window-local stamp on macOS 27+) | `SkyLightInput.click/move/scroll` | ❌ unreliable: fresh Calculator ignored it, Finder sidebar ignored it. Worked only after the window had once received a real HID click. See §6.1. |
| **Freshness guard**: look records the root-event journal cursor; first step of a transaction refused with `ui_changed` if `AXWindowCreated/AXSheetCreated/AXMenuOpened/AXMenuClosed/AXFocusedWindowChanged` occurred since; TS returns "Not executed" + fresh state | Swift `LookRecord.eventCursor`, `act`; TS `UiChangedError`, `performDesktopTransaction` | ❓ not live |
| **Adaptive settle**: stop after 0.15 s if the app posts no AX notifications, or 0.10 s after it goes quiet, max 0.40 s (was a flat ~0.40 s) | Swift `attachRootDelta` | partially: 3-action batch 2.2 s → 1.4 s |
| `menu_commands` tool (list menu bar without opening, query filter) and `act_ui {action:"menu", command}` (AXPress by path; ellipsis/case/whitespace-insensitive; unique leaf allowed) | Swift `menuList/menuPress`, TS `performMenuCommands` | ❓ not live |
| `act_ui {action:"choosePath", location, confirm?}` → expands to Cmd+Shift+G, select-all, type, Return (…Return) | `expandMacroActions` | unit ✅, live ❓ |
| `app_control` tool: launch / quit / relaunch (with `args`) / activate / hide; launch waits for a window and returns roots | `performAppControl` | ❓ not live |
| Chromium hint: Electron/CEF app (`embedsChromium` from bundle frameworks) with ≤30 outline nodes → suggests `app_control relaunch --force-renderer-accessibility` | `chromiumAccessibilityHint`, Swift `listApps` | ❓ |
| `observe_ui {annotate:true}`: draws every interactive node's box + `@e` ref onto the screenshot (native `annotateImage`) | `annotateObservation`, Swift `annotateImage` | ❓ |
| `npm run bench:macos` live benchmark (Calculator medians + background-keyboard check) | `scripts/bench-macos.mjs` | ❓ never run |

`npm test` passes on the branch. `node scripts/check-package-assets.mjs` fails identically on upstream `main` (needs a release-built universal bundle) — not a regression.

---

## 5. Setting up the Mac sandbox

1. macOS 14+ (27.x ideal). Install Xcode Command Line Tools, Node 22+, `gh`.
2. `git clone https://github.com/ahmadaccino/pi-computer-use && cd pi-computer-use && git checkout handoff/grokbot && npm install`.
3. Grant **Accessibility** and **Screen Recording** to the terminal app you run tests from (System Settings → Privacy & Security). Synthetic input silently fails without Accessibility; captures are blank without Screen Recording.
4. Build the helper: `npm run build:native` (arm64; `node scripts/build-native.mjs --arch x64` for Intel; commit both binaries when native code changes).
5. Start the dev helper and point the runtime at it (does not touch an installed helper):
   ```bash
   scripts/dev/dev-helper.sh
   source scripts/dev/dev-env.sh
   ```
   Re-run `dev-helper.sh` after every `build:native`.
6. Write live tests against `scripts/dev/live-harness.mjs` (calls the real `execute*` tool functions). Example:
   ```js
   import { call, stateOf, done } from "../scripts/dev/live-harness.mjs";
   const roots = await call("app", { action: "launch", app: "Calculator" });
   const s = stateOf(await call("observe", { root: roots.details.roots[0].windowRef, mode: "semantic" }));
   await call("act", { stateId: s, observe: "visual", actions: [{ action: "click", text: "7" }, { action: "wait", ms: 200 }] });
   await done();
   ```
   Run with `npx tsx path/to/test.mjs`.
7. Prove background behavior with `scripts/dev/front-probe.swift` (compile once: `swiftc -O scripts/dev/front-probe.swift -o /tmp/front-probe`): print before and after; front app and cursor must not change.
8. To exercise the real pi integration end to end: `pi --no-extensions -e .` from the checkout (see CONTRIBUTING.md). Note this uses the installed helper path unless the env vars from step 5 are exported in that shell.

Rules that cost the previous agent time:
- **Never run `act_ui` and `observe_ui` (or two acts) on the same root in parallel.** Use `observe:"visual"` on act instead.
- Click coordinates are image pixels of *that state's* screenshot; check the coordinate legend line.
- Calculator's display value is `AXStaticText` with description "Edit field"; read it with `search_ui {text:"Edit field"}` (compact observe hides static text).
- Calculator persists its display across launches; press `escape` / "All Clear" first.
- Keep the sandbox's own user activity at zero during live runs; another app stealing focus invalidates background-input conclusions.

---

## 6. Work to do, in priority order

For every item: implement → `npm test` → live test on the Mac sandbox → record results (numbers, pass/fail, delivery fields from `details.execution.steps[].performed`) in the PR/commit body → regenerate docs if a tool/config/contract changed.

### 6.0 Live-verify round 2 (do this first)
1. `npm run bench:macos -- --runs 7 --out bench.json`. Save the JSON. It fails if background keyboard changes the front app.
2. **Background keyboard matrix**, other app frontmost, cursor parked elsewhere: TextEdit (type into a document; check `AXValue`), Safari address bar / web textarea, Chrome, an Electron app (Slack/Obsidian/VS Code), Notes. Record `performed.delivery` (expect `skylight`) and whether text landed. Also verify the user's front app still receives keys afterwards (type into it right after; arc-cua and cua-driver both document a bug class where the user's key window stops getting keys).
3. **Menu shortcut routing**: TextEdit `cmd+b`, Finder `cmd+shift+n` in background; expect `performed.grounding == "menu_shortcut"` and `menuCommand`. Fix `pressMenuShortcut` if it never matches (check `AXMenuItemCmdChar` casing, `AXMenuItemCmdModifiers` bits — shift 1, option 2, control 4, no-command 8 — and whether background apps expose menu children).
4. **Freshness guard**: observe TextEdit; open a sheet by hand (Format → Font…, or Save As); act on the old state → must return "Not executed … ui_changed" with a fresh state and send nothing. Then measure false refusals: run 50 normal single acts on Finder, Safari, Mail and count `ui_changed`. If chatty apps refuse often, narrow the structural set (e.g., ignore `AXFocusedWindowChanged` when the focused window equals the observed root) — document the decision.
5. `menu_commands` + `{action:"menu"}`: Finder `File > New Folder` with Finder in background (a folder appears; front app unchanged), TextEdit `Format > Make Plain Text`, an ambiguous leaf ("Close"), a disabled item, a missing path. Time `menu_commands` on Finder/Safari/Xcode.
6. `app_control`: launch TextEdit, quit with unsaved doc (must report the 10 s timeout clearly, not hang), relaunch Spotify/Obsidian with `--force-renderer-accessibility` and confirm the outline grows; activate/hide.
7. `annotate:true` on Engine DJ (install with `brew install --cask engine-dj`) and on Calculator; check boxes align (Retina scale) and labels are readable.
8. `choosePath`: TextEdit → File → Open… → `{action:"choosePath", location:"~/Documents", confirm:false}`; check the panel navigated. Then a Save panel.
9. Re-run cross-window drag: Finder → Finder (two windows, scratch dirs under /tmp), and **Finder → Engine DJ "Collection"** (the original failure; Engine DJ needs a USB/volume with an Engine Library, or use its local collection). Report reliability over 10 runs.
10. Regression sweep of round 1 (text clicks, wait, observe:visual, launch, keypress without ref).

### 6.1 Fix background pointer (high value, hard)
Goal: coordinate clicks without raising the window or moving the user's cursor, reliable enough to turn `background_pointer` on by default. Findings so far (macOS 27.2, Apple silicon):
- A screen-point `CGEventSetWindowLocation` stamp lands shifted on 27; window-local (top-left origin) is required — implemented (`windowLocationIsWindowLocal`).
- With window-local stamps, clicks on Calculator's "7" worked repeatedly **only after the window had received one real HID click**; on a freshly launched Calculator, nothing (also tried: no primer, 28 ms down→up, no user defocus, AXMain, inert-spot click, make-key records). Finder sidebar clicks also failed.
- Compare carefully with cua-driver's Rust (`trycua/cua` `libs/cua-driver/rust/crates/platform-macos/src/input/{mouse,skylight}.rs`): `prepare_background_pixel_click` (focus record **only** to target, 50 ms settle), `prime_exact_window_key` / `post_window_key_records` (defocus current key window record, focus target, make-key records 0x01/0x02, then *verify* `AXFocusedWindow` before posting), `with_pid_modifier_keys`, `post_mouse_moved_primer`, and the Chromium route plan. Also arc-cua `backends/macos_app.py` (`ready_for_keys`, `_inert_point`, `input_scope`/`keep_behind`). Check how they verify a background click took effect and what they do for SwiftUI/AppKit (`NSButton` modal tracking needs the down→up gap).
- Build a minimal fixture app (AppKit NSButton + SwiftUI Button + NSTableView) that logs received events, like OpenCU's `scripts/verify-gui.mjs` and arc-cua's native fixture, so you can test deterministically instead of guessing with Calculator.
- Acceptance: ≥ 95 % over 50 clicks on the fixture's AppKit and SwiftUI buttons and Finder's sidebar, freshly launched and backgrounded, with front app and cursor unchanged. Only then flip the default and document it.

### 6.2 Background scrolling via scroll bars
arc-cua scrolls by setting the scroll area's scroll bar values through AX (`scroll_area_by_bars`) before falling back to events — web views follow it in the background. Implement in Swift for the `scroll` action when `background_input` is on; verify on a long Safari page and a Finder list with the window behind another app.

### 6.3 Minimized windows and hidden apps
arc-cua moves a minimized window / hidden app onto an invisible virtual display (`macos_parking.py`) for input that needs events or pixels, then restores it. OpenCU also has an "agent desktop" virtual display. Scope: AX actions on minimized windows should already work — verify first; then design parking behind a config flag. Make sure windows are always restored on session end (SIGTERM, socket close).

### 6.4 Speed
Targets from arc-cua's measurements (M5, macOS 26): observe Calculator 8–26 ms, click until effect visible 12 ms, click with settle ~220 ms, menu command 9–16 ms. Our numbers (Ahmad's Mac): observe semantic 60–220 ms, fused 240–360 ms, act ~0.4–0.7 s, 6-action batch with visual successor ~3.2 s. Profile with `bench:macos`, then:
- skip `cgRootSignature` polling when AX events are live;
- consider arc's notification-driven AX cache (re-read only changed subtrees; opt-in) for repeat observes;
- check the TS side (outline parse, stabilizeRefs, rendering) for avoidable work;
- never trade away correctness: keep the freshness guard as the safety net for late sheets.

### 6.5 Nice-to-haves from the research (lower priority)
- `dialog` helpers beyond choosePath: pick a file in an Open panel and verify the selection before confirming (Peekaboo `dialog file`).
- Off-screen pressable controls list (typesafe-computer-use: `AXPress` works on rows scrolled out of view).
- OCR reuse: only re-OCR tiles that changed (typesafe-computer-use).
- Stable error codes table in docs (arc-cua/OpenCU style).
- Person-facing Stop button / input pause (OpenCU).
- Human-like mouse motion option for foreground moves (Peekaboo).

---

## 7. Definition of done for each change

- `npm test` green (includes `docs:check`, invariants, Swift typecheck, `test:one-shot`).
- New pure logic has assertions in `scripts/check-one-shot-actions.mjs` (or a new `scripts/check-*.mjs` wired into `npm test`).
- Live results from the **Mac sandbox** written into the commit/PR body: app, macOS version, runs, success count, medians, `performed` fields.
- Native changes: rebuild both `prebuilt/macos/{arm64,x64}/bridge` and commit them. New Swift files must be added to `scripts/build-native.mjs`, `scripts/setup-helper.mjs` (`helperSourcePaths`), `scripts/check-invariants.mjs` (typecheck list), and `package.json` `files`.
- Tool/schema/config/contract changes: edit the source blocks, run `npm run docs:generate`, commit the regenerated docs. New tools must be added to INV-11's expected list.
- Update `notes/release-v0.6.0.md`.
- Keep `background_pointer` default `false` until §6.1 acceptance passes.
- Push to a branch and open a PR against the fork's `main` (`gh pr create --repo ahmadaccino/pi-computer-use --base main`); do not force-push `main`.

## 8. References

- arc-cua: https://github.com/shhivv/arc-cua — `docs/driver.md`, `docs/internals.md`, `BENCHMARKS.md`, `src/arc_cua/backends/macos_background.py` (SkyLight, MIT), `macos_app.py`, `macos_parking.py`, `settling.py`.
- cua-driver: https://github.com/trycua/cua `libs/cua-driver/rust/crates/platform-macos/src/input/` (`skylight.rs`, `mouse.rs`, `keyboard.rs`), `libs/cua-driver/docs/test-matrix.md`.
- OpenCU: https://github.com/Daily-AC/opencu — `docs/macos.md`, `docs/independent-engine-contract.md`, `scripts/verify-gui.mjs`, pi adapter in `adapters/pi/`.
- Peekaboo: https://github.com/openclaw/Peekaboo — `docs/automation.md`, `docs/commands/{menu,dialog,app,drag}.md`.
- typesafe-computer-use: https://github.com/awlevin/typesafe-computer-use — `docs/how-a-step-works.md` (AX pruning, off-screen controls, OCR reuse).
- This repo: `docs/content/docs/reference/agent/contract.mdx` (generated; source in `src/bridge.ts`), `CONTRIBUTING.md`.
