# Fit the Maus workspace to laptop, iPad, and phone

Keep every supported web action reachable in the user's fork. Change how much appears at once, not which conversations or tools a person owns. Keep one React UI and the existing permissions. Do not change the official native app. Work in `sonlndv/layout` and use the fork's `main` as the baseline. Preserve the uncommitted sidebar work in that checkout.

## Layout contract

| Window | Proposed experience | Example of success |
| --- | --- | --- |
| Laptop web | Keep the current sidebar, chat, keyboard shortcuts, and tiled conversations. Keep a detail panel beside chat only when both fit. | At 1366 × 768, open a file from chat, read it, close it, and resume the same draft. |
| iPad | Use the available window width, not the device name. Keep list and chat together when they fit. Open details over chat when three columns would squeeze the transcript. | In portrait, open a room thread. Narrow the window in Split View, then widen it. Back returns to the same room and draft. |
| Phone | Give the list, chat, and a full detail view one screen each. Keep everyday actions in reach without hover. Let code and tables scroll inside the message, not across the whole page. | With the keyboard open, attach a file, type, send, see the reply, and reopen the bot list without losing your place. |

Start from the current 768px inline sidebar and the panel fit rules in `src/lib/use-media-query.ts`. `DESIGN.md` already reserves 440px for chat beside most panels. Change a rule only when a recorded case fails. Large text, safe areas, an external keyboard, and a narrow browser window matter as much as orientation. The previous isolated browser run covered a named phone list and an 820px iPad chat. It did not prove feature parity or physical Safari behavior.

## Delivery order

These are local review units, not requests to publish upstream. L1 starts from fork main. L2 incorporates the existing layout work after L1. L3 and L4 both depend on L2. Land L3 before L4 if they touch the same component. L5 depends on all four. Review each changed interaction before merge. No deployment is part of this plan.

### L1. Inventory the fork and freeze the laptop reference

- [ ] Own the comparison checklist under `docs/verification/` and the responsive fixture under `scripts/testing/`. Do not edit product code.
- [ ] Walk Simple and Advanced modes in an isolated fake-engine workspace. Compare fork additions, desktop bridge checks, browser routes, settings, and commands. Include chat, rooms, panes, files, computer view, inbox, approvals, automations, and workspace management.
- [ ] Record one row per action: feature, required role and host, entry point on each layout, expected result, fixture, evidence, and open gap. Classify each row as supported, missing a web entry point, or host-only with a reason. A hidden control is not evidence that the operation is unsupported.
- [ ] Unit: check that every inventoried web action names all three entry points or an explicit gap. Live: complete a laptop session using keyboard and pointer. Capture the same data and skin at every target size. Perf: record the fork-main baseline under the protocol below before any product change.

### L2. Make navigation survive a width change

- [x] Reviewed the [L1 fork-main reference](../verification/responsive-workspace-baseline.md) and retained the narrow drawer and wide sidebar preference.
- [x] The client keeps one pane tree, its thread data, and its focused slot. Below 768px it renders the focused conversation, or the primary conversation if the focus is an empty slot. Nothing snapshots or reopens the pane tree. Reopening would replay the read effects of an explicit navigation and could overwrite a deletion or reply received while narrow. A standalone detail keeps its source for Back. Explicit drawer picks still open/read the chosen thread.
- [x] The [two-client resize fixture](../verification/threads.md) passed. A room draft survived 390 → 820 → 390 and Back returned to the source. Across 1366 → 700 → 1366 the peer observed unchanged bot and room selections. A hidden bot reply changed the unread set from one to two; it stayed at two after widening, then returned to one on explicit open. A 600 ms network delay exposed no intermediate wrong room. Peer deletion left an empty slot. See the [projected room](../../.omb-scratch/verify-evidence/responsive-l2-navigation/projected-room.png) and [restored grid](../../.omb-scratch/verify-evidence/responsive-l2-navigation/restored-grid.png).
- [x] 271 scoped tests passed (16 files), including drawer/Back, hidden reads, focus, room opening, composer attachments, and approval/choice recovery. The two store tests that simulate EventSource use `?liveTransport=sse` in happy-dom; its default browser transport is WebSocket.
- [x] L1 navigation budget passed in all 12 comparisons (240 compositor presentations). Worst increase: Simple laptop sidebar, 244 → 270 ms (+10.8%, +26 ms). No cell exceeded both 20% and 17 ms. Physical iOS Safari and Home Screen remain unverified.

Candidate p95 in milliseconds, 20 warmed repetitions per action on Chrome 155.0.8059.84:

| Viewport | Simple sidebar / resize | Advanced sidebar / resize |
| --- | ---: | ---: |
| Laptop, 1366 × 768 | 270 / 317 | 236 / 259 |
| iPad, 820 × 1180 | 239 / 318 | 237 / 271 |
| Phone, 390 × 844 | 270 / 263 | 269 / 262 |

[Samples, trace and screenshot paths](../../.omb-scratch/verify-evidence/responsive-l2-navigation/results.json).
The uncommitted renderer was applied to a disposable archive of the L1 revision; its patch SHA-256 was `03e58c493d8e6efce1ff65bc636512f8b26fee5a06bc2d329eee9b1fb4b71336`.
The sorted path/content manifest of that archive plus patch matched the worktree's `src/` (tracked and nonignored new files), SHA-256 `d7f486f1f19e3f75c862b9a9c0f19f821c5e2fffc8b94c172538b333067347d3` before subsequent test-only changes. The served candidate HTML SHA-256 was `eaa4d8fa816f21c2c861857216bb3d1abbb00e03665897727a7e9563e12ccb0a`, distinct from the fork-main reference `4c42fafca8797f84de18a26369fc67701b1cdd627ea05e68ada9fdbd05a361f8`. `--working-renderer` covers tracked renderer changes only; include or explicitly verify any untracked source before using it for later qualification.
Reproduce with a **new** output directory:

```sh
OMB_CDP_CHROME=/usr/bin/chromium bash scripts/testing/responsive-workspace-baseline.sh \
  7ce06af8f2f991b0003cb5d390f1cdb4a3cc0593 .omb-scratch/verify-evidence/l2-rerun \
  --working-renderer '' '' navigation
```

### L3. Finish reading and composing on touch screens

- [ ] Depends on L2. Own `src/components/Composer.tsx`, `src/components/WorkspacePanes.tsx`, related chat styles in `src/styles.css`, and the composer and phone browser fixtures. Keep desktop keyboard focus behavior.
- [ ] Keep Send, attachments, and multiline input usable with the software keyboard visible. Preserve text and scroll position on rotation and keyboard dismissal. Do not summon the keyboard when a user is only reading or closing a pane.
- [ ] Unit: cover focus return and preservation of unsent text. Live: send one attachment and multiline message, read a streamed reply, open a long code block, and rotate while reading. Assert one send, no clipped controls, and no page-wide overflow. Repeat with an iPad hardware keyboard.
- [ ] Perf: compare input-to-next-paint while the fixture streams the same reply. Review phone and iPad recordings and the laptop tab order before merge.

### L4. Close gaps in the other screens

- [ ] Depends on L2 and L1's inventory. Own only the room, panel, settings, tool, or fork-specific component named by a failed row and its existing fixture. Keep shell navigation in L2. Split this unit into one review per group of related actions if several groups fail.
- [ ] Replace each hover-only or clipped entry with a touch-reachable action. Reuse an existing menu or full-screen detail before adding a new control. Keep everyday actions within two taps in Simple mode. Retain labels, keyboard access, focus return, and the same authorization checks.
- [ ] Unit: cover each alternate entry point and its permitted or denied state. Live: perform each repaired action to its observable result, not merely to an open menu. Include an approval, a room thread, a settings change, and a fork-only workflow on their applicable hosts. A desktop-only bridge gets a documented dependency or a separately approved implementation, never a fake working button.
- [ ] Perf: compare opening the slowest changed panel to L1. Review each interaction before merge.

### L5. Qualify the three layouts for the fork

- [ ] Depends on L1 through L4. Own `docs/verification/phone-web-app.md`, the parity checklist, device evidence, and targeted browser tests under `scripts/testing/`. Return product failures to their owning unit.
- [ ] Unit: run affected navigation, composer, panel, and permission tests. Live: run the production UI in the isolated fixture described in `docs/verification/README.md`. Cover phone at 320, 390, and landscape widths; iPad at 768, 820, and 1024 plus a narrow Split View; laptop at 1366 and 1440. Cross changed breakpoints in both directions. Check Midnight and Daylight, enlarged text, right-to-left navigation, reduced motion, touch, keyboard, and screen-reader names. Smoke-test Electron where it shares changed components.
- [ ] On a physical iPhone and iPad, use Safari and the Home Screen app with a disposable paired workspace. Check keyboard, safe areas, rotation, multitasking, background and resume, and reconnect. Record OS, browser, host, and result. If hardware is unavailable, mark the row unverified. Emulation does not pass it.
- [ ] Perf: rerun the L1 probes and apply the budgets below. Release decision: all supported actions pass on their eligible layouts, no unexplained omissions, and the owner has reviewed the visual differences. Do not claim desktop-only capabilities as mobile parity.

## Performance and evidence rules

Use the same fixture data, browser build, hardware, and warmed production assets for both commits. Record the fork-main commit and the candidate commit. For each changed interaction, repeat the same scripted action 20 times. Use a browser performance trace to compare the 95th percentile time between input or resize and the painted result. For transitions, compare after the same animation completes. Proposed rejection threshold: a regression greater than both 20% and one 60 Hz frame, about 17 ms. These are acceptance budgets, not observed performance. Also fail any run that loses a draft, sends twice, changes shared selection on resize, or scrolls the page horizontally at rest. Save the fixture recipe, before and after screenshots, timings, and any device limitation with each review.
