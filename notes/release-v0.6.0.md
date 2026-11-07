One-shot desktop actions: fewer tool calls, cross-window drags, and no more self-inflicted stale states.

## Features

- `act_ui` click/moveMouse by visible or OCR text (`{ action: "click", text: "Import" }`); ambiguity lists candidate refs and points, and controls beat inert text showing the same string.
- `act_ui` `{ action: "wait", ms }` step and `observe: "semantic" | "visual" | "fused"` successor capture (also on `wait_for`); `visual` attaches the successor screenshot.
- Drags take `from`/`to` endpoints (`ref`, `text`, or `x`+`y`); an endpoint with another root's `stateId` drops into that window or app. Native drags press-and-hold, interpolate, dwell over the target, raise covered drop roots, and refuse drops that would land on another app (`occluded_target`).
- `space: "screen"` for coordinates, plus a coordinate legend on image-bearing results.
- `keypress`/`typeText` without a ref deliver to the root's focused control, as documented.
- `find_roots` `launch: true` (macOS) and `waitMs`; app-name lookup falls back to a strong name match.
- Images attach automatically when most controls are unlabeled (custom-drawn UIs).

- Background keyboard input on macOS (`background_input`, default on): keys and text go to the target window through SkyLight with key focus lent per batch, Command shortcuts through the owning menu item; background coordinate clicks are opt-in (`background_pointer`). Adapted from arc-cua (MIT).
- Freshness guard: the first step of a transaction is refused with `ui_changed` and a fresh state when a window, sheet, or menu changed since the observation.
- `menu_commands` tool and `act_ui` `{ action: "menu", command }`: menu-bar commands without opening menus.
- `app_control` tool: launch, quit, relaunch with args, activate, hide; Electron/CEF apps get a `--force-renderer-accessibility` relaunch hint.
- `observe_ui` `annotate: true` draws control boxes and refs on the screenshot; `act_ui` `choosePath` drives Open/Save panels.
- Adaptive successor settling on Accessibility notifications (idle apps ~0.15 s instead of 0.4 s).
- `npm run bench:macos` live benchmark.

## Changelog

- fixed rejected `act_ui` transactions advancing the root epoch and invalidating every other state for that root
- added stale-state errors that name the latest state and warn against parallel act/observe on one root
- chore bump tsx to 4.23.15 and @types/node to 26.6.6 (from fork dependabot branches)

> "The ships hung in the sky in much the same way that bricks don't."
