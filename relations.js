/* Persistent, real DOM relationships. Uses Clay's existing transactions. */
(function(){
  'use strict';
  window.ClayRelations=function(B,G,field){
    const isGroup=el=>el&&el.dataset.kind==='group';
    const members=g=>[...g.children].filter(e=>e.hasAttribute('data-sculpt-item'));
    function unit(el){while(el&&el.parentElement!==field)el=el.parentElement;return el&&el.hasAttribute('data-sculpt-item')?el:null;}
    function rect(el){const r=el.getBoundingClientRect(),f=field.getBoundingClientRect();return {el,x:r.x-f.x,y:r.y-f.y,w:r.width,h:r.height};}
    // On a phone a picture fills the column but never grows past its desktop width (w), and sits centred.
    function mobile(el,group=false,w=0){const cap=el.tagName==='IMG'&&w>0;return {el,bp:'mobile',css:{position:'relative',left:'auto',top:'auto',width:'100%','max-width':cap?Math.round(w)+'px':'100%',height:'auto','min-height':'0',margin:cap?'0 auto':'0',...(group?{display:'grid',gap:'16px',padding:'0'}:{})}};}
    function childRule(r,box){return {el:r.el,css:{position:'absolute',left:((r.x-box.x)/box.w*100)+'%',top:((r.y-box.y)/box.h*100)+'%',width:(r.w/box.w*100)+'%',height:r.el.tagName==='IMG'||isGroup(r.el)?r.h+'px':'auto','min-height':r.el.dataset.kind==='card'?r.h+'px':'0'}};}
    function boxRule(el,box){return {el,css:{position:'absolute',left:box.x/field.clientWidth*100+'%',top:box.y+'px',width:box.w/field.clientWidth*100+'%',height:box.h+'px','min-height':'0',padding:'0',margin:'0'}};}
    // A split drawing keeps its composition on a phone: the group scales as one picture instead of stacking its parts.
    function keepShape(g,box,boxes){if(g.dataset.bond!=='drawing')return [];
      return [{el:g,bp:'mobile',css:{display:'block',gap:null,'aspect-ratio':box.w+' / '+box.h}},...boxes.map(r=>{const c=childRule(r,box).css;return {el:r.el,bp:'mobile',css:{position:'absolute',left:c.left,top:c.top,width:c.width,height:'auto','max-width':'none'}};})];}
    function remember(el){B.retain(el);}
    // Flatten merged groups so peeling and responsive reading order stay simple.
    function wrap(units,flavor='group'){
      // a drawing keeps its own order, which is also its stacking order; other groups read top to bottom, left to right
      const ordered=flavor==='drawing'?units.slice():units.slice().sort((a,b)=>{const x=rect(a),y=rect(b);return Math.abs(x.y-y.y)<32?x.x-y.x:x.y-y.y;});const leaves=ordered.flatMap(e=>isGroup(e)?members(e):[e]);if(leaves.length<2)return null;
      const boxes=leaves.map(rect),box=G.envelope(boxes),g=document.createElement('div');
      g.id='bundle-'+crypto.randomUUID().slice(0,8);g.className='piece clay-group group';g.dataset.sculptItem='';g.dataset.kind='group';g.dataset.bond=flavor;
      units.sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
      field.insertBefore(g,units[0]);B.register(g,'group');
      // Preserve each existing unit's member order when merging relationships. A merged group that moved, moves the new one.
      const moved=units.filter(isGroup).map(B.rule).find(r=>r.animation);
      boxes.forEach(r=>{remember(r.el);g.appendChild(r.el);});
      units.filter(isGroup).forEach(e=>{remember(e);e.remove();});
      B.write([boxRule(g,box),mobile(g,true),...boxes.flatMap(r=>[childRule(r,box),mobile(r.el,false,r.w)]),...keepShape(g,box,boxes),...(moved?[{el:g,css:{animation:moved.animation,'--clay-take':moved['--clay-take']||null}}]:[])],flavor==='magnet'?'These pieces are attached and move together.':flavor==='drawing'?'These pieces are one drawing, split into parts.':'These pieces form a sticky group.');
      return g;
    }
    function releaseRule(r){return {el:r.el,css:{position:'absolute',left:r.x/field.clientWidth*100+'%',top:r.y+'px',width:r.w/field.clientWidth*100+'%',height:r.el.tagName==='IMG'?r.h+'px':'auto','min-height':r.el.dataset.kind==='card'?r.h+'px':'0'}};}
    function fit(g){if(!g||!g.isConnected||!isGroup(g))return;const boxes=members(g).map(rect);if(!boxes.length)return;const box=G.envelope(boxes);B.write([boxRule(g,box),...boxes.map(r=>childRule(r,box)),...keepShape(g,box,boxes)]);}
    // A released piece goes back to the ordinary phone layout, whatever group it came from.
    function ungroup(g){const boxes=members(g).map(rect);boxes.forEach(r=>{remember(r.el);field.insertBefore(r.el,g);});remember(g);g.remove();B.write(boxes.flatMap(r=>[releaseRule(r),mobile(r.el,false,r.w)]),'You released the pieces from their group.');return boxes.map(r=>r.el);}
    function peel(el){const g=el.parentElement;if(!isGroup(g))return el;const r=rect(el);remember(el);field.insertBefore(el,g);B.write([releaseRule(r),mobile(el,false,r.w)],'You peeled this piece out of its group.');
      if(members(g).length<2)ungroup(g);else fit(g);return el;}
    function resizeState(g){return {w:g.getBoundingClientRect().width,h:g.getBoundingClientRect().height,leaves:members(g).map(el=>({el,h:el.getBoundingClientRect().height,fonts:[el,...el.querySelectorAll('h1,h2,h3,p,a,small')].map(t=>({el:t,size:parseFloat(getComputedStyle(t).fontSize)}))}))};}
    function resize(g,state,w,h){const ratio=Math.min(w/state.w,h/state.h),rows=[];
      state.leaves.forEach(i=>{rows.push({el:i.el,css:i.el.tagName==='IMG'?{height:i.h*h/state.h+'px'}:i.el.dataset.kind==='card'?{'min-height':i.h*h/state.h+'px'}:{}});i.fonts.forEach(f=>rows.push({el:f.el,css:{'font-size':Math.max(f.el.tagName==='SMALL'?11:14,Math.min(120,f.size*ratio))+'px'}}));});B.write(rows,'You stretched a group together.');fit(g);}
    function minimum(g){const r=g.getBoundingClientRect(),scale=Math.min(1,Math.max(.25,...members(g).map(e=>(e.dataset.kind==='block'?360:e.dataset.kind==='card'?200:e.tagName==='IMG'?100:140)/Math.max(1,e.getBoundingClientRect().width))));return {w:r.width*scale,h:Math.max(60,r.height*scale)};}
    function describe(){return [...field.querySelectorAll(':scope > [data-kind=group]')].map(g=>({id:g.id,bond:g.dataset.bond,members:members(g).map(e=>e.id)}));}
    // Everything here measures pieces where they belong: held, a scattered piece is home and motion pauses.
    const steady=f=>(...a)=>{if(document.documentElement.hasAttribute('data-clay-drag'))return f(...a);B.still(true);try{return f(...a);}finally{B.still(false);}};
    // Scatter: each piece waits a little way out from the group's centre, turned, and comes home in drawing order: on
    // hover, when the pointer reaches the group (with a mouse, on a wide screen); or on scroll, as the page scrolls the
    // group into view, on every screen, and apart again on the way back. A piece that covers half the group or more is
    // its backdrop and stays. The same group always scatters the same way.
    function seeded(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return ()=>{h=Math.imul(h^h>>>15,2246822507)^Math.imul(h^h>>>13,3266489909);return ((h^=h>>>16)>>>0)/4294967296;};}
    function scattered(g){return isGroup(g)&&members(g).some(e=>getComputedStyle(e).getPropertyValue('--clay-scatter').trim());}
    function arriving(g){return isGroup(g)&&members(g).some(e=>B.rule(e)['--clay-arrive']);}
    function throws(g){const box=rect(g),W=field.clientWidth,H=field.clientHeight,c={x:box.x+box.w/2,y:box.y+box.h/2},list=[];
      members(g).map(rect).forEach(p=>{if(p.w*p.h>=box.w*box.h*.5)return;const rnd=seeded(p.el.id||String(list.length)),px=p.x+p.w/2-c.x,py=p.y+p.h/2-c.y;
        const a=(Math.hypot(px,py)<8?rnd()*Math.PI*2:Math.atan2(py,px))+(rnd()-.5)*1.1,d=40+Math.max(box.w,box.h)*(.22+.18*rnd());
        list.push({p,dx:G.clamp(Math.cos(a)*d,8-p.x,W-p.x-p.w-8),dy:G.clamp(Math.sin(a)*d,8-p.y,H-p.y-p.h-8),turn:(rnd()<.5?-1:1)*(6+rnd()*16)});});
      return {box,list};}
    function scatter(g){const {box,list}=throws(g),out={t:0,r:0,b:0,l:0},rows=[];if(!list.length)return false;
      list.forEach(({p,dx,dy,turn},n)=>{const pad=Math.max(p.w,p.h)*.2+16;
        rows.push({el:p.el,css:{'--clay-scatter':'translate('+dx.toFixed(1)+'px, '+dy.toFixed(1)+'px) rotate('+turn.toFixed(1)+'deg)','--clay-wait':(n*.07).toFixed(2)+'s'}},{el:p.el,state:'hover',anchor:g,css:{transform:'none'}});
        out.l=Math.max(out.l,box.x-p.x-dx+pad);out.t=Math.max(out.t,box.y-p.y-dy+pad);out.r=Math.max(out.r,p.x+dx+p.w-box.x-box.w+pad);out.b=Math.max(out.b,p.y+dy+p.h-box.y-box.h+pad);});
      rows.push({el:g,css:{'--clay-reach':[out.t,out.r,out.b,out.l].map(v=>-Math.round(Math.max(0,v))+'px').join(' ')}});
      B.write(rows,'These pieces wait apart, and come together when the pointer reaches them.');return true;}
    // On scroll, each piece's throw is kept as a share of its own size, so a drawing that shrinks on a phone throws in
    // proportion. The group is the view timeline its pieces follow, over its entry: each piece is home a little after the
    // one before, all of them once the whole group is on the screen, which any group can reach, even at the very end of
    // a page.
    function assemble(g){const {list}=throws(g),gid=(g.id||'group').replace(/[^a-z0-9-]/gi,''),n=list.length;if(!n)return false;
      B.write([{el:g,css:{'view-timeline-name':'--clay-in-'+gid}},...list.map(({p,dx,dy,turn},k)=>{const at=Math.round(40*k/Math.max(1,n-1));
        return {el:p.el,css:{'--clay-arrive':[dx/p.w*100,dy/p.h*100,turn].map(v=>+v.toFixed(1)).concat([at,at+60,gid]).join(' ')}};})],'These pieces wait apart, and come together as the page scrolls them into view.');return true;}
    // Gathering puts back the group's own story, and only hover scatter's hover looks are its to clear.
    const BONDS={magnet:'These pieces are attached and move together.',drawing:'These pieces are one drawing, split into parts.'};
    function gather(g){const hover=scattered(g);if(!hover&&!arriving(g))return false;
      B.write([{el:g,css:{'--clay-reach':null,'view-timeline-name':null}},...members(g).flatMap(el=>[{el,css:{'--clay-scatter':null,'--clay-wait':null,'--clay-arrive':null}}].concat(hover?[{el,state:'hover',anchor:g,css:{transform:null}}]:[]))],BONDS[g.dataset.bond]||'These pieces form a sticky group.');return true;}
    // Merged into a new group, a scattered one keeps scattering the same way, all of the new group's pieces.
    function merge(units,flavor){const how=units.filter(isGroup).map(g=>scattered(g)?scatter:arriving(g)?assemble:null).find(Boolean);
      units.filter(isGroup).forEach(gather);const g=wrap(units,flavor);if(g&&how)how(g);return g;}
    return {isGroup,members,unit,rect,wrap:steady(merge),ungroup:steady(g=>{gather(g);return ungroup(g);}),peel:steady(el=>{gather(el.parentElement);return peel(el);}),fit:steady(fit),resizeState:steady(resizeState),resize:steady(resize),minimum:steady(minimum),describe,scatter:steady(scatter),assemble:steady(assemble),gather,scattered,arriving};
  };
})();
