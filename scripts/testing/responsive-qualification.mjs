import assert from 'node:assert/strict';

const sizes = {
  phone: [[320,568],[390,844],[844,390],[390,844],[320,568]],
  ipad: [[820,1180],[768,1024],[767,1024],[507,1024],[767,1024],[768,1024],[769,1024],[820,1180],[1024,768]],
  laptop: [[1366,768],[1440,900],[1366,768]],
};

export async function qualifyLayout({ device, mode, editor, send, view, click, openList, key, input, q, ev, expect, record, shot }) {
  const draft = 'ملاحظات الفريق';
  const skin = mode === 'simple' ? 'midnight' : 'daylight';
  const large = mode === 'advanced';
  const sendButton = q('button[aria-label="Send"],button[aria-label="Send message"]');
  await click(editor);
  await input(draft);
  await expect(`${editor}.value===${JSON.stringify(draft)} && getComputedStyle(${editor}).direction==='rtl'`);
  const initial = await ev(`${editor}.selectionStart`);
  await key('ArrowRight','ArrowRight',39);
  await expect(`${editor}.selectionStart<${initial}`, 'Right arrow did not move visually right in the RTL draft');
  for (const [i, [width,height]] of sizes[device].entries()) {
    await record(`layout-${i}-${width}x${height}`,1,async row => {
      row.viewport = {width,height,touch:device!=='laptop'};
      row.skin = skin;
      await view(width,height);
      await expect(`innerWidth===${width} && innerHeight===${height} && ${editor}?.value===${JSON.stringify(draft)}`);
      const bounds = await ev(`(()=>{const e=${editor},r=e.getBoundingClientRect(),s=${sendButton}.getBoundingClientRect();return {font:parseFloat(getComputedStyle(e).fontSize),skin:document.documentElement.dataset.skin,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches,rtl:getComputedStyle(e).direction,editor:r.toJSON(),send:s.toJSON(),pageWidth:document.documentElement.scrollWidth}})()`);
      row.geometry = bounds;
      assert.equal(bounds.skin,skin);
      assert.equal(bounds.reduced,true);
      assert.equal(bounds.rtl,'rtl');
      if (large) assert(bounds.font>=24,`browser minimum font size not applied: ${bounds.font}`);
      for (const rect of [bounds.editor,bounds.send]) assert(rect.width>0 && rect.height>0 && rect.left>=0 && rect.top>=0 && rect.right<=width+1 && rect.bottom<=height+1,'clipped input or send: '+JSON.stringify(rect));
      assert(bounds.pageWidth<=width,'page wider than viewport');
      const ax = (await send('Accessibility.getFullAXTree')).nodes.filter(n=>!n.ignored);
      row.axNames = ['Message Pepper',...(width<768?['Open bot list']:[])].map(name=>{
        const n=ax.find(n=>n.name?.value===name && n.role?.value===(name==='Message Pepper'?'textbox':'button'));
        assert(n,`missing accessible control: ${name}`);return [n.role.value,name];
      });
      assert(ax.some(n=>n.role?.value==='button' && ['Send','Send message'].includes(n.name?.value)), 'Send has no exposed name');
      await openList();
      await click(q('[data-sidebar-inbox]'));
      await expect(q('[data-inbox-list]'));
      await click(q('[aria-label="Close inbox"]'));
      await expect(`!${q('[data-inbox-panel]')} && ${editor}.value===${JSON.stringify(draft)}`);
      row.returned = await shot(`returned-${i}-${width}`);
      return 'Read Inbox, closed it and retained the RTL draft';
    });
  }
  if (device==='laptop') await record('inbox-fit-boundary',1,async row=>{
    row.skin=skin;
    await click(q('[data-sidebar-inbox]'));
    const boundary=mode==='simple'?1040:1280;
    row.positions=[];
    for(const width of [boundary+1,boundary,boundary-1,boundary,boundary+1]){
      await view(width,768);
      const sidebarWidth=`${q('[data-sidebar]')}.getBoundingClientRect().width`;
      await expect(`innerWidth===${width} && ${q('[data-inbox-list]')} && ${sidebarWidth}${width<boundary?'<100':'>=279'}`,`Inbox sidebar at ${width}`);
      assert(await ev('document.documentElement.scrollWidth<=innerWidth'));
      row.positions.push({width,sidebarWidth:await ev(sidebarWidth)});
    }
    await click(q('[aria-label="Close inbox"]'));
    await expect(`!${q('[data-inbox-panel]')} && ${editor}.value===${JSON.stringify(draft)}`);
    return 'Folded the list with Inbox still open, restored it after widening, returned to the same draft';
  });
  if (device==='laptop' && mode==='simple') await record('bot-panel-fit-boundaries',1,async row=>{
    row.skin=skin;
    row.positions=[];
    const panel=q('#bot-panel');
    const openProfile=async()=>{
      const direct=q(`button[aria-label="Open Pepper's profile"]`);
      if (await ev(`!!${direct}`)) await click(direct);
      else {
        await click(q('[data-tour="bot-pill"]'));
        await click(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==="Open Pepper's profile")`);
      }
      await expect(panel);
    };
    const cross=async(boundary,computer)=>{
      for(const width of [boundary+1,boundary,boundary-1,boundary,boundary+1]){
        await view(width,768);
        const position=width<boundary?'absolute':'static';
        await expect(`innerWidth===${width} && getComputedStyle(${panel}).position===${JSON.stringify(position)} && document.documentElement.scrollWidth<=innerWidth`);
        assert.equal(await ev(`!!${q('[data-computer-panel]')}`),computer);
        row.positions.push({width,position,computer});
      }
    };
    await openProfile();
    await cross(920,false);
    await click(q('button[aria-label="Close settings"]'));
    await view(1537,768);
    await expect(`innerWidth===1537 && !${panel}`);
    await click(q(`button[aria-label="Bot's screen"]`));
    await expect(q('[data-computer-panel]'));
    await openProfile();
    await cross(1536,true);
    row.panels=await shot('profile-and-computer-1537');
    await click(q('button[aria-label="Close settings"]'));
    await click(q('[data-computer-panel-close]'));
    await expect(`!${panel} && !${q('[data-computer-panel]')} && ${editor}.value===${JSON.stringify(draft)}`);
    return 'Profile floated below 920px alone and below 1536px with Computer; widening restored inline panels and preserved the draft';
  });
  if(device==='phone') await record('simulated-safe-areas',1,async row=>{
    row.skin=skin;
    const manifest=await send('Page.getAppManifest');
    assert.deepEqual(manifest.errors,[]);
    assert.equal(new URL(manifest.url).pathname,'/manifest.webmanifest');
    row.insets=[];
    try {
      for(const [width,height,insets] of [[390,844,{top:44,right:0,bottom:34,left:0}],[844,390,{top:0,right:44,bottom:21,left:44}]]){
        await view(width,height);
        await send('Emulation.setSafeAreaInsetsOverride',{insets});
        await expect(`innerWidth===${width} && innerHeight===${height} && ${editor}.value===${JSON.stringify(draft)}`);
        for(const control of [editor,sendButton]) await expect(`(()=>{const r=${control}.getBoundingClientRect();return r.left>=${insets.left} && r.top>=${insets.top} && r.right<=${width-insets.right}+1 && r.bottom<=${height-insets.bottom}+1})()`,'control under emulated safe area');
        row.insets.push({width,height,insets,screen:await shot(`safe-area-${width}`)});
      }
    } finally {
      await send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,right:0,bottom:0,left:0}});
      await view(320,568);
    }
    return 'Chrome parsed the manifest; the draft and Send stayed inside emulated portrait and landscape safe areas';
  });
  if(device==='phone' && large) await record('large-text-header',1,async row=>{
    row.skin=skin;
    row.viewport={width:320,height:568,touch:true};
    row.buttons=await ev(`Array.from(document.querySelectorAll('[data-look="chat-header"] button'),e=>{const r=e.getBoundingClientRect(),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {name:e.ariaLabel||e.title||e.innerText,rect:r.toJSON(),hit:e.contains(p),hitName:p?.closest('button')?.ariaLabel??null}}).filter(b=>b.rect.width>0 && b.rect.height>0)`);
    assert(row.buttons.length,'no visible chat header buttons');
    assert(row.buttons.every(b=>b.hit),'visible header control has an occluded center: '+JSON.stringify(row.buttons.filter(b=>!b.hit).map(b=>b.name)));
    return 'Every visible header button received its own center hit';
  });
}
