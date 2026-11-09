// Prints the frontmost app and the cursor position; compile with
// `swiftc -O scripts/dev/front-probe.swift -o /tmp/front-probe` and call it
// before/after a background action to prove nothing was stolen.
import AppKit
let p = NSEvent.mouseLocation
print("front=\(NSWorkspace.shared.frontmostApplication?.localizedName ?? "?") mouse=\(Int(p.x)),\(Int(p.y))")
