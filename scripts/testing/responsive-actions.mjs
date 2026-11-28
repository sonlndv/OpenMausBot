import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkForkActions({ api, bot, room, side, selectPepper, click, ev, expect, input, key, q, named, editor, record, measure, idle, shot, trials, until }) {
  const panel = q('[data-thread-panel]');
  const close = async () => {
    await click(q('[data-thread-panel] button[aria-label="Close forked conversation"]'));
    await expect(`!${panel}`);
  };
  const atMessage = async (words) => {
    const before = await ev(`${panel}?.dataset.threadPanel`);
    const bubble = named(words, '[data-chat-bubble]');
    await click(bubble);
    await click(`(${bubble}).closest('[data-message-row]').querySelector('button[aria-haspopup=menu]')`);
    await click(named('Fork conversation from here', '[role=menuitem]'));
    await expect(`${panel}?.dataset.threadPanel!==${JSON.stringify(before)} && ${panel}?.querySelector('[role=log]')?.innerText.includes(${JSON.stringify(words)})`);
  };
  const checkedOrigin = async (kind, owner, threadId, messageId) => {
    const id = await ev(`${panel}.dataset.threadPanel`);
    const source = (await api('GET','/api/bots'))[kind].find(item => item.id === owner);
    const task = source.tasks.find(item => item.threadId === id);
    assert.equal(task?.origin?.threadId, threadId);
    assert.equal(task?.origin?.messageId, messageId);
    return id;
  };
  const messages = async id => (await api('GET',`/api/threads/${id}/messages?limit=100`)).messages;
  await record('room-message-fork', 1, async row => {
    const words = 'Room reference line', anchor = (await messages(side)).find(m => m.text === words);
    await atMessage(words);
    row.threadId = await checkedOrigin('groups', room.id, side, anchor.id);
    row.open = await shot('room-fork-detail');
    await close();
    return 'Forked the selected room message; stored origin matches the room thread and message';
  });
  await selectPepper();
  const words = 'First orange receipt';
  const sourceId = bot.activeTaskId;
  await api('POST',`/api/bots/${bot.id}/messages`,{text:words,threadId:sourceId});
  const [anchor, latest] = await until(async () => {
    const original = await messages(sourceId);
    const index = original.findIndex(m => m.role === 'user' && m.text === words);
    const reply = original.slice(index+1).findLast(m => m.kind === 'text' && m.role === 'bot');
    return index >= 0 && reply && [original[index],reply];
  }, 'missing fork source reply', 15000);
  await record('command-fork-latest', 1, async row => {
    await click(editor); await input('/fork');
    await expect(`document.body.innerText.includes('/fork')`);
    await key('Escape', 'Escape', 27);
    await click(q('button[aria-label="Fork from the latest text message"]'));
    await expect(`${panel}?.querySelector('[role=log]')?.innerText.includes(${JSON.stringify(words)})`);
    row.threadId = await checkedOrigin('bots', bot.id, sourceId, latest.id);
    assert(!(await messages(sourceId)).some(m => m.text === '/fork'));
    await close();
    return 'Forked latest text without sending the slash command as a message';
  });
  let fork;
  await record('bot-message-fork', 1, async row => {
    await atMessage(words);
    row.threadId = fork = await checkedOrigin('bots', bot.id, sourceId, anchor.id);
    assert(!(await messages(fork)).some(m => m.id === latest.id));
    row.open = await shot('bot-fork-detail'); await close();
    return 'Forked the earlier message, excluding the later answer';
  });
  await record('fork-origin-open', trials, async row => {
    const chip = `(${named(words, '[data-chat-bubble]')}).closest('[data-message-row]').querySelector('[data-testid=fork-links] button')`;
    const result = `${panel}?.dataset.threadPanel===${JSON.stringify(fork)} && ${panel}?.querySelector('[role=log]')?.innerText.includes(${JSON.stringify(words)})`;
    await click(editor, 0.2); await input('Keep orange draft');
    for (let i=-1; i<trials; i++) {
      if(i<0){ await click(chip); await expect(`${result} && ${idle(panel)}`); }
      else await measure(row,'pointerdown',()=>click(chip),result,idle(panel));
      await close();
      await expect(`(${editor}).value==='Keep orange draft'`);
      await delay(350);
    }
    return 'Opened the matching fork from its origin chip and returned to the unsent source draft';
  });
}

export async function checkActionMenus({ api, cli, bot, room, starter, device, mode, selectPepper, openList, click, ev, expect, input, key, esc, q, named, record, shot, send, until }) {
  const groupState = async () => (await api('GET', '/api/bots?messages=0')).groups;
  const item = text => named(text, '[data-room-menu] [role=menuitem]');
  await record('touch-palette', 1, async () => {
    await openList(); await click(q('button[aria-label="You"]')); await click(q('[data-menu-key="palette"]'));
    await click(q('[role=dialog][aria-label="Command palette"] input')); await input('Toggle light/dark');
    await click(named('Toggle light/dark','[role=dialog] button'));
    await expect(`document.documentElement.dataset.skin==='midnight'`);
    return 'Ran the theme command from the account menu; skin is Midnight';
  });
  if (device !== 'laptop') await record('room-actions',1,async row => {
    const {group} = await api('POST','/api/groups',{name:'Room for review',memberIds:[bot.id,starter.id],setup:{bulletin:'',defaultResponder:{kind:'mentions'}}});
    const target = q(`[data-room-actions="${group.id}"]`);
    const menu = async () => { await openList(); await click(target); await expect(q('[data-room-menu]')); };
    const rooms = async () => (await groupState()).map(g=>g.id);
    await menu(); const order = await rooms();
    const up = order.indexOf(group.id) > order.indexOf(room.id);
    await click(item(up?'Move up':'Move down'));
    await until(async()=>{const ids=await rooms();return (ids.indexOf(group.id)>ids.indexOf(room.id))!==up;},'room order not saved');
    await menu(); await click(item('Rename group chat'));
    await click(q('[data-room-menu] input')); await key('a','KeyA',65,2); await input('Orange room'); await click(q('[aria-label="Save group chat name"]'));
    const saved = async () => (await groupState()).find(g=>g.id===group.id);
    await until(async()=>(await saved())?.name==='Orange room','rename not saved');
    await menu(); await click(item('Set description')); await click(q('[data-room-menu] input')); await input('Weekend roster'); await click(q('[aria-label="Save description"]'));
    await until(async()=>(await saved())?.description==='Weekend roster','description not saved');
    await menu(); await click(item('Move to department')); await click(q('[data-section-picker] input')); await input('Operations'); await click(q('[data-section-picker] button[type=submit]'));
    await until(async()=>(await saved())?.section==='Operations','department not saved');
    await menu(); row.open=await shot('room-menu'); await click(item('Delete group chat'));
    await click(named('Delete group chat','[role=alertdialog] button,[role=dialog] button,dialog button'));
    await until(async()=>!(await saved()),'room not deleted');
    return 'Reordered, renamed, described, moved and confirmed deletion of one disposable room';
  });
  if(device==='phone' && mode==='simple') await record('restore-archived',1,async()=>{
    const archived=(await cli('new-bot','--name','Archived fixture')).bot;
    await api('PATCH',`/api/bots/${archived.id}`,{hidden:true});
    await openList(); await click(q('button[aria-label="You"]')); await click(q('[data-menu-key="archived"]'));
    await click(named('Restore','[role=dialog] button'));
    await until(async()=>(await api('GET','/api/bots')).bots.some(b=>b.id===archived.id && !b.hidden),'restore not saved');
    return 'Restored the archived bot in Simple without switching modes';
  });
  if(device==='phone' && mode==='advanced') await record('pinned-page',1,async row=>{
    await openList(); await click(q('button[aria-label="Tools"]'));
    assert(!await ev(q('[data-menu-key="team-files"]')), 'team-only destination on standalone host');
    await click(q('[data-menu-key="web-panel-health"]'));
    const url = await ev(`JSON.parse(localStorage.getItem('omb-web-panels'))[0].url`);
    await expect(q('main[aria-label="Fixture health"]'));
    await until(async()=>{const {targetInfos}=await send('Target.getTargets');const {frameTree}=await send('Page.getFrameTree');return targetInfos.some(t=>t.type==='iframe' && t.url===url) || frameTree.childFrames?.some(f=>f.frame.url===url);},'pinned page URL was not loaded');
    row.open=await shot('pinned-page'); await click(named('Open in browser'));
    await until(async()=>(await send('Target.getTargets')).targetInfos.some(t=>t.type==='page' && t.url===url),'external tab did not open');
    return 'Opened the pinned local health URL, then opened that same URL in a new browser tab';
  });
}
