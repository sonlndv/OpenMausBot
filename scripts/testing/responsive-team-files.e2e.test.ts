import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { hostTimeout } from "../../server/testing/host-timeout";
import { NOTICES } from "../../src/lib/notices";
import { launchCloudSendFixture } from "./cloud-send-fixture";
import { openHeadlessChrome, type HeadlessPage } from "./headless-chrome";
import { mountPreview, type MountedPreview } from "./preview-fixture";

it.runIf(process.env.OMB_UI_E2E === "1")("a phone member manages their own team files through Tools but cannot manage a teammate's file", async () => {
  const fx = await launchCloudSendFixture({ onePasswordToken: `ops_fake-files-${randomUUID()}`, team: { id: "team-touch", name: "Touch team" } });
  let preview: MountedPreview | undefined;
  let page: HeadlessPage | undefined;
  try {
    const team = fx.team!;
    const pair = async (email: string, role: "owner" | "member") => {
      const { status, body, token } = await team.pair({ email, role });
      expect(status, `${role} pairing: ${body?.error ?? status}`).toBe(200);
      if (!token) throw new Error(`${role} pairing returned no bearer`);
      const session = await team.as(token, "GET", "/api/auth/session");
      expect(session.status).toBe(200);
      expect(session.body).toMatchObject({ kind: "session", email, scopes: role === "owner" ? ["admin", "client"] : ["client"], team: { id: team.id, role } });
      return token;
    };
    const owner = await pair("olive@touch.test", "owner");
    const member = await pair("ben@touch.test", "member");
    expect((await team.as(member, "PUT", "/api/me/welcome", { welcomed: true })).status).toBe(200);
    const bot = (await team.as(member, "GET", "/api/bots")).body.bots.find((b: { defaultBot?: { person?: string } }) => b.defaultBot?.person === "ben@touch.test");
    expect((await team.as(member, "PATCH", `/api/bots/${bot.id}`, { welcomed: true, sidebarHidden: false, pinned: true })).status).toBe(200);
    const text = "Friday at noon";
    const peers: string[] = [];
    for (const name of ["First", "Second"]) {
      const made = await team.as(owner, "POST", "/api/bots", { name, visibility: "everyone" });
      expect(made.status).toBe(201);
      peers.push(made.body.bot.id);
    }
    const made = await team.as(owner, "POST", "/api/groups", { name: "Notes room", memberIds: peers, setup: { bulletin: "", defaultResponder: { kind: "mentions" } } });
    expect(made.status).toBe(201);
    const room = made.body.group;
    const started = await team.as(member, "POST", `/api/groups/${room.id}/tasks`, { title: "Member notes" });
    expect(started.status).toBe(201);
    const threadId = started.body.task.threadId;
    expect((await team.as(member, "POST", `/api/groups/${room.id}/messages`, { threadId, text: "Shared meeting note" })).status).toBe(202);
    const forkPath = `/api/groups/${room.id}/tasks/${threadId}/forks`;
    const fork = await team.as(member, "POST", forkPath, { latest: true });
    expect(fork.status, JSON.stringify(fork.body)).toBe(201);
    expect(fork.body.task.origin.threadId).toBe(threadId);
    const other = await pair("mira@touch.test", "member");
    const privateTask = await team.as(member, "POST", `/api/bots/${peers[0]}/tasks`, { title: "Private receipt" });
    expect(privateTask.status).toBe(201);
    const privateId = privateTask.body.task.threadId;
    expect((await team.as(member, "POST", `/api/bots/${peers[0]}/messages`, { threadId: privateId, text: "Member receipt" })).status).toBe(202);
    const receipt = (await team.as(member, "GET", `/api/threads/${privateId}/messages`)).body.messages.find((m: { text?: string }) => m.text === "Member receipt");
    expect(receipt).toBeDefined();
    const denied = await team.as(other, "POST", `/api/bots/${peers[0]}/tasks/${privateId}/forks`, { messageId: receipt.id });
    expect([403, 404]).toContain(denied.status);
    for (const id of peers) expect((await team.as(owner, "PUT", `/api/bots/${id}/access`, { everyone: "view", people: {} })).status).toBe(200);
    expect((await team.as(member, "POST", forkPath, { latest: true })).status).toBe(403);
    expect((await team.as(member, "PUT", "/api/groups/order", { groupIds: [room.id] })).status).toBe(403);
    expect((await team.as(owner, "PUT", "/api/team-files/file?path=&name=notes.md", new TextEncoder().encode(text), { "content-type": "application/octet-stream" })).status).toBe(201);
    preview = await mountPreview({ info: { url: team.base } }, { entry: "/scripts/testing/threads-preview.tsx", route: "/__files.html", title: "Team files", logLevel: "warn", proxyHeaders: { ...fx.edge, authorization: `Bearer ${member}` } });
    const p = page = await openHeadlessChrome(join(fx.root, "chrome"));
    await p.send("Page.enable");
    await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await p.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `for(const key of ${JSON.stringify(NOTICES)})localStorage.setItem(key,'1')` });
    await p.send("Page.navigate", { url: preview.previewUrl + "?mode=advanced&liveTransport=sse" });
    const tap = async (expression: string) => {
      await p.until(`Boolean(${expression})`, 30000);
      const point = `(() => {const e=(${expression});if(!e)return;const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`;
      await p.until(`Boolean(${point})`, 10000);
      await p.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [await p.evaluate(point)] });
      await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const q = (sel: string) => `document.querySelector(${JSON.stringify(sel)})`;
    const named = (s: string) => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(s)})`;
    await p.until(`Boolean(${q('[aria-label="Open bot list"]')})`, 60000);
    if (await p.evaluate(`Boolean(${named("Not now")})`)) await tap(named("Not now"));
    await tap(q('[aria-label="Open bot list"]')); await tap(q('[data-team-side-option="team"]'));
    await tap(q(`[data-room-actions="${room.id}"]`));
    await p.until(`Boolean(${q('[data-room-menu] [role=menuitem]')})`);
    expect(await p.evaluate(`Array.from(document.querySelectorAll('[data-room-menu] [role=menuitem]'),b=>b.innerText)`)).toEqual(["Copy conversation ID"]);
    await p.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await p.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await p.until(`!${q('[data-room-menu]:not([inert])')} && ${q('[aria-label="Open bot list"]')}.ariaExpanded==='true'`);
    await tap(q('[aria-label="Tools"]')); await tap(q('[data-menu-key="team-files"]'));
    const file = '[data-team-file="notes.md"]';
    await tap(q(`${file} button`));
    await p.until(`${q('[data-team-file-preview]')}?.textContent==='Friday at noon'`);
    expect(await p.evaluate(`${q(file)}.querySelectorAll('button').length`)).toBe(1);
    expect((await team.as(member, "POST", "/api/team-files/delete", { path: "notes.md" })).status).toBe(403);
    await tap(named("New folder"));
    await tap(q('[data-team-files] form input')); await p.send("Input.insertText", { text: "Work" });
    await tap(q('[data-team-files] button[type=submit]'));
    await p.until(`Boolean(${q('[data-team-file="Work"]')})`);
    expect((await team.as(member, "GET", "/api/team-files")).body.entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Work", mine: true, canDelete: true }), expect.objectContaining({ name: "notes.md", canDelete: false })]));
    await tap(q('[data-team-file="Work"] button'));
    await p.until(`${q('[data-team-files] nav [aria-current="page"]')}?.textContent==='Work' && ${q('[data-team-files]')}?.dataset.teamFiles==='0'`);
    const source = join(fx.root, "packing.txt"), downloads = join(fx.root, "downloads");
    const contents = "Three orange labels\n";
    writeFileSync(source, contents);
    mkdirSync(downloads);
    await p.send("Page.setInterceptFileChooserDialog", { enabled: true });
    await tap(named("Upload"));
    const { root } = await p.send("DOM.getDocument");
    const { nodeId } = await p.send("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-testid="team-files-picker"]' });
    await p.send("DOM.setFileInputFiles", { nodeId, files: [source] });
    const uploaded = '[data-team-file="Work/packing.txt"]';
    await tap(q(`${uploaded} button[aria-label="Rename"]`));
    await tap(q('[data-team-files] form input'));
    for (const type of ["keyDown", "keyUp"]) await p.send("Input.dispatchKeyEvent", { type, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
    await p.send("Input.insertText", { text: "labels.txt" });
    await tap(q('[data-team-files] button[type=submit]'));
    const renamed = '[data-team-file="Work/labels.txt"]';
    await p.until(`!${q(uploaded)} && !!${q(renamed)}`);
    await p.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
    await tap(q(`${renamed} a[download]`));
    await expect.poll(() => {
      try { return readFileSync(join(downloads, "labels.txt"), "utf8"); } catch { return null; }
    }, { timeout: 10000 }).toBe(contents);
    await Promise.all([
      tap(q(`${renamed} button[aria-label="Delete"]`)),
      expect.poll(async () => {
        try { await p.send("Page.handleJavaScriptDialog", { accept: true }); return true; } catch { return false; }
      }, { timeout: 10000 }).toBe(true),
    ]);
    await p.until(`${q('[data-team-files]')}?.dataset.teamFiles==='0'`);
    expect((await team.as(member, "GET", "/api/team-files?path=Work")).body.entries).toEqual([]);
    await tap(q('[data-team-files] nav button'));
    await p.until(`Boolean(${q(file)}) && Boolean(${q('[data-team-file="Work"]')})`);
  } finally {
    page?.close(); await page?.exited(3000); await preview?.close(); await fx.close();
  }
}, hostTimeout(180_000));
