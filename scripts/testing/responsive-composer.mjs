import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// An untimed capture on a separate CDP connection; screencast encoding must not affect stream-input latency.
export async function recordReading(profile, destination) {
  const [port] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await once(ws, 'open');
  const dir = mkdtempSync(join(tmpdir(), 'omb-composer-film-'));
  const frames = [];
  let next = 0;
  ws.addEventListener('message', ({data}) => {
    const {method, params} = JSON.parse(data);
    if (method !== 'Page.screencastFrame') return;
    const file = `${frames.length}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(params.data, 'base64'));
    frames.push({ file, time: params.metadata.timestamp });
    ws.send(JSON.stringify({id: ++next, method: 'Page.screencastFrameAck', params: {sessionId: params.sessionId}}));
  });
  ws.send(JSON.stringify({ id: ++next, method: 'Page.startScreencast', params: { format:'jpeg', quality:70, maxWidth:820, maxHeight:820 } }));
  return async () => {
    ws.close();
    await once(ws, 'close');
    try {
      assert(frames.length > 1, 'empty reading recording');
      writeFileSync(join(dir,'frames.txt'),frames.map(({file,time},i)=>`file '${file}'\nduration ${Math.max(0.04,(frames[i+1]?.time ?? time+0.3)-time)}`).join('\n'));
      const video = spawnSync('ffmpeg',['-loglevel','error','-f','concat','-i','frames.txt','-vf','scale=820:820:force_original_aspect_ratio=decrease,pad=820:820:(ow-iw)/2:(oh-ih)/2,setsar=1','-pix_fmt','yuv420p','-c:v','libvpx-vp9','-threads','2','-deadline','realtime','-cpu-used','8',destination],{cwd:dir, encoding:'utf8'});
      assert.equal(video.status,0,video.error?.message ?? video.stderr);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  };
}

export async function readAndClosePane({ touch, width, room, side, q, editor, click, key, input, ev, expect, shot, row, attach }) {
  const draft = await ev(`${editor}.value`);
  assert(draft.length > 0);
  await attach();
  const opener = q('[aria-label="Preview: notes.md"]');
  await click(opener);
  await expect(`${q('[data-markdown-file]')}?.innerText.includes('Orange notebook receipt')`);
  row.preview = await shot('reading-file');
  if (touch) await click(q('dialog[open]:has([data-markdown-file]) header button'));
  else await key('Escape','Escape',27);
  await expect(`!${q('[data-markdown-file]')} && document.activeElement===${opener} && ${editor}.value===${JSON.stringify(draft)}`);
  if (width >= 768) {
    await click(q('[aria-label="Pane layout"]'));
    await click(q('[data-menu-key="columns"]'));
    await click(q('[data-empty-pane] button'));
    const task = q(`[data-sidebar-thread-row="${side}"]`);
    if (!await ev(task)) await click(q(`[aria-label="Expand ${room.name} threads"]`));
    await click(task);
    const tile = `[data-workspace-thread="${side}"]`;
    const sideInput = q(`${tile} textarea`);
    await expect(`!!${sideInput} && ${q(tile)}.innerText.includes('Room reference line')`);
    if (touch) assert(!await ev(`document.activeElement.matches('textarea')`),'reading selected the side editor');
    else await expect(`document.activeElement===${sideInput}`,'laptop side composer did not take focus');
    await click(sideInput); await input('Side draft');
    await expect(`${sideInput}.value==='Side draft' && document.activeElement===${sideInput}`);
    if (touch) {
      await click(`[...document.querySelectorAll('[data-pane-id="primary"] [data-citation-source]')].find(line=>line.textContent.startsWith("Hi, I'm Pepper"))`);
      await expect(`!document.activeElement.matches('textarea') && ${q('[data-pane-focused]')}.dataset.paneId==='primary'`);
      await click(sideInput); await expect(`document.activeElement===${sideInput} && ${sideInput}.value==='Side draft'`);
    }
    await click(q(`${tile} .workspace-pane-close`));
    await expect(`!${sideInput} && ${editor}.value===${JSON.stringify(draft)}`);
    if (touch) await expect(`!document.activeElement.matches('textarea')`,'closing the tile summoned the editor');
    else await expect(`document.activeElement===${editor}`,'closing the tile lost keyboard focus');
  }
  await click(editor); await key('End','End',35,2); await input('!');
  await expect(`${editor}.value===${JSON.stringify(draft+'!')}`);
  await expect(`${q('button[aria-label="Remove file"]')} && !${q('[data-markdown-file]')}`,'staged attachment lost on return');
  row.returned=await shot('resumed-draft-attachment');
  return width < 768 ? 'Read and closed attached file by tap; resumed draft' : 'File returned to opener; tile read, edited and closed; primary draft and device-specific focus retained';
}
