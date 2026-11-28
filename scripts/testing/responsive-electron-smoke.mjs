import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

async function checkWindow() {
  const { app, BrowserWindow } = await import('electron');
  const [url, botId, output] = process.argv.slice(-3);
  assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/);
  try {
    await app.whenReady();
    const win = new BrowserWindow({show:false, width:1366,height:768,webPreferences:{offscreen:true,backgroundThrottling:false}});
    const contents = win.webContents;
    contents.on('render-process-gone',(_event,details)=>console.error('Fixture renderer stopped',details));
    await win.loadURL(`${url}/manifest.webmanifest`);
    await contents.executeJavaScript(`for(const k of ['grok-move-2026-11','teams-2026-11b','modelgo-offer-2026-11','whats-new-2026-11b','whats-new-2026-11c','omb-simple-mode-prompt','boat-credit-2026-11','github-star-dismissed','omb-analytics-opt-out'])localStorage.setItem(k,'1');localStorage.setItem('omb-email-gate','skipped')`);
    await win.loadURL(url);
    const cdp = contents.debugger;
    cdp.attach('1.3');
    await cdp.sendCommand('Emulation.setDeviceMetricsOverride',{width:1366,height:768,mobile:false,deviceScaleFactor:1});
    async function waitFor(expression) {
      const deadline=Date.now()+15000;
      do { const result=await contents.executeJavaScript(`(${expression})`); if(result)return result; await delay(50); } while(Date.now()<deadline);
      const observed=await contents.executeJavaScript(`({width:innerWidth,height:innerHeight,text:document.body.innerText.slice(0,1200),dialogs:Array.from(document.querySelectorAll('dialog[open]'),e=>e.innerText.slice(0,160))})`);
      throw new Error(`Missing ${expression}: ${JSON.stringify(observed)}`);
    }
    const q = selector => `document.querySelector(${JSON.stringify(selector)})`;
    async function click(selector) {
      const {x,y} = await waitFor(`(()=>{const e=${q(selector)};if(!e)return;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`);
      for (const type of ['mousePressed','mouseReleased']) await cdp.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});
    }
    const editor='textarea[aria-label="Message Pepper"]';
    await click(`[data-sidebar-bot-row="${botId}"]`);
    await click(editor);
    await cdp.sendCommand('Input.insertText',{text:'Keep my Electron draft'});
    await click('[aria-label="Pane layout"]');
    await click('[data-menu-key="columns"]');
    await waitFor('document.querySelectorAll("[data-pane-id]").length===2');
    await click('[data-empty-pane] .workspace-pane-close, [data-pane-id]:has([data-empty-pane]) .workspace-pane-close');
    await waitFor(`!document.querySelector('[data-empty-pane]') && ${q(editor)}.value==='Keep my Electron draft'`);
    await click(editor);
    await cdp.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});
    await cdp.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});
    await cdp.sendCommand('Input.insertText',{text:' after close'});
    await waitFor(`${q(editor)}.value==='Keep my Electron draft after close'`);
    await contents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    const {data}=await cdp.sendCommand('Page.captureScreenshot',{format:'png',fromSurface:true});
    writeFileSync(output,Buffer.from(data,'base64'));
    console.log(`Electron ${process.versions.electron}, Chromium ${process.versions.chrome}: two columns opened, empty tile closed, Pepper draft retained; ${output}`);
    win.destroy();
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
}

async function launchFixture() {
  const [binary, build, output] = process.argv.slice(2);
  assert(binary && build && output,'usage: node responsive-electron-smoke.mjs ELECTRON_BINARY DIST SCREENSHOT');
  const {launchVerificationServer, runControlOmb} = await import('../control-omb.ts');
  const fx=await launchVerificationServer({},undefined,undefined,undefined,undefined,undefined,[],undefined,resolve(build));
  try {
    const {url,dataDir}=fx.info;
    const {bot}=await runControlOmb(['new-bot','--name','Pepper','--url',url]);
    const child=spawn(binary,['--ozone-platform=headless','--disable-gpu',`--user-data-dir=${join(dataDir,'electron')}`,fileURLToPath(import.meta.url),url,bot.id,resolve(output)],{env:{PATH:process.env.PATH,HOME:dataDir},stdio:'inherit',timeout:60000});
    const [status,signal]=await once(child,'exit');
    assert.equal(status,0,`Electron smoke exited ${status ?? signal}`);
  } finally { await fx.close(); }
}

// Electron emits ready only after its main module has finished loading.
if (process.versions.electron) void checkWindow();
else await launchFixture();
