import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { cpus, loadavg, release } from 'node:os';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { launchVerificationServer, runControlOmb } from '../control-omb.ts';
import { openHeadlessChrome } from './headless-chrome.ts';
import { fixtureApi } from './preview-fixture.ts';

const [commit, out] = process.argv.slice(2);
assert.match(commit, /^[a-f0-9]{40}$/);
assert.equal(readFileSync('.responsive-build-revision', 'utf8').trim(), commit, 'Use the archive launcher');
const trials = process.argv[6] === 'calibrate' ? 2 : 20;
const composer = process.argv[6] === 'composer' ? await import('./responsive-composer.mjs') : null;
const actions = process.argv[6] === 'actions' ? await import('./responsive-actions.mjs') : null;
const qualification = process.argv[6] === 'qualification' ? await import('./responsive-qualification.mjs') : null;
const fileAndInbox = process.argv[6] === 'file-inbox';
const build = resolve('dist');
const shell = readFileSync(join(build, 'index.html'), 'utf8');
const fileText = 'Orange notebook receipt';
const reply = 'Fixture report\n\n```text\n' + '0123456789'.repeat(60) + '\n```\n\nEnd of report.';
const prompt = '#responsive\nPlease review the notes.';
const script = join(out, 'stream.json');
const attachment = join(out, 'notes.md');
writeFileSync(attachment, `# ${fileText}\n`);
writeFileSync(script, JSON.stringify({ '#responsive': [{ say: reply }], '#decision': [{ say: 'Waiting for a decision. '.repeat(150) }] }));
const captures = [];
const run = { commit, capturedAt: new Date().toISOString(), node: process.version, os: `${process.platform} ${release()} ${process.arch}`, cpu: cpus()[0].model, logicalCpus: cpus().length, loadAtStart: loadavg(), productionHtmlSha256: createHash('sha256').update(shell).digest('hex'), skin: 'daylight', captures };
if (existsSync(join(out, 'renderer.patch'))) run.rendererPatchSha256 = createHash('sha256').update(readFileSync(join(out,'renderer.patch'))).digest('hex');
const save = () => writeFileSync(join(out, 'results.json'), JSON.stringify(run, null, 2));
const sizes = { phone: [390, 844], ipad: [820, 1180], laptop: [1366, 768] };
const q = selector => `document.querySelector(${JSON.stringify(selector)})`;
const named = (text, scope = 'button') => `[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.innerText.trim()===${JSON.stringify(text)} && e.getBoundingClientRect().width)`;
const editor = q('textarea[aria-label="Message Pepper"]');
const drawer = q('button[aria-label="Open bot list"]');
const sidebar = q('[data-sidebar]');
const box = e => `(${e})?.getBoundingClientRect()`;
const panel = q('[data-computer-panel]');
const profileSettings = q('[data-settings-page-open]');
const live = q('[data-mid^="live:"]');
const idle = e => `(()=>{for(let n=(${e});n;n=n.parentElement)if(n.getAnimations().some(a=>a.playState==='running'))return false;return true})()`;
const nextFrame = 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))';

async function until(get, why, timeout = 3500) {
  const end = Date.now() + timeout;
  do { const value = await get(); if (value) return value; await delay(30); } while (Date.now() < end);
  throw new Error(why);
}

function addPresentationTimes(events, id) {
  const starts = new Map(), ready = new Map(), presented = new Map(), frames = [];
  for(const e of events) {
    if(e.name.startsWith(id+'/')) {
      if(e.ph==='b')starts.set(e.name,e);
      if(e.name.endsWith(' result'))ready.set(e.name.slice(0,-7),e);
    }
    if(e.name==='AnimationFrame' && e.ph==='b' && e.args?.id)frames.push(e);
    if(e.name==='AnimationFrame::Presentation')presented.set(e.pid+':'+e.args.id,e.ts);
  }
  frames.sort((a,b)=>a.ts-b.ts);
  for(const row of captures.filter(r=>`${r.mode}-${r.device}`===id && r.samplesMs.length)) {
    row.framePresentationMs=row.samplesMs.map((_,index)=>{
      const name=`${id}/${row.action}/${index+1}`, result=ready.get(name), start=starts.get(name);
      if(!start || !result)return null;
      const frame=frames.findLast(f=>f.pid===result.pid && f.tid===result.tid && f.ts<=result.ts);
      const ts=frame && presented.get(frame.pid+':'+frame.args.id);
      return ts>=result.ts ? (ts-start.ts)/1000 : null;
    });
    const sorted=row.framePresentationMs.filter(v=>v!==null).sort((a,b)=>a-b);
    row.presentationP95Ms=sorted.length===20 ? sorted[18] : null;
  }
  save();
}

// Tracing events are delivered only to the CDP connection that started the trace.
async function trace(profile, file, id) {
  const [port, endpoint] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await once(ws, 'open');
  const traceEvents = [];
  let done, started;
  const complete = new Promise(resolve => { done = resolve; });
  const ready = new Promise((resolve, reject) => { started = msg => msg.error ? reject(Error(msg.error.message)) : resolve(); });
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id === 1) started(msg);
    if (msg.method === 'Tracing.dataCollected') traceEvents.push(...msg.params.value);
    if (msg.method === 'Tracing.tracingComplete') done();
  });
  ws.send(JSON.stringify({ id: 1, method: 'Tracing.start', params: { categories: 'blink.user_timing,devtools.timeline,benchmark', transferMode: 'ReportEvents' } }));
  await ready;
  return async () => {
    try {
      ws.send(JSON.stringify({ id: 2, method: 'Tracing.end' }));
      await Promise.race([complete, delay(15000, null, {ref:false}).then(()=>{ throw Error('Trace did not flush'); })]);
      assert(traceEvents.some(e => e.cat?.includes('devtools.timeline')), 'No timeline in Chrome trace');
      writeFileSync(file, gzipSync(JSON.stringify({ traceEvents })));
      addPresentationTimes(traceEvents,id);
    } finally { ws.close(); }
  };
}

async function cell(mode, device) {
  const [width, height] = sizes[device], touch = device !== 'laptop';
  const id = `${mode}-${device}`, path = name => `${id}/${name}`;
  mkdirSync(join(out,id));
  const fixture = await launchVerificationServer({ FAKE_STREAM_SCRIPT: script, FAKE_STREAM_CADENCE: '4:35' }, undefined, undefined, undefined, undefined, undefined, [], undefined, build);
  const {url, dataDir, logPath} = fixture.info;
  const profile = join(dataDir, 'chrome');
  let p, endTrace;
  try {
    const api = fixtureApi(url, {headers:{origin:url}});
    const cli = (...args) => runControlOmb([...args, '--url', url]);
    const {bot} = await cli('new-bot','--name','Pepper');
    const starter = (await api('GET','/api/bots')).bots.find(b=>b.id!==bot.id);
    await api('PATCH',`/api/bots/${starter.id}`,{welcomed:true,color:'blue',mascotBody:'cursor'});
    await api('PATCH',`/api/bots/${bot.id}`,{color:'purple',mascotBody:'cursor'});
    const room = (await api('POST','/api/groups',{name:'Launch room',memberIds:[bot.id,starter.id],setup:{bulletin:'',defaultResponder:{kind:'member',botId:bot.id}}})).group;
    const side = (await api('POST',`/api/groups/${room.id}/tasks`,{title:'Side notes',activate:false})).task.threadId;
    await api('POST',`/api/groups/${room.id}/messages`,{threadId:side,text:'Room reference line'});
    await until(async()=>!(await api('GET','/api/bots')).bots.some(b=>b.busy),'room seed did not settle',15000);
    if (qualification && mode==='advanced') {
      mkdirSync(join(profile,'Default'),{recursive:true});
      writeFileSync(join(profile,'Default','Preferences'),JSON.stringify({webkit:{webprefs:{minimum_font_size:24}}}));
    }
    p = await openHeadlessChrome(profile);
    const {send} = p;
    const ev = expression => p.evaluate(`Promise.resolve(${expression}).then(v=>v instanceof Node || v instanceof FontFaceSet ? true : v)`);
    const expect = (condition, why, timeout) => until(()=>ev(`Boolean(${condition})`),why ?? condition,timeout);
    const key = async (key,code,vk,modifiers=0) => { for (const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,modifiers,...(key==='Enter' && type==='keyDown'?{text:'\r'}:{})}); };
    const esc = () => key('Escape','Escape',27);
    const input = text => send('Input.insertText',{text});
    const view = (w,h=height) => send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:touch});
    const click = async (expr, fraction=0.5) => {
      await expect(`(${expr}) && !(${expr}).disabled`,'missing control: '+expr);
      await ev(`(${expr}).scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`);
      const {x,y} = await until(()=>ev(`(async()=>{const e=(${expr});if(!e)return;const r=e.getBoundingClientRect(),x=r.x+r.width*${fraction},y=r.y+r.height/2;
        await new Promise(requestAnimationFrame);const r2=e.getBoundingClientRect();
        if(Math.abs(r2.x-r.x)+Math.abs(r2.y-r.y)>0.1)return;
        return e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`),'control obscured: '+expr);
      if (touch) { await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]}); await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); }
      else { for(const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',clickCount:1}); }
    };
    const openList = async () => { if(await ev(`innerWidth<768 && ${drawer}.ariaExpanded!=='true'`)) await click(drawer); };
    const pepperRow = q(`[data-sidebar-bot-row="${bot.id}"]`);
    const selectPepper = async()=>{ await openList(); await click(pepperRow); await expect(editor); };
    const settleSidebar = () => expect(idle(sidebar));
    const shot = async name => { const file = path(name+'.png'); writeFileSync(join(out,file),await p.capture()); return file; };
    await send('Page.enable');
    const prefs = {'omb-advanced-mode':mode==='advanced'?'1':'0','omb-skin':'daylight','omb-analytics-opt-out':'1','omb-email-gate':'skipped'};
    if (actions) prefs['omb-web-panels'] = JSON.stringify([{id:'health',name:'Fixture health',url:url.replace('127.0.0.1','localhost')+'/api/health'}]);
    if (qualification) {
      if (mode==='simple') prefs['omb-skin']='midnight';
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    }
    for(const notice of ['grok-move-2026-11','teams-2026-11b','modelgo-offer-2026-11','whats-new-2026-11b','whats-new-2026-11c','omb-simple-mode-prompt','boat-credit-2026-11','github-star-dismissed'])prefs[notice]='1';
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(url)} && !sessionStorage.getItem('baseline-seeded')){for(const [k,v] of Object.entries(${JSON.stringify(prefs)}))localStorage.setItem(k,v);sessionStorage.setItem('baseline-seeded','1')}`});
    await view(width);
    if(touch) await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await send('Page.navigate',{url});
    await expect('document.querySelector("textarea")','App did not mount',20000);
    await selectPepper();
    await ev('document.fonts.ready');
    await expect(`innerWidth===${width} && document.documentElement.dataset.skin===${JSON.stringify(prefs['omb-skin'])} && localStorage.getItem('omb-advanced-mode')===${JSON.stringify(mode==='advanced'?'1':'0')}`);
    assert.equal(await (await fetch(url)).text(),shell,'fixture did not serve the archived build');
    run.browser=(await send('Browser.getVersion')).product;
    endTrace=await trace(profile,join(out,path('timeline.json.gz')),id);
    const rowBase={commit,mode,device,viewport:{width,height,touch},skin:'daylight',trace:path('timeline.json.gz')};
    const record=async(action,n,fn)=>{
      const start=performance.now(); const row={...rowBase,action,availability:'available',completed:false,outcome:null,planned:n,samplesMs:[],p50Ms:null,p95Ms:null};
      try {
        row.before=await shot(action+'-before');
        row.outcome=await fn(row);
        assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false,'page-wide overflow at rest');
        if(n===20) {assert.equal(row.samplesMs.length,n);const sorted=row.samplesMs.toSorted((a,b)=>a-b);row.p50Ms=sorted[9];row.p95Ms=sorted[18];row.rangeMs=[sorted[0],sorted[19]];}
        row.completed=true;
      } catch(e) {row.outcome=e.message; if(e instanceof Gap)row.availability=e.message.startsWith('Host-only:')?'host-only':'not applicable';}
      row.after=await shot(action+'-after'); row.elapsedMs=Math.round(performance.now()-start);row.repetitions=row.samplesMs.length || (row.completed?1:0);
      captures.push(row); save(); console.log(id,action,row.completed?'completed':row.outcome);
      return row;
    };
    const measure=async(row,event,action,predicate,stable='true')=>{
      const name=`${id}/${row.action}/${row.samplesMs.length+1}`;
      await ev(`(()=>{window.__baselineDuration=null;window.addEventListener(${JSON.stringify(event)},e=>{if(!e.isTrusted)return;const start=e.timeStamp;performance.mark(${JSON.stringify(name+' start')},{startTime:start});const frame=()=>{if(performance.now()-start>3000)return;if(!(${predicate})||!(${stable}))return requestAnimationFrame(frame);performance.mark(${JSON.stringify(name+' result')});requestAnimationFrame(()=>{const m=performance.measure(${JSON.stringify(name)},{start,end:performance.now()});window.__baselineDuration=m.duration})};requestAnimationFrame(frame)},{once:true,capture:true})})()`);
      await action();
      row.samplesMs.push(await until(()=>ev('window.__baselineDuration'),'timed outcome not reached: '+predicate));
    };
    if (qualification) {
      await qualification.qualifyLayout({device,mode,editor,send,view,click,openList,key,input,q,ev,expect,record,shot});
      return;
    }
    if (actions) {
      await checkSettingsApprovalAndRoom();
      await actions.checkForkActions({ api, bot, room, side, selectPepper, click, ev, expect, input, key, q, named, editor, record, measure, idle, shot, trials, until });
      if (run.rendererPatchSha256) await actions.checkActionMenus({ api, cli, bot, room, starter, device, mode, selectPepper, openList, click, ev, expect, input, key, esc, q, named, record, shot, send, until });
      return;
    }
    await record('chat-reference',1,async()=>{await expect(`document.querySelector('[role=log]')?.innerText.includes("Hi, I'm Pepper")`);return 'Pepper greeting and composer visible';});
    if (composer && touch) await record('touch-reading-focus',1,async()=>{
      assert(await ev(`matchMedia('(pointer: coarse)').matches`));
      await ev(nextFrame);
      assert(!await ev(`document.activeElement.matches('textarea')`),'navigation focused a text field');
      return 'Opened Pepper by touch without focusing a text field';
    });
    if(device==='laptop')await record('laptop-tab-return',1,async row=>{
      await click(editor);await key('Tab','Tab',9);
      row.forwardFocus=await ev(`({tag:document.activeElement.tagName,label:document.activeElement.ariaLabel??document.activeElement.title})`);
      assert(!await ev(`document.activeElement===${editor} || document.activeElement===document.body`),'Tab did not focus a control');
      await key('Tab','Tab',9,8);await expect(`document.activeElement===${editor}`,'Shift+Tab did not return to the composer');
      return 'Tab reached the next control; Shift+Tab returned to Pepper’s composer';
    });
    if (!composer && !fileAndInbox) await record('sidebar-open',trials,async row=>{
      for(let i=-1;i<trials;i++){
        const phone=width<768;
        const toggle=()=>key('\\','Backslash',220,2);
        if(!phone) {await toggle();await expect(`${box(sidebar)}.width<100 && ${idle(sidebar)}`);}
        const open=phone?()=>click(drawer):toggle;
        const displayed=phone?`${box(sidebar)}.right>=innerWidth-1`:`${box(sidebar)}.width>=279`;
        if(i<0){await open();await expect(displayed);}else await measure(row,phone?'pointerdown':'keydown',open,displayed,idle(sidebar));
        assert(await ev(`${pepperRow}.innerText.includes('Pepper')`),'list omits bot name');
        if(i===trials-1)row.open=await shot('sidebar-open');
        if(phone){await click(pepperRow);await expect(`${box(sidebar)}.right<=0.5`);}
      }return 'Named bot list painted after transition';
    });
    if (!composer) { await view(width); await selectPepper(); await click(editor); await input('Resize draft'); }
    if (!composer && !fileAndInbox) await record('resize-to-chat',trials,async row=>{
      const other=width<768?820:700;
      for(let i=-1;i<trials;i++){
        await view(other);await expect(`innerWidth===${other} && ${other<768?`${box(sidebar)}.right<=0.5`:`${box(sidebar)}.right>0`}`);await settleSidebar();
        const result=`innerWidth===${width} && ${editor}?.value==='Resize draft' && ${width<768?`${box(sidebar)}.right<=0.5`:`${box(sidebar)}.right>0`}`;
        if(i<0){await view(width);await expect(result);}else await measure(row,'resize',()=>view(width),result,idle(sidebar));
      }return 'Returned across 768px to the same Pepper draft';
    });
    if (process.argv[6] === 'navigation') return;
    if (!composer) { await view(width); await click(editor); await key('a','KeyA',65,2);await key('Backspace','Backspace',8); }
    const directScreen=q(`button[aria-label="Bot's screen"]`);
    if (!composer && !fileAndInbox) await record('computer-panel-open',trials,async row=>{
      for(let i=-1;i<trials;i++){
        let control=directScreen;
        if(!await ev(`${box(directScreen)}?.width>0`)){await click(q('button[aria-label="More"]'));control=q('[data-menu-key="computer"]');}
        const openComputer=()=>click(control);
        const result=`${box(panel)}?.width>0 && ${q('[data-computer-panel-close]')}`;
        if(i<0){await openComputer();await expect(result);}else await measure(row,'pointerdown',openComputer,result,idle(panel));
        if(i===trials-1)row.open=await shot('computer-panel');
        await click(q('[data-computer-panel-close]'));await expect(`!${panel}`);
      } return 'Computer panel opened and closed; no computer session launched';
    });
    if(await ev(panel)) {await esc();if(await ev(panel))await click(q('[data-computer-panel-close]'));}
    const attach=async()=>{
      await click(q('button[aria-label="Add"],button[aria-label="Attach files"]'));
      await send('Page.setInterceptFileChooserDialog',{enabled:true});
      await click(q('[data-menu-key="attach"]'));
      const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'[data-tour="composer"] input[type=file]'});
      await send('DOM.setFileInputFiles',{nodeId,files:[attachment]});
      await expect(q('button[aria-label="Remove file"]'));
    };
    await record('attachment-multiline-send',1,async row=>{
      if (composer) {
        await click(editor); await expect(`document.activeElement===${editor}`); await input('#responsive');
        if(touch) { await view(width,Math.round(height*.57)); await expect(`innerHeight===${Math.round(height*.57)}`); }
      }
      await attach();
      if(composer && touch) { await ev(nextFrame); assert(!await ev(`document.activeElement===${editor}`),'file intake opened the keyboard'); }
      await click(editor);
      if (composer) {
        await key('End','End',35,2);
        await key('Enter',device==='phone' ? '' : 'Enter',13,device==='phone' ? 0 : 8);
        await input('Please review the notes.');
      } else await input(prompt);
      await expect(`${editor}.value===${JSON.stringify(prompt)}`);
      for(const control of [editor,q('button[aria-label="Send"],button[aria-label="Send message"]')])await expect(`(()=>{const r=${box(control)};return r?.width>0 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})()`,'clipped composer control');
      if (composer) {
        row.staged=await shot('multiline-attachment');
        if (touch) {
          await esc(); await view(width); await ev(nextFrame);
          await expect(`document.activeElement!==${editor} && ${editor}.value===${JSON.stringify(prompt)}`);
          await click(editor);
          await view(width,Math.round(height*.57));
        }
      }
      if(touch && !(composer && device==='ipad' && mode==='advanced'))await click(q('button[aria-label="Send"],button[aria-label="Send message"]'));else await key('Enter','Enter',13);
      if (composer && touch) await view(width);
      await expect(live,'no streamed row after send',15000);return 'One attachment staged, multiline message sent, first streamed row visible';
    });
    await record('stream-input-next-paint',trials,async row=>{
      await expect(live,'no active fake stream'); await click(editor);await input('w');await expect(`${editor}.value==='w'`);
      for(let i=0;i<trials;i++){
        const text='w'+'x'.repeat(i+1);assert(await ev(`!!${live}`),'stream ended before input');
        await measure(row,'beforeinput',()=>input('x'),`${editor}.value===${JSON.stringify(text)} && !!${live}`);
      }
      if (composer && device==='phone') {
        const followUp=q('[data-composer-follow-up] > button');
        row.followUp=await ev(`(()=>{const r=${box(followUp)},field=${box(editor)};return {label:${followUp}?.ariaLabel, fieldWidth:field.width, hit:r && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===${followUp}}})()`);
        assert(row.followUp.hit && row.followUp.label,'unreachable follow-up while streaming');
      }
      return `${trials} consecutive characters painted in the draft during the same scripted reply`;
    });
    if (process.argv[6] === 'stream') return;
    const finishRecording = composer && touch ? await composer.recordReading(profile,join(out,path('reading.webm'))) : null;
    try {
    await record('read-code-rotate',1,async row=>{
      const block=q('[data-look="code-block"]');await expect(`${block}?.innerText.includes('0123456789') && !${live}`,'final code block not visible',18000);
      const msgs=(await api('GET',`/api/threads/${bot.activeTaskId}/messages?limit=50`)).messages;
      const sent=msgs.filter(m=>m.role==='user' && m.text?.includes('#responsive'));assert.equal(sent.length,1,'stored send count');assert(sent[0].text.includes(prompt) && sent[0].text.includes('notes.md'),'missing attachment or second line');
      const draft=await ev(`${editor}.value`);await ev(`${block}.scrollIntoView({block:'center'})`);
      if (composer) {
        const code=q('[data-look="code-block"] .overflow-x-auto');
        await click(code);
        const rect=await ev(`(${code}).getBoundingClientRect().toJSON()`);
        await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.x+rect.width/2,y:rect.y+rect.height/2,deltaX:100,deltaY:0});
        await expect(`${code}.scrollLeft>0`,'code did not scroll locally');
        row.codeOffset=await ev(`${code}.scrollLeft`);
      }
      await view(height,width);await expect(`innerWidth===${height} && ${box(block)}.bottom>0 && ${box(block)}.top<innerHeight && ${editor}.value===${JSON.stringify(draft)}`);
      if(composer) await expect(`${q('[data-look="code-block"] .overflow-x-auto')}.scrollLeft===${row.codeOffset}`,'rotation lost code reading position');
      assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false,'rotated page overflow');row.rotated=await shot('reading-code-rotated');await view(width);
      return 'One stored user turn with attachment, final code and draft preserved across rotation';
    });
    await view(width);
    if (composer) {
      await record('read-and-close-pane',1,row=>composer.readAndClosePane({touch,width,room,side,q,editor,click,key,input,ev,expect,shot,row,attach}));
      return;
    }
    } finally { await finishRecording?.(); }
    await record('file-preview-return',trials,async row=>{
      const draft=await ev(`${editor}.value`), preview=q('[data-markdown-file]');
      const content=`${preview}?.innerText.includes(${JSON.stringify(fileText)})`;
      const open=()=>click(q('[aria-label="Preview: notes.md"]'));
      for(let i=-1;i<trials;i++) {
        if(i<0){await open();await expect(content);}else await measure(row,'pointerdown',open,content,idle(preview));
        if(i===trials-1)row.open=await shot('file-preview');
        await esc();await expect(`!${preview} && ${editor}.value===${JSON.stringify(draft)}`);
      }
      await click(editor);await key('End','End',35,2);await input('!');await expect(`${editor}.value===${JSON.stringify(draft+'!')}`);
      return 'Read the attached Markdown receipt, closed it and continued typing the same draft';
    });
    if(await ev(q('[data-markdown-file]')))await esc();
    await record('inbox',trials,async row=>{
      const list=q('[data-inbox-list]'), open=()=>click(q('[data-sidebar-inbox]'));
      for(let i=-1;i<trials;i++){
        await openList();
        if(i<0){await open();await expect(list);}else await measure(row,'pointerdown',open,list,idle(list));
        if(i===trials-1)row.open=await shot('inbox');
        await click(q('[aria-label="Close inbox"]'));await expect(`!${q('[data-inbox-panel]')}`);
      }
      return 'Read the fixture inbox and closed it';
    });
    if (fileAndInbox) return;
    await record('automations-calendar',1,async row=>{
      await openList();
      if(mode==='simple'){await click(q('button[aria-label="You"]'));await click(q('[data-menu-key="automations"]'));}
      else if(width<768){await click(q('button[aria-label="Tools"]'));await click(q('[data-menu-key="automations"]'));}
      else await click(named('Automations'));
      await expect(q('[data-tour="automations-page"]'));await click(named('Calendar','button[aria-pressed]'));
      await expect(`${named('Calendar','button[aria-pressed]')}?.ariaPressed==='true'`);row.open=await shot('calendar');await click(q('button[aria-label="Back"],button[title="Back"]'));
      return 'Selected the Calendar view and returned; no schedule created';
    });
    await checkSettingsApprovalAndRoom();
    async function checkSettingsApprovalAndRoom() {
    const settingsNav=async()=>{
      await openList();await click(q('button[aria-label="You"]'));await click(q('[data-menu-key="settings"]'));
      if(!await ev(q('[data-settings-page="appearance"]')) && await ev(q('[data-settings-back]')))await click(q('[data-settings-back]'));
      await expect(q('[data-settings-page="appearance"]'),'Settings navigation did not open');
    };
    await record('settings-change',1,async row=>{
      await settingsNav();
      await click(q('[data-settings-page="appearance"]'));await click(named('Dark','button[role=radio]'));
      await expect(`document.documentElement.dataset.skin==='midnight' && localStorage.getItem('omb-skin')==='midnight'`);row.open=await shot('settings-dark');
      await click(named('Light','button[role=radio]'));await expect(`document.documentElement.dataset.skin==='daylight'`);
      await esc();return 'Appearance applied Dark, saved Midnight, and returned to Light';
    });
    if(await ev(profileSettings))await esc();
    await record('manage-installations',1,async row=>{
      await settingsNav();const config=await api('GET','/api/config');
      row.host={adminEntitlement:config.edition?.features?.includes('admin')===true,fleetAvailable:config.fleet?.available===true};
      const entry=q('[data-settings-page="installations"]');
      row.open=await shot('settings-workspace-entries');
      if(!row.host.adminEntitlement || !row.host.fleetAvailable) {
        assert(!await ev(entry),'unexpected fleet entry');await esc();throw new Gap('Host-only: Settings → Installations needs an entitled operator server with a fleet agent');
      }
      await click(entry);await expect(q('[data-settings-page-open="installations"]'));await esc();return 'Operator installation list opened';
    });
    await view(width);
    await record('approval-deny',1,async row=>{
      await selectPepper();
      await api('PATCH',`/api/bots/${bot.id}`,{approvalMode:'ask'});
      await cli('send','--bot',bot.id,'--text','#decision');await expect(live,'approval fixture turn did not start',15000);
      const socketPath=JSON.parse(readFileSync(fixture.fixtureDumpPath,'utf8')).mcpConfig.mcpServers.ogb.args.at(-1);
      const socket=connect(socketPath);const requestId=randomUUID();
      try {await once(socket,'connect');let answer='';socket.on('data',chunk=>answer+=chunk);
        socket.write(JSON.stringify({t:'ask',id:requestId,tool:'Bash',input:{command:'printf fixture'}})+'\n');
        await expect(q('[data-ask-card="approval"]'));row.open=await shot('approval');await click(named('Deny','[data-ask-card="approval"] button'));await until(()=>answer.includes('\n'),'no decision receipt');
        const receipt=JSON.parse(answer.split('\n')[0]);assert.equal(receipt.id,requestId);assert.equal(receipt.behavior,'deny');
        return 'Deny reached the waiting fixture request; nothing executed';
      }finally{socket.destroy();await cli('interrupt','--bot',bot.id);}
    });
    await record('room-thread',1,async()=>{
      await openList();await click(q(`[data-sidebar-group-row="${room.id}"]`));
      const feedRow=q(`[data-feed-thread="${side}"] > button:first-child`), taskRow=q(`[data-sidebar-thread-row="${side}"]`);
      if(width>=768)await click(feedRow);else {await openList(); if(!await ev(taskRow))await click(q('[aria-label="Expand Launch room threads"]'));await click(taskRow);}
      await expect(`document.querySelector('main')?.innerText.includes('Room reference line') || document.querySelector('[data-thread-panel]')?.innerText.includes('Room reference line')`);
      return 'Opened the seeded side thread and read its unique message';
    });
    }
    const tiled=await record('fork-side-pane-draft',1,async()=>{
      if(width<768)throw new Gap('Tiled panes require an inline workspace; phone is not a tiled host');
      await selectPepper();await expect(`${box(sidebar)}.width>=279 && ${idle(sidebar)}`,'sidebar did not settle after leaving room detail');
      await click(q('[aria-label="Pane layout"]'));await click(q('[data-menu-key="columns"]'));await click(q('[data-empty-pane] button'));
      const taskRow=q(`[data-sidebar-thread-row="${side}"]`);
      if(!await ev(taskRow))await click(q('[aria-label="Expand Launch room threads"]'));
      await click(taskRow);const sideEditor=q(`[data-workspace-thread="${side}"] textarea`);await click(sideEditor);await input('Keep side draft');
      await expect(`${sideEditor}.value==='Keep side draft' && document.querySelectorAll('[data-pane-id]').length===2`);return 'Fork pane layout: opened two columns, selected a side thread and typed a draft in it';
    });
    await record('side-pane-resize',1,async row=>{
      if(!tiled.completed){if(tiled.availability==='available')throw Error('Could not stage side draft: '+tiled.outcome);throw new Gap(tiled.outcome);}
      await cli('run','--bot',starter.id,'--text','Unread sentinel','--wait','turn');
      const observe=async()=>{const state=await api('GET','/api/bots');return {sharedThread:state.groups.find(g=>g.id===room.id).threadId,unread:state.bots.find(b=>b.id===starter.id).tasks.filter(t=>t.unread).map(t=>t.threadId)};};
      row.peerBefore=await observe();assert.notEqual(row.peerBefore.sharedThread,side,'need a noncurrent room thread');assert(row.peerBefore.unread.length,'missing unread sentinel');
      await view(700);await expect('document.querySelectorAll("[data-pane-id]").length===1');await delay(250);row.peerNarrow=await observe();
      await view(width);await expect('document.querySelectorAll("[data-pane-id]").length===2');await ev(nextFrame);row.peerAfter=await observe();
      row.draftFocus=await ev(`({draft:[...document.querySelectorAll('textarea')].find(e=>e.value==='Keep side draft')?.value??null,focus:document.activeElement?.ariaLabel,focusedThread:document.querySelector('[data-pane-focused]')?.dataset.workspaceThread})`);
      assert.deepEqual(row.peerNarrow,row.peerBefore,'resize changed shared room selection or unread work');assert.deepEqual(row.peerAfter,row.peerBefore);assert.equal(row.draftFocus.draft,'Keep side draft');assert.equal(row.draftFocus.focusedThread,side);assert.equal(await ev(`document.activeElement.value==='Keep side draft'`),true);
      return 'Side thread, draft and focus restored; independent fixture client saw no shared changes';
    });
  }finally{try{await endTrace?.();}finally{p?.close();if(p)await p.exited(3000);await fixture.close();copyFileSync(logPath,join(out,path('server.log')));}}
}
class Gap extends Error {}
const modes = process.argv[4] ? [process.argv[4]] : ['simple','advanced'];
const devices = process.argv[5] ? [process.argv[5]] : ['laptop','ipad','phone'];
for (const mode of modes) for (const device of devices) await cell(mode,device);
run.hardware='Unverified: physical iPhone/iPad Safari, Home Screen, software keyboard, external iPad keyboard, rotation, Split View and safe areas.';
save();console.log(join(out,'results.json'));
if(captures.some(r=>!r.completed && r.availability==='available'))process.exitCode=1;
