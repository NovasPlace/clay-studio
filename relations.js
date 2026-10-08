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
      // Preserve each existing unit's member order when merging relationships.
      boxes.forEach(r=>{remember(r.el);g.appendChild(r.el);});
      units.filter(isGroup).forEach(e=>{remember(e);e.remove();});
      B.write([boxRule(g,box),mobile(g,true),...boxes.flatMap(r=>[childRule(r,box),mobile(r.el,false,r.w)]),...keepShape(g,box,boxes)],flavor==='magnet'?'These pieces are attached and move together.':flavor==='drawing'?'These pieces are one drawing, split into parts.':'These pieces form a sticky group.');
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
    return {isGroup,members,unit,rect,wrap,ungroup,peel,fit,resizeState,resize,minimum,describe};
  };
})();
