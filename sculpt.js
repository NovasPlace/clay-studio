(function(){
  'use strict';
  const B=window.ClayBridge,G=window.ClayGeometry;if(!B||!G)return;
  const root=B.root,field=root.querySelector('.sculpt-field');if(!field)return;
  B.original(false);
  const R=window.ClayRelations(B,G,field);
  const shell=document.createElement('div');shell.className='clay-shell';shell.dataset.clayUi='';
  shell.innerHTML=`<header class="clay-top"><div><button class="clay-pages" data-action="pages" hidden title="All your pages">← Pages</button><span class="clay-brand">Clay Studio<small>Sculpting lab · 0.3</small></span><span class="clay-chip">SHAPE IT BY HAND</span></div><div><button class="original-tools" data-action="original">Layout tools</button><button data-action="phone" aria-pressed="false">Phone</button><button class="site-toggle" data-action="preview" aria-pressed="false">View site</button><button class="clay-export" data-action="export">Export</button></div></header>
  <div class="clay-bottom"><div class="clay-selection" hidden><span></span><button data-tool="peel" aria-pressed="false">Peel a piece</button><button data-action="ungroup">Ungroup</button><button data-action="scatter" aria-pressed="false" title="The pieces wait apart and come together when the pointer reaches them">Scatter</button><button data-action="assemble" aria-pressed="false" title="The pieces wait apart and come together as the page scrolls them into view, on phones too">Assemble on scroll</button><button data-action="goo" aria-pressed="false" title="The pieces melt together where they come close">Goo</button></div><div class="clay-hint" role="status" aria-live="polite"></div><div class="clay-tools" role="toolbar" aria-label="Sculpting tools">
  <button class="tool" data-tool="hand" aria-pressed="true">Grab</button><button class="tool" data-tool="group" aria-pressed="false">Group</button><button class="tool" data-tool="push" aria-pressed="false">Push</button><button class="tool" data-tool="grow" aria-pressed="false">Grow</button><button class="tool" data-tool="flow" aria-pressed="false">Flow</button><button class="tool" data-tool="smooth" aria-pressed="false">Tidy</button><button class="tool" data-tool="paint" aria-pressed="false">Paint</button><button class="tool" data-tool="act" aria-pressed="false" title="Hold a piece and move it the way it should move (A)">Act</button><button class="tool" data-tool="pin" aria-pressed="false">Pin</button>
  <span class="separator"></span><label class="clay-options">Brush <input type="range" aria-label="Brush size" min="50" max="380" value="160"><output>160</output></label><input class="clay-color" type="color" aria-label="Paint color" value="#adddc5" hidden>
  <button data-action="magnets" aria-pressed="true" title="Attach small text or a button near a card or image">Magnets</button><button data-action="room" aria-pressed="true" title="Move neighbors aside while sculpting">Make room</button><span class="separator"></span><button data-action="undo" disabled>Undo</button><button data-action="redo" disabled>Redo</button><button data-action="add" aria-expanded="false">Add +</button></div><div class="clay-status">Your edits stay in this browser. Export a page to keep a portable copy.</div>
  <div class="clay-more" hidden><button data-add="text">Add text</button><button data-add="card">Add card</button><button data-add="button">Add button</button><button data-add="image">Add image</button><button data-action="replace" hidden>Replace image</button><button data-action="split" hidden>Split drawing</button><button data-action="space">More canvas</button><button data-action="edit">Edit selected text</button><button data-action="link" hidden title="Point this button or link at another page, a part of this page, or a web address (K)">Link to…</button></div></div>
  <button class="clay-handle" aria-label="Resize selected piece" title="Drag to resize" hidden></button><canvas class="clay-brush" aria-hidden="true"></canvas><input type="file" class="clay-file" accept="image/*" hidden>
  <dialog class="clay-dialog" aria-label="Export page"><div class="row"><h2>Take your page with you.</h2><button data-action="close-export">Close</button></div><p>Real HTML and CSS. The exported page works without the editor.</p><div class="tabs" role="tablist" aria-label="Export format"><button role="tab" aria-selected="true" data-format="html">Page HTML</button><button role="tab" aria-selected="false" data-format="css">CSS</button><button role="tab" aria-selected="false" data-format="agent">For an agent</button></div><textarea aria-label="Exported source" readonly spellcheck="false"></textarea><div class="actions"><button class="primary" data-action="download">Save HTML file</button><button data-action="copy">Copy current view</button></div><div class="clay-export-state" role="status" aria-live="polite"></div><p class="clay-site-note" hidden>This saves this page. To save all your pages together, with the links between them, use <b>Export site</b> on ← Pages.</p></dialog>
  <dialog class="clay-dialog clay-link" aria-labelledby="clay-link-title"><form method="dialog"><h2 id="clay-link-title">Where should this go?</h2><div class="clay-link-list"></div>
  <fieldset><legend>A web address</legend><label><input type="radio" name="to" value="web"><input type="text" class="clay-link-web" aria-label="Web address" placeholder="https://example.com or 192.168.1.20:8096" autocomplete="off" spellcheck="false"></label></fieldset>
  <p class="clay-link-error" role="alert"></p><div class="actions"><button class="primary" value="ok">Keep link</button><button value="cancel" formnovalidate>Cancel</button></div></form></dialog>`;
  document.body.appendChild(shell);
  const q=s=>shell.querySelector(s),qa=s=>[...shell.querySelectorAll(s)];
  const hint=q('.clay-hint'),canvas=q('canvas'),ctx=canvas.getContext('2d'),handle=q('.clay-handle'),dialog=q('dialog'),linkDialog=q('.clay-link');
  const tips={group:'Drag a box or draw a loop around pieces to stick them together. Pinned pieces stay out.',peel:'Pull a piece 56 pixels out of its group to release it. Escape cancels.',hand:'Grab any piece. Pull its corner to resize. Double-click words to edit.',push:'Brush across the page to push pieces. Pinned pieces stay put.',grow:'Brush upward to grow. Brush downward to shrink. Text stays readable.',flow:'Draw a long path across the canvas. Unpinned cards will follow your stroke.',smooth:'Tidy gently closes oversized gaps and evens nearby rows. Your groups stay together.',paint:'Choose a color, then brush it onto pieces.',pin:'Click a piece to pin it. Click again to let it move.',act:'Hold a piece and move it the way it should move, then let go. It keeps moving like that, in the exported page too.'};
  let tool='hand',radius=160,makeRoom=true,magnets=true,selected=null,gesture=null,lastPoint=null,phone=false,live=false,original=false,format='html',exportHTML='',exportURL='',exportSaving=false;
  let seenError=false,hoveringField=false,wasNarrow=false,fileFor=null,pointed=null,linking=null,tapped=null;
  function say(text){hint.textContent=text;}
  // Idle motion pauses while pieces are measured or held, so measuring never picks up a mid-motion offset.
  const still=on=>B.still(on);
  function items(){return [...field.querySelectorAll(':scope > [data-sculpt-item]')];}
  function bounds(){return {w:field.clientWidth,h:field.clientHeight};}
  function point(e){const r=field.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
  function model(){B.stopMotion();still(true);try{return measure();}finally{if(!gesture)still(false);}}
  function measure(){const r=field.getBoundingClientRect();return items().map(el=>{
    const box=el.getBoundingClientRect(),style=getComputedStyle(el),kind=el.dataset.kind,font=parseFloat(style.fontSize);
    const content=el.lastElementChild,needed=content?content.getBoundingClientRect().bottom-box.top+parseFloat(style.paddingBottom)+2:30;
    const minW=kind==='group'?R.minimum(el).w:kind==='image'?100:kind==='block'?Math.min(box.width,360):kind==='card'?200:font>34?240:el.classList.contains('eyebrow')?200:140;
    return {id:el.id,el,x:box.left-r.left,y:box.top-r.top,w:box.width,h:box.height,font,pin:style.getPropertyValue('--clay-pin').trim()==='1',minW:Math.min(minW,field.clientWidth),minH:kind==='group'?R.minimum(el).h:(kind==='card'||kind==='block')?needed:30,minFont:font<14?font:14,kind};});}
  function select(el){selected=el;field.querySelectorAll('[data-sculpt-item]').forEach(e=>e.toggleAttribute('data-sculpt-selected',e===el));refresh();}
  function refresh(){const isNarrow=root.clientWidth<=767;qa('[data-tool],[data-action=room],[data-action=magnets],[data-action=add]').forEach(b=>b.disabled=phone||isNarrow);if(isNarrow&&!phone&&!wasNarrow)say('This window shows the phone layout. Widen it to sculpt.');else if(!isNarrow&&wasNarrow&&!phone)say(tips[tool]);wasNarrow=isNarrow;const c=B.counts();q('[data-action=undo]').disabled=!c.undo;q('[data-action=redo]').disabled=!c.redo;
    q('[data-action=replace]').hidden=!imageOf(selected);q('[data-action=split]').hidden=!isSvg(imageOf(selected));q('[data-action=link]').hidden=!linksIn(selected).length;
    items().forEach(e=>e.toggleAttribute('data-sculpt-locked',getComputedStyle(e).getPropertyValue('--clay-pin').trim()==='1'));
    if(selected&&!selected.isConnected)selected=null;else if(selected)selected=R.unit(selected);field.querySelectorAll('[data-sculpt-item]').forEach(e=>e.toggleAttribute('data-sculpt-selected',e===selected));q('.clay-selection').hidden=!selected||!R.isGroup(selected)||phone||live||original;q('.clay-selection span').textContent=selected&&R.isGroup(selected)?R.members(selected).length+' pieces · move and stretch together':'';if(selected&&R.isGroup(selected)){q('[data-action=scatter]').setAttribute('aria-pressed',String(R.scattered(selected)));q('[data-action=assemble]').setAttribute('aria-pressed',String(R.arriving(selected)));q('[data-action=goo]').setAttribute('aria-pressed',String(/#clay-goo/.test(getComputedStyle(selected).filter)));}handle.hidden=!selected||phone||isNarrow||live||original||tool!=='hand';if(!handle.hidden){const r=selected.getBoundingClientRect();handle.style.left=r.right+'px';handle.style.top=r.bottom+'px';}
  }
  function mobileRules(el){return {el,bp:'mobile',defaults:true,css:{position:'relative',left:'auto',top:'auto',width:'100%','max-width':'100%',height:'auto','min-height':'0',margin:'0',transform:'none',rotate:'none','font-size':el.classList.contains('headline')?'42px':el.dataset.kind==='text'?(el.classList.contains('eyebrow')||el.classList.contains('little')?'13px':'18px'):null}};}
  // A real second layout, stored and exported with the same page. Desktop art direction remains free.
  B.write([{el:field,bp:'mobile',defaults:true,css:{height:'auto',display:'grid',gap:'24px',padding:'30px 24px'}}].concat(items().map(mobileRules)));
  // Only what a gesture actually moved or resized is written, so every other piece keeps its exact values. A piece that
  // moved earlier in the same gesture keeps being written, even if it has come back to where it started.
  function apply(list,label,resize=false,from=null,seen=null){const b=bounds(),near=(a,c)=>Math.abs(a-c)<.5;
    B.write(list.flatMap(i=>{const s=from&&from.find(o=>o.el===i.el);
      let pos=!s||!near(i.x,s.x)||!near(i.y,s.y),size=resize&&!i.pin&&(!s||!near(i.w,s.w)||!near(i.h,s.h)||Math.abs(i.font-s.font)>.05);
      if(seen){if(pos)seen.pos.add(i.el);if(size)seen.size.add(i.el);pos=seen.pos.has(i.el);size=resize&&!i.pin&&seen.size.has(i.el);}
      if(!pos&&!size)return [];const css={};if(pos){css.left=(i.x/b.w*100).toFixed(4)+'%';css.top=i.y.toFixed(2)+'px';}
      if(size){css.width=(i.w/b.w*100).toFixed(4)+'%';if(i.kind==='text')css['font-size']=i.font.toFixed(2)+'px';else if(i.el.tagName==='IMG'||i.kind==='group')css.height=i.h.toFixed(2)+'px';else css['min-height']=i.h.toFixed(2)+'px';}
      return [{el:i.el,css}];}),label);refresh();}
  // Make room clears space for what is moving; pairs that were already crowded before the gesture are left as they were.
  function settle(list,held,crowded=gesture&&gesture.crowded){if(!makeRoom)return {items:list,unresolved:0};return G.separate(list,bounds(),held,undefined,crowded);}
  function setTool(t){if(gesture)finish(false);tool=t;tapped=null;qa('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===t)));q('.clay-color').hidden=t!=='paint';say(tips[t]);refresh();draw();}
  function active(){return !phone&&root.clientWidth>767&&!live&&!original&&!dialog.open&&!linkDialog.open;}
  function selectedBy(e){return e.target.closest&&R.unit(e.target.closest('[data-sculpt-item]'));}
  function start(e,resize=false){if(!active()||e.button!==0||e.target.isContentEditable)return;let el=resize?selected:selectedBy(e);const p=point(e);lastPoint=p;if(tool==='act'&&!resize){startAct(e,p);return;}const peel=(tool==='peel'||e.altKey)&&!resize;if(peel){const hit=e.target.closest('[data-sculpt-item]');if(!hit||!R.isGroup(hit.parentElement)){say('Start on a piece inside a group.');return;}el=hit;if(getComputedStyle(R.unit(el)).getPropertyValue('--clay-pin').trim()==='1'){say('Unpin this group before peeling a piece out.');return;}}
    if(tool==='pin'&&!resize){if(!el){say('Click a piece to pin it.');return;}const before=B.begin(),pin=getComputedStyle(el).getPropertyValue('--clay-pin').trim()!=='1';B.write([{el,css:{'--clay-pin':pin?'1':'0'}}],pin?'Pinned this piece.':'Unpinned this piece.');B.commit(before,pin?'Pinned a piece.':'Unpinned a piece.');select(el);say(pin?'Pinned. Brushes and neighbors will leave this piece in place.':'Unpinned. This piece can move again.');return;}
    if((tool==='hand'||resize||tool==='peel')&&!el){select(null);return;}
    if(el&&(tool==='hand'||resize)&&getComputedStyle(el).getPropertyValue('--clay-pin').trim()==='1'){select(el);say('This piece is pinned. Use Pin to release it first.');return;}
    e.preventDefault();e.stopPropagation();q('.clay-more').hidden=true;q('[data-action=add]').setAttribute('aria-expanded','false');
    const before=B.begin(),all=model();gesture={id:e.pointerId,start:p,prev:p,before,seen:{pos:new Set(),size:new Set()},crowded:G.crowded(all),all:all.map(i=>({...i})),now:all.map(i=>({...i})),path:[p],moved:false,resize,el,painted:new Set(),lastOutcome:0,guides:[],flowValid:false,peel,peeled:false,peelBox:peel?R.rect(el):null,magnet:null,groupSizes:new Map(all.filter(i=>i.kind==='group').map(i=>[i.id,R.resizeState(i.el)]))};
    still(true);if(el&&tool==='hand')select(el);if(tool==='flow'){gesture.flowIds=all.filter(i=>(i.kind==='card'||i.kind==='group')&&!i.pin).map(i=>i.id);say('Drawing a path for '+gesture.flowIds.length+' cards. Keep drawing until they settle.');}
    try{field.setPointerCapture(e.pointerId);}catch(err){}if(tool==='paint')paint(p);draw();
  }
  function paint(p){const targets=gesture.now.flatMap(i=>i.kind==='group'?R.members(i.el).map(el=>({...R.rect(el),id:el.id,kind:el.dataset.kind,pin:i.pin})):[i]).filter(i=>!i.pin&&G.influence(i,p,radius)>.25&&!gesture.painted.has(i.id));const color=q('.clay-color').value;
    if(targets.length){B.write(targets.map(i=>({el:i.el,css:{[i.kind==='text'?'color':'background-color']:color,'background-image':'none'}})),'You painted this piece '+color+'.');targets.forEach(i=>gesture.painted.add(i.id));gesture.moved=true;}}
  function move(e){const at=point(e),b0=bounds();hoveringField=at.x>=0&&at.y>=0&&at.x<=b0.w&&at.y<=b0.h;if(hoveringField||gesture)lastPoint=at;if(!gesture){draw();return;}if(e.pointerId!==gesture.id)return;e.preventDefault();const d=gesture,p=lastPoint,dx=p.x-d.start.x,dy=p.y-d.start.y,b=bounds();
    if(!d.moved&&Math.hypot(dx,dy)<3&&tool!=='paint')return;d.moved=true;if(d.act){acting(d,e);return;}let next=d.now,label='',held=null;
    if(tool==='group'){d.path.push(p);d.groupIds=G.lasso(d.all,d.path);d.prev=p;say(d.groupIds.length+' pieces inside. Release to group them.');draw();return;}
    if(d.peel&&!d.peeled){if(Math.hypot(dx,dy)<56){say('Pull a little farther to peel this piece out.');draw();return;}R.peel(d.el);d.peeled=true;d.all=model();d.now=d.all;select(d.el);}
    if(d.resize){const i=d.all.find(i=>i.el===d.el),w=G.clamp(i.w+dx,i.minW,b.w-i.x),h=G.clamp(i.h+dy,i.minH,b.h-i.y);next=d.all.map(o=>o.id===i.id?{...o,w,h,font:G.clamp(i.font*w/i.w,i.minFont,120)}:{...o});held=i.id;label='You resized a piece by hand.';}
    else if(tool==='hand'||d.peel){const i=d.all.find(i=>i.el===d.el);let moved=G.contain({...i,x:i.x+dx,y:i.y+dy},b);d.guides=[];d.magnet=null;if(!e.shiftKey&&!d.peel){const snap=G.snap(moved,d.all.filter(o=>o.id!==i.id),b);moved=snap.item;d.guides=snap.guides;}if(magnets&&!e.shiftKey&&!d.peel){d.magnet=G.magnet(moved,d.all.filter(o=>o.id!==i.id),b);if(d.magnet)moved=d.magnet.item;}if(makeRoom&&!d.magnet){const pins=d.all.filter(o=>o.id!==i.id&&o.pin);if(pins.some(o=>G.overlaps(moved,o,0)))moved=G.nearestFree(moved,pins,b)||i;}next=d.all.map(o=>o.id===i.id?moved:{...o});held=d.magnet?[i.id,d.magnet.target]:i.id;label=d.peel?'You peeled out a piece and placed it freely.':'You placed a piece freely.';}
    else if(tool==='flow'){if(Math.hypot(p.x-d.path[d.path.length-1].x,p.y-d.path[d.path.length-1].y)>3)d.path.push(p);const group=d.all.filter(i=>d.flowIds.includes(i.id)),flow=G.flow(group,d.path,b);d.flowValid=!!flow;
      if(flow){const map=new Map(flow.map(i=>[i.id,i]));next=d.all.map(i=>map.get(i.id)||{...i});label='You drew a path for the cards to follow.';}else{say('Keep drawing a longer path for '+group.length+' cards.');d.prev=p;draw();return;}}
    else{const delta={x:p.x-d.prev.x,y:p.y-d.prev.y};const steps=Math.max(1,Math.ceil(Math.hypot(delta.x,delta.y)/Math.max(20,radius*.25)));next=d.now;
      for(let j=1;j<=steps;j++){const at={x:d.prev.x+delta.x*j/steps,y:d.prev.y+delta.y*j/steps};if(tool==='push')next=G.push(next,at,{x:delta.x/steps*.9,y:delta.y/steps*.9},radius,b);
        else if(tool==='grow')next=G.grow(next,at,-delta.y/steps*.006,radius,b);else if(tool==='smooth')next=G.smooth(next,at,radius,b);else if(tool==='paint')paint(at);}
      label={push:'You pushed the page with a brush.',grow:'You sculpted the size of nearby pieces.',smooth:'You smoothed the spacing and alignment.',paint:'You painted the page.'}[tool];}
    if(tool!=='paint'){const settled=settle(next,held);d.now=settled.items;d.lastOutcome=settled.unresolved;apply(d.now,label,d.resize||tool==='grow',d.all,d.seen);if(d.resize||tool==='grow')d.now.filter(i=>i.kind==='group'&&!i.pin).forEach(i=>{const state=d.groupSizes.get(i.id);if(state)R.resize(i.el,state,i.w,i.h);});
      // Text wrapping can change a rectangle after growing. Feed those actual dimensions back into collision resolution.
      if(d.resize||tool==='grow'){const measured=model();d.now=measured;const adjusted=settle(measured,held);d.now=adjusted.items;d.lastOutcome=adjusted.unresolved;apply(d.now,label,false,d.all,d.seen);}}
    d.label=label;d.prev=p;say(d.magnet?'Attach '+d.magnet.side+' on release. Hold Shift for free placement.':d.peel?'Released from the group. Keep dragging; Undo brings it back.':d.lastOutcome?'Some pieces touch. Move farther, use a smaller brush, or switch Make room off.':tool==='flow'?'The cards follow your line. Release to keep this arrangement.':tips[tool]);draw();
  }
  function finish(keep){if(!gesture)return;const d=gesture;gesture=null;still(false);try{field.releasePointerCapture(d.id);}catch(err){}if(d.act){endAct(d,keep);return;}
    if(keep&&d.peel&&!d.peeled){select(R.unit(d.el));say('Still attached. Pull farther to peel, or use Ungroup.');draw();return;}
    if(keep&&tool==='group'){const chosen=d.all.filter(i=>(d.groupIds||[]).includes(i.id)).map(i=>i.el);if(chosen.length>=2){const g=R.wrap(chosen);B.commit(d.before,'You looped '+chosen.length+' pieces into a sticky group.');select(g);setTool('hand');say('Stuck together. Grab any member, stretch the corner, or choose Peel a piece.');}else say('Include the centers of at least two unpinned pieces.');refresh();draw();return;}
    if(keep&&d.magnet&&d.moved){const target=items().find(e=>e.id===d.magnet.target);if(target){const g=R.wrap([target,d.el],'magnet');B.commit(d.before,'You attached a piece with magnetism.');select(g);say('Attached. Move them together, or use Peel a piece to pull one free.');refresh();draw();return;}}
    if(!keep||tool==='flow'&&!d.flowValid){B.restore(d.before);B.stopMotion();say(!keep?'Stroke cancelled. Everything is back where it was.':'That path was too short. Draw farther across the canvas.');}
    else if(d.moved){B.commit(d.before,d.label||'You painted the page.');say(d.lastOutcome?'Saved. Some pieces still touch; Undo is available.':'Shape kept. '+(tool==='hand'?'Double-click words to edit them.':'One stroke, one undo.'));}
    if(keep&&d.peeled){setTool('hand');say('Piece peeled free. Grab to move it; Undo reattaches it.');}
    refresh();draw();
  }
  // ---- Act: hold a piece and move it the way it should move; let go and it keeps moving exactly like that ----
  // Nothing else stops while you act, so takes layer like a loop pedal. A part of a split drawing acts on its own, and a
  // piece of any other group acts with its group; Alt reaches the other way. A piece picked up mid-motion starts there.
  function actor(e){const hit=e.target.closest&&e.target.closest('[data-sculpt-item]');if(!hit||!field.contains(hit))return null;const g=hit.parentElement;
    return R.isGroup(g)&&(g.dataset.bond==='drawing')!==e.altKey?hit:R.unit(hit);}
  const actName=el=>R.isGroup(el)?el.dataset.bond==='drawing'?'the drawing':'the group':'“'+pieceName(el)+'”';
  // its own motion: an arrival on scroll isn't something it was acted to do
  const moves=el=>getComputedStyle(el).animationName.split(/,\s*/).some(n=>n!=='none'&&!/^clay-in-/.test(n));
  function hold(el,at){el.style.setProperty('translate',at.x+'px '+at.y+'px','important');el.style.setProperty('rotate','none','important');el.style.setProperty('scale','none','important');}
  // Times come from the pointer events, including every position the browser gathered in between, so a busy moment
  // isn't mistaken for a pause.
  const when=e=>Math.abs(e.timeStamp-performance.now())<5000?e.timeStamp:performance.now();
  function startAct(e,p){if(gesture)finish(false);const el=actor(e);if(!el){select(null);say(tips.act);return;}
    e.preventDefault();e.stopPropagation();q('.clay-more').hidden=true;q('[data-action=add]').setAttribute('aria-expanded','false');B.stopMotion();
    const cs=getComputedStyle(el),from={x:parseFloat(cs.getPropertyValue('--clay-dx'))||0,y:parseFloat(cs.getPropertyValue('--clay-dy'))||0},up=el.parentElement;
    // home is measured with all motion held, its own and any arrival's
    still(true);let r,u;try{r=el.getBoundingClientRect();u=up.getBoundingClientRect();}finally{still(false);}
    gesture={id:e.pointerId,act:true,el,up,start:p,from,at:from,far:false,most:0,t0:when(e),samples:[{t:0,...from}],before:B.begin(),moved:false,guides:[],home:{x:r.left-u.left+r.width/2,y:r.top-u.top+r.height/2}};
    hold(el,from);select(R.unit(el));try{field.setPointerCapture(e.pointerId);}catch(err){}say('Acting. Move it the way it should move, and pause if you like. Esc cancels.');draw();}
  function acting(d,e){const all=e.getCoalescedEvents&&e.getCoalescedEvents();
    (all&&all.length?all:[e]).forEach(c=>{const p=point(c);d.at=G.leash({x:d.from.x+p.x-d.start.x,y:d.from.y+p.y-d.start.y});d.samples.push({t:when(c)-d.t0,...d.at});});
    hold(d.el,d.at);const away=Math.hypot(d.at.x-d.from.x,d.at.y-d.from.y);d.most=Math.max(d.most,away);d.far=d.far||away>G.ACT.close*2;
    say(d.far&&away<=G.ACT.close?'Let go here and it loops.':'Let go in the green ring to loop it, anywhere else to swing back. Esc cancels.');draw();}
  // A press that hardly moves is a click. It remembers its piece for a moment, for a double-click: a moving piece can
  // slip away between the two clicks, and pointer capture sends the double-click to the canvas.
  function endAct(d,keep){const el=d.el,tap=!d.moved||d.most<6;['translate','rotate','scale'].forEach(k=>el.style.removeProperty(k));tapped=keep&&tap?{el,at:performance.now()}:null;
    const t=keep&&!tap&&G.take(d.samples.concat({t:performance.now()-d.t0,...d.at}));
    if(t){const label='You acted out how '+actName(el)+' moves.',css=B.takeCSS(t);B.write([{el,css}],label);B.commit(d.before,label);
      const plays=getComputedStyle(el).animationName.split(/,\s*/).includes(css.animation.split(' ')[0]);
      say(!plays?'Kept, but here a motion set in Layout tools, for this screen size or a state, takes its place.':matchMedia('(prefers-reduced-motion: reduce)').matches?'Kept. This computer asks for less motion, so it stays still here; visitors who allow motion see it move.':t.loop?'Kept. It loops the way you acted it, pauses and all. Act on another piece to layer it; Undo takes it back.':'Kept. It moves the way you acted it, and swings back. End where you started to make a loop.');}
    else say(!keep?'Cancelled. It moves the way it did before.':!tap?'Too quick to keep. Act it out a little longer.':moves(el)?'It moves the way it was acted. Hold it and move it to act it again, or double-click to still it.':tips.act);
    refresh();draw();}
  function draw(){const ratio=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(innerWidth*ratio)||canvas.height!==Math.round(innerHeight*ratio)){canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(innerHeight*ratio);canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';}ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);if(!active())return;const r=field.getBoundingClientRect();
    if(lastPoint&&(hoveringField||gesture)&&['push','grow','smooth','paint'].includes(tool)){ctx.beginPath();ctx.arc(r.left+lastPoint.x,r.top+lastPoint.y,radius,0,Math.PI*2);ctx.fillStyle='#16836509';ctx.fill();ctx.strokeStyle='#16836588';ctx.lineWidth=1.5;ctx.setLineDash([5,6]);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(r.left+lastPoint.x,r.top+lastPoint.y,3,0,Math.PI*2);ctx.fillStyle='#168365';ctx.fill();}
    if(selected&&R.isGroup(selected)){const b=selected.getBoundingClientRect();ctx.setLineDash([5,5]);ctx.strokeStyle='#168365';ctx.lineWidth=1.5;ctx.strokeRect(b.x-8,b.y-8,b.width+16,b.height+16);ctx.setLineDash([]);}
    if(gesture&&tool==='group'){const path=gesture.path,box=G.envelope(path.map(p=>({...p,w:0,h:0})));ctx.fillStyle='#16836514';ctx.strokeStyle='#168365';ctx.setLineDash([6,4]);ctx.fillRect(r.left+box.x,r.top+box.y,box.w,box.h);ctx.strokeRect(r.left+box.x,r.top+box.y,box.w,box.h);ctx.setLineDash([]);ctx.beginPath();path.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x+r.left,p.y+r.top));ctx.stroke();gesture.all.filter(i=>(gesture.groupIds||[]).includes(i.id)).forEach(i=>ctx.strokeRect(r.left+i.x-5,r.top+i.y-5,i.w+10,i.h+10));}
    if(gesture&&gesture.magnet){const target=gesture.now.find(i=>i.id===gesture.magnet.target);if(target){ctx.fillStyle='#e2b33a20';ctx.strokeStyle='#b18528';ctx.lineWidth=3;ctx.fillRect(r.left+target.x-6,r.top+target.y-6,target.w+12,target.h+12);ctx.strokeRect(r.left+target.x-6,r.top+target.y-6,target.w+12,target.h+12);}}
    if(gesture&&gesture.peel&&!gesture.peeled){ctx.strokeStyle='#b18528';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(r.left+gesture.start.x,r.top+gesture.start.y);ctx.lineTo(r.left+lastPoint.x,r.top+lastPoint.y);ctx.stroke();ctx.setLineDash([]);}
    // the rings ride along with a group that is itself moving, so they stay where the piece's own motion is measured
    if(gesture&&gesture.act){const d=gesture,u=d.up.getBoundingClientRect(),hx=u.left+d.home.x,hy=u.top+d.home.y,back=d.far&&Math.hypot(d.at.x-d.from.x,d.at.y-d.from.y)<=G.ACT.close;
      ctx.beginPath();ctx.arc(hx,hy,G.ACT.reach,0,Math.PI*2);ctx.strokeStyle='#6756d455';ctx.lineWidth=1.5;ctx.setLineDash([5,6]);ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(hx+d.from.x,hy+d.from.y,G.ACT.close,0,Math.PI*2);ctx.fillStyle=back?'#16836566':'#ffffff26';ctx.fill();ctx.strokeStyle='#ffffffcc';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='#168365';ctx.lineWidth=2;ctx.stroke();
      ctx.beginPath();d.samples.forEach((s,i)=>ctx[i?'lineTo':'moveTo'](hx+s.x,hy+s.y));ctx.strokeStyle='#6756d4';ctx.lineWidth=2;ctx.lineCap='round';ctx.stroke();}
    if(gesture&&tool==='flow'){ctx.beginPath();gesture.path.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x+r.left,p.y+r.top));ctx.strokeStyle=gesture.flowValid?'#168365':'#b18528';ctx.lineWidth=3;ctx.lineCap='round';ctx.stroke();}
    if(gesture)gesture.guides.forEach(g=>{ctx.beginPath();ctx.setLineDash([4,4]);if(g.axis==='x'){ctx.moveTo(r.left+g.at,r.top);ctx.lineTo(r.left+g.at,r.bottom);}else{ctx.moveTo(r.left,r.top+g.at);ctx.lineTo(r.right,r.top+g.at);}ctx.strokeStyle='#6756d4aa';ctx.lineWidth=1;ctx.stroke();ctx.setLineDash([]);});}
  function textEditor(el){if(R.isGroup(el)){say('Double-click the words inside the group to edit them.');return;}if(!el){say('Grab a text piece first, or double-click its words.');return;}let target=el;if(el.dataset.kind==='card')target=el.querySelector('h2,p')||el;if(el.tagName==='IMG'){say('Image added. Its filename is used as alternative text.');return;}
    const editor=document.createElement('div');editor.className='clay-inline-editor';editor.innerHTML='<label>Edit these words<textarea aria-label="Edit selected text"></textarea></label><div class="row"><button data-cancel>Cancel</button><button data-save>Keep words</button></div>';shell.appendChild(editor);const input=editor.querySelector('textarea');input.value=target.innerText;input.focus();input.select();
    const close=()=>editor.remove();editor.querySelector('[data-cancel]').onclick=close;editor.querySelector('[data-save]').onclick=()=>{B.text(target,input.value);const unit=R.unit(target);if(R.isGroup(unit)){R.fit(unit);B.save();}close();refresh();say('Words saved. They remain real, selectable text in your exported page.');};input.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape')close();if((e.ctrlKey||e.metaKey)&&e.key==='Enter')editor.querySelector('[data-save]').click();};}
  function add(kind,url,fileName){if(phone){say('Return to Desktop to add a piece.');return;}const before=B.begin(),el=document.createElement(kind==='card'?'article':kind==='button'?'a':kind==='image'?'img':'p');el.id='piece-'+Date.now().toString(36);el.dataset.sculptItem='';el.dataset.kind=kind;el.className='piece '+(kind==='card'?'note leaf':kind==='button'?'join':kind==='text'?'intro':'');
    if(kind==='card')el.innerHTML='<small>A new thought</small><h2>Something good.</h2><p>Double-click these words to make them yours.</p>';else if(kind==='button'){el.textContent='Explore the page';el.href='#story';}else if(kind==='image'){el.src=url;el.alt=fileName||'Added image';}else el.textContent='Start with a little thought.';
    field.appendChild(el);B.register(el,kind);const b=bounds(),p=lastPoint||{x:b.w*.55,y:240};B.write([{el,css:{position:'absolute',left:G.clamp(p.x/b.w*100,2,68)+'%',top:G.clamp(p.y,20,b.h-220)+'px',width:'27%',...(kind==='image'?{height:'190px'}:{})}},mobileRules(el)],'You added a '+kind+' to the page.');B.commit(before,'Added a '+kind+'.');q('.clay-more').hidden=true;q('[data-action=add]').setAttribute('aria-expanded','false');select(el);setTool('hand');say('Added. Grab it anywhere, or double-click its words.');}
  function imageOk(file){if(!file)return false;if(!/^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(file.type)){say('Choose a PNG, JPEG, WebP, GIF, AVIF or SVG image.');return false;}const mb=/svg|gif/.test(file.type)?4:25;if(file.size>mb*1024*1024){say('Choose an image smaller than '+mb+' MB.');return false;}return true;}
  // The one picture a piece shows: the piece itself, or the only picture inside a group.
  function imageOf(el){if(!el||!el.isConnected)return null;if(el.tagName==='IMG')return el;const imgs=el.querySelectorAll('img');return imgs.length===1?imgs[0]:null;}
  function replaceImage(img,file){if(!imageOk(file))return;B.picture(img,file,()=>{q('.clay-more').hidden=true;q('[data-action=add]').setAttribute('aria-expanded','false');select(R.unit(img));say('Picture replaced in the same place and size. Undo brings the old one back.');});}
  // ---- Split drawing: each top-level part of an SVG picture becomes its own picture, in the same place ----
  // The parts stay together as a drawing group, which keeps its shape on a phone; Peel, or Alt-drag, pulls one out.
  function isSvg(img){const s=img&&img.getAttribute('src')||'';return /^data:image\/svg\+xml[,;]/.test(s)||/\.svg([?#]|$)/i.test(s);}
  async function svgText(img){const s=img.getAttribute('src')||'',m=/^data:image\/svg\+xml(;[^,]*)?,([\s\S]*)$/.exec(s);
    if(m)return /;base64/i.test(m[1]||'')?new TextDecoder().decode(Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0))):decodeURIComponent(m[2]);
    const r=await fetch(s);return r.ok?r.text():null;}
  // Nothing in a drawing gets to run: scripts, foreign content, event handlers and script links are dropped first.
  function clean(svg){svg.querySelectorAll('script,foreignObject,iframe').forEach(n=>n.remove());
    [svg,...svg.querySelectorAll('*')].forEach(n=>[...n.attributes].forEach(a=>{if(/^on/i.test(a.name)||/^\s*javascript:/i.test(a.value))n.removeAttribute(a.name);}));return svg;}
  const SHARED=/^(defs|style)$/i,SKIP=/^(defs|style|title|desc|metadata)$/i,KEEP=/^(viewBox|width|height|x|y|id|class|role|preserveAspectRatio|xmlns(:\w+)?)$|^aria-/i;
  function partName(el,n,whole){const t=el.querySelector(':scope > title'),l=el.getAttribute('aria-label')||t&&t.textContent.trim()||el.id.replace(/[-_]+/g,' ').trim();
    return l?l[0].toUpperCase()+l.slice(1):(whole||'Drawing')+', part '+n;}
  async function splitDrawing(img){
    let text=null;try{text=await svgText(img);}catch(err){}
    const svg=text&&new DOMParser().parseFromString(text,'image/svg+xml').documentElement;
    if(!svg||svg.localName!=='svg'||svg.querySelector('parsererror')){say('This picture could not be read as a drawing.');return;}
    clean(svg);const parts=[...svg.children].filter(e=>!SKIP.test(e.localName));
    if(parts.length<2){say('This drawing is one part. Put its shapes in top-level groups, and each group becomes a piece.');return;}
    const v=(svg.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number),vb=v.length===4&&v.every(Number.isFinite)?{x:v[0],y:v[1],w:v[2],h:v[3]}:{x:0,y:0,w:parseFloat(svg.getAttribute('width'))||300,h:parseFloat(svg.getAttribute('height'))||150};
    // measure each part where it really renders, including its transforms and strokes
    const probe=document.importNode(svg,true),hold=document.createElement('div');probe.setAttribute('width',vb.w);probe.setAttribute('height',vb.h);
    hold.style.cssText='position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;contain:strict;width:'+vb.w+'px;height:'+vb.h+'px';hold.appendChild(probe);document.body.appendChild(hold);
    const pr=probe.getBoundingClientRect(),k=vb.w/(pr.width||vb.w),live=[...probe.children].filter(e=>!SKIP.test(e.localName));
    const boxes=live.map(e=>{const r=e.getBoundingClientRect();let pad=1.5;[e,...e.querySelectorAll('*')].forEach(n=>{const s=getComputedStyle(n);if(s.stroke&&s.stroke!=='none')pad=Math.max(pad,parseFloat(s.strokeWidth)/2+1.5);});
      return r.width||r.height?{x:vb.x+(r.left-pr.left)*k-pad,y:vb.y+(r.top-pr.top)*k-pad,w:r.width*k+pad*2,h:r.height*k+pad*2}:null;});
    hold.remove();
    // where the picture's drawing actually sits on the canvas, honouring object-fit
    // measured where it rests: a moving picture is held still for it
    still(true);let at,fit;try{at=R.rect(img);fit=getComputedStyle(img).objectFit;}finally{still(false);}let sx=at.w/vb.w,sy=at.h/vb.h,ox=0,oy=0;
    if(fit==='contain'||fit==='scale-down'||fit==='cover'){const s=fit==='cover'?Math.max(sx,sy):Math.min(sx,sy);ox=(at.w-vb.w*s)/2;oy=(at.h-vb.h*s)/2;sx=sy=s;}
    const shared=[...svg.children].filter(e=>SHARED.test(e.localName)).map(e=>new XMLSerializer().serializeToString(e)).join(''),
      rootAttrs=[...svg.attributes].filter(a=>!KEEP.test(a.name)).map(a=>' '+a.name+'="'+a.value.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"').join('');
    const before=B.begin(),b=bounds(),stamp=Date.now().toString(36),made=[];
    if(R.isGroup(img.parentElement))R.peel(img);
    parts.forEach((part,n)=>{const bx=boxes[n];if(!bx)return;
      const src='<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+[bx.x,bx.y,bx.w,bx.h].map(z=>+z.toFixed(2)).join(' ')+'" width="'+bx.w.toFixed(2)+'" height="'+bx.h.toFixed(2)+'"'+rootAttrs+'>'+shared+new XMLSerializer().serializeToString(part)+'</svg>';
      const el=document.createElement('img');el.id='piece-'+stamp+'-'+(n+1);el.className=img.className;el.dataset.sculptItem='';el.dataset.kind='image';el.alt=partName(part,n+1,img.alt);
      el.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(src);img.before(el);B.register(el,'image');made.push(el);
      const x=at.x+ox+(bx.x-vb.x)*sx,y=at.y+oy+(bx.y-vb.y)*sy;
      B.write([{el,css:{position:'absolute',left:(x/b.w*100).toFixed(4)+'%',top:y.toFixed(2)+'px',width:(bx.w*sx/b.w*100).toFixed(4)+'%',height:(bx.h*sy).toFixed(2)+'px'}},mobileRules(el)]);});
    const was=B.rule(img);B.retain(img);img.remove();
    // the drawing keeps moving the way the picture did
    const g=made.length>1?R.wrap(made,'drawing'):made[0];if(was.animation)B.write([{el:g,css:{animation:was.animation,'--clay-take':was['--clay-take']||null}}]);B.commit(before,'You split a drawing into '+made.length+' pieces.');
    select(g);setTool('peel');say('Split into '+made.length+' pieces, held together as one drawing. Pull any piece out; Grab moves the whole drawing.');refresh();draw();
  }
  // Big photos are scaled down first, the same way Replace image does, so the page still fits in browser storage.
  function readImage(file){if(!imageOk(file))return;B.shrink(file,url=>add('image',url,file.name),()=>say('That image could not be read. Try another file.'));}
  // ---- Links: a button or link goes to another of your pages, a part of this page, or a web address ----
  // A piece with several links (a navigation bar) uses the one last clicked inside it.
  function linksIn(el){return !el||!el.isConnected?[]:el.tagName==='A'?[el]:[...el.querySelectorAll('a')];}
  function linkOf(el){const all=linksIn(el);return all.length===1?all[0]:all.includes(pointed)?pointed:null;}
  const words=(el,n)=>(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,n);
  function pieceName(el){return el.tagName==='IMG'?el.alt||'A picture':words(el.querySelector('h1,h2,h3')||el,48)||el.id;}
  const linkName=a=>words(a.querySelector('h1,h2,h3')||a,40)||'this link';
  // Typed the way people say addresses: a bare name or a home network address gets http, anything else https.
  function webAddress(v){v=v.trim();if(/^(https?:\/\/|mailto:|tel:)\S+$/i.test(v))return v;if(/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(v))return 'mailto:'+v;
    const m=/^([a-z0-9-]+(\.[a-z0-9-]+)*)(:\d{1,5})?([/?#]\S*)?$/i.exec(v);if(!m)return null;
    return (/^\d{1,3}(\.\d{1,3}){3}$/.test(m[1])||!m[2]||/\.(lan|local|home|internal|localhost)$/i.test(m[1])?'http://':'https://')+v;}
  function choice(label,href,where,on){const l=document.createElement('label'),r=document.createElement('input'),s=document.createElement('span');r.type='radio';r.name='to';r.value=href;r.dataset.where=where;r.checked=on;s.textContent=label;l.append(r,s);return l;}
  async function openLink(){const a=linkOf(selected);q('.clay-more').hidden=true;q('[data-action=add]').setAttribute('aria-expanded','false');
    if(!a){const n=linksIn(selected).length;say(n?'This piece has '+n+' links. Click the one you want, then choose Link to….':'Grab a button, or a piece with a link in it, first.');return;}
    const now=a.getAttribute('href')||'',list=q('.clay-link-list'),web=q('.clay-link-web'),groups=[];
    if(B.where==='server'){let pages=[];try{const r=await fetch('/api/pages');if(r.ok)pages=await r.json();}catch(err){}const me=(/^\/p\/([^/]+)\//.exec(location.pathname)||[])[1];
      groups.push(['Your pages',pages.filter(p=>p.name!==me).map(p=>[p.title,'../'+p.name+'/','the page “'+p.title+'”'])]);}
    groups.push(['On this page',[['The top','#'+field.id,'the top of this page']].concat(items().filter(el=>el.id&&!el.contains(a)).map(el=>[pieceName(el),'#'+el.id,'“'+pieceName(el)+'” on this page']))]);
    list.replaceChildren();let found=false;
    groups.forEach(([title,opts])=>{const fs=document.createElement('fieldset'),lg=document.createElement('legend');lg.textContent=title;fs.appendChild(lg);
      if(!opts.length){const p=document.createElement('p');p.textContent='No other pages yet. Make one from ← Pages, then link to it here.';fs.appendChild(p);}
      opts.forEach(([label,href,where])=>{const on=!found&&href===now;found=found||on;fs.appendChild(choice(label,href,where,on));});list.appendChild(fs);});
    const webOn=!found&&!!now&&now[0]!=='#';q('input[name=to][value=web]').checked=webOn;web.value=webOn?now:'';q('.clay-link-error').textContent='';
    q('#clay-link-title').textContent='Where should “'+linkName(a)+'” go?';linking={a,now};linkDialog.returnValue='';linkDialog.showModal();
    const on=linkDialog.querySelector('input[name=to]:checked');if(on&&on.value==='web')web.focus();else if(on)on.focus();}
  ['focus','click','input'].forEach(t=>q('.clay-link-web').addEventListener(t,()=>{q('input[name=to][value=web]').checked=true;}));
  q('.clay-link form').addEventListener('submit',e=>{if(!e.submitter||e.submitter.value!=='ok'||!linking)return;const r=linkDialog.querySelector('input[name=to]:checked'),err=q('.clay-link-error');
    if(!r){e.preventDefault();err.textContent='Choose where it goes.';return;}
    let href=r.value,where=r.dataset.where;if(href==='web'){href=webAddress(q('.clay-link-web').value);where=href;if(!href){e.preventDefault();err.textContent='Type a web address, like https://example.com or 192.168.1.20:8096.';q('.clay-link-web').focus();return;}}
    linking.href=href;linking.where=where;});
  linkDialog.addEventListener('close',()=>{const l=linking;linking=null;if(linkDialog.returnValue!=='ok'||!l||!l.href)return;
    if(l.href===l.now){say('It already goes there.');return;}B.link(l.a,l.href,l.where);select(R.unit(l.a.closest('[data-sculpt-item]')));say('Linked. “'+linkName(l.a)+'” now goes to '+l.where+'. Try it in View site.');});
  function showFormat(f){format=f;qa('[data-format]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.format===f));b.setAttribute('aria-pressed',String(b.dataset.format===f));});q('.clay-dialog textarea').value=f==='html'?exportHTML:f==='css'?B.css():B.agent()+'\n\n# Sticky relationships\n'+R.describe().map(g=>g.id+' ('+g.bond+'): keep '+g.members.join(', ')+' together in this order on small screens.').join('\n');}
  function openExport(){if(gesture)finish(true);B.stopMotion();exportHTML=B.html();showFormat('html');q('.clay-export-state').replaceChildren();dialog.showModal();draw();}
  async function saveExport(){if(exportSaving)return;exportSaving=true;const state=q('.clay-export-state');state.textContent='Saving your standalone page…';q('[data-action=download]').disabled=true;
    try{if(location.protocol==='http:'||location.protocol==='https:'){const response=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html:exportHTML})});if(!response.ok)throw new Error('No local export service');const result=await response.json();state.replaceChildren();const msg=document.createElement('span');msg.textContent='Saved. ';state.appendChild(msg);const preview=document.createElement('a');preview.textContent='Open exported page';preview.href=result.url;preview.target='_blank';preview.rel='noopener';state.appendChild(preview);const dl=document.createElement('a');dl.textContent='Download HTML';dl.href=result.url+'?download=1';dl.download='clay-page.html';state.appendChild(dl);}
      else throw new Error('File mode');
    }catch(err){if(exportURL)URL.revokeObjectURL(exportURL);exportURL=URL.createObjectURL(new Blob([exportHTML],{type:'text/html'}));state.replaceChildren();const dl=document.createElement('a');dl.textContent='Download HTML';dl.href=exportURL;dl.download='clay-page.html';state.appendChild(dl);const msg=document.createElement('span');msg.textContent=' — browser download; no local export server is running.';state.appendChild(msg);}
    finally{exportSaving=false;q('[data-action=download]').disabled=false;}}
  async function action(name){if(name==='undo'||name==='redo'){if(gesture)finish(false);B[name]();B.stopMotion();refresh();say(name==='undo'?'Undone.':'Redone.');return;}
    if(name==='magnets'){magnets=!magnets;q('[data-action=magnets]').setAttribute('aria-pressed',String(magnets));say(magnets?'Small text and buttons attach near cards and pictures. Hold Shift to bypass.':'Magnets off. Pieces remain independent.');}
    if(name==='ungroup'&&selected&&R.isGroup(selected)){const before=B.begin(),all=R.ungroup(selected);B.commit(before,'You released a sticky group.');select(all[0]);setTool('hand');say('Pieces released in place. Undo sticks them back together.');}
    // Scatter has two ways home: on hover, or on scroll. Choosing the other one switches; choosing the same one gathers.
    if((name==='scatter'||name==='assemble')&&selected&&R.isGroup(selected)){const g=selected,want=name==='scatter'?'hover':'scroll',was=R.scattered(g)?'hover':R.arriving(g)?'scroll':'',before=B.begin();
      if(was)R.gather(g);if(was!==want&&!(want==='hover'?R.scatter(g):R.assemble(g))){if(was)B.restore(before);say('Every piece here is the backdrop. '+(want==='hover'?'Scatter':'Assemble on scroll')+' needs smaller pieces.');return;}
      B.commit(before,was===want?'You gathered a group back together.':want==='hover'?'You scattered a group.':'You set a group to assemble as it scrolls into view.');select(g);
      say(was===want?'Gathered. The pieces stay together.':want==='hover'?'Scattered. Hover the group and its pieces come together, in drawing order. Touch screens, phones and reduced motion see it whole.':'Assembles on scroll. As the page scrolls this group into view its pieces fly home, one after another, and scrolling back sends them apart. Phones too; reduced motion sees it whole. Scroll to watch.');}
    if(name==='goo'&&selected&&R.isGroup(selected)){const g=selected,before=B.begin(),on=!/#clay-goo/.test(getComputedStyle(g).filter);B.write([{el:g,css:{filter:on?'url(#clay-goo)':null}}],on?'The pieces in this group melt together where they come close.':'');B.commit(before,on?'You let a group melt together.':'You stopped a group melting.');select(g);
      say(on?'Melting. Pieces that come close run together like liquid; words and pictures stay crisp on top. In Layout tools, give the pieces Drift to watch it move.':'No more goo. The pieces keep their own edges.');}
    if(name==='room'){makeRoom=!makeRoom;q('[data-action=room]').setAttribute('aria-pressed',String(makeRoom));say(makeRoom?'Neighbors will make room. Pinned pieces stay put.':'Overlap is allowed. Place pieces exactly where you want.');}
    if(name==='add'){const menu=q('.clay-more');menu.hidden=!menu.hidden;q('[data-action=add]').setAttribute('aria-expanded',String(!menu.hidden));}
    if(name==='space'){const before=B.begin();B.write([{el:field,css:{height:(field.clientHeight+300)+'px'}}],'You added more room to the canvas.');B.commit(before,'Added more canvas.');q('.clay-more').hidden=true;say('Another 300 pixels of room. Your exported page includes it.');refresh();}
    if(name==='edit')textEditor(selected);if(name==='link')await openLink();
    if(name==='split'){const img=imageOf(selected);q('.clay-more').hidden=true;q('[data-action=add]').setAttribute('aria-expanded','false');if(!isSvg(img)){say('Grab a drawing first: an SVG picture.');return;}await splitDrawing(img);}
    if(name==='replace'){const img=imageOf(selected);if(!img){say('Grab a picture first, then choose Replace image.');return;}fileFor=img;q('.clay-file').click();}
    if(name==='pages'){say('Saving…');B.flush(()=>{location.href=B.pages;});}
    if(name==='export')openExport();if(name==='close-export')dialog.close();if(name==='download')await saveExport();
    if(name==='copy'){try{await navigator.clipboard.writeText(q('.clay-dialog textarea').value);q('.clay-export-state').textContent='Copied '+(format==='agent'?'the change description':format.toUpperCase())+'.';}catch(err){q('.clay-dialog textarea').select();q('.clay-export-state').textContent='Select and copy the source with Ctrl+C.';}}
    if(name==='phone'){if(gesture)finish(false);phone=!phone;B.mobile(phone);B.stopMotion();q('[data-action=phone]').setAttribute('aria-pressed',String(phone));q('[data-action=phone]').textContent=phone?'Desktop':'Phone';qa('[data-tool],[data-action=room],[data-action=add]').forEach(b=>b.disabled=phone);say(phone?'Phone preview: your composition becomes a readable stack. Choose Desktop to sculpt.':tips[tool]);refresh();draw();}
    if(name==='preview'){live=!live;document.documentElement.toggleAttribute('data-sculpting',!live&&!original);q('[data-action=preview]').setAttribute('aria-pressed',String(live));q('[data-action=preview]').textContent=live?'Back to sculpt':'View site';q('.clay-bottom').classList.toggle('clay-hidden',live);refresh();draw();}
    if(name==='original'){if(gesture)finish(false);original=!original;phone=false;live=false;B.mobile(false);B.stopMotion();q('[data-action=phone]').textContent='Phone';q('[data-action=phone]').setAttribute('aria-pressed','false');q('[data-action=preview]').textContent='View site';q('[data-action=preview]').setAttribute('aria-pressed','false');qa('[data-action=phone],[data-action=preview]').forEach(b=>b.disabled=original);B.original(original);document.documentElement.toggleAttribute('data-sculpting',!original);q('[data-action=original]').textContent=original?'Back to sculpt':'Layout tools';q('.clay-bottom').classList.toggle('clay-hidden',original);refresh();draw();}
  }
  qa('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));qa('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));qa('[data-add]').forEach(b=>b.onclick=()=>b.dataset.add==='image'?(fileFor=null,q('.clay-file').click()):add(b.dataset.add));qa('[data-format]').forEach(b=>b.onclick=()=>showFormat(b.dataset.format));
  q('input[type=range]').oninput=e=>{radius=+e.target.value;q('output').textContent=radius;draw();};q('.clay-file').onchange=e=>{const f=e.target.files[0],img=fileFor;fileFor=null;e.target.value='';if(img&&img.isConnected)replaceImage(img,f);else readImage(f);};
  field.addEventListener('pointerdown',e=>{pointed=e.target.closest&&e.target.closest('a');start(e);});handle.addEventListener('pointerdown',e=>start(e,true));window.addEventListener('pointermove',e=>{if(active())move(e);});window.addEventListener('pointerup',e=>{if(gesture&&e.pointerId===gesture.id)finish(true);});window.addEventListener('pointercancel',()=>finish(false));window.addEventListener('blur',()=>{if(gesture)finish(false);});
  field.addEventListener('dblclick',e=>{if(active()&&tool==='hand'){const hit=document.elementFromPoint(e.clientX,e.clientY),piece=hit&&hit.closest('[data-sculpt-item]');if(piece&&field.contains(piece)){e.preventDefault();let t=hit.closest('h1,h2,h3,p,a,button');textEditor(t&&piece.contains(t)?t:piece);}}
    else if(active()&&tool==='act'){const t=tapped,el=t&&performance.now()-t.at<600&&t.el;tapped=null;if(!el||!el.isConnected||!moves(el))return;e.preventDefault();
      if(!B.rule(el).animation){say('Its motion is set in Layout tools, for a screen size or a state. Still it there.');return;}const before=B.begin(),label='You stilled '+actName(el)+'.';B.write([{el,css:{animation:null,'--clay-take':null}}],label);B.commit(before,label);refresh();say('Still. Act it out again whenever you like; Undo brings the motion back.');}});
  field.addEventListener('click',e=>{if(active()){e.preventDefault();e.stopPropagation();}});
  // In View site, a link to another of your pages saves this one first, and the next page opens in View site too.
  field.addEventListener('click',e=>{const a=live&&e.target.closest&&e.target.closest('a[href^="../"]');if(!a||e.defaultPrevented||e.button||e.ctrlKey||e.metaKey||e.shiftKey)return;e.preventDefault();
    try{sessionStorage.setItem('clay-view-site','1');}catch(err){}let gone=false;const go=()=>{if(!gone){gone=true;location.href=a.href;}};B.flush(go);setTimeout(go,1500);});field.addEventListener('dragover',e=>{if(active()){e.preventDefault();e.dataTransfer.dropEffect='copy';}});field.addEventListener('drop',e=>{if(active()){e.preventDefault();lastPoint=point(e);const img=e.target.closest&&e.target.closest('img');if(img&&field.contains(img))replaceImage(img,e.dataTransfer.files[0]);else readImage(e.dataTransfer.files[0]);}});
  window.addEventListener('keydown',e=>{if(original||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable)return;if(dialog.open||linkDialog.open)return;
    if(e.key==='Escape'){if(gesture){e.preventDefault();finish(false);}else{select(null);q('.clay-more').hidden=true;}return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();action(e.shiftKey?'redo':'undo');return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();action('redo');return;}
    if(!active()||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='Delete'&&selected){e.preventDefault();B.remove(selected);select(null);say('Removed. Undo brings it back.');return;}
    if(selected&&/^Arrow/.test(e.key)){e.preventDefault();const before=B.begin(),all=model(),start=all.map(o=>({...o})),i=all.find(i=>i.el===selected);if(i.pin){say('Unpin this piece before moving it.');return;}const n=e.shiftKey?10:2;i.x+=(e.key==='ArrowRight'?n:e.key==='ArrowLeft'?-n:0);i.y+=(e.key==='ArrowDown'?n:e.key==='ArrowUp'?-n:0);G.contain(i,bounds());const moved=settle(all,i.id,G.crowded(start)).items;apply(moved,'You nudged a piece with the keyboard.',false,start);B.commit(before,'Nudged a piece.');refresh();return;}
    if(e.key.toLowerCase()==='k'&&selected){e.preventDefault();action('link');return;}
    const keys={b:'group',g:'hand',u:'push',s:'smooth',f:'flow',p:'paint',n:'pin',r:'grow',a:'act'};if(keys[e.key.toLowerCase()])setTool(keys[e.key.toLowerCase()]);});
  window.addEventListener('resize',()=>{refresh();draw();});window.addEventListener('scroll',()=>{refresh();draw();},{passive:true});
  // On a Clay server, work is saved there and the page list is one click away; otherwise it stays in this browser.
  const SAVED={saving:'Saving to the server…',saved:'Saved on the server. Open this page from any computer on your network.',offline:'Can’t reach the server. Your changes are safe in this tab; it keeps trying.',stale:'This page was changed somewhere else. Reload to see the latest; changes made here since then were not saved.'};
  if(B.where==='server'){q('.clay-pages').hidden=false;q('.clay-site-note').hidden=false;q('.clay-status').textContent='Your work is saved on the server as you go.';}
  window.addEventListener('clay-save',e=>{const d=e.detail,server=d.where==='server';
    q('.clay-status').textContent=server?SAVED[d.state]:d.ok?'Saved in this browser. Export a page to keep a portable copy.':'Browser storage is full or unavailable. Export now to keep these changes.';
    if(server&&(d.state==='offline'||d.state==='stale'))say(SAVED[d.state]);else if(!server&&!d.ok)say('Could not autosave. Use Export to keep your page before closing.');});
  window.addEventListener('error',()=>{if(!seenError){seenError=true;say('Something interrupted the editor. Your last saved work stays here; reload to recover.');}});
  document.documentElement.setAttribute('data-sculpting','');setTool('hand');refresh();
  try{if(sessionStorage.getItem('clay-view-site')){sessionStorage.removeItem('clay-view-site');action('preview');}}catch(err){}
  // Agents reach a page on a Clay server through agent.js, with the same pieces, rules and undo as your hands.
  // A page opened out of sight takes their changes only when it was opened for them (host.js), not for Export site.
  window.ClaySculpt={shell,field,root,R,G,B,q,say,items,bounds,model,mobileRules,select,refresh,webAddress,pieceName,
    busy:()=>gesture?'You are in the middle of a gesture.':dialog.open||linkDialog.open?'A dialog is open in the editor.':phone||root.clientWidth<=767?'The editor is showing the phone layout.':''};
  if(B.where==='server'&&(window===window.top||new URLSearchParams(location.search).has('agent'))){const s=document.createElement('script');s.src='agent.js';s.dataset.clayRuntime='';document.body.appendChild(s);}
})();
