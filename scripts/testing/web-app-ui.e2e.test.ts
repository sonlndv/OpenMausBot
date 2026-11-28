// Production UI and browser installability, in an owned disposable profile.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "../control-omb.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { ensureUiBrowser } from "./control-omb-ui.ts";
import { fixtureApi } from "./preview-fixture.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const enabled = process.env.OMB_UI_E2E === "1";
const build = process.env.OMB_WEB_APP_BUILD || join(root, "dist");
if (!enabled) console.log("skipping web app UI: build the UI and set OMB_UI_E2E=1 for browser qualification");

async function connect(url: string) {
  const socket = new WebSocket(url);
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const events: string[] = [];
  let next = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method) { events.push(message.method); if (events.length > 20) events.shift(); }
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Fixture Chrome connection failed")), { once: true });
  });
  return {
    close: () => {
      for (const waiting of pending.values()) waiting.reject(new Error("Fixture Chrome connection closed"));
      pending.clear();
      socket.close();
    },
    request(method: string, params: unknown = {}, sessionId?: string): Promise<any> {
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture Chrome ${method} timed out: ${events.join(", ")}`)); }, 30_000);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

(enabled ? it : it.skip)("qualifies the served phone web app and keeps controls inside safe areas", async () => {
  if (!existsSync(join(build, "index.html"))) throw new Error("Run pnpm build before OMB_UI_E2E=1 web-app qualification");
  let fixture: VerificationServer | undefined;
  let chrome: ChildProcess | undefined;
  let cdp: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    const tools = await ensureUiBrowser();
    if (!tools.chrome) throw new Error("This recipe needs the pinned Chrome for Testing");
    fixture = await launchVerificationServer({ FAKE_CODEX_MODE: "happy", FAKE_CODEX_CONTEXT_TOKENS: "252960", FAKE_CODEX_CONTEXT_TOKENS_AFTER_COMPACT: "40000" },
      undefined, undefined, undefined, undefined, undefined, ["codex"], undefined, build);
    const { url, dataDir, logPath } = fixture.info;
    mkdirSync(join(dataDir, ".codex"), { recursive: true });
    writeFileSync(join(dataDir, ".codex", "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { account_id: "pwa-fixture", access_token: "fixture" } }));
    const { bot } = await runControlOmb(["new-bot", "--name", "Pepper", "--url", url]) as { bot: { id: string; activeTaskId: string } };
    const api = fixtureApi(url, { headers: { origin: url } });
    const starter = (await api("GET", "/api/bots")).bots.find((other: { id: string }) => other.id !== bot.id);
    if (starter) await api("PATCH", `/api/bots/${starter.id}`, { welcomed: true });
    const title = "Field notes for the next site visit and the equipment checklist";
    const models = await runControlOmb(["models", "--url", url]) as { instances: Array<{ instanceId: string; models: { options: { id: string }[] } }> };
    const model = models.instances.find(instance => instance.instanceId === "codex")!.models.options[0].id;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.activeTaskId}`, { title: "Ideas for planning our next field research session", modelSelection: { instanceId: "codex", model }, requireAvailableModel: true });
    const side = (await api("POST", `/api/bots/${bot.id}/tasks`, { title })).task.threadId;
    await api("POST", `/api/bots/${bot.id}/tasks/${bot.activeTaskId}`, {});
    const profile = join(dataDir, "chrome");
    mkdirSync(profile, { recursive: true });
    chrome = spawn(tools.chrome, ["--headless=new", "--window-size=1366,1200", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--password-store=basic", "--use-mock-keychain", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {
      env: { PATH: process.env.PATH, HOME: dataDir, USERPROFILE: dataDir, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
      stdio: "ignore",
    });
    const portFile = join(profile, "DevToolsActivePort");
    await expect.poll(() => existsSync(portFile), { timeout: 20_000 }).toBe(true);
    const [port, endpoint] = readFileSync(portFile, "utf8").trim().split("\n");
    cdp = await connect(`ws://127.0.0.1:${port}${endpoint}`);
    const target = await cdp.request("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.request("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const session = attached.sessionId as string;
    const request = (method: string, params: unknown = {}) => cdp!.request(method, params, session);
    const evaluate = async (expression: string) => {
      const value = await request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
      return value.result.value;
    };
    await request("Page.enable");
    await request("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await request("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.setItem('omb-analytics-opt-out','1');localStorage.setItem('omb-email-gate','skipped');localStorage.setItem('grok-move-2026-11','1');localStorage.setItem('teams-2026-11b','1');localStorage.setItem('modelgo-offer-2026-11','1');localStorage.setItem('whats-new-2026-11b','1');localStorage.setItem('whats-new-2026-11c','1');" });
    await request("Runtime.enable");
    await request("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await request("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await request("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.setItem('openmausbot.sidebarDensity','avatars')" });
    await request("Page.navigate", { url });
    const drawerButton = `document.querySelector('button[aria-label="Open bot list"]')`;
    await expect.poll(() => evaluate("document.querySelector('textarea[aria-label^=\"Message\"]') !== null"), { timeout: 20_000 }).toBe(true);
    await evaluate(`${drawerButton}.click()`);
    const botRow = `document.querySelector('[data-sidebar-bot-row="${bot.id}"]')`;
    await expect.poll(() => evaluate(`${botRow}?.innerText.includes("Pepper")`)).toBe(true);
    const sidebarBox = `document.querySelector('[data-sidebar]').getBoundingClientRect()`;
    await expect.poll(() => evaluate(`${sidebarBox}.right`)).toBe(390);
    const listShot = await request("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${logPath}.web-app-list.png`, Buffer.from(listShot.data, "base64"));
    await evaluate(`${botRow}.click()`);
    await expect.poll(() => evaluate(`${drawerButton}.getAttribute("aria-expanded")`)).toBe("false");
    await evaluate(`${drawerButton}.click()`);
    await evaluate(`document.querySelector('[data-sidebar-top-buttons] button[aria-label="Close"]').click()`);
    await expect.poll(() => evaluate(`${drawerButton}.getAttribute("aria-expanded")`)).toBe("false");
    const threads = `document.querySelector('[data-chathead-threads]')`;
    const sheet = `document.querySelector('[role="dialog"]')`;
    const tap = async (expression: string) => {
      const point = `(() => {const e=${expression}; if (!e) return null; const r=e.getBoundingClientRect(), x=r.x+r.width/2,y=r.y+r.height/2; return e.contains(document.elementFromPoint(x,y)) ? {x,y} : null})()`;
      const steady = `(async()=>{let previous,frames=0;for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);const p=${point};frames=p&&previous&&p.x===previous.x&&p.y===previous.y?frames+1:0;if(frames===3)return p;previous=p}return null})()`;
      let target: { x: number; y: number } | null = null;
      await expect.poll(async () => (target = await evaluate(steady)), { message: `Touch target is moving, obscured or offscreen: ${expression}` }).toBeTruthy();
      await request("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [target] });
      await request("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await tap(threads);
    const taskButton = (id: string) => `${sheet}?.querySelector('[data-thread-chip="${id}"]')`;
    await expect.poll(() => evaluate(`${taskButton(side)}?.textContent`)).toContain(title);
    const menuBounds = await evaluate(`(() => {
      const menu = ${sheet}.getBoundingClientRect(), button = ${threads}.getBoundingClientRect();
      return { gap: menu.top - button.bottom, left: menu.left, right: innerWidth - menu.right };
    })()`);
    expect(menuBounds.gap).toBeGreaterThanOrEqual(0);
    expect(menuBounds.gap).toBeLessThanOrEqual(8);
    expect(Math.min(menuBounds.left, menuBounds.right)).toBeGreaterThanOrEqual(8);
    const threadsShot = await request("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${logPath}.threads.png`, Buffer.from(threadsShot.data, "base64"));
    await tap(taskButton(side));
    await expect.poll(() => evaluate(`${threads}?.textContent`)).toContain(title);
    await tap(threads);
    await tap(taskButton(bot.activeTaskId));
    await expect.poll(() => evaluate(`${threads}?.textContent.includes(${JSON.stringify(title)})`)).toBe(false);
    // iOS automatically zooms small form text on focus, leaving a standalone
    // window shifted after the keyboard closes. Keep the mention mirror aligned.
    const touchText = await evaluate(`(() => {
      const input = document.querySelector('textarea[aria-label^="Message"]');
      return { input: parseFloat(getComputedStyle(input).fontSize),
        mirror: parseFloat(getComputedStyle(document.querySelector('.mention-editor-mirror')).fontSize) };
    })()`);
    expect(touchText.input).toBeGreaterThanOrEqual(16);
    expect(touchText.mirror).toBe(touchText.input);
    const parsed = await request("Page.getAppManifest");
    expect(parsed.url).toBe(`${url}/manifest.webmanifest`);
    expect(parsed.errors).toEqual([]);
    const installability = await request("Page.getInstallabilityErrors");
    expect(installability.installabilityErrors).toEqual([]);
    await expect.poll(() => evaluate("document.querySelector('textarea[aria-label^=\"Message\"]') !== null"), { timeout: 20_000 }).toBe(true);
    await evaluate(`${drawerButton}.click()`);
    await request("Emulation.setDeviceMetricsOverride", { width: 820, height: 1180, deviceScaleFactor: 1, mobile: true });
    await expect.poll(() => evaluate(`${drawerButton}.getAttribute("aria-expanded")`)).toBe("false");
    for (const [width, height, insets] of [[390, 844, { top: 44, bottom: 34, left: 0, right: 0 }],
      [820, 1180, { top: 24, bottom: 20, left: 0, right: 0 }],
      [844, 390, { top: 0, bottom: 21, left: 44, right: 44 }]] as const) {
      await request("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
      await request("Emulation.setSafeAreaInsetsOverride", { insets });
      await expect.poll(() => evaluate(`[innerWidth, innerHeight, ...['Top','Right','Bottom','Left'].map(edge => parseFloat(getComputedStyle(document.getElementById('root'))['padding'+edge]))]`))
        .toEqual([width, height, insets.top, insets.right, insets.bottom, insets.left]);
      if (width < 768) await expect.poll(() => evaluate(`${sidebarBox}.right`)).toBeLessThanOrEqual(insets.left);
      else await expect.poll(() => evaluate(`${sidebarBox}.width`)).toBeLessThan(100);
      const box = await evaluate(`(() => { const root=document.getElementById('root').getBoundingClientRect();
        const input=document.querySelector('textarea[aria-label^="Message"]').getBoundingClientRect();
        return {overflow:document.documentElement.scrollWidth>innerWidth, top:input.top, bottom:input.bottom, left:input.left, right:input.right, height:root.height}; })()`);
      expect(box.overflow).toBe(false);
      expect(box.top).toBeGreaterThanOrEqual(insets.top);
      expect(box.bottom).toBeLessThanOrEqual(height - insets.bottom);
      expect(box.left).toBeGreaterThanOrEqual(insets.left);
      expect(box.right).toBeLessThanOrEqual(width - insets.right);
      const shot = await request("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${logPath}.web-app-${width}.png`, Buffer.from(shot.data, "base64"));
    }
    await evaluate("document.querySelector('textarea[aria-label^=\"Message\"]').focus()");
    await request("Input.insertText", { text: "Phone web app fixture message" });
    await request("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await request("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    const settled = await runControlOmb(["wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "25", "--url", url]) as { status: string };
    expect(settled.status).toBe("settled");
    await expect.poll(() => evaluate("document.body.textContent.includes('Phone web app fixture message')"), { timeout: 15_000 }).toBe(true);
    await request("Page.reload");
    await expect.poll(() => evaluate("document.body.textContent.includes('Phone web app fixture message')"), { timeout: 15_000 }).toBe(true);
    const messages = await fetch(`${url}/api/threads/${bot.activeTaskId}/messages?limit=50`).then(r => r.json());
    expect(messages.messages.filter((message: { role: string; text: string }) => message.role === "user" && message.text === "Phone web app fixture message")).toHaveLength(1);
    expect(await evaluate("caches.keys()" )).toEqual([]);
    expect(await evaluate("navigator.serviceWorker.getRegistrations().then(items=>items.length)")).toBe(0);
    // The regular touch browser opts into cover. Simulate the WebKit launch
    // signals on the same build, including iPadOS's desktop UA and zero inset.
    const viewport = `document.querySelector('meta[name="viewport"]').content`;
    expect(await evaluate(viewport)).toContain("viewport-fit=cover");
    const statusEdge = `document.querySelector('.ios-home-screen-status-edge')`;
    expect(await evaluate(`Boolean(${statusEdge})`)).toBe(false);
    await request("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    await request("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15" });
    await request("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(navigator,'standalone',{value:true});localStorage.setItem('omb-skin','midnight');for(const key of ['omb-simple-mode-prompt','boat-credit-2026-11','github-star-dismissed'])localStorage.setItem(key,'1')" });
    await request("Emulation.setEmulatedMedia", { features: [{ name: "display-mode", value: "standalone" }] });
    const warning = `document.querySelector('[data-testid="context-warning"]')`;
    const more = `document.querySelector('[data-chathead-controls] button[aria-label="More"]')`;
    const activeInput = `Array.from(document.querySelectorAll('textarea[aria-label^="Message"]')).find(e=>e.getBoundingClientRect().width)`;
    const headerFrame = `(() => {
      const elements = [${drawerButton},${threads},${more},${warning}].filter(e=>e?.getBoundingClientRect().width);
      const title = ${threads}?.querySelector('[data-chathead-conversation]');
      return { width: innerWidth, rootTop: parseFloat(getComputedStyle(document.getElementById('root')).paddingTop),
        boxes: elements.map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]}),
        titleWidth: title?.clientWidth, singleLine: title && title.scrollHeight <= parseFloat(getComputedStyle(title).lineHeight) + 1,
        targets: elements.map(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}) };
    })()`;
    const capture = async (name: string) => {
      const screenshot = await request("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${logPath}.${name}.png`, Buffer.from(screenshot.data, "base64"));
    };
    await api("PATCH", "/api/config", { features: { threadTabs: true } });
    for (const mode of ["simple", "advanced"]) {
      await evaluate(`localStorage.setItem('omb-advanced-mode','${mode === "simple" ? "0" : "1"}')`);
      await request("Page.reload");
      await expect.poll(() => evaluate(`navigator.standalone && ${warning}?.textContent.includes('93%')`), { timeout: 15000 }).toBe(true);
      expect(await evaluate(viewport)).not.toContain("viewport-fit=cover");
      await evaluate(`(()=>{
        const events=[], frames=[];
        for(const type of ['touchstart','touchend']) document.addEventListener(type,e=>events.push({type,t:e.timeStamp,name:e.target.closest('button,[role=tab],[role=option]')?.textContent?.slice(0,80)}),{passive:true});
        window.pwaJourney={events,frames}; function record(t){frames.push({t,...${headerFrame}});requestAnimationFrame(record)}requestAnimationFrame(record);
      })()`);
      for (const [width, height] of [[390, 844], [320, 568], [507, 1024], [820, 1180], [1180, 820], [844, 390], [390, 844]]) {
        await request("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
        if (width < 768) await expect.poll(() => evaluate(`${sidebarBox}.right`)).toBeLessThanOrEqual(0);
        if (width >= 768) await expect.poll(() => evaluate(`${sidebarBox}.width`)).toBeLessThan(width / 2);
        await expect.poll(() => evaluate(`innerWidth===${width} && !!(${threads})===${width < 768}`)).toBe(true);
        expect(await evaluate(`(() => {
          const edge=${statusEdge}, rect=edge.getBoundingClientRect(), style=getComputedStyle(edge);
          return rect.top===0 && rect.left===0 && rect.width===innerWidth && rect.height>10 &&
            style.position==='fixed' && style.backgroundColor===getComputedStyle(document.querySelector('[data-look="chat"]')).backgroundColor &&
            style.backgroundClip==='text' && style.pointerEvents==='none' && document.elementFromPoint(innerWidth/2,4)!==edge;
        })()`)).toBe(true);
        const tag = `pwa-${mode}-${width}x${height}`;
        await capture(tag);
        const frames = await evaluate(`(async()=>{const frames=[];for(let n=0;n<6;n++){const tick=Promise.withResolvers();requestAnimationFrame(tick.resolve);await tick.promise;frames.push(${headerFrame})}return frames})()`);
        writeFileSync(`${logPath}.${tag}.json`, JSON.stringify(frames));
        for (const g of frames) {
          expect(g.rootTop, tag).toBe(0);
          expect(g.boxes.every(([l,t,r,b]:number[]) => l >= 0 && t >= 0 && r <= width && b <= height), tag).toBe(true);
          if (width < 768) {
            expect(g.titleWidth, tag).toBeGreaterThan(64);
            expect(g.singleLine, tag).toBe(true);
            const [bots, threads, more] = g.boxes;
            for (const box of [threads, more]) {
              expect(box[1], tag).toBeCloseTo(bots[1], 0);
              expect(box[3], tag).toBeCloseTo(bots[3], 0);
            }
            expect(g.targets.every(Boolean), tag).toBe(true);
          }
        }
        if (width >= 768) {
          await tap(`document.querySelector('[data-tab-id="${side}"] [data-tab-label]')`);
          await expect.poll(() => evaluate(`document.querySelector('[data-tab-id="${side}"]').ariaSelected`)).toBe("true");
          await tap(`document.querySelector('[data-tab-id="${bot.activeTaskId}"] [data-tab-label]')`);
          await expect.poll(() => evaluate(`document.querySelector('[data-tab-id="${bot.activeTaskId}"]').ariaSelected`)).toBe("true");
          await capture(`${tag}-returned`);
          await expect.poll(() => evaluate(`${warning}?.textContent`)).toContain("93%");
          await tap(`document.querySelector('textarea[aria-label^="Message"]')`);
          await expect.poll(() => evaluate(`document.activeElement.tagName`)).toBe("TEXTAREA");
          continue;
        }
        if (width === 320) {
          await tap(activeInput);
          // Replay WebKit's keyboard geometry; Chromium's device resize also shrinks the layout viewport.
          await evaluate(`Object.defineProperty(visualViewport,'height',{configurable:true,value:300});visualViewport.dispatchEvent(new Event('resize'))`);
          await evaluate(`Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:110});visualViewport.dispatchEvent(new Event('scroll'))`);
          const keyboardFit = `(() => {
            const top=visualViewport.offsetTop, bottom=top+visualViewport.height, row=${activeInput}.closest('[data-composer-row]').getBoundingClientRect();
            return ${threads}.getBoundingClientRect().top>=top && bottom-row.bottom>=0 && bottom-row.bottom<32;
          })()`;
          await expect.poll(() => evaluate(keyboardFit)).toBe(true);
          await request("Input.insertText", { text: "So" });
          const draft = await evaluate(`${activeInput}.value`);
          expect(draft).toContain("So");
          await capture(`${tag}-visual-keyboard`);
          await evaluate(`delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))`);
          await expect.poll(() => evaluate(keyboardFit)).toBe(true);
          expect(await evaluate(`${activeInput}.value`)).toBe(draft);
        }
        if (width === 507) {
          await tap(activeInput);
          await request("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, commands: ["selectAll"] });
          await request("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
          await request("Input.insertText", { text: `${mode} Split View draft` });
          await request("Emulation.setDeviceMetricsOverride", { width, height: 460, deviceScaleFactor: 1, mobile: true });
          await expect.poll(() => evaluate(`innerHeight===460 && ${activeInput}.getBoundingClientRect().bottom<=460`)).toBe(true);
          await capture(`${tag}-editing`);
          await request("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
        }
        await tap(drawerButton);
        await expect.poll(() => evaluate(`${drawerButton}.ariaExpanded`)).toBe("true");
        await expect.poll(() => evaluate(`${sidebarBox}.right`)).toBe(width);
        await tap(`document.querySelector('[data-sidebar-top-buttons] button[aria-label="Close"]')`);
        await expect.poll(() => evaluate(`${drawerButton}.ariaExpanded`)).toBe("false");
        await expect.poll(() => evaluate(`${sidebarBox}.right`)).toBeLessThanOrEqual(0);
        await tap(threads);
        await capture(`${tag}-threads`);
        await tap(taskButton(side));
        await expect.poll(() => evaluate(`${threads}?.textContent`)).toContain(title);
        if (width === 507) await expect.poll(() => evaluate(`${activeInput}?.value`)).toBe("");
        await expect.poll(() => evaluate(`!(${warning})`)).toBe(true);
        await tap(threads);
        await tap(taskButton(bot.activeTaskId));
        await expect.poll(() => evaluate(`${warning}?.textContent`)).toContain("93%");
        if (width === 507) await expect.poll(() => evaluate(`${activeInput}?.value`)).toBe(`${mode} Split View draft`);
        await tap(more);
        await expect.poll(() => evaluate(`${more}.ariaExpanded`)).toBe("true");
        await capture(`${tag}-more`);
        const menu = `document.getElementById(${more}.getAttribute('aria-controls'))`;
        await expect.poll(() => evaluate(`${menu}.getBoundingClientRect().left`)).toBeGreaterThan(4);
        await request("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 3, y: height / 2 }] });
        await request("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect.poll(() => evaluate(`${more}.ariaExpanded`)).toBe("false");
      }
      writeFileSync(`${logPath}.pwa-${mode}-journey.json`, JSON.stringify(await evaluate("window.pwaJourney")));
    }
    await tap(`${warning}.querySelector('button')`);
    await expect.poll(() => evaluate(`!(${warning})`), { timeout: 15000 }).toBe(true);
    await expect.poll(async () => (await api("GET", `/api/threads/${bot.activeTaskId}/messages`)).messages
      .filter((m: { kind?: string; engineCompaction?: unknown }) => m.kind === "compaction" && m.engineCompaction), { timeout: 15000 }).toHaveLength(1);
    await capture("pwa-after-compact");
    await request("Emulation.setSafeAreaInsetsOverride", { insets: { top: 44 } });
    await expect.poll(() => evaluate("getComputedStyle(document.getElementById('root')).paddingTop")).toBe("44px");
    writeFileSync(`${logPath}.web-app.json`, JSON.stringify({ installability, platform: process.platform }, null, 2));
    console.log(`Web app evidence: ${logPath}.web-app.json`);
  } finally {
    cdp?.close();
    if (chrome) await waitForExit(chrome, { signal: "SIGTERM" });
    await fixture?.close();
  }
}, 660_000);
