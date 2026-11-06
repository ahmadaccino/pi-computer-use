One-shot desktop actions: fewer tool calls, cross-window drags, and no more self-inflicted stale states.

## Features

- `act_ui` click/moveMouse by visible or OCR text (`{ action: "click", text: "Import" }`); ambiguity lists candidate refs and points, and controls beat inert text showing the same string.
- `act_ui` `{ action: "wait", ms }` step and `observe: "semantic" | "visual" | "fused"` successor capture (also on `wait_for`); `visual` attaches the successor screenshot.
- Drags take `from`/`to` endpoints (`ref`, `text`, or `x`+`y`); an endpoint with another root's `stateId` drops into that window or app. Native drags press-and-hold, interpolate, dwell over the target, raise covered drop roots, and refuse drops that would land on another app (`occluded_target`).
- `space: "screen"` for coordinates, plus a coordinate legend on image-bearing results.
- `keypress`/`typeText` without a ref deliver to the root's focused control, as documented.
- `find_roots` `launch: true` (macOS) and `waitMs`; app-name lookup falls back to a strong name match.
- Images attach automatically when most controls are unlabeled (custom-drawn UIs).

## Changelog

- fixed rejected `act_ui` transactions advancing the root epoch and invalidating every other state for that root
- added stale-state errors that name the latest state and warn against parallel act/observe on one root
- chore bump tsx to 4.23.15 and @types/node to 26.6.6 (from fork dependabot branches)

> "The ships hung in the sky in much the same way that bricks don't."
