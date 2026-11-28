import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as holdFinger } from "node:timers/promises";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import { NOTICES } from "../../src/lib/notices";
import { openHeadlessChrome, type HeadlessPage } from "./headless-chrome";
import { fixtureApi, REPO_ROOT } from "./preview-fixture";

const stem = "NovemberWarehouseInventoryReconciliation".repeat(3);
const files = [
  { name: `Intake${stem}.md`, text: "Submitted inventory notes" },
  { name: `Review${stem}.md`, text: "Reviewed inventory notes" },
  { name: `Delivery${stem}.md`, text: "Delivered inventory notes" },
] as const;
const q = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;

// Scroll vertically to a message, but never pan sideways to rescue a clipped action.
async function tap(page: HeadlessPage, selector: string, fileAction = true) {
  const target = q(selector);
  await page.until(`!!${target}`, 15_000);
  if (fileAction) {
    const horizontal = await page.evaluate(`(() => {
      const b = ${target}, r = b.getBoundingClientRect();
      let left = 0, right = innerWidth;
      for (let el = b.parentElement; el; el = el.parentElement) {
        if (!el.matches('[data-chat-bubble]') && getComputedStyle(el).overflowX === 'visible') continue;
        const rect = el.getBoundingClientRect();
        left = Math.max(left, rect.left); right = Math.min(right, rect.right);
      }
      return { width: r.width, height: r.height, fits: r.left >= left - 1 && r.right <= right + 1 };
    })()`);
    expect(horizontal, selector).toMatchObject({ fits: true });
    expect(horizontal.width, selector).toBeGreaterThanOrEqual(44);
    expect(horizontal.height, selector).toBeGreaterThanOrEqual(44);
  }
  const point = `(() => { const e = ${target}; if (!e) return null; const r = e.getBoundingClientRect(), x = r.left + r.width/2, y = r.top + r.height/2; return e.contains(document.elementFromPoint(x,y)) ? { x,y } : null; })()`;
  let lastGesture: { x: number; y: number; dy: number } | null = null;
  if (await page.evaluate(`${target}.closest('[role="log"]') !== null`)) {
    // The header and composer cover opposite ends of the transcript. A real swipe
    // also tells scroll-follow to stop tracking the newest row while reading.
    for (let swipe = 0; swipe < 8 && !await page.evaluate(point); swipe++) {
      const gesture = await page.evaluate(`(() => {
        const el = ${target}, log = el.closest('[role="log"]'), box = log.getBoundingClientRect();
        const x = (Math.max(0,box.left) + Math.min(innerWidth,box.right)) / 2;
        const visible = [];
        for (let y = 12; y < innerHeight - 12; y += 8) if (log.contains(document.elementFromPoint(x,y))) visible.push(y);
        if (visible.length < 3) return null;
        const middle = visible[Math.floor(visible.length/2)], r = el.getBoundingClientRect();
        const dy = middle - r.top - r.height/2;
        const start = dy > 0 ? visible[0] : visible.at(-1);
        const travel = Math.min(Math.abs(dy) + 12, visible.at(-1) - visible[0]);
        return { x, y: start, dy: Math.sign(dy) * travel };
      })()`);
      lastGesture = gesture;
      if (!gesture?.dy) break;
      const { x, y, dy } = gesture;
      await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 6; step++) {
        await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy * step / 6 }] });
      }
      // Chromium uses real input timestamps for momentum. A moving finger
      // would fling the list, and the next tap would stop it rather than open a file.
      await holdFinger(180);
      await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
  } else {
    await page.evaluate(`${target}.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })`);
  }
  try {
    await page.until(point, 5_000);
  } catch (error) {
    const details = await page.evaluate(`(() => {
      const e = ${target}, r = e.getBoundingClientRect(), x = r.left+r.width/2, y = r.top+r.height/2;
      return { viewport:[innerWidth,innerHeight,visualViewport.width,visualViewport.height], rect:r.toJSON(),
        hits:document.elementsFromPoint(x,y).slice(0,6).map(el=>el.outerHTML.split('>')[0]),
        scroll:Array.from(document.querySelectorAll('*')).filter(el=>el.contains(e)&&el.scrollHeight>el.clientHeight+1).map(el=>[el.className,el.scrollTop,el.clientHeight,el.scrollHeight]) };
    })()`);
    throw new Error(`Cannot tap ${selector}: ${JSON.stringify({ lastGesture, ...details })}`, { cause: error });
  }
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [await page.evaluate(point)] });
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

it.runIf(process.env.OMB_UI_E2E === "1")("opens, closes and downloads long named files from all three touch transcript surfaces", async () => {
  const build = resolve(process.env.OMB_WEB_APP_BUILD || join(REPO_ROOT, "dist"));
  const shell = readFileSync(join(build, "index.html"), "utf8");
  const fx = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true }, [], undefined, build);
  const { url, dataDir, logPath } = fx.info;
  let page: HeadlessPage | undefined;
  try {
    expect(await (await fetch(url)).text()).toBe(shell);
    const api = fixtureApi(url, { headers: { origin: url } });
    const ctl = (...args: string[]) => runControlOmb([...args, "--url", url]);
    const { bot } = await ctl("new-bot", "--name", "Pepper") as { bot: { id: string; activeTaskId: string } };
    const starter = (await api("GET", "/api/bots")).bots.find((b: { id: string }) => b.id !== bot.id);
    if (starter) await api("PATCH", `/api/bots/${starter.id}`, { welcomed: true });
    const folder = join(dataDir, "workspaces", bot.id);
    mkdirSync(folder, { recursive: true });
    const [submitted, linked, delivered] = files;
    for (const file of files) writeFileSync(join(folder, file.name), file.text);
    writeFileSync(join(dataDir, "room-plan.json"), JSON.stringify({ [bot.id]: { script: [
      { key: "review", match: ["Review this inventory"], reply: `Read [${linked.name}](./${linked.name}).` },
      { key: "delivery", match: ["Send the inventory delivery"], steps: [{ tool: "attach_file", arguments: { path: join(folder, delivered.name) } }], reply: "The inventory delivery is attached." },
    ] } }));
    const upload = await fetch(`${url}/api/files?name=${encodeURIComponent(submitted.name)}`, {
      method: "POST", headers: { "content-type": "text/markdown", origin: url }, body: readFileSync(join(folder, submitted.name)),
    });
    expect(upload.ok).toBe(true);
    const saved = await upload.json() as { path: string; name: string };
    await ctl("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", `Review this inventory\n\n<attached-file path="${saved.path}" name="${saved.name}" />`);
    expect(await ctl("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).toMatchObject({ status: "settled" });
    // Only a reply carrying both prose and an unlinked delivered file renders the compact output chip.
    const { routine } = await api("POST", "/api/routines", { botId: bot.id, name: "Inventory delivery", prompt: "Send the inventory delivery", enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 } });
    const { run } = await api("POST", `/api/routines/${routine.id}/run`);
    await expect.poll(async () => (await api("GET", "/api/routines")).runs.find((r: { id: string }) => r.id === run.id)?.report?.state, { timeout: 30_000 }).toBe("posted");

    const p = page = await openHeadlessChrome(join(dataDir, "chrome"));
    await p.send("Page.enable");
    await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await p.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "display-mode", value: "standalone" }] });
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(navigator, 'standalone', {value:true}); for (const k of ${JSON.stringify(NOTICES)}) localStorage.setItem(k, '1'); localStorage.setItem('omb-simple-mode-prompt','1'); localStorage.setItem('omb-email-gate','skipped'); localStorage.setItem('omb-analytics-opt-out','1');` });
    for (const [width, height] of [[320, 568], [390, 844], [507, 1024], [820, 1180], [1024, 768], [844, 390]] as const) {
      await p.send("Emulation.setDeviceMetricsOverride", { width, height, mobile: true, deviceScaleFactor: 1 });
      await p.send("Page.navigate", { url });
      await p.until(`!!document.querySelector('textarea[aria-label^="Message"]')`, 30_000);
      const editor = 'textarea[aria-label="Message Pepper"]';
      if (!await p.evaluate(`!!${q(editor)}`)) {
        if (width < 768) await tap(p, 'button[aria-label="Open bot list"]', false);
        await tap(p, `[data-sidebar-bot-row="${bot.id}"]`, false);
      }
      await p.until(`!!${q(editor)}`);
      expect(await p.evaluate(`innerWidth === ${width} && navigator.standalone && matchMedia('(pointer: coarse)').matches`)).toBe(true);
      const draft = `Continue inventory ${width}`;
      await tap(p, editor, false);
      await p.send("Input.insertText", { text: draft });
      const expectedDraft = await p.evaluate(`${q(editor)}.value`);
      expect(expectedDraft).toContain(draft);
      const downloads = join(dataDir, `downloads-${width}`);
      mkdirSync(downloads);
      await p.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
      for (const [i, file] of files.entries()) {
        const selector = i === 1 ? `button[title="Preview: ${file.name}"]` : `button[aria-label="Preview: ${file.name}"]`;
        await tap(p, selector);
        await p.until(`${q('dialog[open] [data-markdown-file]')}?.textContent === ${JSON.stringify(file.text)}`, 10_000);
        expect(await p.evaluate(`${q('dialog[open] header h2')}.textContent`)).toBe(file.name);
        await tap(p, 'dialog[open] header button');
        await p.until(`!document.querySelector('dialog[open]') && document.activeElement === ${q(selector)}`);
        expect(await p.evaluate(`${q(editor)}.value`)).toBe(expectedDraft);
        await tap(p, `button[aria-label="Save a copy of ${file.name}"]`);
        await expect.poll(() => { try { return readFileSync(join(downloads, file.name), "utf8"); } catch { return null; } }, { timeout: 8_000 }).toBe(file.text);
        expect(await p.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")).toBe(true);
        writeFileSync(`${logPath}.files-${width}-${i + 1}.png`, await p.capture());
      }
    }
    console.log(`Touch file captures: ${logPath}.files-*.png`);
  } catch (error) {
    if (page) {
      writeFileSync(`${logPath}.files-blocked.png`, await page.capture());
      console.error(`Blocked file touch: ${logPath}.files-blocked.png`);
    }
    throw error;
  } finally {
    page?.close(); await page?.exited(3_000); await fx.close();
  }
}, 150_000);
