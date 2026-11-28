# Responsive workspace: fork-main reference

Run this before changing the renderer. It records interactions, not a desktop/mobile parity verdict. The reference revision in the layout worktree is `7ce06af8f2f991b0003cb5d390f1cdb4a3cc0593` (`sonlndv/OpenMausBot`, local `origin/main`). No fetch, checkout, live workspace URL, browser profile, or account is needed.

## Recorded fork-main run

**Narrowing a tiled chat changed the server's shared room selection.** In both modes on laptop and emulated iPad, an independent client saw the previously noncurrent side thread become the shared selection at 700px. Widening restored the local draft and focus, but not the original shared selection. Any resize-induced change to shared selection, even transient, fails L2.

**Unread coverage is narrower.** Fixture Starter was outside both panes and already had an unread message before resize. Its unread state survived. No message arrived in a temporarily hidden pane during this probe; whether that message stays unread after widening is unverified and belongs in L2.

The command below exited **1** on those four checks. Of 98 action rows, 84 completed, four failed, six required an operator fleet host, and four concerned tiled panes unavailable at phone width. All six cells sent one multiline message with its attachment, received the fake reply, and continued typing after closing the file preview. Both laptop cells completed keyboard/pointer navigation. No candidate was measured.

**Presentation p95 (ms), rounded; 20 warmed trials per cell and action.** Chrome 155.0.8059.84, Linux x64, Ryzen 7 8845HS, Node v26.13.1; 2026-11-27 UTC. Raw samples include the slower phone frames during streaming; do not substitute the earlier animation-frame callback for compositor presentation.

| Mode / viewport | Sidebar | Resize | Stream input | Computer | File | Inbox |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple laptop | 244 | 297 | 41 | 270 | 272 | 272 |
| Simple iPad | 239 | 318 | 18 | 306 | 74 | 334 |
| Simple phone | 270 | 250 | 184 | 303 | 71 | 271 |
| Advanced laptop | 241 | 266 | 31 | 270 | 270 | 271 |
| Advanced iPad | 237 | 266 | 17 | 303 | 73 | 304 |
| Advanced phone | 269 | 248 | 72 | 302 | 70 | 269 |

Evidence is local to this worktree, not checked in: [action rows](../../.omb-scratch/verify-evidence/responsive-fork-main/results.json), [laptop file preview](../../.omb-scratch/verify-evidence/responsive-fork-main/simple-laptop/file-preview.png), [rotated phone code](../../.omb-scratch/verify-evidence/responsive-fork-main/advanced-phone/reading-code-rotated.png), [iPad room after widening](../../.omb-scratch/verify-evidence/responsive-fork-main/simple-ipad/side-pane-resize-after.png), [iPad trace](../../.omb-scratch/verify-evidence/responsive-fork-main/simple-ipad/timeline.json.gz). See `peerBefore`, `peerNarrow`, `peerAfter`, and `draftFocus` on the four `side-pane-resize` failures.

## Reproduce on Linux

From the layout worktree, with Node 24+, the matching pnpm installation in `node_modules`, and Chromium installed:

```sh
OMB_CDP_CHROME=/usr/bin/chromium bash scripts/testing/responsive-workspace-baseline.sh \
  7ce06af8f2f991b0003cb5d390f1cdb4a3cc0593 .omb-scratch/verify-evidence/responsive-fork-main
```

Use a new output directory for each run. The launcher extracts the requested Git commit into a temporary directory, compares its lockfile with the installed dependency lockfile, builds with Vite there, and runs the probe against that build. Neither checkout's `dist` is used. The probe starts one `launchVerificationServer` with the repository fake Claude per mode and viewport. Only the URL returned by that launcher is used. The served root HTML must match the archive's `dist/index.html`. Each browser owns a temporary profile. The launcher exits nonzero for a failed action and retains its evidence.

| Viewport (CSS px) | Input |
| --- | --- |
| Laptop 1366 × 768 | Mouse, keyboard, Ctrl+Backslash, Enter |
| iPad 820 × 1180 | Chromium touch emulation |
| Phone 390 × 844 | Chromium touch emulation |

All six cells start in Daylight with the same fixture recipe: Pepper, Fixture Starter, Launch room with a noncurrent side thread, `notes.md`, and a scripted reply with a long code line. The isolated server allocates IDs and timestamps. Existing-user notice preferences are seeded before navigation so an announcement cannot cover the controls. The probe confirms the mode and skin, then saves a chat reference before sending anything.

The laptop uses Tab and Shift+Tab, Ctrl+Backslash, pointer actions, Enter to send, and Escape to return from the file to its draft. Other workflows read Inbox, switch Automations to Calendar, apply Dark and restore Light, and deny a fake-engine permission request. The deny must reach the waiting request; the proposed command never runs. The fork's tiled layout opens the noncurrent room thread in a second column. An independent HTTP client records the server's shared thread and unread IDs before narrowing, at 700px and after widening. Settings → Installations is host-only when the standalone fixture lacks the fleet agent or admin entitlement. No remote computer or fleet operation is started.

## Measurements and artifacts

`results.json` contains the commit, browser/OS/CPU, production shell digest and per-action evidence. Each row names the mode, viewport, availability, completed outcome, repetition count, elapsed time, before/after PNGs and Chrome trace. Open only a completed 20-sample row for comparison. `elapsedMs` is wall time for the whole workflow **including harness work**. `samplesMs`, nearest-rank p50/p95 and range are browser-clock measurements, not wall time. Empty samples mean there is no latency estimate.

- **Sidebar:** expand the desktop/iPad list using the keyboard shortcut, or open the phone drawer by touch. Check the named bot and the rendered width. Time after the sidebar transition settles.
- **Resize:** cross 768px and return with an unsent draft. Start at the trusted resize event and stop after the expected sidebar geometry and draft are visible.
- **Stream:** insert one character at a time into the composer while the same fake reply has a live transcript row. Require the corresponding value before timing each result.
- **Panels:** open the bot's computer panel, read the fixture Inbox list, and open the attached Markdown receipt. Time each panel 20 times from its own entry. The panel and its ancestors must finish animating. Compare the slowest applicable panel; do not substitute a menu opening for the panel result.

Each timed action has an untimed warm-up. `results.json` supplies two distinct clocks:

- `samplesMs` / `p95Ms`: trusted input or resize to the animation-frame callback **after** the expected UI appeared. This measures a rendering opportunity, not actual display.
- `framePresentationMs` / `presentationP95Ms`: input or resize to Chromium presenting the renderer frame in which the expected UI was observed. The collector matches the User Timing `result` mark to `AnimationFrame` on the same renderer thread and resolves its ID to `AnimationFrame::Presentation`. A missing frame receipt is `null`; no presentation p95 is reported without all 20 samples. This is headless compositor presentation, not physical display latency.

To inspect a sample, unzip `MODE-DEVICE/timeline.json.gz` and open the JSON in Chrome DevTools Performance. Look for `MODE-DEVICE/ACTION/REPETITION`. Keep both revisions, browser build, hardware, tracing, animation settings, fixture and data identical. Only flag a regression when the p95 increase exceeds **both** 20% and 17 ms. Lost drafts, duplicate sends, changed shared selection, and page-wide horizontal overflow at rest are functional failures independent of speed.

Physical iPhone/iPad Safari and Home Screen, software keyboard geometry, hardware iPad keyboard, safe areas, actual rotation, multitasking and background/resume are **unverified**. The desktop keyboard events in this run do not qualify an external iPad keyboard. For device qualification use [the phone web app checklist](phone-web-app.md).
