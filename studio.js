/* Clay Studio: arrange a web page by hand and get real layout CSS back.
 * Physics is only how things move while you work. Every drop, stretch and brush stroke is read as ordinary layout and
 * style (grid, flex, gaps, margins, widths, colours) and written as CSS rules. The sculpting extension also saves
 * free placement as percentage left positions and pixel top positions. Edits made while previewing a smaller screen apply from that size down, and export as @media rules. */
(function(){
  'use strict';
  var doc=document,html=doc.documentElement,root=doc.querySelector('[data-studio-root]')||doc.body;
  var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var PX=[0,4,8,12,16,20,24,32,40,48,56,64,80,96,112,128,160];
  var REM=[0,.25,.5,.75,1,1.25,1.5,2,2.5,3,4,5,6];
  var WIDTHS=[320,400,480,560,640,720,768,840,960,1080,1200,1320,1440];
  var TYPE=[12,13,14,15,16,18,20,22,24,28,32,36,40,48,56,64,72,80,96,112,128];
  var LAYOUT=['display','grid-template-columns','flex-direction','flex-wrap','justify-content','align-items','justify-items','gap','row-gap','column-gap'];
  var TEXT=/^(H[1-6]|P|A|SPAN|STRONG|EM|B|I|SMALL|LABEL|BUTTON|BLOCKQUOTE|LI|FIGCAPTION|CITE|Q|TIME)$/;
  var BPS={base:{label:'Desktop',max:null,width:null},tablet:{label:'Tablet',max:1023,width:820},mobile:{label:'Phone',max:767,width:390}};
  var ORDER_BP=['base','tablet','mobile'];
  var SHADOWS={none:'none',soft:'0 6px 20px rgba(20,26,38,.08)',lifted:'0 18px 44px rgba(20,26,38,.18)',glow:'0 0 0 1px rgba(79,124,255,.35), 0 0 28px rgba(79,124,255,.35)'};
  var MATERIALS={
    soft:{label:'Soft',css:{'box-shadow':SHADOWS.soft,'border-radius':'16px'}},
    lifted:{label:'Lifted',css:{'box-shadow':SHADOWS.lifted,'border-radius':'16px'}},
    glow:{label:'Glow',css:{'box-shadow':SHADOWS.glow,'border-radius':'16px'}},
    outline:{label:'Outline',css:{'box-shadow':'none','border-width':'1px','border-style':'solid','border-color':'rgba(20,26,38,.16)'}},
    glass:{label:'Glass',css:{'background-color':'rgba(255,255,255,.55)','background-image':'none','backdrop-filter':'blur(12px)','border-width':'1px','border-style':'solid','border-color':'rgba(255,255,255,.7)','box-shadow':'0 10px 30px rgba(20,26,38,.12)'}},
    flat:{label:'Flat',css:{'box-shadow':'none','border-width':'0'}},
    pill:{label:'Pill',css:{'border-radius':'999px'}}
  };
  // Carve: shapes cut from the element with clip-path, so the box keeps its place in the layout.
  var CARVES={none:{label:'None',css:'none'},circle:{label:'Circle',css:'circle(50% at 50% 50%)'},slant:{label:'Slant',css:'polygon(0 0, 100% 0, 100% 82%, 0 100%)'},
    wave:{label:'Wave',css:'polygon(0 0,100% 0,100% 88%,95% 92%,90% 95%,85% 96%,80% 95%,75% 92%,70% 89%,65% 87%,60% 86%,55% 87%,50% 89%,45% 92%,40% 95%,35% 96%,30% 95%,25% 92%,20% 89%,15% 87%,10% 86%,5% 87%,0 89%)'},
    arch:{label:'Arch',css:'ellipse(75% 100% at 50% 100%)'},ticket:{label:'Ticket',css:'polygon(0 0,100% 0,100% 40%,96% 50%,100% 60%,100% 100%,0 100%,0 60%,4% 50%,0 40%)'}};
  // States: how a thing looks under the pointer, when reached by keyboard, and while pressed. Exported in this order.
  var STATES={hover:{label:'Hover',css:':hover',when:'under the pointer'},focus:{label:'Focus',css:':focus-visible',when:'when reached by keyboard'},active:{label:'Pressed',css:':active',when:'while pressed'}};
  var ORDER_ST=['hover','focus','active'];
  var LIFTS={none:{label:'None',css:null},up2:{label:'2px',css:'translateY(-2px)'},up4:{label:'4px',css:'translateY(-4px)'},up8:{label:'8px',css:'translateY(-8px)'},press:{label:'Press in',css:'translateY(1px) scale(.98)'}};
  function snap(v,scale){var b=scale[0];for(var i=1;i<scale.length;i++)if(Math.abs(scale[i]-v)<Math.abs(b-v))b=scale[i];return b;}
  function hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
  function mk(tag,cls,text){var e=doc.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
  function hex(c){var m=/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c||'');if(!m)return c&&c[0]==='#'?c:'#000000';return '#'+[1,2,3].map(function(i){return ('0'+Math.round(+m[i]).toString(16)).slice(-2);}).join('');}
  function visible(c){return !!c&&c!=='transparent'&&!/rgba\([^)]*,\s*0\)$/.test(c);}
  function round(v){return Math.round(v*100)/100;}

  // Every element gets a stable id; the generated rules live in one stylesheet keyed by those ids, one layer per size.
  // Elements the studio makes or removes stay reachable by id, so undo and redo can put them back.
  var pristine=root.innerHTML,fingerprint=hash(pristine);
  var nextId=1,layers={base:{},tablet:{},mobile:{}},reasons={},bp='base',made={},copyOf={},originNames={},origin=null,edited={},originTexts={},inserted={},imaged={};
  function idOf(el){if(!el.hasAttribute('data-cs'))el.setAttribute('data-cs','e'+(nextId++));return el.getAttribute('data-cs');}
  function byId(id){return doc.querySelector('[data-cs="'+id+'"]')||made[id]||null;}
  // A rule's key is the element's id, with ~hover, ~focus or ~active on the end for how it looks in that state, and
  // @ plus a container's id when it is how it looks while that container is in the state (a card's title on card hover).
  function keyOf(el,st,a){return idOf(el)+(st?'~'+st+(a&&a!==el?'@'+idOf(a):''):'');}
  function split(k){var m=/^([^~]+)(?:~([^@]+)(?:@(.+))?)?$/.exec(k);return [m[1],m[2]||'',m[3]||''];}
  function stateRank(k){var s=split(k)[1];return s?ORDER_ST.indexOf(s)+1:0;}
  function easing(props){return Object.keys(props).filter(function(p){return p!=='background-image';}).map(function(p){return p+' .2s ease';}).join(', ');}
  var sheet=mk('style');sheet.id='clay-studio-css';doc.head.appendChild(sheet);
  var rootStyle=root.getAttribute('style')||'';
  root.style.containerType='inline-size';root.style.containerName='clay-page';
  function decls(r,imp){return Object.keys(r).map(function(k){return k+':'+r[k]+(imp?' !important':'');}).join(';');}
  var hush=false; // a drag preview re-renders often; the change count waits for the drop
  var dress='',anchor=null; // the state being styled ('', 'hover', 'focus' or 'active'), and the thing whose state it is
  // The key for a thing in the state being styled: inside the thing whose state it is, it's a look on that thing's state.
  function dkey(el){return keyOf(el,dress,dress&&anchor&&anchor!==el&&anchor.contains(el)?anchor:null);}
  function render(){
    var out=[],ease={};
    ORDER_BP.forEach(function(L){
      var body=Object.keys(layers[L]).sort(function(a,b){return stateRank(a)-stateRank(b);}).map(function(k){
        var d=decls(layers[L][k],true),p=split(k),at='[data-cs="'+p[0]+'"]';if(!d)return '';if(!p[1])return at+'{'+d+'}';
        Object.keys(layers[L][k]).forEach(function(prop){(ease[p[0]]=ease[p[0]]||{})[prop]=1;});
        // forced on while it is being styled, and the real thing once the studio is hidden
        var whose=p[2]?'[data-cs="'+p[2]+'"]':at,inner=p[2]?' '+at:'';
        return 'html[data-clay-state~="'+p[1]+'"] '+whose+inner+',html:not([data-clay-on]) '+whose+STATES[p[1]].css+inner+'{'+d+'}';
      }).filter(Boolean).join('\n');
      if(body)out.push(L==='base'?body:'@container clay-page (max-width: '+BPS[L].max+'px){\n'+body+'\n}');
    });
    // states ease in on the live page; in the studio they snap, so what the inspector reads is never mid-way
    Object.keys(ease).forEach(function(id){var e=easing(ease[id]);if(e)out.unshift('html:not([data-clay-on]) [data-cs="'+id+'"]{transition:'+e+' !important}');});
    sheet.textContent=out.join('\n');cache=null;if(!hush)badge();
  }
  function setRule(el,props,L,key){
    L=L||bp;var id=key||idOf(el),r=layers[L][id]||(layers[L][id]={});
    Object.keys(props).forEach(function(k){if(props[k]===null||props[k]===undefined)delete r[k];else r[k]=props[k];});
    if(!Object.keys(r).length)delete layers[L][id];render();
  }
  function ruleOf(el,L){return layers[L||bp][idOf(el)]||{};}
  // At a smaller size, only write what differs from what the larger sizes already say.
  function inherited(el,k){var v;for(var i=0;i<ORDER_BP.length&&ORDER_BP[i]!==bp;i++){var r=layers[ORDER_BP[i]][dkey(el)];if(r&&k in r)v=r[k];}return v;}
  // What the rules say about a property at this size, in the state being styled.
  function said(el,k){var v;for(var i=0;i<=ORDER_BP.indexOf(bp);i++){var r=layers[ORDER_BP[i]][dkey(el)];if(r&&k in r)v=r[k];}return v;}
  function setOwn(el,props){if(bp==='base'){setRule(el,props,null,dkey(el));return;}var p={};Object.keys(props).forEach(function(k){var v=props[k];p[k]=v!==null&&v===inherited(el,k)?null:v;});setRule(el,p,null,dkey(el));}
  // Reasons build up per element (the last few, no repeats), so a rule's comment tells its whole story.
  function because(el,why){if(!why)return;lastWhy=why;var k=bp+':'+dkey(el),list=(reasons[k]||'').split(/(?<=\.) /).filter(Boolean).filter(function(r){return r!==why;});list.push(why);reasons[k]=list.slice(-3).join(' ');}

  // Names people can read, and selectors that point at the element in the page's own terms.
  function nameOf(el){
    if(!el)return '?';var s=el.tagName.toLowerCase()+(el.id?'#'+el.id:el.classList[0]?'.'+el.classList[0]:'');
    // a list of like things (cards, sections) is named for what it is, not for its first item's title
    var ks=kids(el),like=ks.length>=2&&ks.filter(function(k){return k.tagName===ks[0].tagName;}).length>=ks.length*.6;
    var big=el===root||el===doc.body||like||el.classList.contains('group');
    var h=el.matches('h1,h2,h3,h4,h5,h6,p,a,blockquote,button')?el:big?null:el.querySelector('h1,h2,h3,h4,h5,h6');
    var t=h?h.textContent.trim().replace(/\s+/g,' '):'';
    var id=el.getAttribute('data-cs');
    return (t?s+' “'+(t.length>24?t.slice(0,23)+'…':t)+'”':s)+(id&&copyOf[id]?' (copy)':'');
  }
  function selectorOf(el){
    if(el.id)return '#'+CSS.escape(el.id);
    var tag=el.tagName.toLowerCase();
    for(var i=0;i<el.classList.length;i++){var c='.'+CSS.escape(el.classList[i]);if(doc.querySelectorAll(c).length===1)return c;if(doc.querySelectorAll(tag+c).length===1)return tag+c;}
    var p=el.parentElement;if(!p||p===html||p===doc.body)return tag;
    var ps=selectorOf(p);if(doc.querySelectorAll(ps+' > '+tag).length===1)return ps+' > '+tag;
    return ps+' > '+tag+':nth-child('+(Array.prototype.indexOf.call(p.children,el)+1)+')';
  }
  // A state as CSS: the thing's own selector with the state on the end, or its container's state and then the thing,
  // named the shortest way that finds only it inside that container.
  function stateSel(el,st,a){
    if(!a||a===el)return selectorOf(el)+STATES[st].css;
    var t=el.tagName.toLowerCase(),c=[];for(var i=0;i<el.classList.length;i++)c.push('.'+CSS.escape(el.classList[i]),t+'.'+CSS.escape(el.classList[i]));c.push(t);
    for(var j=0;j<c.length;j++){var m=a.querySelectorAll(c[j]);if(m.length===1&&m[0]===el)return selectorOf(a)+STATES[st].css+' '+c[j];}
    return selectorOf(a)+STATES[st].css+' '+selectorOf(el);
  }

  // What can be arranged: block-level children of any element inside the root.
  var host=null,cache=null;
  function ours(el){return el===host||el===sheet||/^(SCRIPT|STYLE|TEMPLATE)$/.test(el.tagName);}
  function isBlock(el){var d=getComputedStyle(el).display;return d!=='inline'&&d!=='none'&&d!=='contents';}
  function kids(c){return Array.prototype.filter.call(c.children,function(k){return !ours(k)&&isBlock(k)&&k.getBoundingClientRect().height>0;});}
  function inRoot(el){return !!el&&(el===root||root.contains(el));}
  function boxy(el){var cs=getComputedStyle(el);return visible(cs.backgroundColor)||cs.boxShadow!=='none'||parseFloat(cs.borderTopWidth)>0;}
  function containers(){if(!cache)cache=[root].concat(Array.prototype.slice.call(root.querySelectorAll('*'))).filter(function(c){return !ours(c)&&kids(c).length>=2;});return cache;}
  // Pressing on text inside a box (a card) takes the box; once that box or something in it is selected, it takes the text
  // inside it. A button is a box of its own, so it's always taken itself. Otherwise the deepest block under the pointer.
  // Alt takes the deepest.
  function pickItem(el,deep){
    var ch=[];for(var a=el;a&&a!==root&&inRoot(a);a=a.parentElement)if(isBlock(a))ch.push(a);
    if(!ch.length)return null;if(deep)return ch[0];
    if(TEXT.test(ch[0].tagName)&&!boxy(ch[0]))for(var i=1;i<ch.length;i++){if(ch[i].parentElement===root)break;if(boxy(ch[i]))return selected&&ch[i].contains(selected)?ch[0]:ch[i];}
    return ch[0];
  }
  function flowing(el){return /grid|flex/.test(getComputedStyle(el).display);}
  // Things placed by position (a free canvas, like Sculpt's) stay where they were put: layout can style them, not arrange them.
  function placed(el){var p=getComputedStyle(el).position;return p==='absolute'||p==='fixed';}
  function freeCanvas(c){var ks=kids(c);return ks.length>0&&ks.every(placed);}
  function stays(list){if(!list.some(placed))return false;say('That piece is placed by position, so arranging leaves it where it is. You can still select and style it.');return true;}
  function textish(el){return TEXT.test(el.tagName)||!kids(el).length&&!!el.textContent.trim();}
  function textTarget(t){for(var a=t;a&&inRoot(a)&&a!==root;a=a.parentElement)if(textish(a)&&isBlock(a))return a;return null;}
  // A command about layout aimed at one of several like things (a card among cards) means the list they are in;
  // aimed at a box of other things, it means that box.
  function container(el){
    if(!el)return null;var P=el.parentElement;
    if(P&&P!==root&&inRoot(P)){var ks=kids(P);if(ks.length>=2&&ks.filter(function(k){return k.tagName===el.tagName&&k.className===el.className;}).length>=2)return P;}
    return kids(el).length>=2?el:P&&inRoot(P)?P:el;
  }

  // Motion: a spring per moving element, drawn with translate from the top-left corner.
  var motions=new Map(),raf=0,last=0;
  function motion(el){var m=motions.get(el);if(!m){m={x:0,y:0,sx:1,sy:1,vx:0,vy:0,vsx:0,vsy:0,tx:0,ty:0,tsx:1,tsy:1,held:false};motions.set(el,m);el.style.transformOrigin='0 0';}return m;}
  function draw(el,m){el.style.translate=m.x.toFixed(1)+'px '+m.y.toFixed(1)+'px';el.style.scale=m.sx.toFixed(4)+' '+m.sy.toFixed(4);}
  function tick(now){
    var dt=Math.min(.033,Math.max(.001,(now-last)/1000));last=now;var K=240,D=21;
    motions.forEach(function(m,el){
      m.vx+=(K*(m.tx-m.x)-D*m.vx)*dt;m.vy+=(K*(m.ty-m.y)-D*m.vy)*dt;m.vsx+=(K*(m.tsx-m.sx)-D*m.vsx)*dt;m.vsy+=(K*(m.tsy-m.sy)-D*m.vsy)*dt;
      m.x+=m.vx*dt;m.y+=m.vy*dt;m.sx+=m.vsx*dt;m.sy+=m.vsy*dt;
      if(!m.held&&!m.tx&&!m.ty&&Math.abs(m.x)+Math.abs(m.y)<.3&&Math.abs(m.vx)+Math.abs(m.vy)<4&&Math.abs(m.sx-1)+Math.abs(m.sy-1)<.002){
        el.style.translate=el.style.scale=el.style.transformOrigin='';motions.delete(el);return;}
      draw(el,m);
    });
    raf=motions.size?requestAnimationFrame(tick):0;
    if(!raf)refreshSel();
  }
  function go(){if(!raf){last=performance.now();raf=requestAnimationFrame(tick);}}
  // Where an element sits in the layout, without any motion applied.
  function layoutRect(el){
    var r=el.getBoundingClientRect(),m=motions.get(el);
    var x=m?r.left-m.x:r.left,y=m?r.top-m.y:r.top,w=m?r.width/m.sx:r.width,h=m?r.height/m.sy:r.height;
    return {left:x,top:y,width:w,height:h,right:x+w,bottom:y+h};
  }
  // FLIP: note where things are, change the layout, then spring each thing from where it was to where it now belongs.
  // Only positions travel (sizes change at once, so text never squashes). A container and its children never both move:
  // normally the innermost things travel; for a whole-page change ('outer') the outermost do.
  function flip(els,mutate,drop,outer){
    els=els.filter(function(e,i){return e&&els.indexOf(e)===i;});
    els=els.filter(function(e){return !els.some(function(o){return o!==e&&(outer?o.contains(e):e.contains(o));});});
    var first=new Map();els.forEach(function(e){first.set(e,drop&&drop.el===e?drop.rect:e.getBoundingClientRect());});
    mutate();
    els.forEach(function(e){e.style.translate=e.style.scale='';});
    if(reduced){els.forEach(function(e){motions.delete(e);e.style.transformOrigin='';});refreshSel();return;}
    var lastR=new Map();els.forEach(function(e){lastR.set(e,e.getBoundingClientRect());});
    els.forEach(function(e){
      var a=first.get(e),b=lastR.get(e);if(!b.width||!b.height||!e.isConnected||!a.width)return;var m=motion(e);
      m.x=a.left-b.left;m.y=a.top-b.top;m.sx=m.sy=1;m.vsx=m.vsy=0;m.tx=m.ty=0;m.tsx=m.tsy=1;m.held=false;draw(e,m);
    });
    go();
  }

  // Reading an arrangement: things share a row when they overlap vertically but sit beside each other, not on top of
  // each other. Something dropped across a full-width block is going between blocks, not next to one.
  function beside(a,b){var ov=Math.min(a.right,b.right)-Math.max(a.left,b.left);return ov<.3*Math.min(a.right-a.left,b.right-b.left);}
  function rows(items,rectOf){
    var list=items.map(function(k){return {k:k,r:rectOf(k)};}).sort(function(a,b){return (a.r.top+a.r.height/2)-(b.r.top+b.r.height/2);}),out=[];
    list.forEach(function(it){
      var r=it.r,row=null;
      for(var i=0;i<out.length;i++){var b=out[i].box,ov=Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top);
        if(ov>.5*Math.min(b.bottom-b.top,r.height)&&out[i].list.every(function(o){return beside(o.r,r);})){row=out[i];break;}}
      if(row){row.list.push(it);var b2=row.box;row.box={top:Math.min(b2.top,r.top),bottom:Math.max(b2.bottom,r.bottom),left:Math.min(b2.left,r.left),right:Math.max(b2.right,r.right)};}
      else out.push({list:[it],box:{top:r.top,bottom:r.bottom,left:r.left,right:r.right}});
    });
    out.sort(function(a,b){return a.box.top-b.box.top;});
    out.forEach(function(row){row.list.sort(function(a,b){return a.r.left-b.r.left;});row.items=row.list.map(function(x){return x.k;});});
    return out;
  }
  // From rows to layout: how many across, and the gaps where the dropped item landed.
  function infer(c,rs,el,rectOf,measure,why,gapsOf){
    var n=0,cols=0;rs.forEach(function(r){n+=r.items.length;cols=Math.max(cols,r.items.length);});
    var g0=gapsOf?gapsOf(c):null,cs=g0?null:getComputedStyle(c),oldCol=g0?g0.col:parseFloat(cs.columnGap)||0,oldRow=g0?g0.row:parseFloat(cs.rowGap)||0,colGap=null,rowGap=null,r=rectOf(el);
    if(measure!==false)rs.forEach(function(row,ri){
      var i=row.items.indexOf(el);if(i<0)return;
      var g=[];if(row.items[i-1])g.push(r.left-rectOf(row.items[i-1]).right);if(row.items[i+1])g.push(rectOf(row.items[i+1]).left-r.right);
      g=g.filter(function(v){return v>0;});if(g.length)colGap=Math.min.apply(null,g);
      var v=[];if(row.items.length===1){if(rs[ri-1])v.push(r.top-rs[ri-1].box.bottom);if(rs[ri+1])v.push(rs[ri+1].box.top-r.bottom);}
      v=v.filter(function(x){return x>0;});if(v.length)rowGap=Math.min.apply(null,v);
    });
    colGap=snap(Math.max(8,colGap!==null?colGap:(oldCol||24)),PX);
    rowGap=snap(Math.min(96,Math.max(8,rowGap!==null?rowGap:(oldRow||colGap))),PX);
    var single=rs.length===1,reason=why?why:cols===1?'You stacked them.':single?'You lined up '+n+' side by side.':'You arranged them '+cols+' across in '+rs.length+' rows.';
    var kinds=cols===1?['stack','grid-1']:single?['grid-auto','flex-row','grid-fixed','flex-wrap']:['grid-auto','grid-fixed','flex-wrap'];
    return {c:c,cols:cols,n:n,colGap:colGap,rowGap:rowGap,reason:reason,kinds:kinds,i:0,kind:kinds[0]};
  }
  function describe(ctx){
    var g=ctx.colGap,rg=ctx.rowGap;
    return {
      'grid-auto':'Grid · '+ctx.cols+' across here, fewer on small screens · '+g+'px gap',
      'grid-fixed':'Grid · always '+ctx.cols+' columns · '+g+'px gap',
      'flex-row':'Row · items share the width · '+g+'px gap',
      'flex-wrap':'Wrapping row · centered · '+g+'px gap',
      'stack':'Stack · '+rg+'px apart',
      'grid-1':'Single column grid · '+rg+'px apart'
    }[ctx.kind];
  }
  function autoMin(c,cols,g){
    // A column minimum that gives exactly this many across at today's width, and fewer when the space shrinks.
    var cs=getComputedStyle(c),inner=c.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
    var hi=(inner+g)/cols-g,lo=(inner+g)/(cols+1)-g;return Math.max(Math.ceil(lo+1),Math.min(Math.floor(hi),Math.floor(hi*.9/10)*10));
  }
  function applyLayout(ctx,kind){
    var c=ctx.c,clear={};LAYOUT.forEach(function(k){clear[k]=null;});setRule(c,clear);
    var g=ctx.colGap,rg=ctx.rowGap,css;
    if(kind==='grid-auto')css={display:'grid','grid-template-columns':'repeat(auto-fit, minmax(min(100%, '+autoMin(c,ctx.cols,g)+'px), 1fr))','column-gap':g+'px','row-gap':rg+'px'};
    else if(kind==='grid-fixed')css={display:'grid','grid-template-columns':'repeat('+ctx.cols+', 1fr)','column-gap':g+'px','row-gap':rg+'px'};
    else if(kind==='flex-row')css={display:'flex','flex-direction':'row','flex-wrap':'nowrap','align-items':'stretch','column-gap':g+'px'};
    else if(kind==='flex-wrap')css={display:'flex','flex-wrap':'wrap','justify-content':'center','column-gap':g+'px','row-gap':rg+'px'};
    else if(kind==='grid-1')css={display:'grid','grid-template-columns':'1fr','row-gap':rg+'px'};
    else css={display:'flex','flex-direction':'column','row-gap':rg+'px'};
    setRule(c,css);
    // The layout owns the spacing now, so the children's own margins step aside.
    kids(c).forEach(function(k){setOwn(k,{margin:'0',flex:kind==='flex-row'?'1 1 0':null,'min-width':kind==='flex-row'?'0':null});});
    because(c,ctx.reason);ctx.kind=kind;
  }
  function layoutTo(c,kind,cols){
    if(!c||dressed()||freeCanvas(c)&&stays(kids(c)))return;var cs=getComputedStyle(c),g=snap(Math.max(8,parseFloat(cs.columnGap)||parseFloat(cs.rowGap)||24),PX);
    var ctx={c:c,cols:cols||Math.max(1,rows(kids(c),layoutRect).reduce(function(m,r){return Math.max(m,r.items.length);},0)),colGap:g,rowGap:g,kinds:[kind],i:0,reason:''};
    ctx.reason='You made '+nameOf(c)+' '+(kind==='grid-auto'?'a responsive grid, '+ctx.cols+' across':kind==='grid-fixed'?'a '+ctx.cols+'-column grid':kind.replace('-',' '))+'.';
    act(function(){flip(kids(c),function(){applyLayout(ctx,kind);});});showLayout(ctx);
  }

  // History: every change is one undo. A snapshot is every layer of rules plus every container's children, in order.
  var undo=[],redo=[],lastWhy='',openStep=null,pool={},epoch=0;
  function capture(){var m={};[root].concat(Array.prototype.slice.call(root.querySelectorAll('*'))).forEach(function(c){if(c.children.length&&!ours(c))m[idOf(c)]=Array.prototype.map.call(c.children,idOf);});return m;}
  // Taking a snapshot starts a new action, so the reason heard from here on is that action's label in the history.
  function snapshot(){var texts={},srcs={};Object.keys(edited).forEach(function(id){var e=byId(id);if(e)texts[id]=e.innerHTML;});
    Object.keys(imaged).forEach(function(id){var e=byId(id);if(e)srcs[id]=e.getAttribute('src');});lastWhy='';
    return {layers:JSON.parse(JSON.stringify(layers)),reasons:Object.assign({},reasons),orders:capture(),copyOf:Object.assign({},copyOf),texts:texts,srcs:srcs,
      epoch:epoch,html:pooled(),edited:Object.assign({},edited),inserted:JSON.parse(JSON.stringify(inserted)),imaged:JSON.parse(JSON.stringify(imaged))};}
  function allItems(){var items=[];containers().forEach(function(c){items=items.concat(kids(c));});return items;}
  function restore(s){
    if(!s.orders||s.epoch!==epoch){restoreMarkup(s);return;}
    flip(allItems(),function(){
      var keep={};Object.keys(s.orders).forEach(function(cid){keep[cid]=true;s.orders[cid].forEach(function(id){keep[id]=true;});});
      Object.keys(s.orders).forEach(function(cid){var c=byId(cid);if(!c)return;if(!c.isConnected)made[cid]=c;var current=Array.prototype.map.call(c.children,idOf);if(JSON.stringify(current)===JSON.stringify(s.orders[cid]))return;s.orders[cid].forEach(function(id){var k=byId(id);if(k)c.appendChild(k);});});
      // things the studio made after this snapshot leave; things it removed come back through the orders above
      Object.keys(made).forEach(function(id){var el=made[id];if(el.isConnected&&!keep[id]){el.remove();}});
      if(s.srcs)Object.keys(s.srcs).forEach(function(id){var e=byId(id);if(e&&e.getAttribute('src')!==s.srcs[id])e.setAttribute('src',s.srcs[id]);});
      if(s.texts)Object.keys(s.texts).forEach(function(id){var e=byId(id);if(e&&e.innerHTML!==s.texts[id])e.innerHTML=s.texts[id];});
      layers=JSON.parse(JSON.stringify(s.layers));reasons=Object.assign({},s.reasons);copyOf=Object.assign({},s.copyOf||{});render();
    });
  }
  // Every step also keeps the page as markup, with pictures stored once in a pool, so history outlives a reload.
  // A step from before a reload, or from before the page was last rebuilt this way, comes back from that markup. The
  // root keeps its own top-level elements and only refills them, so anything holding on to them stays connected.
  var inert=doc.implementation.createHTMLDocument('');
  function pooled(){var c=cleanCopy(inert.importNode(root,true));
    c.querySelectorAll('[src^="data:"],image[href^="data:"]').forEach(function(n){var a=n.hasAttribute('src')?'src':'href',v=n.getAttribute(a),k=hash(v)+'-'+v.length;pool[k]=v;n.setAttribute(a,'clay-pool:'+k);});
    return c.innerHTML;}
  function unpooled(h){return h.replace(/clay-pool:([0-9a-z]+-\d+)/g,function(m,k){return pool[k]||m;});}
  function restoreMarkup(s){
    var t=doc.createElement('template'),tops={};t.innerHTML=unpooled(s.html);
    Array.prototype.forEach.call(root.children,function(c){var id=c.getAttribute('data-cs');if(id)tops[id]=c;});
    var next=Array.prototype.map.call(t.content.childNodes,function(n){var old=n.nodeType===1&&tops[n.getAttribute('data-cs')];if(!old)return n;
      Array.prototype.slice.call(old.attributes).forEach(function(a){if(!n.hasAttribute(a.name))old.removeAttribute(a.name);});
      Array.prototype.forEach.call(n.attributes,function(a){old.setAttribute(a.name,a.value);});
      old.replaceChildren.apply(old,Array.prototype.slice.call(n.childNodes));return old;});
    root.replaceChildren.apply(root,next);
    layers=JSON.parse(JSON.stringify(s.layers));reasons=Object.assign({},s.reasons);copyOf=Object.assign({},s.copyOf||{});
    if(s.edited)edited=Object.assign({},s.edited);if(s.inserted)inserted=JSON.parse(JSON.stringify(s.inserted));if(s.imaged)imaged=JSON.parse(JSON.stringify(s.imaged));
    motions.forEach(function(m,e){if(!e.isConnected)motions.delete(e);});epoch++;render();
  }
  // Each step is labelled with its reason, or with the first thing said about it right after.
  function commit(before){before.label=lastWhy;lastWhy='';openStep=before;setTimeout(function(){if(openStep===before)openStep=null;},0);undo.push(before);if(undo.length>100)undo.shift();redo.length=0;buttons();save();}
  // One action, one undo: take the snapshot, do the thing, keep the snapshot.
  function act(fn){var before=snapshot();fn();commit(before);}
  function back(){if(!undo.length)return;if(playing)togglePlay(false,true);var s=undo.pop(),now=snapshot();now.prevLabel=s.label;redo.push(now);restore(s);hidePill();select(null);buttons();save();}
  function forward(){if(!redo.length)return;if(playing)togglePlay(false,true);var s=redo.pop(),now=snapshot();now.label=s.prevLabel;undo.push(now);restore(s);hidePill();select(null);buttons();save();}

  // Autosave: the page as you left it comes back after a reload, as long as the page itself hasn't changed underneath.
  var KEY='clay-studio:'+location.pathname;
  function cleanCopy(node){
    [node].concat(Array.prototype.slice.call(node.querySelectorAll('*'))).forEach(function(e){if(!e.style)return;e.style.translate=e.style.scale=e.style.rotate=e.style.transformOrigin='';if(!e.getAttribute('style'))e.removeAttribute('style');});
    return node;
  }
  function save(){
    try{var c=cleanCopy(root.cloneNode(true));localStorage.setItem(KEY,JSON.stringify({v:1,fp:fingerprint,html:c.innerHTML,layers:layers,reasons:reasons,nextId:nextId,origin:origin,names:originNames,copyOf:copyOf,edited:edited,texts0:originTexts,inserted:inserted,imaged:imaged}));window.dispatchEvent(new CustomEvent('clay-save',{detail:{ok:true}}));}catch(e){window.dispatchEvent(new CustomEvent('clay-save',{detail:{ok:false}}));}
    clearTimeout(saveSteps.t);saveSteps.t=setTimeout(saveSteps,300);
  }
  var restored=false;
  (function(){
    try{var s=JSON.parse(localStorage.getItem(KEY)||'null');if(!s||s.v!==1||s.fp!==fingerprint)return;
      root.innerHTML=s.html;nextId=s.nextId;layers=s.layers;reasons=s.reasons||{};origin=s.origin;originNames=s.names||{};copyOf=s.copyOf||{};edited=s.edited||{};originTexts=s.texts0||{};inserted=s.inserted||{};imaged=s.imaged||{};restored=true;
      var h=JSON.parse(localStorage.getItem(KEY+':steps')||'null');if(h&&h.fp===fingerprint){Object.assign(pool,h.pool||{});undo=h.undo||[];redo=h.redo||[];}}catch(e){}
  })();
  function resetPage(){try{localStorage.removeItem(KEY);localStorage.removeItem(KEY+':steps');}catch(e){}location.reload();}
  // The steps go under their own key, fewer of them until they fit, so the page itself always saves.
  function saveSteps(){clearTimeout(saveSteps.t);saveSteps.t=0;try{for(var n=40;;n=Math.floor(n/2)){try{localStorage.setItem(KEY+':steps',steps(n));return;}catch(e){if(!n){localStorage.removeItem(KEY+':steps');return;}}}}catch(e){}}
  function steps(n){var used={},keep=function(s){(s.html.match(/clay-pool:[0-9a-z]+-\d+/g)||[]).forEach(function(m){used[m.slice(10)]=pool[m.slice(10)];});
      return {label:s.label,prevLabel:s.prevLabel,html:s.html,layers:s.layers,reasons:s.reasons,copyOf:s.copyOf,edited:s.edited,inserted:s.inserted,imaged:s.imaged};};
    var o={fp:fingerprint,undo:n?undo.slice(-n).map(keep):[],redo:n?redo.slice(-n).map(keep):[]};o.pool=used;return JSON.stringify(o);}
  addEventListener('pagehide',function(){if(saveSteps.t)saveSteps();});

  // ---- The studio's own UI: one shadow root on <html>. ----
  host=mk('clay-studio');host.style.cssText='all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647';html.appendChild(host);
  var sh=host.attachShadow({mode:'open'});
  var CSSUI=[
    ':host{all:initial}*{box-sizing:border-box;font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}',
    'button{font:inherit}',
    '.box{position:fixed;left:0;top:0;pointer-events:none;border-radius:8px;display:none}',
    '.hover{border:2px solid #4f7cff;background:rgba(79,124,255,.05);transition:transform .08s ease-out,width .08s ease-out,height .08s ease-out}',
    '.sels .box{display:block;border:2px solid #4f7cff;box-shadow:0 0 0 4px rgba(79,124,255,.18)}',
    '.target{border:2px dashed #16a37f;background:rgba(22,163,127,.05)}',
    '.ghost{border:2px solid rgba(22,163,127,.75);border-radius:10px;background:repeating-linear-gradient(45deg,rgba(22,163,127,.16) 0 8px,rgba(22,163,127,.06) 8px 16px)}',
    '.slot{background:#16a37f;border-radius:4px;box-shadow:0 0 12px rgba(22,163,127,.8)}',
    '.lasso{border:1.5px dashed #4f7cff;background:rgba(79,124,255,.08);border-radius:4px}',
    '.band{background:repeating-linear-gradient(45deg,rgba(255,92,138,.35) 0 6px,rgba(255,92,138,.15) 6px 12px);border:1px solid #ff5c8a;border-radius:4px}',
    '.edge{background:#ff5c8a;border-radius:3px}',
    '.tag{position:fixed;left:0;top:0;display:none;pointer-events:none;padding:3px 8px;border-radius:6px;background:#4f7cff;color:#fff;font-weight:600;font-size:12px;white-space:nowrap}',
    '.pill{position:fixed;left:0;top:0;display:none;max-width:min(560px,calc(100vw - 24px));padding:10px 14px;border-radius:14px;background:#141a26;color:#eef2fb;box-shadow:0 12px 34px rgba(0,0,0,.3)}',
    '.pill .why{color:#9fb0cc;font-size:12px;margin-bottom:2px}.pill .what{font-weight:600}.pill .more{color:#7fd1ae;font-size:12px;margin-top:4px}',
    '.pill .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.pill .acts:empty{display:none}',
    '.btn{border:0;cursor:pointer;border-radius:9px;padding:6px 10px;font-weight:600;font-size:12px;color:#eef2fb;background:rgba(255,255,255,.08)}',
    '.btn:hover{background:rgba(255,255,255,.16)}.btn[aria-pressed=true]{background:#4f7cff;color:#fff}.btn.lit{background:#16a37f}.btn.warn:hover{background:#c43b5c}',
    '.dock{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;padding:7px;border-radius:18px;background:#141a26;box-shadow:0 14px 40px rgba(0,0,0,.35);color:#eef2fb;white-space:nowrap;width:max-content;max-width:calc(100vw - 16px)}',
    '.dock .brand{display:flex;align-items:center;gap:7px;font-weight:800;letter-spacing:.06em;padding:0 6px 0 4px;color:#fff}',
    '.dock .brand i{width:18px;height:18px;border-radius:6px;background:linear-gradient(135deg,#ffcc4d,#ff5c8a 55%,#4f7cff)}',
    '.dock .set{display:flex;gap:3px;padding:3px;border-radius:13px;background:rgba(255,255,255,.04)}',
    '.dock button{display:flex;align-items:center;gap:6px;border:0;cursor:pointer;border-radius:10px;padding:7px 10px;font-weight:600;color:#cdd6ea;background:transparent}',
    '.dock button:hover{background:rgba(255,255,255,.1);color:#fff}',
    '.dock button[aria-pressed=true]{background:#4f7cff;color:#fff}',
    '.dock .bps button[aria-pressed=true]{background:#ffcc4d;color:#141a26}',
    '.dock button:disabled{opacity:.35;cursor:default}',
    '.dock svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.dock kbd{font:600 10px ui-monospace,Consolas,monospace;padding:1px 4px;border-radius:4px;background:rgba(255,255,255,.1);color:#9fb0cc}',
    '@media (max-width:760px){.dock .brand span,.dock .lb,.dock kbd{display:none}.dock{gap:4px;padding:5px}.dock button{padding:6px 7px}}',
    '.count{display:inline-block;min-width:18px;padding:0 5px;border-radius:999px;background:#ff5c8a;color:#fff;font-size:11px;line-height:18px;text-align:center}',
    '.paintbar{position:fixed;left:50%;bottom:calc(var(--dock,46px) + 28px);transform:translateX(-50%);display:none;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 9px;border-radius:14px;background:#141a26;box-shadow:0 14px 40px rgba(0,0,0,.35);width:max-content;max-width:calc(100vw - 16px)}',
    '.sw{width:24px;height:24px;border-radius:50%;border:2px solid rgba(255,255,255,.25);cursor:pointer;padding:0}.sw:hover{transform:scale(1.12)}.sw[aria-pressed=true]{border-color:#fff;box-shadow:0 0 0 3px rgba(79,124,255,.6)}',
    'input[type=color]{width:28px;height:26px;border:0;padding:0;background:transparent;cursor:pointer}',
    '.insp{position:fixed;right:12px;top:calc(var(--studio-top,0px) + 12px);width:284px;max-height:calc(100vh - var(--dock,46px) - var(--studio-top,0px) - 54px);overflow:auto;display:none;padding:12px;border-radius:16px;background:#141a26;color:#eef2fb;box-shadow:0 14px 40px rgba(0,0,0,.35)}',
    '@media (max-width:760px){.insp{left:8px;right:8px;top:auto;bottom:calc(var(--dock,46px) + 24px);width:auto;max-height:42vh}}',
    '.insp .hd{display:flex;align-items:baseline;gap:8px;cursor:pointer}.insp .hd b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.insp .hd small{color:#7c8aa5}',
    '.insp .sel{color:#7c8aa5;font:11px ui-monospace,Consolas,monospace;margin:2px 0 6px;word-break:break-all}',
    '@media (min-width:761px){.insp.left{right:auto;left:12px}}',
    '.insp .badge{display:inline-block;padding:1px 7px;border-radius:999px;background:#ffcc4d;color:#141a26;font-size:11px;font-weight:700}',
    '.insp h4{margin:12px 0 6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9fb0cc}',
    '.irow{display:flex;align-items:center;gap:8px;margin:5px 0}.irow .ilbl{width:86px;flex:none;color:#b6c2da;font-size:12px;user-select:none}',
    '.irow .ilbl.scrub{cursor:ew-resize}.irow .ilbl.scrub:hover{color:#fff}',
    '.irow input[type=number]{width:74px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#0b0f18;color:#eef2fb;padding:5px 7px;font:12px ui-monospace,Consolas,monospace}',
    '.irow .unit{color:#7c8aa5;font-size:11px}',
    '.segs{display:flex;flex-wrap:wrap;gap:3px}.segs .btn{padding:4px 7px;font-size:11px}',
    '.swrow{display:flex;flex-wrap:wrap;gap:5px;align-items:center}.swrow .sw{width:20px;height:20px}',
    '.foot{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}',
    '.panel{position:fixed;right:16px;bottom:calc(var(--dock,46px) + 32px);max-height:calc(100vh - var(--dock,46px) - 44px);overflow:auto;width:min(580px,calc(100vw - 32px));display:none;flex-direction:column;gap:8px;padding:12px;border-radius:16px;background:#141a26;color:#eef2fb;box-shadow:0 14px 40px rgba(0,0,0,.35)}',
    '.panel .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.panel .row .grow{flex:1}',
    '.panel textarea{width:100%;height:260px;resize:vertical;border:0;border-radius:10px;padding:10px;background:#0b0f18;color:#cfe0ff;font:12px/1.45 ui-monospace,Consolas,monospace}',
    '.toast{position:fixed;left:50%;bottom:calc(var(--dock,46px) + 32px);transform:translateX(-50%);display:none;padding:8px 14px;border-radius:12px;background:#141a26;color:#eef2fb;box-shadow:0 10px 30px rgba(0,0,0,.3);max-width:calc(100vw - 24px)}',
    '.trash{position:fixed;left:18px;bottom:18px;display:none;width:74px;height:74px;border-radius:50%;place-items:center;text-align:center;font-size:11px;font-weight:700;color:#fff;background:rgba(196,59,92,.75);box-shadow:0 10px 30px rgba(196,59,92,.35);transition:transform .12s}',
    '.trash.hot{transform:scale(1.25);background:#c43b5c}',
    '.cmd{position:fixed;left:50%;top:14vh;transform:translateX(-50%);display:none;width:min(560px,calc(100vw - 24px));border-radius:16px;background:#141a26;box-shadow:0 24px 70px rgba(0,0,0,.5);overflow:hidden}',
    '.cmd input{width:100%;border:0;outline:0;padding:16px 18px;font-size:16px;background:transparent;color:#fff}',
    '.cmd ul{list-style:none;margin:0;padding:6px;border-top:1px solid rgba(255,255,255,.08);max-height:320px;overflow:auto}',
    '.cmd li{display:flex;justify-content:space-between;gap:12px;padding:8px 12px;border-radius:10px;color:#cdd6ea;cursor:pointer}.cmd li b{color:#fff;font-weight:600}',
    '.cmd li.on,.cmd li:hover{background:#4f7cff;color:#fff}.cmd li small{color:inherit;opacity:.75}',
    '.cmd .hint{padding:8px 16px;color:#7c8aa5;font-size:12px;border-top:1px solid rgba(255,255,255,.08)}',
    '.help,.coach{position:fixed;display:none;border-radius:16px;background:#141a26;color:#eef2fb;box-shadow:0 24px 70px rgba(0,0,0,.5)}',
    '.help{left:50%;top:50%;transform:translate(-50%,-50%);width:min(620px,calc(100vw - 24px));max-height:80vh;overflow:auto;padding:18px 20px}',
    '.help h3{margin:0 0 10px;font-size:16px}.help .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px}@media (max-width:560px){.help .grid{grid-template-columns:1fr}}',
    '.help .k{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06)}',
    '.help kbd,.coach kbd{font:600 11px ui-monospace,Consolas,monospace;padding:1px 6px;border-radius:5px;background:rgba(255,255,255,.1);color:#fff}',
    '.coach{left:50%;bottom:calc(var(--dock,46px) + 32px);transform:translateX(-50%);width:min(420px,calc(100vw - 24px));padding:14px 16px}',
    '.coach ol{margin:6px 0 10px;padding-left:18px;color:#cdd6ea}.coach li{margin:4px 0}',
    '.meas{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none}',
    '.meas .ln{position:absolute;background:#ff3b5c}.meas .ln.v{width:1px}.meas .ln.h{height:1px}',
    '.meas .lb{position:absolute;transform:translate(-50%,-50%);padding:1px 6px;border-radius:5px;background:#ff3b5c;color:#fff;font:600 11px ui-monospace,Consolas,monospace;white-space:nowrap}',
    '.meas .ob{position:absolute;border:1px dashed #ff3b5c}.meas .mg{position:absolute;background:rgba(255,160,70,.28)}.meas .pd{position:absolute;background:rgba(80,200,120,.28)}',
    '.meas .lb.m{background:#d9822b}.meas .lb.p{background:#2f9e62}',
    '.guides{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none}',
    '.guides .gl{position:absolute;background:#ff2fb3}.guides .gl.v{width:1px}.guides .gl.h{height:1px}',
    '.guides .gm{position:absolute;border:0 solid #ff2fb3}',
    '.guides .gm.h{height:9px;transform:translateY(-50%);border-left-width:1px;border-right-width:1px;background:linear-gradient(#ff2fb3,#ff2fb3) center/100% 1px no-repeat}',
    '.guides .gm.v{width:9px;transform:translateX(-50%);border-top-width:1px;border-bottom-width:1px;background:linear-gradient(#ff2fb3,#ff2fb3) center/1px 100% no-repeat}',
    '.guides .gb{position:absolute;transform:translate(-50%,-50%);padding:0 5px;border-radius:4px;background:#ff2fb3;color:#fff;font:600 10px/15px ui-monospace,Consolas,monospace}',
    '.readout{position:fixed;left:0;top:0;display:none;pointer-events:none;padding:4px 9px;border-radius:8px;background:#16a37f;color:#fff;font-weight:700;font-size:12px;white-space:nowrap;box-shadow:0 6px 16px rgba(22,163,127,.4)}',
    '.playbar{position:fixed;left:50%;bottom:calc(var(--dock,46px) + 28px);transform:translateX(-50%);display:none;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;padding:7px 9px;border-radius:14px;background:#141a26;box-shadow:0 14px 40px rgba(0,0,0,.35);width:max-content;max-width:calc(100vw - 16px)}',
    '.playbar .lbl{color:#ffcc4d;font-weight:800;letter-spacing:.08em;font-size:11px;margin:0 4px}.playbar .hint{color:#9fb0cc;font-size:11px;margin-right:4px}',
    '.pring{position:fixed;left:0;top:0;display:none;pointer-events:none;border-radius:50%;border:1.5px dashed #ffcc4d;box-shadow:inset 0 0 26px rgba(255,204,77,.22)}',
    '.pfx{position:fixed;pointer-events:none;border-radius:50%}',
    '.dock button.t-play[aria-pressed=true]{background:#ffcc4d;color:#141a26}',
    '.dock button.t-state{display:none;background:#7fd1ae;color:#141a26}.dock button.t-state:hover{background:#a5e3c8;color:#141a26}.dock.dressing button.t-state{display:flex}',
    '.insp .badge.st{background:#7fd1ae}',
    '.lib{position:fixed;left:12px;top:calc(var(--studio-top,0px) + 12px);width:236px;max-height:calc(100vh - var(--dock,46px) - var(--studio-top,0px) - 54px);overflow:auto;display:none;padding:12px;border-radius:16px;background:#141a26;color:#eef2fb;box-shadow:0 14px 40px rgba(0,0,0,.35)}',
    '@media (max-width:760px){.lib{left:8px;right:8px;top:auto;bottom:calc(var(--dock,46px) + 24px);width:auto;max-height:42vh}}',
    '.lib .hd{display:flex;align-items:baseline;gap:8px;cursor:pointer}.lib .hd b{flex:1}.lib .hd small{color:#7c8aa5}.lib .hint{color:#9fb0cc;font-size:12px;margin:4px 0 2px}',
    '.lib h4{margin:12px 0 6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9fb0cc}',
    '.tiles{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
    '.tile{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px;background:rgba(255,255,255,.04);color:#eef2fb;cursor:grab;text-align:left;touch-action:none}',
    '.tile:hover{background:rgba(79,124,255,.18);border-color:rgba(79,124,255,.5)}.tile .gl{font-size:16px;line-height:1;color:#ffcc4d}.tile .tl{max-width:100%;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rewind{position:fixed;left:50%;top:12px;transform:translateX(-50%);display:none;flex-direction:column;gap:8px;width:min(520px,calc(100vw - 24px));padding:12px 14px;border-radius:16px;background:#141a26;color:#eef2fb;box-shadow:0 14px 40px rgba(0,0,0,.35)}',
    '.rewind .top{display:flex;align-items:center;gap:10px}.rewind .top b{flex:1}.rewind .n{color:#9fb0cc;font-size:12px}',
    '.rewind input{width:100%;accent-color:#ffcc4d;cursor:pointer}.rewind .lbl{min-height:16px;color:#cdd6ea;font-size:12px}',
    '.peek{position:fixed;left:50%;top:14px;transform:translateX(-50%);display:none;padding:6px 14px;border-radius:999px;background:#ffcc4d;color:#141a26;font-weight:800;letter-spacing:.04em;box-shadow:0 10px 30px rgba(0,0,0,.25)}',
    '.open{position:fixed;right:16px;bottom:16px;display:none;border:0;cursor:pointer;border-radius:14px;padding:10px 16px;font-weight:700;color:#fff;background:#4f7cff;box-shadow:0 10px 30px rgba(79,124,255,.4)}'
  ].join('\n');
  try{var st=new CSSStyleSheet();st.replaceSync(CSSUI);sh.adoptedStyleSheets=[st];}catch(e){var s2=mk('style');s2.textContent=CSSUI;sh.appendChild(s2);}
  var I={
    grab:'<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13M17 12v-2a1.5 1.5 0 0 1 3 0v4c0 4-3 7-7 7h-1c-3 0-4.5-1.5-6-4l-2.5-4a1.5 1.5 0 0 1 2.5-1.6L8 14"/>',
    stretch:'<path d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4"/>',
    paint:'<path d="M18.4 3.6a2 2 0 0 1 2.9 2.9L11 16.8 7.2 13ZM7 13.5c-2 0-3.5 1.6-3.5 3.5 0 1.3-.7 2.2-1.5 2.9 3.8.8 7.5-.3 7.5-4"/>',
    desk:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',tab:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M11 18h2"/>',phone:'<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    undo:'<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',redo:'<path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>',
    cmd:'<path d="M9 6V5a3 3 0 1 0-3 3h1M15 6V5a3 3 0 1 1 3 3h-1M9 18v1a3 3 0 1 1-3-3h1M15 18v1a3 3 0 1 0 3-3h-1M9 8h6v8H9z"/>',
    code:'<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',plus:'<path d="M12 5v14M5 12h14"/>',hist:'<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7v5l3 2"/>',play:'<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/>'
  };
  function svg(n){return '<svg viewBox="0 0 24 24">'+I[n]+'</svg>';}
  sh.innerHTML+=
    '<div class="box hover"></div><div class="sels"></div><div class="box target"></div><div class="box slot"></div><div class="box ghost"></div><div class="box lasso"></div><div class="box band"></div><div class="box edge"></div><div class="tag"></div>'+
    '<div class="pill" role="status"><div class="why"></div><div class="what"></div><div class="more"></div><div class="acts"></div></div>'+
    '<div class="insp" role="dialog" aria-label="Inspector"></div><div class="lib" role="dialog" aria-label="Insert"></div><div class="peek">BEFORE · let go of B to come back</div>'+
    '<div class="rewind" role="dialog" aria-label="History"><div class="top"><b>History</b><span class="n"></span><button class="btn rwclose">Close</button></div><input type="range" min="0" max="0" step="1" value="0" aria-label="Step"><div class="lbl"></div></div>'+
    '<div class="trash">🗑<br>Drop to remove</div>'+
    '<div class="paintbar" role="toolbar" aria-label="Paint"></div>'+
    '<div class="panel" role="dialog" aria-label="Changes"><div class="row"><b class="grow">Changes</b><button class="btn v-css" aria-pressed="true">CSS</button><button class="btn v-list" aria-pressed="false">For an agent</button></div>'+
      '<textarea readonly spellcheck="false"></textarea><div class="row"><span class="grow note"></span><button class="btn copy">Copy</button><button class="btn lit dl">Download page</button><button class="btn warn reset">Reset page</button><button class="btn pclose">Close</button></div></div>'+
    '<div class="cmd" role="dialog" aria-label="Commands"><input type="text" placeholder="Try: 3 columns · center · gap 32 · bigger · shadow lifted · phone" spellcheck="false"><ul></ul><div class="hint">Enter runs it · ↑↓ to choose · Esc closes · acts on the selection, or what the pointer is over</div></div>'+
    '<div class="help" role="dialog" aria-label="Shortcuts"></div><div class="coach" role="dialog" aria-label="Getting started"></div>'+
    '<div class="guides"></div><div class="meas"></div><div class="readout"></div><div class="playbar" role="toolbar" aria-label="Play"></div><div class="pring"></div><div class="toast"></div>'+
    '<div class="dock" role="toolbar" aria-label="Clay Studio"><span class="brand"><i></i><span>CLAY STUDIO</span></span>'+
      '<button class="t-state" title="Styling a state. Click or Esc to go back to the normal look">✦ <span class="st"></span> ×</button>'+
      '<span class="set"><button class="t-grab" aria-pressed="true" title="Grab: drag to arrange · Shift+drag selects · Ctrl+drag copies">'+svg('grab')+'<span class="lb">Grab</span><kbd>G</kbd></button>'+
      '<button class="t-stretch" aria-pressed="false" title="Stretch: pull gaps, edges and text size">'+svg('stretch')+'<span class="lb">Stretch</span><kbd>S</kbd></button>'+
      '<button class="t-paint" aria-pressed="false" title="Paint: brush colours and materials onto things">'+svg('paint')+'<span class="lb">Paint</span><kbd>P</kbd></button></span>'+
      '<span class="set"><button class="t-play" aria-pressed="false" title="Play: meteors and friends for demos. Never touches your layout (F)">'+svg('play')+'<span class="lb">Play</span><kbd>F</kbd></button></span>'+
      '<span class="set bps"><button data-bp="base" aria-pressed="true" title="Desktop (1)">'+svg('desk')+'</button><button data-bp="tablet" aria-pressed="false" title="Tablet: edits apply at 1023px and below (2)">'+svg('tab')+'</button><button data-bp="mobile" aria-pressed="false" title="Phone: edits apply at 767px and below (3)">'+svg('phone')+'</button></span>'+
      '<span class="set"><button class="undo" title="Undo (Ctrl+Z)">'+svg('undo')+'</button><button class="redo" title="Redo (Ctrl+Y)">'+svg('redo')+'</button></span>'+
      '<span class="set"><button class="t-ins" aria-pressed="false" title="Insert blocks (I)">'+svg('plus')+'</button><button class="t-hist" aria-pressed="false" title="History: scrub through your changes (H)">'+svg('hist')+'</button></span>'+
      '<span class="set"><button class="t-cmd" title="Commands (Ctrl+K)">'+svg('cmd')+'<kbd>Ctrl K</kbd></button><button class="changes" title="Changes and export (C)">'+svg('code')+'<span class="count">0</span></button>'+
      '<button class="t-help" title="Shortcuts (?)">'+svg('help')+'</button><button class="hide" title="Hide (Esc)">'+svg('x')+'</button></span></div>'+
    '<button class="open">Clay Studio</button>';
  var q=function(s){return sh.querySelector(s);};
  var ui={lib:q('.lib'),rewind:q('.rewind'),peek:q('.peek'),ghost:q('.ghost'),guides:q('.guides'),meas:q('.meas'),readout:q('.readout'),playbar:q('.playbar'),pring:q('.pring'),slot:q('.slot'),hover:q('.hover'),sels:q('.sels'),target:q('.target'),lasso:q('.lasso'),band:q('.band'),edge:q('.edge'),tag:q('.tag'),pill:q('.pill'),acts:q('.pill .acts'),insp:q('.insp'),
    trash:q('.trash'),paintbar:q('.paintbar'),panel:q('.panel'),area:q('.panel textarea'),toast:q('.toast'),dock:q('.dock'),open:q('.open'),cmd:q('.cmd'),cmdIn:q('.cmd input'),cmdList:q('.cmd ul'),help:q('.help'),coach:q('.coach')};
  // Everything that floats above the dock measures from its real height, so a dock wrapped onto two rows covers nothing.
  function fitDock(){host.style.setProperty('--dock',ui.dock.offsetHeight+'px');}
  if(window.ResizeObserver)new ResizeObserver(fitDock).observe(ui.dock);fitDock();
  function box(elm,r,pad){if(!r){elm.style.display='none';return;}pad=pad||0;elm.style.display='block';elm.style.transform='translate('+(r.left-pad)+'px,'+(r.top-pad)+'px)';elm.style.width=(r.width+pad*2)+'px';elm.style.height=(r.height+pad*2)+'px';}
  function tagAt(text,r){if(!text){ui.tag.style.display='none';return;}ui.tag.textContent=text;ui.tag.style.display='block';ui.tag.style.transform='translate('+Math.max(4,r.left)+'px,'+Math.max(4,r.top-26)+'px)';}
  var toastT=0;function say(t){if(openStep&&!openStep.label)openStep.label=t;ui.toast.textContent=t;ui.toast.style.display='block';placeToast();clearTimeout(toastT);toastT=setTimeout(function(){ui.toast.style.display='none';},2800);}
  // A message rises above whatever sits over the dock where it would show, so it never covers the controls.
  function placeToast(){
    var t=ui.toast;t.style.bottom='';var tr=t.getBoundingClientRect(),top=tr.top;
    [ui.insp,ui.lib,ui.panel,ui.paintbar,ui.playbar,ui.coach].forEach(function(p){if(!p.offsetHeight)return;var r=p.getBoundingClientRect();
      if(r.bottom>tr.top&&r.top<tr.bottom&&r.left<tr.right&&r.right>tr.left)top=Math.min(top,r.top-8-tr.height);});
    if(top<tr.top&&top>=8)t.style.bottom=(innerHeight-top-tr.height)+'px';
  }

  // The pill: what the studio understood, Tab for other readings, and buttons for what can be done next.
  var pillCtx=null;
  function union(list){var r=null;list.forEach(function(el){var b=el.getBoundingClientRect();r=r?{left:Math.min(r.left,b.left),top:Math.min(r.top,b.top),right:Math.max(r.right,b.right),bottom:Math.max(r.bottom,b.bottom)}:{left:b.left,top:b.top,right:b.right,bottom:b.bottom};});return r&&{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.right-r.left,height:r.bottom-r.top};}
  function pill(at,why,what,more,acts){
    if(openStep&&!openStep.label&&why)openStep.label=why;
    var r=at.getBoundingClientRect?at.getBoundingClientRect():at;ui.pill.style.display='block';
    q('.pill .why').textContent=why||'';q('.pill .what').textContent=what||'';q('.pill .more').textContent=more||'';
    ui.acts.innerHTML='';(acts||[]).forEach(function(a){var b=mk('button','btn'+(a.lit?' lit':''),a.text);if(a.title)b.title=a.title;b.addEventListener('click',function(e){e.stopPropagation();a.run();});ui.acts.appendChild(b);});
    var top=r.top-ui.pill.offsetHeight-10;if(top<8)top=Math.min(innerHeight-ui.pill.offsetHeight-90,r.bottom+10);
    ui.pill.style.transform='translate('+Math.max(8,Math.min(innerWidth-ui.pill.offsetWidth-8,r.left))+'px,'+Math.max(8,top)+'px)';
  }
  function hidePill(){ui.pill.style.display='none';pillCtx=null;}
  function showLayout(ctx){pillCtx=ctx;pill(ctx.c,ctx.reason,describe(ctx)+(bp!=='base'?' · '+BPS[bp].label+' and smaller':''),ctx.kinds.length>1?'Tab: other ways ('+(ctx.i+1)+'/'+ctx.kinds.length+')':'');}
  function cycle(){
    if(!pillCtx)return;var ctx=pillCtx;ctx.i=(ctx.i+1)%ctx.kinds.length;
    flip(kids(ctx.c).concat([ctx.c]),function(){applyLayout(ctx,ctx.kinds[ctx.i]);});showLayout(ctx);save();if(selected)inspect(selected);
  }

  // ---- Selection and the inspector ----
  var selected=null,multi=[];
  function refreshSel(){ui.sels.innerHTML='';(multi.length?multi:selected?[selected]:[]).forEach(function(el){if(!el.isConnected)return;var b=mk('div','box');ui.sels.appendChild(b);box(b,el.getBoundingClientRect(),2);});}
  function select(el){selected=el&&el.isConnected?el:null;multi=[];
    // picking something inside the thing whose state it is keeps that state; picking something else makes it theirs
    if(dress&&selected&&(!anchor||!anchor.isConnected||!anchor.contains(selected)))anchor=selected;
    refreshSel();inspect(selected);}
  function selectMany(list){
    selected=null;multi=list;hidePill();refreshSel();inspect(null);if(!list.length)return;if(list.length===1){select(list[0]);return;}
    var P=list[0].parentElement,same=list.every(function(e){return e.parentElement===P;});
    pill(union(list),list.length+' selected'+(same?' in '+nameOf(P):''),same?'Group them, copy them or remove them.':'Group needs things that share a parent.','',
      (same?[{text:'Group (Ctrl+G)',lit:true,run:group}]:[]).concat([{text:'Duplicate',run:function(){duplicate(list);}},{text:'Remove',run:function(){remove(list);}}]));
  }
  var palCache=null;
  // The page's own colours, most used first, so painting stays on-brand.
  function palette(){
    if(palCache)return palCache;var counts={};
    root.querySelectorAll('*').forEach(function(el){var cs=getComputedStyle(el);[cs.color,cs.backgroundColor,cs.borderTopColor].forEach(function(c){if(!visible(c))return;var h=hex(c);counts[h]=(counts[h]||0)+1;});});
    var list=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];}),out=[];
    var rgb=function(h){return [1,3,5].map(function(i){return parseInt(h.substr(i,2),16);});};
    list.forEach(function(h){var a=rgb(h);if(out.length<10&&!out.some(function(o){var b=rgb(o);return Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2])<30;}))out.push(h);});
    ['#ffffff','#141a26'].forEach(function(h){if(out.indexOf(h)<0)out.push(h);});
    return palCache=out;
  }
  // Inspector edits: a typed value or a scrubbed label is one undo, however many small steps it took.
  var sess=null;
  function begin(){if(!sess)sess=snapshot();}
  function finish(){if(sess){commit(sess);sess=null;}if(selected)inspect(selected);}
  function inspect(el){
    var p=ui.insp;p.innerHTML='';if(!el){p.style.display='none';return;}p.style.display='block';
    var cs=getComputedStyle(el),isC=kids(el).length>=2,hd=mk('div','hd'),whose=dress&&anchor&&anchor!==el&&anchor.contains(el)?anchor:null;hd.appendChild(mk('b','',nameOf(el)));
    if(dress)hd.appendChild(mk('span','badge st',STATES[dress].label+(whose?' on '+shortName(whose):'')));if(bp!=='base')hd.appendChild(mk('span','badge',BPS[bp].label+' and smaller'));hd.appendChild(mk('small','','×'));
    hd.addEventListener('click',function(){select(null);hidePill();});p.appendChild(hd);p.appendChild(mk('div','sel',dress?stateSel(el,dress,whose):selectorOf(el)));
    var sec=function(t){p.appendChild(mk('h4','',t));};
    // a dot marks the states this thing has a look for, its own or for the things inside it
    var sr=mk('div','irow'),ss=mk('div','segs'),eid=idOf(el);sr.appendChild(mk('span','ilbl','State'));sr.appendChild(ss);p.appendChild(sr);
    [''].concat(ORDER_ST).forEach(function(s){var has=s&&ORDER_BP.some(function(L){return Object.keys(layers[L]).some(function(k){var q2=split(k);return q2[1]===s&&(q2[0]===eid&&!q2[2]||q2[2]===eid);});}),b=mk('button','btn',(s?STATES[s].label:'Normal')+(has?' •':''));
      b.title=s?'Style how it looks '+STATES[s].when:'Style how it looks the rest of the time';b.setAttribute('aria-pressed',String(dress===s));b.addEventListener('click',function(){setDress(s);});ss.appendChild(b);});
    var write=function(props,why){setOwn(el,props);because(el,why||'You set '+Object.keys(props).join(', ')+' on '+nameOf(el)+' in the inspector.');};
    function num(label,val,unit,apply,step,min){
      var r=mk('div','irow'),l=mk('label','ilbl scrub',label),i=mk('input');i.type='number';i.value=round(val);i.step=step||1;if(min!==undefined)i.min=min;
      r.appendChild(l);r.appendChild(i);if(unit)r.appendChild(mk('span','unit',unit));p.appendChild(r);
      var set=function(v){v=Math.max(min!==undefined?min:-1e6,v);i.value=round(v);apply(v);};
      i.addEventListener('input',function(){if(i.value==='')return;begin();set(+i.value);});
      i.addEventListener('change',finish);i.addEventListener('keydown',function(e){if(e.key==='Enter'){i.blur();}});
      l.addEventListener('pointerdown',function(e){e.preventDefault();begin();var x0=e.clientX,v0=+i.value||0;try{l.setPointerCapture(e.pointerId);}catch(err){}
        var mv=function(ev){set(v0+Math.round((ev.clientX-x0)/2)*(step||1)*(ev.shiftKey?10:1));};
        var up=function(){l.removeEventListener('pointermove',mv);l.removeEventListener('pointerup',up);finish();};
        l.addEventListener('pointermove',mv);l.addEventListener('pointerup',up);});
    }
    function segs(label,items,pick){
      var r=mk('div','irow'),s=mk('div','segs');r.appendChild(mk('span','ilbl',label));r.appendChild(s);p.appendChild(r);
      items.forEach(function(it){var b=mk('button','btn',it.t);b.setAttribute('aria-pressed',String(!!it.on));b.addEventListener('click',function(){act(function(){pick(it.v);});select(el);});s.appendChild(b);});
    }
    function colors(label,current,pick){
      var r=mk('div','irow'),s=mk('div','swrow');r.appendChild(mk('span','ilbl',label));r.appendChild(s);p.appendChild(r);
      palette().forEach(function(h){var b=mk('button','sw');b.style.background=h;b.title=h;b.setAttribute('aria-pressed',String(hex(current)===h));b.addEventListener('click',function(){act(function(){pick(h);});select(el);});s.appendChild(b);});
      var c=mk('input');c.type='color';c.value=hex(current);c.title='Any colour';c.addEventListener('input',function(){begin();pick(c.value);});c.addEventListener('change',finish);s.appendChild(c);
    }
    if(isC&&!dress&&!freeCanvas(el)){
      sec('Layout');
      var d=cs.display,fd=cs.flexDirection,wrap=cs.flexWrap==='wrap',isGrid=d==='grid',isFlex=/flex/.test(d);
      segs('Flow',[{t:'Normal',v:'flow',on:!isGrid&&!isFlex},{t:'Row',v:'row',on:isFlex&&fd==='row'&&!wrap},{t:'Column',v:'column',on:isFlex&&fd==='column'},{t:'Wrap',v:'wrap',on:isFlex&&wrap},{t:'Grid',v:'grid',on:isGrid}],function(v){
        flip(kids(el),function(){
          if(v==='flow'){var clear={};LAYOUT.forEach(function(k){clear[k]=null;});setRule(el,clear);because(el,'You set '+nameOf(el)+' back to normal flow.');}
          else if(v==='grid'){var g=snap(Math.max(8,parseFloat(cs.columnGap)||parseFloat(cs.rowGap)||24),PX),cols=Math.max(2,rows(kids(el),layoutRect).reduce(function(m,r){return Math.max(m,r.items.length);},0));
            applyLayout({c:el,cols:cols,colGap:g,rowGap:g,reason:'You made '+nameOf(el)+' a responsive grid, '+cols+' across.'},'grid-auto');}
          else flowNow(el,v);
        });
      });
      if(isGrid){var cols=cs.gridTemplateColumns.split(' ').length;num('Columns',cols,'across',function(v){v=Math.max(1,Math.round(v));var g=parseFloat(cs.columnGap)||24;
        flip(kids(el),function(){setOwn(el,{display:'grid','grid-template-columns':'repeat(auto-fit, minmax(min(100%, '+autoMin(el,v,g)+'px), 1fr))'});because(el,'You set '+nameOf(el)+' to '+v+' across, fewer on small screens.');});},1,1);}
      if(isGrid||isFlex)num('Gap',parseFloat(cs.columnGap)||parseFloat(cs.rowGap)||0,'px',function(v){flip(kids(el),function(){write({'row-gap':v+'px','column-gap':v+'px'},'You set the gap in '+nameOf(el)+' to '+v+'px.');});},4,0);
      segs('Align',['start','center','end','spread'].map(function(g){return {t:g[0].toUpperCase()+g.slice(1),v:g};}),function(g){gravityNow(el,g);});
    }
    sec('Size & spacing');
    num('Max width',cs.maxWidth==='none'?0:parseFloat(cs.maxWidth),'px · 0 = none',function(v){write(v?{'max-width':v+'px','margin-left':'auto','margin-right':'auto'}:{'max-width':null,'margin-left':null,'margin-right':null},v?'You set '+nameOf(el)+' to at most '+v+'px wide.':'');},10,0);
    num('Padding Y',parseFloat(cs.paddingTop),'px',function(v){write({'padding-top':v+'px','padding-bottom':v+'px'});},4,0);
    num('Padding X',parseFloat(cs.paddingLeft),'px',function(v){write({'padding-left':v+'px','padding-right':v+'px'});},4,0);
    num('Space below',parseFloat(cs.marginBottom),'px',function(v){write({'margin-bottom':v+'px'});},4,0);
    if(textish(el)||el.textContent.trim()&&!isC){
      sec('Type');
      num('Size',parseFloat(cs.fontSize),'px',function(v){write({'font-size':round(v/16)+'rem'},'You set '+nameOf(el)+' to '+v+'px text.');},1,6);
      segs('Weight',[400,500,600,700,800].map(function(w){return {t:String(w),v:w,on:+cs.fontWeight===w};}),function(w){write({'font-weight':String(w)});});
      segs('Align',[['Left','left'],['Center','center'],['Right','right']].map(function(a){return {t:a[0],v:a[1],on:cs.textAlign===a[1]||a[1]==='left'&&cs.textAlign==='start'};}),function(a){write({'text-align':a});});
      colors('Colour',cs.color,function(h){write({color:h},'You painted '+nameOf(el)+'’s text '+h+'.');});
    }
    sec('Fill');
    colors('Background',cs.backgroundColor,function(h){write({'background-color':h,'background-image':'none'},'You filled '+nameOf(el)+' with '+h+'.');});
    num('Radius',parseFloat(cs.borderTopLeftRadius)||0,'px',function(v){write({'border-radius':v+'px'});},2,0);
    segs('Shadow',Object.keys(SHADOWS).map(function(k){return {t:k[0].toUpperCase()+k.slice(1),v:k,on:cs.boxShadow===SHADOWS[k]||k==='none'&&cs.boxShadow==='none'};}),function(k){write({'box-shadow':SHADOWS[k]},'You gave '+nameOf(el)+' a '+k+' shadow.');});
    segs('Border',[{t:'None',v:0,on:!(parseFloat(cs.borderTopWidth)>0)},{t:'Hairline',v:1,on:parseFloat(cs.borderTopWidth)===1},{t:'Bold',v:2,on:parseFloat(cs.borderTopWidth)>=2}],function(w){write(w?{'border-width':w+'px','border-style':'solid','border-color':visible(cs.borderTopColor)&&parseFloat(cs.borderTopWidth)>0?hex(cs.borderTopColor):'rgba(20,26,38,.16)'}:{'border-width':'0'});});
    if(dress){sec('Move');var lifted=said(el,'transform');
      segs('Lift',Object.keys(LIFTS).map(function(k){return {t:LIFTS[k].label,v:k,on:k==='none'?!lifted||lifted==='none':lifted===LIFTS[k].css};}),function(k){
        write({transform:LIFTS[k].css||(inherited(el,'transform')?'none':null)},k==='none'?'You took the lift off '+nameOf(el)+'.':'You made '+nameOf(el)+(k==='press'?' press in ':' lift '+LIFTS[k].label+' ')+STATES[dress].when+'.');});}
    sec('Shape');
    var carved=said(el,'clip-path');
    segs('Carve',Object.keys(CARVES).map(function(k){return {t:CARVES[k].label,v:k,on:k==='none'?!carved||carved==='none':carved===CARVES[k].css};}),function(k){
      write({'clip-path':k!=='none'?CARVES[k].css:inherited(el,'clip-path')?'none':null},k!=='none'?'You carved '+nameOf(el)+' into '+(k==='arch'?'an ':'a ')+CARVES[k].label.toLowerCase()+'.':'You took the carve off '+nameOf(el)+'.');});
    var f=mk('div','foot'),pinned=ruleOf(el).position==='sticky',clear={t:'Clear '+(dress?STATES[dress].label+' ':'')+(bp==='base'?'styles':BPS[bp].label+' styles'),run:function(){var k=dkey(el);act(function(){flip(kids(el),function(){delete layers[bp][k];delete reasons[bp+':'+k];render();});});select(el);}};
    (dress?[clear]:[{t:pinned?'📌 Unpin':'📌 Pin',run:function(){pin(el);}},{t:'Duplicate',run:function(){duplicate([el]);}},isC&&el!==root?{t:'Ungroup',run:function(){ungroup(el);}}:null,
     clear,{t:'Remove',cls:'warn',run:function(){remove([el]);}}]).forEach(function(a){if(!a)return;var b=mk('button','btn'+(a.cls?' '+a.cls:''),a.t);b.addEventListener('click',a.run);f.appendChild(b);});
    p.appendChild(f);placeInsp(el);
  }
  // The inspector keeps clear of what it shows: if it would cover the selection, it moves to the other side.
  function placeInsp(el){
    var p=ui.insp;p.classList.remove('left');if(!el||p.style.display==='none'||innerWidth<=760||ui.lib.style.display==='block')return;
    var r=el.getBoundingClientRect(),over=function(a){return r.left<a.right&&r.right>a.left&&r.top<a.bottom&&r.bottom>a.top;};
    if(!over(p.getBoundingClientRect()))return;p.classList.add('left');if(over(p.getBoundingClientRect()))p.classList.remove('left');
  }

  // ---- Actions: group, ungroup, flow, gravity, pin, remove, duplicate, reorder ----
  function group(){
    var list=multi.slice();if(list.length<2||dressed()||stays(list))return;var P=list[0].parentElement;
    if(!list.every(function(e){return e.parentElement===P;})){say('Group needs things that share a parent.');return;}
    list.sort(function(a,b){return a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1;});
    var before=snapshot(),rs=rows(list,layoutRect),g=mk('div','group');made[idOf(g)]=g;
    // the new container takes the arrangement they already have
    var cols=0,n=list.length,cg=[],rg=[];rs.forEach(function(row,i){cols=Math.max(cols,row.items.length);
      for(var j=1;j<row.items.length;j++)cg.push(layoutRect(row.items[j]).left-layoutRect(row.items[j-1]).right);
      if(i)rg.push(row.box.top-rs[i-1].box.bottom);});
    var med=function(a,d){a=a.filter(function(v){return v>0;}).sort(function(x,y){return x-y;});return a.length?a[Math.floor(a.length/2)]:d;};
    var ctx={c:g,cols:cols,n:n,colGap:snap(Math.max(8,med(cg,24)),PX),rowGap:snap(Math.min(96,Math.max(8,med(rg,24))),PX),i:0,
      reason:'You grouped '+n+' things'+(cols>1?' side by side':' in a stack')+'.',kinds:cols===1?['stack','grid-1']:rs.length===1?['flex-row','grid-auto','flex-wrap']:['grid-auto','grid-fixed','flex-wrap']};
    flip(kids(P).concat(list),function(){P.insertBefore(g,list[0]);list.forEach(function(e){g.appendChild(e);});applyLayout(ctx,ctx.kinds[0]);});
    commit(before);multi=[];selected=g;refreshSel();inspect(g);showLayout(ctx);
  }
  function ungroup(el){
    var P=el.parentElement;if(!P||el===root)return;var before=snapshot(),ks=Array.prototype.slice.call(el.children);
    flip(kids(P).concat(kids(el)),function(){ks.forEach(function(k){P.insertBefore(k,el);});made[idOf(el)]=el;el.remove();});
    commit(before);select(null);pill(P,'You unwrapped '+nameOf(el)+'.','Its children now sit directly in '+nameOf(P)+'.','');
  }
  function flowNow(el,kind){
    var cs=getComputedStyle(el),g=snap(Math.max(8,parseFloat(cs.columnGap)||parseFloat(cs.rowGap)||24),PX),clear={};LAYOUT.forEach(function(k){clear[k]=null;});setRule(el,clear);
    setRule(el,kind==='row'?{display:'flex','flex-direction':'row','flex-wrap':'nowrap','column-gap':g+'px','align-items':'flex-start'}:
      kind==='column'?{display:'flex','flex-direction':'column','row-gap':g+'px'}:{display:'flex','flex-wrap':'wrap','column-gap':g+'px','row-gap':g+'px'});
    kids(el).forEach(function(k){setOwn(k,{margin:'0',flex:kind==='row'?'1 1 0':null,'min-width':kind==='row'?'0':null});});
    because(el,'You set '+nameOf(el)+' to flow as a '+(kind==='wrap'?'wrapping row':kind)+'.');
  }
  function flow(el,kind){if(dressed()||freeCanvas(el)&&stays(kids(el)))return;act(function(){flip(kids(el),function(){flowNow(el,kind);});});select(el);}
  function gravityNow(el,gv){
    flip(kids(el),function(){
      if(!flowing(el))setRule(el,{display:'flex','flex-direction':'column','row-gap':(parseFloat(getComputedStyle(el).rowGap)||0)+'px'});
      var map={start:['flex-start','flex-start','start'],center:['center','center','center'],end:['flex-end','flex-end','end'],spread:['space-between','stretch','stretch']}[gv];
      if(getComputedStyle(el).display==='grid')setRule(el,{'justify-items':map[2],'align-items':map[2]});
      else setRule(el,{'justify-content':map[0],'align-items':map[1]});
      because(el,'You gave '+nameOf(el)+' '+gv+' gravity.');
    });
  }
  function gravity(el,gv){if(dressed()||freeCanvas(el)&&stays(kids(el)))return;act(function(){gravityNow(el,gv);});select(el);}
  function pin(el){
    var was=ruleOf(el).position==='sticky';
    act(function(){setRule(el,was?{position:null,top:null,'z-index':null}:{position:'sticky',top:'0','z-index':'20'});if(!was)because(el,'You pinned '+nameOf(el)+' so it stays at the top while scrolling.');});
    select(el);say(was?'Unpinned.':'Pinned: it sticks to the top while the page scrolls.');
  }
  function remove(list){
    list=list.filter(function(e){return e&&e.isConnected&&e!==root;});if(!list.length)return;
    var around=[];list.forEach(function(e){around=around.concat(kids(e.parentElement));});
    act(function(){flip(around.filter(function(e){return list.indexOf(e)<0;}),function(){list.forEach(function(e){made[idOf(e)]=e;e.remove();});});});
    select(null);pill(around.find(function(e){return e.isConnected;})||root,'You removed '+(list.length===1?nameOf(list[0]):list.length+' things')+'.','Ctrl+Z brings '+(list.length===1?'it':'them')+' back.','');
  }
  function cloneOf(el){
    var c=el.cloneNode(true),src=[el].concat(Array.prototype.slice.call(el.querySelectorAll('*'))),dst=[c].concat(Array.prototype.slice.call(c.querySelectorAll('*')));
    // a copy can't share an id with its original, so ids inside it take the next free number
    var taken={};dst.forEach(function(n){n.removeAttribute('data-cs');if(n.style){n.style.translate=n.style.scale=n.style.transformOrigin='';}
      if(n.id){var b=n.id.replace(/-\d+$/,''),i=2;while(doc.getElementById(b+'-'+i)||taken[b+'-'+i])i++;n.id=b+'-'+i;taken[n.id]=1;}});
    // the copy carries the studio's rules for the original and everything inside it
    var to={};src.forEach(function(s,i){var sid=s.getAttribute('data-cs');if(sid&&dst[i])to[sid]=idOf(dst[i]);});
    ORDER_BP.forEach(function(L){Object.keys(layers[L]).forEach(function(k){var q2=split(k);if(!to[q2[0]])return;
      layers[L][to[q2[0]]+(q2[1]?'~'+q2[1]+(q2[2]?'@'+(to[q2[2]]||q2[2]):''):'')]=JSON.parse(JSON.stringify(layers[L][k]));});});
    var id=idOf(c);made[id]=c;copyOf[id]=idOf(el);return c;
  }
  function duplicate(list){
    list=list.filter(function(e){return e&&e.isConnected&&e!==root;});if(!list.length||stays(list))return;var copies=[];
    act(function(){var around=[];list.forEach(function(e){around=around.concat(kids(e.parentElement));});
      flip(around,function(){list.forEach(function(e){var c=cloneOf(e);e.after(c);copies.push(c);});render();});});
    if(copies.length===1)select(copies[0]);else selectMany(copies);say('Duplicated. The copy sits right after the original.');
  }
  // Put a container's children in a new order: CSS order on smaller screens inside grid or flex, the HTML otherwise.
  function applyOrder(P,order,same){
    if(bp!=='base'&&same&&flowing(P)){order.forEach(function(k,i){setRule(k,{order:String(i+1)});});return 'css';}
    order.forEach(function(k){P.appendChild(k);});return 'html';
  }
  function nudge(el,dir){
    var P=el&&el.parentElement;if(!P||el===root||dressed()||stays([el]))return;var ks=kids(P),i=ks.indexOf(el),j=i+dir;if(i<0||j<0||j>=ks.length)return;
    var order=ks.slice();order.splice(i,1);order.splice(j,0,el);
    act(function(){flip(ks,function(){applyOrder(P,order,true);because(P,'You moved '+nameOf(el)+' '+(dir<0?'earlier':'later')+'.');});});select(el);
  }

  // ---- Screen sizes ----
  var htmlBg=html.style.background,bodyBg=doc.body.style.background,pageBg=getComputedStyle(doc.body).backgroundColor;
  function setBP(name){
    if(!BPS[name]||name===bp)return;if(playing)togglePlay(false,true);bp=name;var w=BPS[name].width;
    sh.querySelectorAll('.bps button').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.bp===name));});
    hidePill();
    flip(allItems(),function(){
      root.style.width=w?Math.min(w,innerWidth-32)+'px':'';
      root.style.marginLeft=root.style.marginRight=w?'auto':'';
      root.style.boxShadow=w?'0 0 0 1px rgba(255,255,255,.3), 0 30px 90px rgba(0,0,0,.45)':'';
      // the page's own background moves onto the page, so the space around the preview can go dark
      root.style.background=w?pageBg:'';doc.body.style.background=w?'transparent':bodyBg;html.style.background=w?'#2b303b':htmlBg;cache=null;
    },null,true);
    if(selected)inspect(selected);
    say(name==='base'?'Desktop: edits apply at every size.':BPS[name].label+': edits now apply at '+BPS[name].max+'px and below.');
  }

  // ---- States: hover, focus and pressed ----
  // While a state is chosen it is forced on for everything that has a look for it, and paint, stretch, the inspector and
  // the look commands write into it. Pressed shows over hover, as it does for real. Arranging is the same in every state,
  // so it waits until you come back to Normal.
  function setDress(st,quiet){
    st=STATES[st]?st:'';if(st===dress)return;if(playing)togglePlay(false,true);if(editing)endEdit(true);
    if(!st)anchor=null;else if(!dress)anchor=selected;
    dress=st;if(st)html.setAttribute('data-clay-state',st==='active'?'hover active':st);else html.removeAttribute('data-clay-state');
    ui.dock.classList.toggle('dressing',!!st);q('.t-state .st').textContent=st?STATES[st].label:'';fitDock();
    hidePill();refreshSel();if(selected)inspect(selected);
    if(quiet)return;
    if(st==='focus'&&anchor&&!anchor.matches('a[href],button,input,select,textarea,summary,[tabindex]'))say('Focus: '+nameOf(anchor)+' can’t be reached by keyboard, so this look shows only if it gets a tabindex.');
    else say(st?STATES[st].label+': paint, stretch or use the inspector to style how '+(anchor?nameOf(anchor)+' and what’s inside it look ':'things look ')+STATES[st].when+'. Esc comes back.':'Back to the normal look. Hide the studio (Esc) to try the states for real.');
  }
  // L steps through the looks: normal, hover, focus, pressed.
  function nextDress(){setDress(dress?ORDER_ST[ORDER_ST.indexOf(dress)+1]||'':ORDER_ST[0]);}
  function dressed(){if(!dress)return false;say('Arranging is the same in every state. Press Esc to leave '+STATES[dress].label+' first.');return true;}

  // ---- Grab ----
  var on=true,tool='grab',drag=null,stretch=null,lasso=null,painting=null,pointer={x:0,y:0},lastHover=null,stuckPress=null;
  function lift(el){var s=el.style;drag.orig={z:s.zIndex,pos:s.position,shadow:s.boxShadow,pe:s.pointerEvents};
    if(getComputedStyle(el).position==='static')s.position='relative';s.zIndex='60';s.boxShadow='0 24px 60px rgba(20,26,38,.28)';s.pointerEvents='none';}
  function unlift(el,o){var s=el.style;s.zIndex=o.z;s.position=o.pos;s.boxShadow=o.shadow;s.pointerEvents=o.pe;}
  function overTrash(x,y){var r=ui.trash.getBoundingClientRect();return Math.hypot(x-(r.left+r.width/2),y-(r.top+r.height/2))<r.width*.8;}
  // While something is dragged, every reading (where it would land, what it snaps to, what layout that makes) is
  // taken from the page as it was when the drag began, so the live preview never feeds back into itself.
  function geo(d){
    var B=d.base;
    if(!B)return {rect:layoutRect,kids:kids,gaps:function(c){var cs=getComputedStyle(c);return {col:parseFloat(cs.columnGap)||0,row:parseFloat(cs.rowGap)||0,display:cs.display};}};
    return {rect:function(k){var r=B.rects.get(k);if(!r)return layoutRect(k);var sx=scrollX,sy=scrollY;return {left:r.left-sx,top:r.top-sy,right:r.right-sx,bottom:r.bottom-sy,width:r.width,height:r.height};},
      kids:function(c){return B.kids.get(c)||[];},gaps:function(c){return B.gaps.get(c)||{col:0,row:0};}};
  }
  function baseCapture(d){
    var sx=scrollX,sy=scrollY,rects=new Map(),ks=new Map(),gaps=new Map();
    [root].concat(Array.prototype.slice.call(root.querySelectorAll('*'))).forEach(function(e){
      if(ours(e))return;var r=layoutRect(e);rects.set(e,{left:r.left+sx,top:r.top+sy,right:r.right+sx,bottom:r.bottom+sy,width:r.width,height:r.height});
      var k=kids(e);if(k.length){ks.set(e,k);var cs=getComputedStyle(e);gaps.set(e,{col:parseFloat(cs.columnGap)||0,row:parseFloat(cs.rowGap)||0,display:cs.display});}
    });
    d.base={rects:rects,kids:ks,gaps:gaps,layers:JSON.parse(JSON.stringify(layers)),reasons:Object.assign({},reasons),orders:capture()};
    d.touched={};d.touched[idOf(d.from)]=d.from;d.shown='base';d.G=geo(d);
    var lc=getComputedStyle(d.el),empty=!d.el.children.length&&!d.el.textContent.trim();d.look={};
    (empty?['background-color','border-radius','width','height']:LOOK).forEach(function(k){d.look[k]=lc.getPropertyValue(k);});
  }
  // Where a dragged thing would land: its own container, another container of things like it under the pointer, or
  // failing those, whatever box it is over.
  function targetAt(x,y,el,G){
    var hit=null,px=x+scrollX,py=y+scrollY;
    drag.base.rects.forEach(function(r,k){if(k!==el&&!el.contains(k)&&px>=r.left&&px<=r.right&&py>=r.top&&py<=r.bottom)hit=k;});
    var like=function(k){return k!==el&&k.tagName===el.tagName&&(drag.fresh&&!el.className||k.className===el.className);};
    for(var a=hit;a&&inRoot(a);a=a.parentElement){
      if(a===drag.from&&!drag.fresh)return a;
      if(freeCanvas(a))break;
      if(G.kids(a).some(like))return a;
      if(a===root)break;
    }
    // something new goes into the nearest box of text it lands in
    if(drag.fresh)for(var b=hit;b&&inRoot(b)&&b!==root&&!freeCanvas(b);b=b.parentElement)if(G.kids(b).some(function(k){return k!==el&&textish(k);}))return b;
    // anywhere else: the nearest box that holds blocks of its own (text and empty boxes pass it up to theirs; a free
    // canvas takes nothing)
    for(var c=hit;c&&inRoot(c)&&!freeCanvas(c);c=c.parentElement)if(!TEXT.test(c.tagName)&&G.kids(c).some(function(k){return k!==el;}))return c;
    return drag.from;
  }
  // Drop zones: the left or right third of a sibling puts it beside, the middle above or below.
  function slotAt(x,y,target,el,G){
    var item=null,r=null;
    G.kids(target).forEach(function(k){if(item||k===el)return;var b=G.rect(k);if(x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom){item=k;r=b;}});
    if(!item)return null;var fx=(x-r.left)/r.width;
    return {item:item,r:r,zone:fx<.3?'left':fx>.7?'right':y<r.top+r.height/2?'above':'below'};
  }
  function slotRows(target,el,s,G){
    var rs=rows(G.kids(target).filter(function(k){return k!==el;}),G.rect),ri=-1,pi=-1;
    rs.forEach(function(row,i){var j=row.items.indexOf(s.item);if(j>=0){ri=i;pi=j;}});if(ri<0)return null;
    if(s.zone==='left'||s.zone==='right')rs[ri].items.splice(s.zone==='left'?pi:pi+1,0,el);
    else rs.splice(s.zone==='above'?ri:ri+1,0,{items:[el],box:rs[ri].box});
    return rs;
  }
  // What letting go would do: the new rows, the order, and the layout they read as. The preview, the drag chip and
  // the drop itself all ask this, so what you see is what you get.
  function planDrop(d){
    var el=d.el,target=d.target||d.from,G=d.G||geo(d);
    // Read the arrangement from where the hand put it, not from where the spring has got to.
    var ix=d.ipx-scrollX,iy=d.ipy-scrollY,intent={left:ix,top:iy,width:d.w,height:d.h,right:ix+d.w,bottom:iy+d.h};
    var before=G.kids(target).filter(function(k){return k!==el;}),all=before.concat([el]);
    var rectOf=function(k){return k===el?intent:G.rect(k);};
    var s=d.slot&&before.indexOf(d.slot.item)>=0?d.slot:null,rsNew=s&&slotRows(target,el,s,G)||rows(all,rectOf),order=[];rsNew.forEach(function(r){order=order.concat(r.items);});
    var why=s?(s.zone==='left'||s.zone==='right'?'You put '+nameOf(el)+' beside '+nameOf(s.item)+'.':'You moved '+nameOf(el)+' '+s.zone+' '+nameOf(s.item)+'.'):null;
    var oldShape=rows(target===d.from?all:before,G.rect).map(function(r){return r.items.length;}).join();
    var newShape=rsNew.map(function(r){return r.items.length;}).join();
    var ctx=all.length>1&&(newShape!==oldShape||target!==d.from)?infer(target,rsNew,el,rectOf,!s,why,G.gaps):null;
    // a stack dropped into ordinary flow needs no layout: it already stacks
    if(ctx&&ctx.cols===1&&!/grid|flex/.test(G.gaps(target).display||''))ctx=null;
    return {target:target,s:s,order:order,why:why,ctx:ctx};
  }
  // The order goes in first, so a thing arriving from another container gets the layout's spacing like the rest.
  function applyPlan(d,p){var how=applyOrder(p.target,p.order,p.target===d.from);if(p.target!==d.from&&d.look&&!d.fresh)keepLook(d);if(p.ctx)applyLayout(p.ctx,p.ctx.kinds[0]);return how;}
  // Moved somewhere new, a thing keeps the look its old place gave it: colours, type, corners, and an empty box's size.
  var LOOK=['color','background-color','font-size','font-weight','border-radius'];
  function keepLook(d){
    var el=d.el,cs=getComputedStyle(el),out={};
    Object.keys(d.look).forEach(function(k){var v=d.look[k];if(v&&cs.getPropertyValue(k)!==v)out[k]=k==='font-size'?round(parseFloat(v)/16)+'rem':v;});
    if(!Object.keys(out).length)return;setRule(el,out,'base');
    var rk='base:'+idOf(el);if(!/keeps its look/.test(reasons[rk]||''))reasons[rk]=((reasons[rk]||'')+' It keeps its look in its new place.').trim();
  }
  function unpreviewNow(d){
    layers=JSON.parse(JSON.stringify(d.base.layers));reasons=Object.assign({},d.base.reasons);
    Object.keys(d.touched).forEach(function(id){var c=d.touched[id];(d.base.orders[id]||[]).forEach(function(kid){var k=byId(kid);if(k)c.appendChild(k);});});
    render();
  }
  function planKey(p){if(!p)return 'base';var c=p.ctx;return idOf(p.target)+'|'+p.order.map(idOf).join()+'|'+(c?c.kinds[0]+c.cols+'/'+c.colGap+'/'+c.rowGap:'');}
  // Live reflow: the page shows the plan for real (order, layout and all) and everything else slides into place.
  function preview(d,p){
    var key=planKey(p);if(key===d.shown)return;d.shown=key;if(p)d.touched[idOf(p.target)]=p.target;
    var el=d.el,around=kids(root);Object.keys(d.touched).forEach(function(id){around=around.concat(d.base.kids.get(d.touched[id])||[]);});
    around=around.filter(function(k){return k!==el&&!el.contains(k);});
    var b0=layoutRect(el);hush=true;
    try{flip(around,function(){unpreviewNow(d);if(p)applyPlan(d,p);});}finally{hush=false;}
    // the dragged thing keeps its place under the hand while its place in the layout moves
    var b1=layoutRect(el),m=motion(el);m.x-=b1.left-b0.left;m.y-=b1.top-b0.top;draw(el,m);
  }
  // The dragged thing follows the hand; if the preview gives it a new size, the hand keeps its grip at the same spot.
  function follow(d){
    var el=d.el,m=motion(el),r=layoutRect(el),gx=d.gx*(r.width/d.w),gy=d.gy*(r.height/d.h);
    m.held=true;m.tx=d.ipx+d.gx-gx-(r.left+scrollX);m.ty=d.ipy+d.gy-gy-(r.top+scrollY);go();
  }
  function dragUI(){ui.target.style.display='none';box(ui.slot,null);box(ui.ghost,null);ui.trash.style.display='none';ui.trash.classList.remove('hot');chip(null);clearGuides();}
  function drop(e){
    var d=drag;drag=null;var el=d.el,dropRect=el.getBoundingClientRect(),target=d.target||d.from,trashed=!!e&&overTrash(e.clientX,e.clientY);
    unlift(el,d.orig);dragUI();
    if(trashed){
      var m1=motions.get(el);if(m1){motions.delete(el);el.style.translate=el.style.scale=el.style.transformOrigin='';}
      var around=kids(d.from).filter(function(k){return k!==el;});
      flip(around.concat(kids(root)),function(){if(d.base)unpreviewNow(d);made[idOf(el)]=el;el.remove();});
      if(d.fresh){delete inserted[idOf(el)];render();say('Nothing was added.');return;}
      commit(d.before);select(null);
      pill(around[0]||root,'You threw '+nameOf(el)+' away.','Ctrl+Z brings it back.','');return;
    }
    var plan=planDrop(d),order=plan.order,why=plan.why,ctx=plan.ctx,note='';lastWhy='';
    var affected=kids(target).concat(target!==d.from?kids(d.from):[],[el],kids(root));
    flip(affected,function(){
      if(d.base)unpreviewNow(d);
      // On a smaller screen, reordering inside a grid or flex container uses CSS order, so larger screens keep theirs.
      if(applyPlan(d,plan)==='css')because(target,why||'You reordered it on '+BPS[bp].label+'.');
      else if(bp!=='base')note='Element order changes apply at every size.';
    },{el:el,rect:dropRect});
    commit(d.before);
    if(d.copy)say('Copied.');
    if(ctx)showLayout(ctx);
    else{hidePill();pill(target,d.fresh?'You added '+nameOf(el)+' to '+nameOf(target)+'.':target!==d.from?'You moved '+nameOf(el)+' into '+nameOf(target)+'.':(why||'You reordered '+nameOf(target)+'.'),'New order: '+order.map(nameOf).join(', '),note);}
    if(d.fresh&&canType(el))startEdit(el);
  }
  // Esc mid-drag: everything slides back and nothing is recorded.
  function cancelDrag(){
    var d=drag;drag=null;var el=d.el,r=el.getBoundingClientRect();unlift(el,d.orig);dragUI();html.style.cursor='';
    flip(kids(root).concat(kids(d.from),[el]),function(){if(d.base)unpreviewNow(d);if(d.copy||d.fresh){made[idOf(el)]=el;el.remove();delete copyOf[idOf(el)];delete inserted[idOf(el)];render();}},{el:el,rect:r});
    say(d.fresh?'Nothing was added.':d.copy?'Copy cancelled.':'Cancelled: everything went back.');
  }

  // ---- Stretch ----
  function hitStretch(x,y){
    var best=null;
    // gaps belong to the layout, which is the same in every state, and a free canvas has none
    if(!dress)containers().forEach(function(c){if(freeCanvas(c))return;
      var ks=kids(c);for(var i=0;i<ks.length;i++)for(var j=0;j<ks.length;j++){if(i===j)continue;
        var a=ks[i].getBoundingClientRect(),b=ks[j].getBoundingClientRect();
        var ox=Math.min(a.right,b.right)-Math.max(a.left,b.left);
        var gy=b.top-a.bottom<8?3:0,gx=b.left-a.right<8?3:0;
        if(ox>20&&b.top>=a.bottom-2&&b.top-a.bottom<200&&y>=a.bottom-gy&&y<=b.top+gy&&x>=Math.max(a.left,b.left)&&x<=Math.min(a.right,b.right)){
          var area=ox*(b.top-a.bottom+12);if(!best||area<best.area)best={kind:'gap',axis:'y',c:c,a:ks[i],b:ks[j],area:area,band:{left:Math.max(a.left,b.left),top:a.bottom,width:ox,height:Math.max(6,b.top-a.bottom)}};}
        var oy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        if(oy>20&&b.left>=a.right-2&&b.left-a.right<200&&x>=a.right-gx&&x<=b.left+gx&&y>=Math.max(a.top,b.top)&&y<=Math.min(a.bottom,b.bottom)){
          var area2=oy*(b.left-a.right+12);if(!best||area2<best.area)best={kind:'gap',axis:'x',c:c,a:ks[i],b:ks[j],area:area2,band:{left:a.right,top:Math.max(a.top,b.top),width:Math.max(6,b.left-a.right),height:oy}};}
      }
    });
    if(best)return best;
    var el=doc.elementFromPoint(x,y);if(!inRoot(el))return null;
    for(var t=el;t&&t!==root;t=t.parentElement){if(!isBlock(t))continue;var r=t.getBoundingClientRect();
      if(x<=r.right+2&&x>=r.right-8&&y>r.top&&y<r.bottom)return {kind:'width',el:t,r:r};
      // the bottom edge of text sizes the text; of anything else, its padding
      if(y<=r.bottom+2&&y>=r.bottom-8&&x>r.left&&x<r.right)return {kind:textish(t)?'font':'height',el:t,r:r};}
    return null;
  }
  function startStretch(h){
    if(h.kind==='gap'){var cs=getComputedStyle(h.c);h.flow=/grid|flex/.test(cs.display);var ar=h.a.getBoundingClientRect(),br=h.b.getBoundingClientRect();
      h.v0=h.flow?(parseFloat(h.axis==='y'?cs.rowGap:cs.columnGap)||0):(h.axis==='y'?br.top-ar.bottom:br.left-ar.right);}
    else if(h.kind==='width'){var pr=h.el.parentElement.getBoundingClientRect();h.v0=h.r.width;h.centered=h.r.left-pr.left>1&&Math.abs((h.r.left-pr.left)-(pr.right-h.r.right))<2;}
    else if(h.kind==='font'){h.v0=parseFloat(getComputedStyle(h.el).fontSize);h.h0=h.r.height;}
    else{var cs2=getComputedStyle(h.el);h.v0=(parseFloat(cs2.paddingTop)+parseFloat(cs2.paddingBottom))/2;}
    h.value=null;
  }
  function moveStretch(h,dx,dy){
    var v,label,el,why,props={};
    if(h.kind==='gap'){
      var raw=Math.max(0,h.v0+(h.axis==='y'?dy:dx));
      if(h.flow){v=snap(raw,PX);var prop=h.axis==='y'?'row-gap':'column-gap';props[prop]=v+'px';el=h.c;label=prop+': '+v+'px';}
      else{v=snap(raw/16,REM);el=h.a;label=(h.axis==='y'?'margin-bottom: ':'margin-right: ')+v+'rem';props[h.axis==='y'?'margin-bottom':'margin-right']=v+'rem';}
      why='You pulled apart '+nameOf(h.a)+' and '+nameOf(h.b)+'.';
    }
    else if(h.kind==='width'){var rawW=Math.max(160,h.v0+(h.centered?2:1)*dx),like=h.like=widthMatch(h,rawW);v=like?like.w:snap(rawW,WIDTHS);el=h.el;props={'max-width':v+'px','margin-left':'auto','margin-right':'auto'};
      label='max-width: '+v+'px · centered'+(like?' · same as '+shortName(like.el):'');why=like?'You matched '+nameOf(h.el)+' to the width of '+nameOf(like.el)+'.':'You pulled '+nameOf(h.el)+' to a new width.';}
    else if(h.kind==='font'){v=snap(h.v0*Math.max(.3,(h.h0+dy)/h.h0),TYPE);el=h.el;props={'font-size':round(v/16)+'rem'};label='font-size: '+round(v/16)+'rem ('+v+'px)';why='You scaled '+nameOf(h.el)+' to '+v+'px text.';}
    else{v=snap(Math.max(0,h.v0+dy/2),PX);el=h.el;props={'padding-top':v+'px','padding-bottom':v+'px'};label='padding-block: '+v+'px';why='You pulled '+nameOf(h.el)+' taller.';}
    if(v===h.value)return;h.value=v;
    var moving=h.kind==='gap'?kids(h.c):kids(el.parentElement||root);
    flip(moving.concat([el]),function(){setOwn(el,props);if(h.kind==='gap'&&!h.flow&&h.axis==='y'){setOwn(h.b,{'margin-top':'0'});because(h.b,'So only the margin above it sets the gap.');}});
    if(h.kind==='width')widthGuides(el,h.like&&h.like.el,v);
    // one stretch, one reason: the steps along the way don't pile up in the rule's comment
    var rk=bp+':'+dkey(el);if(h.rk!==rk){h.rk=rk;h.r0=reasons[rk];}else if(h.r0===undefined)delete reasons[rk];else reasons[rk]=h.r0;
    because(el,why);h.changed=true;pill(el,why,label+(dress?' · '+STATES[dress].label:'')+(bp!=='base'?' · '+BPS[bp].label+' and smaller':''),'');
  }

  // ---- Paint ----
  var paintMode='fill',paintColor=null,paintMat='soft';
  function paintbar(){
    var b=ui.paintbar;b.innerHTML='';if(!paintColor)paintColor=palette()[0];
    var modes=mk('div','segs');[['fill','Fill'],['text','Text'],['border','Border'],['material','Material']].forEach(function(m){var x=mk('button','btn',m[1]);x.setAttribute('aria-pressed',String(paintMode===m[0]));x.addEventListener('click',function(){paintMode=m[0];paintbar();});modes.appendChild(x);});
    b.appendChild(modes);
    if(paintMode==='material')Object.keys(MATERIALS).forEach(function(k){var x=mk('button','btn',MATERIALS[k].label);x.setAttribute('aria-pressed',String(paintMat===k));x.addEventListener('click',function(){paintMat=k;paintbar();});b.appendChild(x);});
    else{palette().forEach(function(h){var x=mk('button','sw');x.style.background=h;x.title=h;x.setAttribute('aria-pressed',String(paintColor===h));x.addEventListener('click',function(){paintColor=h;paintbar();});b.appendChild(x);});
      var c=mk('input');c.type='color';c.value=paintColor;c.title='Any colour';c.addEventListener('input',function(){paintColor=c.value;});c.addEventListener('change',paintbar);b.appendChild(c);}
  }
  function paintOne(el){
    if(paintMode==='fill'){setOwn(el,{'background-color':paintColor,'background-image':'none'});because(el,'You painted '+nameOf(el)+' '+paintColor+'.');}
    else if(paintMode==='text'){setOwn(el,{color:paintColor});because(el,'You painted '+nameOf(el)+'’s text '+paintColor+'.');}
    else if(paintMode==='border'){setOwn(el,{'border-width':'1.5px','border-style':'solid','border-color':paintColor});because(el,'You outlined '+nameOf(el)+' in '+paintColor+'.');}
    else{setOwn(el,MATERIALS[paintMat].css);because(el,'You gave '+nameOf(el)+' the '+MATERIALS[paintMat].label.toLowerCase()+' material.');}
  }
  function paintAt(x,y){
    var t=doc.elementFromPoint(x,y);if(!inRoot(t)||host.contains(t))return;
    var el=paintMode==='text'?textTarget(t):pickItem(t,false);if(!el||painting.done.has(el))return;
    painting.done.add(el);paintOne(el);painting.changed=true;var r=el.getBoundingClientRect();box(ui.hover,r,2);
  }

  // ---- Commands: type what you want ----
  var COMMANDS=[
    {ex:['3 columns','2 columns','4 across'],re:/^(\d+)\s*(col|cols|columns?|across|up)$/,t:function(m){return m[1]+' across, as a responsive grid';},run:function(m,el){layoutTo(container(el),'grid-auto',+m[1]);}},
    {ex:['grid 3'],re:/^grid\s*(\d+)?$/,t:function(m){return 'Always '+(m[1]||2)+' columns';},run:function(m,el){layoutTo(container(el),'grid-fixed',+(m[1]||2));}},
    {ex:['row','column','stack','wrap'],re:/^(row|column|stack|wrap)$/,t:function(m){return 'Flow as a '+m[1];},run:function(m,el){flow(container(el),m[1]==='stack'?'column':m[1]);}},
    {ex:['center','start','end','spread'],re:/^(center|centre|start|end|spread)$/,t:function(m){return 'Gravity: '+m[1];},run:function(m,el){var c=container(el);gravity(c,m[1]==='centre'?'center':m[1]);}},
    {ex:['gap 32'],re:/^gap\s*(\d+)$/,t:function(m){return 'Gap of '+m[1]+'px';},run:function(m,el){var c=container(el);if(freeCanvas(c)&&stays(kids(c)))return;act(function(){flip(kids(c),function(){if(!flowing(c))flowNow(c,'column');setOwn(c,{'row-gap':m[1]+'px','column-gap':m[1]+'px'});because(c,'You set the gap to '+m[1]+'px.');});});select(c);}},
    {look:true,ex:['padding 48'],re:/^pad(?:ding)?\s*(\d+)$/,t:function(m){return 'Padding of '+m[1]+'px all round';},run:function(m,el){act(function(){setOwn(el,{padding:m[1]+'px'});because(el,'You set '+m[1]+'px of padding.');});select(el);}},
    {look:true,ex:['width 960'],re:/^(?:width|max(?:-?width)?)\s*(\d+)$/,t:function(m){return 'At most '+m[1]+'px wide, centered';},run:function(m,el){act(function(){setOwn(el,{'max-width':m[1]+'px','margin-left':'auto','margin-right':'auto'});because(el,'You set a '+m[1]+'px max width.');});select(el);}},
    {look:true,ex:['bigger','smaller'],re:/^(bigger|larger|smaller)$/,t:function(m){return 'Text one step '+(m[1]==='smaller'?'smaller':'bigger');},run:function(m,el){var t=textish(el)?el:el;var v=parseFloat(getComputedStyle(t).fontSize),i=TYPE.indexOf(snap(v,TYPE));var nv=TYPE[Math.max(0,Math.min(TYPE.length-1,i+(m[1]==='smaller'?-1:1)))];
      act(function(){setOwn(t,{'font-size':round(nv/16)+'rem'});because(t,'You made the text '+nv+'px.');});select(t);}},
    {look:true,ex:['size 48'],re:/^(?:size|font|text)\s*(\d+)$/,t:function(m){return 'Text at '+m[1]+'px';},run:function(m,el){act(function(){setOwn(el,{'font-size':round(+m[1]/16)+'rem'});because(el,'You set '+m[1]+'px text.');});select(el);}},
    {look:true,ex:['bold','weight 600'],re:/^(?:bold|weight\s*(\d{3}))$/,t:function(m){return 'Weight '+(m[1]||700);},run:function(m,el){act(function(){setOwn(el,{'font-weight':m[1]||'700'});});select(el);}},
    {look:true,ex:['round','pill','square'],re:/^(round|rounded|pill|square)$/,t:function(m){return {round:'Rounded corners',rounded:'Rounded corners',pill:'Pill shape',square:'Square corners'}[m[1]];},run:function(m,el){act(function(){setOwn(el,{'border-radius':m[1]==='pill'?'999px':m[1]==='square'?'0':'16px'});});select(el);}},
    {look:true,ex:['shadow soft','shadow lifted','shadow glow','no shadow'],re:/^(?:shadow\s*(soft|lifted|glow|none)|no shadow)$/,t:function(m){return 'Shadow: '+(m[1]||'none');},run:function(m,el){act(function(){setOwn(el,{'box-shadow':SHADOWS[m[1]||'none']});because(el,'You gave it a '+(m[1]||'no')+' shadow.');});select(el);}},
    {look:true,ex:['glass','outline','flat'],re:/^(glass|outline|flat|soft|lifted|glow)$/,t:function(m){return MATERIALS[m[1]].label+' material';},run:function(m,el){act(function(){setOwn(el,MATERIALS[m[1]].css);because(el,'You gave it the '+m[1]+' material.');});select(el);}},
    {look:true,ex:['color #1d2330','text white'],re:/^(?:colou?r|text)\s+(\S+)$/,t:function(m){return 'Text colour '+m[1];},ok:function(m){return colorOk(m[1]);},run:function(m,el){act(function(){setOwn(el,{color:colorOk(m[1])});});select(el);}},
    {look:true,ex:['fill #ffcc4d','background white'],re:/^(?:fill|bg|background)\s+(\S+)$/,t:function(m){return 'Fill '+m[1];},ok:function(m){return colorOk(m[1]);},run:function(m,el){act(function(){setOwn(el,{'background-color':colorOk(m[1]),'background-image':'none'});});select(el);}},
    {ex:['pin','group','duplicate','delete'],re:/^(pin|unpin|group|ungroup|duplicate|delete|remove)$/,t:function(m){return m[1][0].toUpperCase()+m[1].slice(1);},run:function(m,el){
      if(m[1]==='group'){if(multi.length<2)say('Select two or more things first (Shift+click).');else group();}else if(m[1]==='ungroup')ungroup(el);else if(m[1]==='duplicate')duplicate(multi.length?multi:[el]);else if(m[1]==='delete'||m[1]==='remove')remove(multi.length?multi:[el]);else pin(el);}},
    {ex:['edit text'],re:/^edit(?: text)?$/,t:function(){return 'Edit the text';},run:function(m,el){startEdit(textish(el)?el:el.querySelector('h1,h2,h3,h4,p,a,button,blockquote')||el);}},
    {ex:['play'],re:/^play$/,t:function(){return 'Play mode';},free:true,run:function(){togglePlay(true);}},
    {ex:['hover','focus','pressed','normal'],re:/^(?:on\s+|when\s+)?(hover|hovered|focus|focused|press|pressed|active|normal)$/,t:function(m){var s=stateWord(m[1]);return s?'Style the '+STATES[s].label.toLowerCase()+' look':'Back to the normal look';},free:true,
      run:function(m,el){if(el&&el!==selected&&!multi.length)select(el);setDress(stateWord(m[1]));}},
    {look:true,ex:['circle','slant','wave','arch'],re:/^(?:carve\s+)?(circle|slant|wave|arch|ticket)$/,t:function(m){return 'Carve into '+(m[1]==='arch'?'an ':'a ')+m[1];},run:function(m,el){act(function(){setOwn(el,{'clip-path':CARVES[m[1]].css});because(el,'You carved it into '+(m[1]==='arch'?'an ':'a ')+m[1]+'.');});select(el);}},
    {ex:['add heading','add text','add button','add image'],re:/^(?:add|insert|new)\s+(heading|title|text|paragraph|button|image|picture|quote|divider|line|section)$/,t:function(m){return 'Add a '+m[1]+' after it';},
      run:function(m,el){insertAfter({title:'heading',paragraph:'text',picture:'image',line:'divider'}[m[1]]||m[1],el);}},
    {ex:['history'],re:/^(history|rewind|timeline)$/,t:function(){return 'History: scrub through changes';},free:true,run:function(){rewind(true);}},
    {ex:['desktop','tablet','phone'],re:/^(desktop|tablet|phone|mobile)$/,t:function(m){return 'Preview '+m[1];},free:true,run:function(m){setBP(m[1]==='desktop'?'base':m[1]==='phone'?'mobile':m[1]);}},
    {ex:['undo','redo'],re:/^(undo|redo)$/,t:function(m){return m[1][0].toUpperCase()+m[1].slice(1);},free:true,run:function(m){m[1]==='undo'?back():forward();}},
    {ex:['copy css','copy for agent','download page','reset page','help'],re:/^(copy css|css|copy for agent|agent|download page|download|reset page|help)$/,t:function(m){return m[1][0].toUpperCase()+m[1].slice(1);},free:true,run:function(m){
      var k=m[1];if(k==='help')help(true);else if(k.indexOf('download')===0)downloadPage();else if(k==='reset page')resetPage();else{view=k.indexOf('agent')>=0?'list':'css';openPanel();copy();}}}
  ];
  function stateWord(w){return /^hover/.test(w)?'hover':/^focus/.test(w)?'focus':/^(press|active)/.test(w)?'active':'';}
  function colorOk(v){if(/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v))v='#'+v;return CSS.supports('color',v)?v:null;}
  var cmdSel=0,cmdItems=[];
  function cmdTarget(){return selected||(multi.length?multi[0]:null)||lastHover;}
  function cmdMatches(text){
    text=text.trim().toLowerCase();var out=[];
    COMMANDS.forEach(function(c){var m=c.re.exec(text);if(m&&(!c.ok||c.ok(m)))out.push({c:c,m:m,label:c.t(m),exact:true});});
    COMMANDS.forEach(function(c){c.ex.forEach(function(x){if(out.length>=8)return;if(!text||x.indexOf(text)>=0||text.split(' ').every(function(w){return x.indexOf(w)>=0;})){var m=c.re.exec(x);if(m&&!out.some(function(o){return o.label===c.t(m);}))out.push({c:c,m:m,label:c.t(m),ex:x});}});});
    return out.slice(0,8);
  }
  function cmdRender(){
    cmdItems=cmdMatches(ui.cmdIn.value);cmdSel=Math.min(cmdSel,Math.max(0,cmdItems.length-1));ui.cmdList.innerHTML='';
    cmdItems.forEach(function(it,i){var li=mk('li'+'');li.className=i===cmdSel?'on':'';var b=mk('b','',it.label);li.appendChild(b);li.appendChild(mk('small','',it.exact?'Enter':it.ex));
      li.addEventListener('mousedown',function(e){e.preventDefault();cmdRun(it);});ui.cmdList.appendChild(li);});
  }
  function cmdOpen(){if(playing)togglePlay(false,true);ui.cmd.style.display='block';ui.cmdIn.value='';cmdSel=0;cmdRender();setTimeout(function(){ui.cmdIn.focus();},0);}
  function cmdClose(){ui.cmd.style.display='none';ui.cmdIn.blur();}
  function cmdRun(it){
    var el=cmdTarget();cmdClose();if(!it)return;
    if(!it.c.free&&!el){say('Select something first, or point at it, then press Ctrl+K.');return;}
    if(!it.c.free&&!it.c.look&&dressed())return;
    it.c.run(it.m,el);
  }
  ui.cmdIn.addEventListener('input',function(){cmdSel=0;cmdRender();});
  ui.cmdIn.addEventListener('keydown',function(e){
    if(e.key==='Escape'){e.preventDefault();cmdClose();return;}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();cmdSel=(cmdSel+(e.key==='ArrowDown'?1:-1)+cmdItems.length)%Math.max(1,cmdItems.length);cmdRender();return;}
    if(e.key==='Enter'){e.preventDefault();cmdRun(cmdItems[cmdSel]);}
  });

  // ---- Measure: hold Alt ----
  // With something selected, the distances from it to what you point at; with nothing selected, the pointed thing's
  // own spacing, margin in orange and padding in green.
  var altHeld=false;
  function clearMeasure(){ui.meas.innerHTML='';}
  function mline(x1,y1,x2,y2,val){
    var v=x1===x2,d=mk('div','ln '+(v?'v':'h'));d.style.left=Math.min(x1,x2)+'px';d.style.top=Math.min(y1,y2)+'px';
    if(v)d.style.height=Math.abs(y2-y1)+'px';else d.style.width=Math.abs(x2-x1)+'px';ui.meas.appendChild(d);
    var l=mk('div','lb',String(Math.round(val)));l.style.left=(x1+x2)/2+'px';l.style.top=(y1+y2)/2+'px';ui.meas.appendChild(l);
  }
  function measure(el){
    clearMeasure();if(!el)return;var B=el.getBoundingClientRect();
    var ob=mk('div','ob');ob.style.left=B.left+'px';ob.style.top=B.top+'px';ob.style.width=B.width+'px';ob.style.height=B.height+'px';ui.meas.appendChild(ob);
    if(selected&&selected!==el&&selected.isConnected){
      var A=selected.getBoundingClientRect(),inner=function(P,C){var cx=C.left+C.width/2,cy=C.top+C.height/2;
        if(C.top-P.top>0)mline(cx,P.top,cx,C.top,C.top-P.top);if(P.bottom-C.bottom>0)mline(cx,C.bottom,cx,P.bottom,P.bottom-C.bottom);
        if(C.left-P.left>0)mline(P.left,cy,C.left,cy,C.left-P.left);if(P.right-C.right>0)mline(C.right,cy,P.right,cy,P.right-C.right);};
      if(B.left<=A.left&&B.right>=A.right&&B.top<=A.top&&B.bottom>=A.bottom)inner(B,A);
      else if(A.left<=B.left&&A.right>=B.right&&A.top<=B.top&&A.bottom>=B.bottom)inner(A,B);
      else{
        var ox=[Math.max(A.left,B.left),Math.min(A.right,B.right)],oy=[Math.max(A.top,B.top),Math.min(A.bottom,B.bottom)];
        var mx=ox[0]<ox[1]?(ox[0]+ox[1])/2:A.left+A.width/2,my=oy[0]<oy[1]?(oy[0]+oy[1])/2:A.top+A.height/2;
        if(B.top>=A.bottom)mline(mx,A.bottom,mx,B.top,B.top-A.bottom);else if(A.top>=B.bottom)mline(mx,B.bottom,mx,A.top,A.top-B.bottom);
        if(B.left>=A.right)mline(A.right,my,B.left,my,B.left-A.right);else if(A.left>=B.right)mline(B.right,my,A.left,my,A.left-B.right);
      }
      tagAt(nameOf(el),B);return;
    }
    var cs=getComputedStyle(el),side=['Top','Right','Bottom','Left'],m=side.map(function(s){return parseFloat(cs['margin'+s])||0;}),p=side.map(function(s){return parseFloat(cs['padding'+s])||0;});
    var area=function(cls,x,y,w,h,val){if(w<=0||h<=0)return;var a=mk('div',cls);a.style.left=x+'px';a.style.top=y+'px';a.style.width=w+'px';a.style.height=h+'px';ui.meas.appendChild(a);
      if(val){var l=mk('div','lb '+(cls==='mg'?'m':'p'),String(Math.round(val)));l.style.left=x+w/2+'px';l.style.top=y+h/2+'px';ui.meas.appendChild(l);}};
    area('mg',B.left,B.top-m[0],B.width,m[0],m[0]);area('mg',B.right,B.top,m[1],B.height,m[1]);area('mg',B.left,B.bottom,B.width,m[2],m[2]);area('mg',B.left-m[3],B.top,m[3],B.height,m[3]);
    area('pd',B.left,B.top,B.width,p[0],p[0]);area('pd',B.right-p[1],B.top+p[0],p[1],B.height-p[0]-p[2],p[1]);area('pd',B.left,B.bottom-p[2],B.width,p[2],p[2]);area('pd',B.left,B.top+p[0],p[3],B.height-p[0]-p[2],p[3]);
    tagAt(nameOf(el)+' · '+Math.round(B.width)+' × '+Math.round(B.height),B);
  }
  // While dragging, a chip says what letting go would do.
  function shortName(el){var n=nameOf(el),m=/“(.*)”/.exec(n);return m?'“'+m[1]+'”':n;}
  function readout(sl,p,x,y){
    if(!sl){chip(null);return;}
    var g=p.ctx?p.ctx.colGap:snap(Math.max(8,drag.G.gaps(p.target).col||24),PX);
    chip(sl.zone==='left'||sl.zone==='right'?'Beside '+shortName(sl.item)+' · '+g+'px gap':(sl.zone==='above'?'Above ':'Below ')+shortName(sl.item),x,y);
  }

  // ---- Edit text in place: double-click ----
  var editing=null;
  function startEdit(el){
    if(!el||editing||!inRoot(el))return;var id=idOf(el);if(!(id in originTexts))originTexts[id]=el.textContent;edited[id]=true;
    select(null);hidePill();var before=snapshot();
    editing={el:el,before:before,html0:el.innerHTML,outline:el.style.outline,offset:el.style.outlineOffset};
    try{el.contentEditable='plaintext-only';}catch(e){}if(el.contentEditable!=='plaintext-only')el.contentEditable='true';
    el.style.outline='2px solid #4f7cff';el.style.outlineOffset='3px';el.focus();
    var r=doc.createRange();r.selectNodeContents(el);var s=getSelection();s.removeAllRanges();s.addRange(r);
    el.addEventListener('keydown',editKeys);el.addEventListener('blur',editBlur);
    say('Editing text · Enter keeps it · Esc cancels');
  }
  function editKeys(e){e.stopPropagation();if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();endEdit(true);}else if(e.key==='Escape'){e.preventDefault();endEdit(false);}}
  function editBlur(){endEdit(true);}
  function endEdit(keep){
    var ed=editing;if(!ed)return;editing=null;var el=ed.el;
    el.removeEventListener('keydown',editKeys);el.removeEventListener('blur',editBlur);el.removeAttribute('contenteditable');
    el.style.outline=ed.outline;el.style.outlineOffset=ed.offset;if(!el.getAttribute('style'))el.removeAttribute('style');
    try{getSelection().removeAllRanges();}catch(e){}
    if(!keep)el.innerHTML=ed.html0;
    select(el);
    if(keep&&el.innerHTML!==ed.html0){commit(ed.before);render();pill(el,'You rewrote '+nameOf(el)+'.','The change list carries the new text for your source.','');}
  }

  // ---- Play: the fun tools, for demos. Only transforms, never rules; everything drifts home when you leave. ----
  var PLAY={meteor:'☄ Meteor',scatter:'✺ Scatter',swirl:'🌀 Swirl',hole:'● Black hole',quake:'〰 Quake'};
  var playing=false,ptool='meteor',ppieces=[],pactive=new Set(),praf=0,plast=0,pdown=null,pshocks=[],pleaving=false,PR=130;
  function playbar(){
    var b=ui.playbar;b.innerHTML='';b.appendChild(mk('span','lbl','PLAY'));b.appendChild(mk('span','hint','Hold on the page · Shift reverses · your layout is safe'));
    Object.keys(PLAY).forEach(function(k){var x=mk('button','btn',PLAY[k]);x.setAttribute('aria-pressed',String(ptool===k));x.addEventListener('click',function(){ptool=k;playbar();});b.appendChild(x);});
    var h=mk('button','btn lit','Everything home');h.addEventListener('click',function(){home(false);});b.appendChild(h);
    var x2=mk('button','btn','Back to work');x2.addEventListener('click',function(){togglePlay(false);});b.appendChild(x2);
  }
  // The pieces: boxes (cards and the like) move whole; otherwise the innermost blocks, so nothing moves twice.
  function collect(){
    ppieces=[];
    (function walk(el){Array.prototype.forEach.call(el.children,function(k){
      if(ours(k)||!isBlock(k))return;var r=k.getBoundingClientRect();if(!r.width||!r.height)return;
      if(boxy(k)&&k.parentElement!==root||!kids(k).length){ppieces.push({el:k,rx:r.left+scrollX+r.width/2,ry:r.top+scrollY+r.height/2,w:r.width,h:r.height,tx:0,ty:0,tr:0,ts:1,cx:0,cy:0,cr:0,cs:1,vx:0,vy:0,vr:0,vs:0,seed:Math.random()});return;}
      walk(k);});})(root);
    ppieces.forEach(function(p){p.el.style.transformOrigin='50% 50%';});
  }
  // Leaving drifts everything home; 'now' snaps it home at once, for when something else is about to move the page.
  function togglePlay(v,now){
    if(v===playing||v&&(drag||stretch||lasso||painting||editing))return;playing=v;q('.t-play').setAttribute('aria-pressed',String(v));
    if(v){select(null);hidePill();clearMeasure();box(ui.hover,null);tagAt(null);ui.paintbar.style.display='none';
      motions.forEach(function(m,el){el.style.translate=el.style.scale=el.style.transformOrigin='';});motions.clear();
      pleaving=false;if(!ppieces.length)collect();playbar();ui.playbar.style.display='flex';}
    else{pdown=null;ui.playbar.style.display='none';ui.pring.style.display='none';
      if(now){pactive.clear();pshocks.length=0;pfinish();}else home(true);if(tool==='paint'&&on)ui.paintbar.style.display='flex';}
  }
  function home(leaving){ppieces.forEach(function(p){p.tx=p.ty=p.tr=0;p.ts=1;pwake(p);});pleaving=!!leaving;if(leaving&&!praf)pfinish();}
  function pfinish(){ppieces.forEach(function(p){var s=p.el.style;s.translate=s.rotate=s.scale=s.transformOrigin='';});ppieces=[];pleaving=false;}
  function prun(){if(!praf){plast=performance.now();praf=requestAnimationFrame(pstep);}}
  function pwake(p){if(reduced){p.cx=p.tx;p.cy=p.ty;p.cr=p.tr;p.cs=p.ts;pdraw(p);return;}pactive.add(p);prun();}
  function pdraw(p){var s=p.el.style,moved=Math.abs(p.cx)>.05||Math.abs(p.cy)>.05||Math.abs(p.cr)>.001||Math.abs(p.cs-1)>.001;
    s.translate=moved?p.cx.toFixed(1)+'px '+p.cy.toFixed(1)+'px':'';s.rotate=moved?p.cr.toFixed(3)+'rad':'';s.scale=moved?p.cs.toFixed(3):'';}
  function pstep(now){
    var dt=Math.min(.033,Math.max(.001,(now-plast)/1000));plast=now;
    if(pdown)papply(dt);if(pshocks.length)pwaves(dt);
    var K=190,D=15;
    pactive.forEach(function(p){
      p.vx+=(K*(p.tx-p.cx)-D*p.vx)*dt;p.vy+=(K*(p.ty-p.cy)-D*p.vy)*dt;p.vr+=(K*(p.tr-p.cr)-D*p.vr)*dt;p.vs+=(K*(p.ts-p.cs)-D*p.vs)*dt;
      p.cx+=p.vx*dt;p.cy+=p.vy*dt;p.cr+=p.vr*dt;p.cs+=p.vs*dt;
      if(Math.abs(p.tx-p.cx)+Math.abs(p.ty-p.cy)<.05&&Math.abs(p.vx)+Math.abs(p.vy)<.05&&Math.abs(p.tr-p.cr)+Math.abs(p.ts-p.cs)<.0005&&Math.abs(p.vr)+Math.abs(p.vs)<.0005){
        p.cx=p.tx;p.cy=p.ty;p.cr=p.tr;p.cs=p.ts;p.vx=p.vy=p.vr=p.vs=0;pactive.delete(p);}
      pdraw(p);
    });
    praf=(pdown||pactive.size||pshocks.length)?requestAnimationFrame(pstep):0;
    if(!praf&&pleaving&&!playing)pfinish();
  }
  // Reach is measured to a piece's nearest edge, so wide blocks feel a hit anywhere on them.
  function preach(p,x,y,r){r=r||PR;var ex=Math.max(0,Math.abs(x-p.rx-p.tx)-p.w*p.cs/2),ey=Math.max(0,Math.abs(y-p.ry-p.ty)-p.h*p.cs/2),d=Math.hypot(ex,ey);if(d>=r)return 0;var k=1-(d/r)*(d/r);return k*k*(p.w*p.h>60000?.5:1);}
  function pdir(p,x,y){var dx=p.rx+p.tx-x,dy=p.ry+p.ty-y,d=Math.hypot(dx,dy);if(d<1){var a=p.seed*6.283;return {dx:Math.cos(a),dy:Math.sin(a),d:1};}return {dx:dx,dy:dy,d:d};}
  function papply(dt){
    var at={x:pdown.x+scrollX,y:pdown.y+scrollY},t=ptool,sign=pdown.shift?-1:1;
    if(t==='meteor'){pdown.cool-=dt;if(pdown.cool<=0){var a=Math.random()*6.283,m=Math.sqrt(Math.random())*PR*.6;pstrike({x:at.x+Math.cos(a)*m,y:at.y+Math.sin(a)*m},PR*.75);pdown.cool=.2;}return;}
    ppieces.forEach(function(p){
      var w=preach(p,at.x,at.y);if(!w)return;var v=pdir(p,at.x,at.y),dx=v.dx,dy=v.dy,d=v.d;
      if(t==='scatter'){var push=w*PR*2.4*dt*sign;p.tx+=dx/d*push;p.ty+=dy/d*push;p.tr+=(p.seed-.5)*w*dt*2;}
      else if(t==='swirl'){var an=sign*2.6*w*dt,c=Math.cos(an),s=Math.sin(an);p.tx+=dx*c-dy*s-dx;p.ty+=dx*s+dy*c-dy;p.tr+=an;}
      else if(t==='hole'){
        if(sign>0){var g=Math.min(1,w*dt*2.4),a2=3.2*w*dt,c2=Math.cos(a2),s2=Math.sin(a2);p.tx+=(dx*c2-dy*s2)*(1-g)-dx;p.ty+=(dx*s2+dy*c2)*(1-g)-dy;p.tr+=a2*2;p.ts=Math.max(.1,p.ts*Math.exp(-1.8*w*dt));}
        else{var o=w*PR*3*dt;p.tx+=dx/d*o;p.ty+=dy/d*o;p.ts+=(1-p.ts)*Math.min(1,w*dt*2.5);}
      }
      else if(t==='quake'){var j=w*dt*PR*1.3;p.tx+=(Math.random()-.5)*j;p.ty+=(Math.random()-.5)*j;p.tr+=(Math.random()-.5)*w*dt;p.vx+=(Math.random()-.5)*w*900;p.vy+=(Math.random()-.5)*w*900;}
      pwake(p);
    });
  }
  function pfx(x,y,size,bg,frames,ms,border){
    var e=mk('div','pfx');e.style.left=(x-size/2)+'px';e.style.top=(y-size/2)+'px';e.style.width=e.style.height=size+'px';e.style.background=bg;if(border)e.style.border=border;
    sh.appendChild(e);if(e.animate)e.animate(frames,{duration:ms,easing:'ease-out',fill:'forwards'});setTimeout(function(){e.remove();},ms+60);
  }
  function pstrike(at,r){
    ppieces.forEach(function(p){var w=preach(p,at.x,at.y,r);if(!w)return;var v=pdir(p,at.x,at.y),dx=v.dx,dy=v.dy,d=v.d;
      p.tx+=dx/d*w*r*.9;p.ty+=dy/d*w*r*.9;p.ts=Math.max(.3,p.ts*(1-.35*w));p.tr+=(p.seed-.5)*w*1.4;p.vx+=dx/d*w*1300;p.vy+=dy/d*w*1300;pwake(p);});
    pshocks.push({x:at.x,y:at.y,r:r*.8,max:r*4.5,speed:1100,hit:new Set()});prun();
    if(reduced)return;var cx=at.x-scrollX,cy=at.y-scrollY;
    pfx(cx,cy,r*1.6,'radial-gradient(circle,#fff 0 12%,#ffd58a 26%,rgba(255,122,89,.55) 48%,transparent 70%)',[{transform:'scale(.2)',opacity:1},{transform:'scale(1.25)',opacity:0}],550);
    pfx(cx,cy,r*9,'transparent',[{transform:'scale(.18)',opacity:.9},{transform:'scale(1)',opacity:0}],Math.round(r*3.7/1.1),'2px solid rgba(255,190,150,.85)');
    if(root.animate){var amp=Math.min(14,3+r/11),fr=[];for(var i=0;i<=8;i++){var f=1-i/8,aa=amp*f*f;fr.push({translate:i===8?'0 0':((Math.random()-.5)*2*aa).toFixed(1)+'px '+((Math.random()-.5)*2*aa).toFixed(1)+'px'});}root.animate(fr,{duration:360});}
  }
  function pwaves(dt){
    for(var i=pshocks.length-1;i>=0;i--){var s=pshocks[i],r0=s.r;s.r+=s.speed*dt;var f=Math.max(0,1-s.r/s.max);
      ppieces.forEach(function(p){if(s.hit.has(p))return;var dx=p.rx+p.tx-s.x,dy=p.ry+p.ty-s.y,d=Math.hypot(dx,dy);if(d<r0||d>s.r)return;s.hit.add(p);var k=600*f/(d||1);p.vx+=dx*k;p.vy+=dy*k;p.vs+=.6*f;pwake(p);});
      if(s.r>=s.max)pshocks.splice(i,1);}
  }
  function pring(x,y){var r=ui.pring;r.style.display='block';r.style.width=r.style.height=PR*2+'px';r.style.transform='translate('+(x-PR)+'px,'+(y-PR)+'px)';}

  // ---- Snap guides ----
  // Dragged through open space, a thing's edges and centre snap to its neighbours' and to its container's, and its
  // distance to the nearest neighbour snaps to a spacing the container already uses, so the layout read from the
  // drop comes out clean. Shift while dragging moves freely.
  var SNAP=6;
  function clearGuides(){ui.guides.innerHTML='';}
  function snapInfo(d){
    var c=d.target||d.from;if(d.snapFor===c)return d.snapCache;var G=d.G||geo(d);
    var sx=scrollX,sy=scrollY,pg=function(r,k){return {k:k||null,left:r.left+sx,top:r.top+sy,right:r.right+sx,bottom:r.bottom+sy};};
    var ks=G.kids(c).filter(function(k){return k!==d.el;}),cr=G.rect(c),cs=getComputedStyle(c);
    var bx=pg({left:cr.left+parseFloat(cs.paddingLeft),right:cr.right-parseFloat(cs.paddingRight),top:cr.top+parseFloat(cs.paddingTop),bottom:cr.bottom-parseFloat(cs.paddingBottom)});
    // the spacing already in use: between neighbours in a row, and between rows
    var gx=[],gy=[],rs=rows(ks,G.rect);
    rs.forEach(function(row,i){
      for(var j=1;j<row.items.length;j++){var a=pg(G.rect(row.items[j-1]),row.items[j-1]),b=pg(G.rect(row.items[j]),row.items[j]);if(b.left-a.right>.5)gx.push({v:b.left-a.right,a:a,b:b,ks:[a.k,b.k]});}
      if(i){var p=pg(rs[i-1].box),q=pg(row.box);if(q.top-p.bottom>.5)gy.push({v:q.top-p.bottom,a:p,b:q,ks:rs[i-1].items.concat(row.items)});}
    });
    d.snapFor=c;return d.snapCache={sibs:ks.map(function(k){return pg(G.rect(k),k);}),box:bx,gx:gx,gy:gy};
  }
  function sLines(r,ax){return ax==='x'?[r.left,(r.left+r.right)/2,r.right]:[r.top,(r.top+r.bottom)/2,r.bottom];}
  function sEnds(ax){return ax==='x'?['left','right']:['top','bottom'];}
  function sAt(d){return {left:d.ipx,top:d.ipy,right:d.ipx+d.w,bottom:d.ipy+d.h};}
  function sOthers(S,ax){return S.sibs.concat(ax==='x'?[S.box]:[]);}
  // the nearest neighbour before and after along an axis, among those it shares the other axis with
  function sNear(S,D,ax){
    var e=sEnds(ax),lo=null,hi=null;
    S.sibs.forEach(function(s){
      var share=ax==='x'?Math.min(s.bottom,D.bottom)-Math.max(s.top,D.top):Math.min(s.right,D.right)-Math.max(s.left,D.left);if(share<=0)return;
      if(s[e[1]]<=D[e[0]]+SNAP){if(!lo||s[e[1]]>lo[e[1]])lo=s;}else if(s[e[0]]>=D[e[1]]-SNAP){if(!hi||s[e[0]]<hi[e[0]])hi=s;}});
    return {lo:lo,hi:hi};
  }
  function snapDrag(d,free){
    d.snapped=!free;if(free)return;var S=snapInfo(d);
    ['x','y'].forEach(function(ax){
      var D=sAt(d),e=sEnds(ax),mine=sLines(D,ax),best=null,consider=function(o){if(Math.abs(o)<=SNAP&&(best===null||Math.abs(o)<Math.abs(best)))best=o;};
      sOthers(S,ax).forEach(function(s){sLines(s,ax).forEach(function(w){mine.forEach(function(v){consider(w-v);});});});
      var n=sNear(S,D,ax);(ax==='x'?S.gx:S.gy).forEach(function(g){if(n.lo)consider(n.lo[e[1]]+g.v-D[e[0]]);if(n.hi)consider(n.hi[e[0]]-g.v-D[e[1]]);});
      if(best!==null){if(ax==='x')d.ipx+=best;else d.ipy+=best;}
    });
  }
  // What it snapped to, drawn only against things the live preview has left where they were.
  function drawGuides(d){
    clearGuides();if(!d.snapped)return;var S=snapInfo(d),G=ui.guides,D=sAt(d),ox=scrollX,oy=scrollY,B=d.base;
    var still=function(k){if(!k||!B)return true;var b=B.rects.get(k),r=layoutRect(k);return !!b&&Math.abs(r.left+ox-b.left)<1&&Math.abs(r.top+oy-b.top)<1&&Math.abs(r.width-b.width)<1&&Math.abs(r.height-b.height)<1;};
    var put=function(cls,l,tp,w,h,text){var n=mk('div',cls,text);n.style.left=(l-ox)+'px';n.style.top=(tp-oy)+'px';if(w!==null)n.style.width=w+'px';if(h!==null)n.style.height=h+'px';G.appendChild(n);};
    var gap=function(ax,a,b,v){
      if(ax==='x'){var y=(Math.max(a.top,b.top)+Math.min(a.bottom,b.bottom))/2;put('gm h',a.right,y,b.left-a.right,null);put('gb',(a.right+b.left)/2,y,null,null,String(Math.round(v)));}
      else{var x=(Math.max(a.left,b.left)+Math.min(a.right,b.right))/2;put('gm v',x,a.bottom,null,b.top-a.bottom);put('gb',x,(a.bottom+b.top)/2,null,null,String(Math.round(v)));}
    };
    ['x','y'].forEach(function(ax){
      var mine=sLines(D,ax),spans={};
      sOthers(S,ax).forEach(function(s){if(!still(s.k))return;sLines(s,ax).forEach(function(w){mine.forEach(function(v){if(Math.abs(w-v)>=.5)return;
        var k=Math.round(w),sp=spans[k]||(spans[k]={at:w,from:Infinity,to:-Infinity});
        sp.from=Math.min(sp.from,ax==='x'?Math.min(s.top,D.top):Math.min(s.left,D.left));sp.to=Math.max(sp.to,ax==='x'?Math.max(s.bottom,D.bottom):Math.max(s.right,D.right));});});});
      Object.keys(spans).forEach(function(k){var sp=spans[k];if(ax==='x')put('gl v',sp.at,sp.from,null,sp.to-sp.from);else put('gl h',sp.from,sp.at,sp.to-sp.from,null);});
      var e=sEnds(ax),n=sNear(S,D,ax),gaps=ax==='x'?S.gx:S.gy,shown=false;
      [[n.lo,D],[D,n.hi]].forEach(function(pr){
        var a=pr[0],b=pr[1];if(!a||!b||!still(a.k)||!still(b.k))return;var v=b[e[0]]-a[e[1]];if(v<=.5)return;
        var same=gaps.filter(function(g){return Math.abs(g.v-v)<.5&&g.ks.every(still);});if(!same.length)return;
        gap(ax,a,b,v);if(!shown){shown=true;same.forEach(function(g){gap(ax,g.a,g.b,g.v);});}
      });
    });
  }
  // Width stretch clicks to the width of a neighbour, or of anything else on the page with a set width.
  function widthMatch(h,raw){
    if(!h.widths){var el=h.el,seen={};h.widths=[];
      var add=function(k){if(k===el||k.contains(el)||el.contains(k)||ours(k))return;var w=Math.round(layoutRect(k).width);if(w<160||seen[w])return;seen[w]=1;h.widths.push({w:w,el:k});};
      kids(el.parentElement||root).forEach(add);
      Array.prototype.forEach.call(root.querySelectorAll('*'),function(k){if(isBlock(k)&&getComputedStyle(k).maxWidth!=='none')add(k);});}
    var best=null;h.widths.forEach(function(c){var dd=Math.abs(c.w-raw);if(dd<=12&&(!best||dd<Math.abs(best.w-raw)))best=c;});return best;
  }
  function widthGuides(el,other,w){
    clearGuides();if(!other)return;
    [el,other].forEach(function(k){var r=layoutRect(k),y=r.top-8,m=mk('div','gm h'),l=mk('div','gb',String(w));
      m.style.left=r.left+'px';m.style.top=y+'px';m.style.width=r.width+'px';l.style.left=(r.left+r.width/2)+'px';l.style.top=y+'px';ui.guides.appendChild(m);ui.guides.appendChild(l);});
  }
  function chip(text,x,y){var r=ui.readout;if(!text){r.style.display='none';return;}r.textContent=text;r.style.display='block';r.style.transform='translate('+Math.min(innerWidth-r.offsetWidth-8,x+16)+'px,'+(y+18)+'px)';}
  // In open space the chip reads the drop exactly the way letting go will.
  function readFree(p,x,y){
    var el=drag.el,i=p.order.indexOf(el),now=drag.G.kids(p.target);
    if(p.ctx){chip(describe(p.ctx),x,y);return;}
    if(drag.fresh){chip('New · '+(i===p.order.length-1?'last in '+shortName(p.target):'before '+shortName(p.order[i+1])),x,y);return;}
    var stays=p.target===drag.from&&now.length===p.order.length&&now.every(function(k,j){return p.order[j]===k;});
    chip(stays?'Stays where it is':p.order.length===1?'Into '+shortName(p.target):i===p.order.length-1?'Last in '+shortName(p.target):'Before '+shortName(p.order[i+1]),x,y);
  }
  // ---- Insert: new blocks, or parts of this page, dragged in or added after the selection ----
  var IMG='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><rect width="640" height="400" fill="#e6e1d6"/><circle cx="468" cy="118" r="42" fill="#ffcc4d"/><path d="M0 332 176 184l116 104 92-72 256 184H0z" fill="#b8b0a0"/></svg>');
  var BLOCKS=[['heading','Heading','H'],['text','Text','¶'],['button','Button','▭'],['image','Image','▨'],['quote','Quote','❝'],['divider','Divider','―'],['section','Section','▤']];
  function pageButton(){var list=root.querySelectorAll('a,button');for(var i=0;i<list.length;i++)if(boxy(list[i]))return list[i];return null;}
  // parts worth reusing: things that come in sets (cards), then the page's own sections
  function pageParts(){
    var seen={},out=[],add=function(el){var key=el.tagName+'.'+(el.classList[0]||'');if(seen[key]||out.length>=6)return;seen[key]=1;out.push(el);};
    Array.prototype.forEach.call(root.querySelectorAll('*'),function(el){
      if(ours(el)||!el.classList.length||el.classList.contains('group')||el.parentElement===root||!isBlock(el))return;
      if(kids(el.parentElement).filter(function(k){return k.tagName===el.tagName&&k.classList[0]===el.classList[0];}).length>=2)add(el);});
    kids(root).forEach(add);
    return out;
  }
  function makeBlock(kind){
    var el;
    if(kind.indexOf('like:')===0){var src=byId(kind.slice(5));el=cloneOf(src);delete copyOf[idOf(el)];inserted[idOf(el)]={like:idOf(src)};return el;}
    if(kind==='heading')el=mk('h2','','New heading');
    else if(kind==='text')el=mk('p','','Write something here.');
    else if(kind==='button'){var b=pageButton();el=b?b.cloneNode(false):mk('a');['data-cs','id','style'].forEach(function(a){el.removeAttribute(a);});el.textContent='New button';if(el.tagName==='A')el.setAttribute('href','#');}
    else if(kind==='image'){el=mk('img');el.src=IMG;el.alt='';}
    else if(kind==='quote')el=mk('blockquote','','“A few kind words about you.”');
    else if(kind==='divider')el=mk('hr');
    else{el=mk('section');el.appendChild(mk('h2','','New section'));el.appendChild(mk('p','','Say what this part is about.'));}
    var id=idOf(el);made[id]=el;inserted[id]={kind:kind};
    if(el.tagName==='IMG')setRule(el,{display:'block',width:'100%','max-width':'560px',height:'auto','border-radius':'12px'},'base');
    return el;
  }
  function canType(el){return el.matches('h1,h2,h3,h4,h5,h6,p,blockquote,a,button');}
  // A new thing lands after the given one; text opens for typing straight away.
  function placeNew(el,after,before){
    flip(kids(after.parentElement).concat(kids(root)),function(){after.after(el);});lastWhy='You added '+nameOf(el)+'.';commit(before);
    if(canType(el))startEdit(el);else{select(el);pill(el,'You added '+nameOf(el)+'.','Drag it anywhere, or Ctrl+Z to take it back.','');}
  }
  function insertAfter(kind,after){if(dress)setDress('');if(!after||after===root)after=kids(root).slice(-1)[0];var before=snapshot();placeNew(makeBlock(kind),after,before);}
  // Dragging a tile starts an ordinary drag of the new thing, so it gets the live preview, snapping and the ghost.
  function startFresh(kind,e){
    if(e.button!==0||!on)return;e.preventDefault();e.stopPropagation();coachDone();if(playing)togglePlay(false,true);if(editing)endEdit(true);if(dress)setDress('');
    var before=snapshot(),el=makeBlock(kind);root.appendChild(el);hush=true;render();hush=false;
    var r=layoutRect(el),gx=Math.min(28,r.width/2),gy=Math.min(18,r.height/2);
    drag={el:el,src:null,x0:e.clientX,y0:e.clientY,gx:gx,gy:gy,bx:r.left+scrollX,by:r.top+scrollY,ipx:e.clientX+scrollX-gx,ipy:e.clientY+scrollY-gy,w:r.width,h:r.height,moved:false,from:root,target:null,slot:null,before:before,copy:false,fresh:true,id:e.pointerId};
  }
  function lib(show){
    var p=ui.lib;q('.t-ins').setAttribute('aria-pressed',String(!!show));if(!show){p.style.display='none';if(selected)placeInsp(selected);return;}
    p.innerHTML='';var hd=mk('div','hd');hd.appendChild(mk('b','','Insert'));hd.appendChild(mk('small','','×'));hd.addEventListener('click',function(){lib(false);});p.appendChild(hd);
    p.appendChild(mk('div','hint','Drag onto the page, or select something and click to add after it.'));
    var grid=function(title,items){p.appendChild(mk('h4','',title));var g=mk('div','tiles');
      items.forEach(function(it){var b=mk('button','tile');b.appendChild(mk('span','gl',it.g));b.appendChild(mk('span','tl',it.t));b.title=it.title||it.t;
        b.addEventListener('pointerdown',function(e){startFresh(it.k,e);});
        // Enter or Space has no drag to start: the new thing goes after the selection, or at the end of the page
        b.addEventListener('click',function(e){if(e.detail||!on)return;coachDone();if(playing)togglePlay(false,true);if(editing)endEdit(true);
          insertAfter(it.k,selected&&selected!==root&&selected.isConnected?selected:null);});g.appendChild(b);});p.appendChild(g);};
    grid('Blocks',BLOCKS.map(function(b){return {k:b[0],t:b[1],g:b[2]};}));
    var parts=pageParts();if(parts.length)grid('From this page',parts.map(function(el){return {k:'like:'+idOf(el),t:shortName(el),g:'⧉',title:'A copy of '+nameOf(el)};}));
    p.style.display='block';if(selected)placeInsp(selected);
  }

  // ---- Pictures: drop an image file onto an image to swap it, or anywhere else to add it ----
  function shrinkImage(file,done){
    var fr=new FileReader();fr.onload=function(){var url=fr.result;if(/svg|gif/.test(file.type)){done(url);return;}
      // big photos are scaled down, so the autosave and the downloaded page stay a sensible size
      var im=new Image();im.onload=function(){var k=Math.min(1,1600/Math.max(im.naturalWidth,im.naturalHeight));if(k>=1&&url.length<700000){done(url);return;}
        var cv=doc.createElement('canvas');cv.width=Math.round(im.naturalWidth*k);cv.height=Math.round(im.naturalHeight*k);cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);
        done(cv.toDataURL(file.type==='image/png'?'image/png':'image/jpeg',.86));};im.onerror=function(){done(url);};im.src=url;};
    fr.readAsDataURL(file);
  }
  // A swapped picture keeps its element, place and size. A description that was only a file name follows the new file.
  function swapPicture(img,url,name){var id=idOf(img);if(!imaged[id])imaged[id]={orig:img.getAttribute('src')};var before=snapshot();imaged[id].file=name;img.setAttribute('src',url);
    if(/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(img.getAttribute('alt')||''))img.setAttribute('alt',name);lastWhy='You swapped in '+name+'.';commit(before);}
  function filesIn(e){return !!e.dataTransfer&&Array.prototype.indexOf.call(e.dataTransfer.types||[],'Files')>=0;}
  function dropSpot(t){return t.tagName==='IMG'&&inRoot(t)?t:pickItem(t,false)||kids(root).slice(-1)[0];}
  addEventListener('dragover',function(e){if(!on||!filesIn(e))return;e.preventDefault();if(!inRoot(e.target)){ui.target.style.display='none';return;}e.dataTransfer.dropEffect='copy';box(ui.target,dropSpot(e.target).getBoundingClientRect(),4);},true);
  addEventListener('dragleave',function(e){if(!e.relatedTarget)ui.target.style.display='none';},true);
  addEventListener('drop',function(e){
    if(!on||!filesIn(e))return;e.preventDefault();ui.target.style.display='none';var file=e.dataTransfer.files[0],t=e.target;
    if(!inRoot(t)||!file||!/^image\//.test(file.type)){if(file)say('Drop an image file onto the page to add it.');return;}
    var spot=dropSpot(t);
    shrinkImage(file,function(url){
      if(spot.tagName==='IMG'){swapPicture(spot,url,file.name);select(spot);pill(spot,'You swapped in '+file.name+'.','Ctrl+Z puts the old picture back.','');return;}
      var before2=snapshot(),img=mk('img');img.src=url;img.alt='';var nid=idOf(img);made[nid]=img;inserted[nid]={kind:'image',file:file.name};
      setRule(img,{display:'block',width:'100%','max-width':'560px',height:'auto','border-radius':'12px'},'base');placeNew(img,spot,before2);
    });
  },true);

  // ---- Before and after: hold B to see the page as it was ----
  var peekEl=null,peekDisplay='';
  function peek(v){
    if(v===!!peekEl||v&&(drag||playing||editing))return;
    if(v){peekEl=root.cloneNode(false);peekEl.removeAttribute('data-cs');peekEl.innerHTML=pristine;peekDisplay=root.style.display;root.style.display='none';root.after(peekEl);
      ui.sels.style.display='none';hidePill();box(ui.hover,null);tagAt(null);clearMeasure();ui.peek.style.display='block';}
    else{peekEl.remove();peekEl=null;root.style.display=peekDisplay;ui.sels.style.display='';ui.peek.style.display='none';refreshSel();}
  }
  addEventListener('keyup',function(e){if(e.key==='b'||e.key==='B')peek(false);},true);
  addEventListener('blur',function(){peek(false);});

  // ---- History: scrub through every change and watch the page move between them ----
  var rw=null;
  function rewindSync(){
    if(!rw)return;var L=undo.concat([snapshot()],redo.slice().reverse()),T=[];
    for(var k=0;k<L.length-1;k++)T.push(L[k+1].prevLabel||L[k].label||'A change');
    rw.L=L;rw.T=T;rw.at=undo.length;var r=q('.rewind input');r.max=String(L.length-1);r.value=String(rw.at);r.disabled=L.length<2;rewindLabel();
  }
  function rewindLabel(){var j=rw.at,n=rw.L.length-1;q('.rewind .n').textContent=n?'Step '+j+' of '+n:'No changes yet';
    q('.rewind .lbl').textContent=j?rw.T[j-1]:n?'Where this session began':'Make a change, then come back to scrub through them.';}
  function rewind(show){
    q('.t-hist').setAttribute('aria-pressed',String(!!show));if(!show){rw=null;ui.rewind.style.display='none';return;}
    if(playing)togglePlay(false,true);if(editing)endEdit(true);hidePill();select(null);rw={};ui.rewind.style.display='flex';rewindSync();
  }
  function rewindTo(j){if(!rw||j===rw.at)return;rw.at=j;restore(rw.L[j]);hidePill();select(null);rewindLabel();}
  // Letting go makes the step you scrubbed to the present; undo and redo carry on from there.
  function rewindKeep(){
    if(!rw)return;var j=rw.at,L=rw.L,T=rw.T;
    L.forEach(function(s,k){if(k<j)s.label=T[k];else if(k>j)s.prevLabel=T[k-1];});
    undo=L.slice(0,j);redo=L.slice(j+1).reverse();buttons();save();
  }
  q('.rewind input').addEventListener('input',function(e){rewindTo(+e.target.value);});
  q('.rewind input').addEventListener('change',rewindKeep);
  q('.rwclose').addEventListener('click',function(){rewind(false);});
  q('.t-ins').addEventListener('click',function(){lib(ui.lib.style.display!=='block');});
  q('.t-hist').addEventListener('click',function(){rewind(!rw);});

  // ---- Input ----
  function isUI(e){return e.composedPath&&e.composedPath().indexOf(host)>=0;}
  doc.addEventListener('pointerdown',function(e){
    if(editing){if(editing.el.contains(e.target))return;endEdit(true);}
    if(!on||e.button!==0||isUI(e)||!inRoot(e.target))return;
    e.preventDefault();e.stopPropagation();pointer.x=e.clientX;pointer.y=e.clientY;coachDone();clearMeasure();
    if(playing){pdown={x:e.clientX,y:e.clientY,shift:e.shiftKey,cool:.35,id:e.pointerId};if(ptool==='meteor')pstrike({x:e.clientX+scrollX,y:e.clientY+scrollY},PR);prun();return;}
    if(tool==='grab'&&e.shiftKey){lasso={x0:e.clientX,y0:e.clientY,id:e.pointerId,moved:false,hit:pickItem(e.target,e.altKey)};}
    else if(tool==='grab'){var el=pickItem(e.target,e.altKey);if(!el)return;if(dress){hidePill();select(el);return;}if(placed(el)){hidePill();select(el);stuckPress={x:e.clientX,y:e.clientY,id:e.pointerId};return;}var before=snapshot(),copy=false,src=el;
      // Ctrl+drag pulls a copy out and leaves the original where it was
      if((e.ctrlKey||e.metaKey)&&el!==root){var c=cloneOf(el);el.after(c);render();el=c;copy=true;}
      var r=layoutRect(el);
      drag={el:el,src:src,x0:e.clientX,y0:e.clientY,gx:e.clientX-r.left,gy:e.clientY-r.top,bx:r.left+scrollX,by:r.top+scrollY,ipx:r.left+scrollX,ipy:r.top+scrollY,w:r.width,h:r.height,moved:false,from:el.parentElement,target:null,slot:null,before:before,copy:copy,id:e.pointerId};}
    else if(tool==='paint'){painting={before:snapshot(),done:new Set(),changed:false,id:e.pointerId};paintAt(e.clientX,e.clientY);}
    else{var h=hitStretch(e.clientX,e.clientY);if(!h)return;startStretch(h);stretch={h:h,x0:e.clientX,y0:e.clientY,before:snapshot(),id:e.pointerId};box(ui.hover,null);}
    try{e.target.setPointerCapture(e.pointerId);}catch(err){}
  },true);
  var hoverRaf=0;
  addEventListener('pointermove',function(e){
    pointer.x=e.clientX;pointer.y=e.clientY;if(altHeld!==e.altKey){altHeld=e.altKey;if(!altHeld)clearMeasure();}
    if(stuckPress&&e.pointerId===stuckPress.id&&Math.hypot(e.clientX-stuckPress.x,e.clientY-stuckPress.y)>6){stuckPress=null;if(selected)stays([selected]);}
    if(playing&&on){if(pdown){pdown.x=e.clientX;pdown.y=e.clientY;pdown.shift=e.shiftKey;}if(isUI(e))ui.pring.style.display='none';else pring(e.clientX,e.clientY);return;}
    if(!on||isUI(e)&&!drag&&!stretch&&!painting&&!lasso)return;
    if(lasso){if(!lasso.moved&&Math.hypot(e.clientX-lasso.x0,e.clientY-lasso.y0)<4)return;lasso.moved=true;
      box(ui.lasso,{left:Math.min(lasso.x0,e.clientX),top:Math.min(lasso.y0,e.clientY),width:Math.abs(e.clientX-lasso.x0),height:Math.abs(e.clientY-lasso.y0)});return;}
    if(painting){paintAt(e.clientX,e.clientY);return;}
    if(drag){
      if(!drag.moved){if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)<4)return;drag.moved=true;lift(drag.el);html.style.cursor='grabbing';box(ui.hover,null);tagAt(null);hidePill();select(null);ui.trash.style.display='grid';baseCapture(drag);}
      drag.ipx=e.clientX+scrollX-drag.gx;drag.ipy=e.clientY+scrollY-drag.gy;
      var hot=overTrash(e.clientX,e.clientY);ui.trash.classList.toggle('hot',hot);
      if(hot){box(ui.target,null);box(ui.ghost,null);drag.slot=null;chip(null);clearGuides();preview(drag,null);follow(drag);return;}
      var t=drag.target=targetAt(e.clientX,e.clientY,drag.el,drag.G);box(ui.target,t.getBoundingClientRect(),4);
      var sl=drag.slot=slotAt(e.clientX,e.clientY,t,drag.el,drag.G);
      snapDrag(drag,!!sl||e.shiftKey);
      var plan=planDrop(drag);preview(drag,plan);follow(drag);
      // something new appears under the hand rather than flying in from wherever it was made
      if(drag.fresh&&!drag.flown){drag.flown=true;var fm=motion(drag.el);fm.x=fm.tx;fm.y=fm.ty;fm.vx=fm.vy=0;draw(drag.el,fm);}
      box(ui.ghost,layoutRect(drag.el));drawGuides(drag);
      if(sl)readout(sl,plan,e.clientX,e.clientY);else readFree(plan,e.clientX,e.clientY);
      return;
    }
    if(stretch){moveStretch(stretch.h,e.clientX-stretch.x0,e.clientY-stretch.y0);return;}
    if(!hoverRaf)hoverRaf=requestAnimationFrame(hover);
  },true);
  function hover(){
    hoverRaf=0;var el=doc.elementFromPoint(pointer.x,pointer.y);
    if(playing||editing){box(ui.hover,null);tagAt(null);return;}
    if(altHeld&&(tool==='grab'||tool==='stretch')&&inRoot(el)&&!host.contains(el)){box(ui.hover,null);box(ui.band,null);box(ui.edge,null);var it=pickItem(el,true);
      // outside the selection, measure to whatever sits at the selection's own level
      if(selected&&it&&!selected.contains(it))while(it.parentElement&&!it.parentElement.contains(selected))it=it.parentElement;
      measure(it);return;}
    clearMeasure();
    box(ui.band,null);box(ui.edge,null);html.style.cursor='';
    if(!inRoot(el)||host.contains(el)){box(ui.hover,null);tagAt(null);return;}
    if(tool==='grab'||tool==='paint'){var it=tool==='paint'&&paintMode==='text'?textTarget(el):pickItem(el,false);if(!it){box(ui.hover,null);tagAt(null);return;}
      lastHover=it;var r=it.getBoundingClientRect();box(ui.hover,r,2);tagAt(nameOf(it),r);html.style.cursor=tool==='grab'?'grab':'crosshair';return;}
    box(ui.hover,null);tagAt(null);
    var h=hitStretch(pointer.x,pointer.y);if(!h)return;
    if(h.kind==='gap'){box(ui.band,h.band);html.style.cursor=h.axis==='y'?'row-resize':'col-resize';}
    else if(h.kind==='width'){box(ui.edge,{left:h.r.right-2,top:h.r.top,width:4,height:h.r.height});html.style.cursor='ew-resize';}
    else{box(ui.edge,{left:h.r.left,top:h.r.bottom-2,width:h.r.width,height:4});html.style.cursor='ns-resize';tagAt(h.kind==='font'?'Drag to size the text':'Drag for more room',h.r);}
  }
  // A lasso takes the outermost things that sit mostly inside it.
  function lassoPick(r){
    var inside=Array.prototype.filter.call(root.querySelectorAll('*'),function(el){
      if(ours(el)||!isBlock(el))return false;var b=el.getBoundingClientRect();if(!b.width||!b.height)return false;
      var ix=Math.max(0,Math.min(b.right,r.right)-Math.max(b.left,r.left)),iy=Math.max(0,Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top));
      return ix*iy>=.8*b.width*b.height;
    });
    return inside.filter(function(el){return !inside.some(function(o){return o!==el&&o.contains(el);});});
  }
  function end(e){
    if(stuckPress&&e.pointerId===stuckPress.id)stuckPress=null;
    if(pdown&&e.pointerId===pdown.id){pdown=null;return;}
    if(lasso&&e.pointerId===lasso.id){var L=lasso;lasso=null;box(ui.lasso,null);
      if(!L.moved){if(L.hit){var list=multi.length?multi.slice():selected?[selected]:[],i=list.indexOf(L.hit);if(i>=0)list.splice(i,1);else list.push(L.hit);selectMany(list);}return;}
      selectMany(lassoPick({left:Math.min(L.x0,e.clientX),top:Math.min(L.y0,e.clientY),right:Math.max(L.x0,e.clientX),bottom:Math.max(L.y0,e.clientY)}));return;}
    if(painting&&e.pointerId===painting.id){var pt=painting;painting=null;if(pt.changed){commit(pt.before);palCache=null;say('Painted '+(dress?'the '+STATES[dress].label.toLowerCase()+' look of ':'')+pt.done.size+' thing'+(pt.done.size===1?'':'s')+'.');}return;}
    if(drag&&e.pointerId===drag.id){
      if(!drag.moved){var d=drag;drag=null;
        // a tile clicked, not dragged: the new thing goes after the selection
        if(d.fresh){d.el.remove();var after=selected&&selected!==root&&selected.isConnected?selected:null;
          if(after)placeNew(d.el,after,d.before);else{delete inserted[idOf(d.el)];render();say('Drag it onto the page, or select something first and click to add it after.');}return;}
        if(d.copy){made[idOf(d.el)]=d.el;d.el.remove();delete copyOf[idOf(d.el)];render();select(d.src);}else{hidePill();select(d.el);}return;}
      drop(e);return;}
    if(stretch&&e.pointerId===stretch.id){var s=stretch;stretch=null;clearGuides();if(s.h.changed){commit(s.before);if(selected)inspect(selected);}}
  }
  addEventListener('pointerup',end,true);addEventListener('pointercancel',end,true);
  addEventListener('click',function(e){if(on&&!isUI(e)&&inRoot(e.target)){e.preventDefault();e.stopPropagation();}},true);
  addEventListener('keydown',function(e){
    if(!on||editing)return;var k=e.key,mod=e.ctrlKey||e.metaKey;
    if(drag&&drag.moved){if(k==='Escape'){e.preventDefault();cancelDrag();}return;}
    if(k==='Alt'){altHeld=true;e.preventDefault();if(!hoverRaf)hoverRaf=requestAnimationFrame(hover);return;}
    if(playing&&!/^(f|F|Escape)$/.test(k))return;
    if(mod&&(k==='k'||k==='K')){e.preventDefault();ui.cmd.style.display==='block'?cmdClose():cmdOpen();return;}
    if(ui.cmd.style.display==='block'&&isUI(e))return;
    if(isUI(e)&&k!=='Tab'&&k!=='Escape')return;
    if(mod&&(k==='z'||k==='Z')){e.preventDefault();e.shiftKey?forward():back();return;}
    if(mod&&(k==='y'||k==='Y')){e.preventDefault();forward();return;}
    if(mod&&(k==='g'||k==='G')){e.preventDefault();if(e.shiftKey){if(selected)ungroup(selected);}else group();return;}
    if(mod&&(k==='d'||k==='D')){e.preventDefault();duplicate(multi.length?multi:selected?[selected]:[]);return;}
    if(mod||e.altKey)return;
    if(k==='Tab'&&pillCtx){e.preventDefault();cycle();return;}
    if(k==='Escape'){
      if(playing){togglePlay(false);return;}
      if(ui.help.style.display==='block')help(false);else if(ui.panel.style.display==='flex')ui.panel.style.display='none';
      else if(rw)rewind(false);else if(ui.lib.style.display==='block')lib(false);else if(dress)setDress('');
      else if(pillCtx||ui.pill.style.display==='block'||multi.length||selected){hidePill();select(null);}else hide();return;}
    if((k==='Delete'||k==='Backspace')&&(selected||multi.length)){e.preventDefault();remove(multi.length?multi:[selected]);return;}
    if(selected&&/^Arrow/.test(k)){e.preventDefault();nudge(selected,k==='ArrowUp'||k==='ArrowLeft'?-1:1);return;}
    if(k==='/'){e.preventDefault();cmdOpen();return;}
    if(k==='?'){help(ui.help.style.display!=='block');return;}
    if(k==='g'||k==='G')pick('grab');else if(k==='s'||k==='S')pick('stretch');else if(k==='p'||k==='P')pick('paint');else if(k==='c'||k==='C')changes();else if(k==='f'||k==='F')togglePlay(!playing);
    else if(k==='i'||k==='I')lib(ui.lib.style.display!=='block');else if(k==='h'||k==='H')rewind(!rw);else if(k==='l'||k==='L')nextDress();else if(k==='b'||k==='B'){if(!e.repeat)peek(true);}
    else if(k==='1')setBP('base');else if(k==='2')setBP('tablet');else if(k==='3')setBP('mobile');
  },true);
  addEventListener('scroll',function(){if(!on)return;hidePill();refreshSel();if(selected)placeInsp(selected);box(ui.hover,null);tagAt(null);clearMeasure();if(drag&&drag.moved&&ui.ghost.style.display==='block'){box(ui.ghost,layoutRect(drag.el));drawGuides(drag);}},{passive:true});
  addEventListener('resize',function(){cache=null;if(BPS[bp].width)root.style.width=Math.min(BPS[bp].width,innerWidth-32)+'px';refreshSel();});

  // ---- Dock, changes panel, export ----
  function pick(t){
    if(playing)togglePlay(false);tool=t;['grab','stretch','paint'].forEach(function(n){q('.t-'+n).setAttribute('aria-pressed',String(t===n));});
    box(ui.hover,null);tagAt(null);ui.paintbar.style.display=t==='paint'?'flex':'none';if(t==='paint')paintbar();
    say(t==='grab'?'Grab: drag to arrange. Shift+drag selects several, Ctrl+drag pulls out a copy.':t==='paint'?'Paint: pick a colour or material, then brush over things.':'Stretch: pull the space between things, an edge, or the bottom of some text.');
  }
  function buttons(){q('.undo').disabled=!undo.length;q('.redo').disabled=!redo.length;if(rw)rewindSync();}
  function changeList(){
    var out=[],now=capture(),seen={};
    // structure: new containers, copies, removed things, and new orders
    Object.keys(copyOf).forEach(function(id){var c=byId(id);if(c&&c.isConnected){seen[id]=true;out.push({sel:selectorOf(c),text:'Duplicate '+(originNames[copyOf[id]]||nameOf(byId(copyOf[id])))+'; the copy goes right after it.'});}});
    Object.keys(now).forEach(function(cid){
      var was=origin[cid],is=now[cid],c=byId(cid);
      if(!was){if(made[cid]&&!copyOf[cid]&&c.classList.contains('group'))out.push({sel:selectorOf(c),text:'Add a new <div class="group"> inside '+nameOf(c.parentElement)+', holding '+is.map(function(id){return nameOf(byId(id));}).join(', ')+'.'});return;}
      if(was.join()===is.join())return;
      var arrived=is.filter(function(id){return was.indexOf(id)<0&&!made[id];}).map(function(id){return nameOf(byId(id));});
      out.push({sel:selectorOf(c),text:(arrived.length?'Move '+arrived.join(', ')+' into '+nameOf(c)+'. ':'')+'Order the children of '+nameOf(c)+' as: '+is.map(function(id){return nameOf(byId(id));}).join(', ')+'.'});
    });
    var inNew=function(el){for(var a=el;a&&a!==root;a=a.parentElement){var i=a.getAttribute('data-cs');if(i&&inserted[i]&&!inserted[i].like)return true;}return false;};
    Object.keys(inserted).forEach(function(id){var c=byId(id);if(!c||!c.isConnected)return;var info=inserted[id],prev=c.previousElementSibling,file=(imaged[id]&&imaged[id].file)||info.file;
      while(prev&&ours(prev))prev=prev.previousElementSibling;
      var what=info.like?'a copy of '+(originNames[info.like]||nameOf(byId(info.like))):file?'the image “'+file+'” (it is embedded in the downloaded page)':'`'+htmlOf(c)+'`';
      out.push({sel:selectorOf(c),text:'Insert '+what+' into '+nameOf(c.parentElement)+(prev?', right after '+nameOf(prev):', at the start')+'.'});});
    Object.keys(imaged).forEach(function(id){var c=byId(id);if(!c||!c.isConnected||inserted[id]||!imaged[id].file||c.getAttribute('src')===imaged[id].orig)return;
      out.push({sel:selectorOf(c),text:'Replace the picture in '+nameOf(c)+' with the file “'+imaged[id].file+'” (it is embedded in the downloaded page).'});});
    Object.keys(edited).forEach(function(id){var el=byId(id);if(!el||!el.isConnected||inNew(el))return;var now2=el.textContent;if(now2===originTexts[id])return;
      out.push({sel:selectorOf(el),text:'Change the text of '+(originNames[id]||nameOf(el))+' to: “'+now2.trim().replace(/\s+/g,' ')+'”'});});
    var gone={};Object.keys(origin).forEach(function(cid){origin[cid].concat([cid]).forEach(function(id){if(gone[id])return;var el=byId(id);if(!el||!el.isConnected){gone[id]=true;}});});
    Object.keys(gone).forEach(function(id){var parentGone=Object.keys(origin).some(function(cid){return gone[cid]&&cid!==id&&origin[cid].indexOf(id)>=0;});if(!parentGone)out.push({text:'Remove '+(originNames[id]||'an element')+'.'});});
    // rules, per screen size. Children that all got the same rule from their container's layout are written once, as "container > *".
    var ease={};
    ORDER_BP.forEach(function(L){
      var rules=layers[L],done={};
      Object.keys(rules).sort(function(a,b){return stateRank(a)-stateRank(b);}).forEach(function(id){
        var st=split(id)[1],eid=split(id)[0];
        if(done[id])return;var el=byId(eid);if(!el||!el.isConnected)return;var r=rules[id],p=el.parentElement,pid=p&&p.getAttribute('data-cs');
        // a state is the element's own selector with :hover, :focus-visible or :active on the end
        if(st){var aid=split(id)[2],a=aid?byId(aid):null;if(aid&&(!a||!a.isConnected))return;
          Object.keys(r).forEach(function(k){(ease[eid]=ease[eid]||{})[k]=1;});out.push({bp:L,sel:stateSel(el,st,a),css:r,text:reasons[L+':'+id]||''});return;}
        if(pid&&rules[pid]&&rules[pid].display){var sibs=kids(p),same=sibs.every(function(s){var sr=rules[s.getAttribute('data-cs')];return sr&&JSON.stringify(sr)===JSON.stringify(r);});
          if(same&&sibs.length>1){sibs.forEach(function(s){done[s.getAttribute('data-cs')]=true;});out.push({bp:L,sel:selectorOf(p)+' > *',css:r,text:'Its children let the layout do the spacing.'});return;}}
        done[id]=true;out.push({bp:L,sel:selectorOf(el),css:r,text:reasons[L+':'+id]||''});
      });
    });
    Object.keys(ease).forEach(function(id){var el=byId(id);if(el&&el.isConnected&&easing(ease[id]))out.push({bp:'base',sel:selectorOf(el),css:{transition:easing(ease[id])},text:'So it eases between its looks instead of snapping.'});});
    return out;
  }
  // New things are handed over as clean HTML: no studio ids or styles, and a stand-in name for placeholder images.
  // The copy is made in an inert document, so the stand-in is never fetched.
  function htmlOf(c){var d=doc.implementation.createHTMLDocument('').importNode(c,true);[d].concat(Array.prototype.slice.call(d.querySelectorAll('*'))).forEach(function(n){['data-cs','style','contenteditable'].forEach(function(a){n.removeAttribute(a);});
    if(n.tagName==='IMG'&&/^data:/.test(n.getAttribute('src')||''))n.setAttribute('src','your-image.jpg');});return d.outerHTML;}
  function block(c,ind,imp){return (c.text?ind+'/* '+c.text+' */\n':'')+ind+c.sel+' {\n'+Object.keys(c.css).map(function(k){return ind+'  '+k+': '+c.css[k]+(imp?' !important':'')+';';}).join('\n')+'\n'+ind+'}';}
  function cssText(list,imp){
    return ORDER_BP.map(function(L){
      var mine=list.filter(function(c){return c.css&&c.bp===L;});if(!mine.length)return '';
      return L==='base'?mine.map(function(c){return block(c,'',imp);}).join('\n\n'):'@media (max-width: '+BPS[L].max+'px) {\n'+mine.map(function(c){return block(c,'  ',imp);}).join('\n\n')+'\n}';
    }).filter(Boolean).join('\n\n');
  }
  function agentText(list){
    return '# Layout changes from Clay Studio\nPage: '+location.href+'\nApply these to the source files so the page matches what was arranged by hand. They are ordinary HTML structure and CSS. Free compositions use absolute positions on desktop and a readable stack on phones. Preserve intentional placement, text and links. Rules marked with a screen size go inside that @media query.\n\n'+
      list.map(function(c,i){var where=c.bp&&c.bp!=='base'?' (only at '+BPS[c.bp].max+'px and below: @media (max-width: '+BPS[c.bp].max+'px))':'';
        return (i+1)+'. '+(c.sel?'`'+c.sel+'`'+where+': ':'')+(c.text||'Style change.')+(c.css?'\n   ```css\n'+block(c,'   ')+'\n   ```':'');}).join('\n');
  }
  // A standalone copy of the page with the layout baked in: the studio, its ids and its preview styling left out.
  function exportDocument(){
    var list=changeList(),d=html.cloneNode(true);
    d.querySelectorAll('clay-studio,#clay-studio-css,script[src*="studio"],[data-clay-ui],[data-clay-runtime],#codex-browser-sidebar-comments-root').forEach(function(n){n.remove();});
    d.removeAttribute('data-sculpting');d.querySelectorAll('[data-sculpt-selected],[data-sculpt-locked]').forEach(function(n){n.removeAttribute('data-sculpt-selected');n.removeAttribute('data-sculpt-locked');});
    cleanCopy(d);d.querySelectorAll('[data-cs]').forEach(function(n){n.removeAttribute('data-cs');});d.removeAttribute('data-clay-on');d.removeAttribute('data-clay-state');
    var r=d.querySelector('[data-studio-root]');if(r){if(rootStyle)r.setAttribute('style',rootStyle);else r.removeAttribute('style');}
    d.style.background=htmlBg;if(!d.getAttribute('style'))d.removeAttribute('style');var b=d.querySelector('body');if(b){b.style.background=bodyBg;if(!b.getAttribute('style'))b.removeAttribute('style');}
    var s=doc.createElement('style');s.id='clay-studio-export';
    s.textContent='\n/* Layout from Clay Studio. !important so these win over the original stylesheet; fold them into your source to drop it. */\n'+cssText(list,true)+'\n';
    d.querySelector('head').appendChild(s);
    return '<!doctype html>\n'+d.outerHTML;
  }
  function downloadPage(){
    var blob=new Blob([exportDocument()],{type:'text/html'}),a=doc.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=(location.pathname.split('/').pop()||'index').replace(/\.html?$/,'')+'-clay.html';doc.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1000);say('Downloaded a standalone copy of the page with your layout in it.');
  }
  var view='css';
  function fillPanel(){var list=changeList();ui.area.value=list.length?(view==='css'?cssText(list)||'/* Only structure or order changed. See "For an agent". */':agentText(list)):'Nothing changed yet. Drag something, pull a gap, or paint.';
    q('.note').textContent=list.length+' change'+(list.length===1?'':'s');q('.v-css').setAttribute('aria-pressed',String(view==='css'));q('.v-list').setAttribute('aria-pressed',String(view!=='css'));}
  function openPanel(){fillPanel();ui.panel.style.display='flex';}
  function changes(){if(ui.panel.style.display==='flex'){ui.panel.style.display='none';return;}openPanel();}
  function badge(){if(!origin)return;q('.count').textContent=String(changeList().length);}
  function copy(){var t=ui.area.value;var ok=function(){say('Copied.');};
    if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t).then(ok,function(){ui.area.select();doc.execCommand('copy');ok();});else{ui.area.select();doc.execCommand('copy');ok();}}
  function help(show){
    var h=ui.help;if(!show){h.style.display='none';return;}
    var rows2=[['Drag','Arrange: beside, above, below'],['Shift + drag','Lasso select'],['Shift + click','Add to selection'],['Ctrl + drag','Pull out a copy'],['Alt + drag','Pick what is inside'],['Tab','Other ways to read a layout'],
      ['G · S · P','Grab · Stretch · Paint'],['1 · 2 · 3','Desktop · Tablet · Phone'],['Ctrl + K  or  /','Commands'],['Ctrl + G','Group'],['Ctrl + Shift + G','Ungroup'],['Ctrl + D','Duplicate'],
      ['Delete','Remove'],['Arrow keys','Move earlier or later'],['Ctrl + Z · Ctrl + Y','Undo · Redo'],['C','Changes, CSS and export'],['Alt (hold)','Measure distances and spacing'],['Shift while dragging','Move without snapping'],['Esc while dragging','Cancel the drag'],['I','Insert blocks'],['H','History: scrub through changes'],['B (hold)','See the page as it was'],['Drop an image file','Swap or add a picture'],['Double-click text','Edit it in place'],['L','Looks: normal · hover · focus · pressed'],['F','Play: meteors and friends'],['Esc','Close, deselect, hide']];
    h.innerHTML='<h3>Clay Studio shortcuts</h3><div class="grid">'+rows2.map(function(r){return '<div class="k"><span>'+r[1]+'</span><kbd>'+r[0]+'</kbd></div>';}).join('')+'</div>';
    h.style.display='block';
  }
  function coach(){
    try{if(localStorage.getItem('clay-studio:coached'))return false;}catch(e){return false;}
    var c=ui.coach;c.innerHTML='<b>Arrange this page by hand</b><ol><li>Drag a card onto the right side of another: they go side by side.</li><li>Press <kbd>Tab</kbd> for other ways to read what you did.</li><li>Press <kbd>C</kbd> for the CSS, or <kbd>Ctrl K</kbd> and type what you want.</li></ol>';
    var b=mk('button','btn lit','Got it');b.addEventListener('click',coachDone);c.appendChild(b);c.style.display='block';return true;
  }
  function coachDone(){if(ui.coach.style.display!=='block')return;ui.coach.style.display='none';try{localStorage.setItem('clay-studio:coached','1');}catch(e){}}
  function hide(){if(drag&&drag.moved)cancelDrag();lib(false);rewind(false);peek(false);togglePlay(false);clearMeasure();clearGuides();ui.readout.style.display='none';if(editing)endEdit(true);on=false;drag=stretch=lasso=painting=null;hidePill();select(null);['hover','target','band','edge','slot','lasso'].forEach(function(k){box(ui[k],null);});tagAt(null);html.style.cursor='';
    setDress('',true);html.removeAttribute('data-clay-on');ui.dock.style.display='none';ui.panel.style.display='none';ui.paintbar.style.display='none';ui.trash.style.display='none';ui.open.style.display='block';cmdClose();help(false);}
  function show(){on=true;html.setAttribute('data-clay-on','');ui.dock.style.display='flex';ui.open.style.display='none';if(tool==='paint')ui.paintbar.style.display='flex';}
  ['grab','stretch','paint'].forEach(function(n){q('.t-'+n).addEventListener('click',function(){pick(n);});});
  sh.querySelectorAll('.bps button').forEach(function(b){b.addEventListener('click',function(){setBP(b.dataset.bp);});});
  q('.undo').addEventListener('click',back);q('.redo').addEventListener('click',forward);
  q('.t-cmd').addEventListener('click',cmdOpen);q('.t-help').addEventListener('click',function(){help(ui.help.style.display!=='block');});
  q('.changes').addEventListener('click',changes);q('.hide').addEventListener('click',hide);ui.open.addEventListener('click',show);
  q('.v-css').addEventListener('click',function(){view='css';fillPanel();});q('.v-list').addEventListener('click',function(){view='list';fillPanel();});
  q('.copy').addEventListener('click',copy);q('.dl').addEventListener('click',downloadPage);q('.reset').addEventListener('click',function(){if(confirm('Start over? This clears your saved changes for this page.'))resetPage();});
  q('.pclose').addEventListener('click',function(){ui.panel.style.display='none';});
  q('.t-play').addEventListener('click',function(){togglePlay(!playing);});q('.t-state').addEventListener('click',function(){setDress('');});
  addEventListener('dblclick',function(e){if(!on||playing||editing||isUI(e)||!inRoot(e.target)||tool!=='grab')return;var t=textTarget(e.target);if(!t)return;e.preventDefault();e.stopPropagation();startEdit(t);},true);
  addEventListener('keyup',function(e){if(e.key==='Alt'){altHeld=false;clearMeasure();if(!hoverRaf)hoverRaf=requestAnimationFrame(hover);}},true);

  if(!origin){origin=capture();Object.keys(origin).forEach(function(cid){[cid].concat(origin[cid]).forEach(function(id){if(!originNames[id])originNames[id]=nameOf(byId(id));});});}
  html.setAttribute('data-clay-on','');render();buttons();
  window.__studio={layers:function(){return layers;},changes:changeList,css:function(){return cssText(changeList());},agent:function(){return agentText(changeList());},
    undo:back,redo:forward,pick:pick,bp:setBP,group:group,ungroup:ungroup,selectMany:selectMany,select:select,flow:flow,gravity:gravity,pin:pin,remove:remove,duplicate:duplicate,nudge:nudge,
    command:function(text){var it=cmdMatches(text).find(function(x){return x.exact;});if(!it)return false;cmdRun(it);return true;},paint:function(mode,val){paintMode=mode;if(mode==='material')paintMat=val;else paintColor=val;},
    paintOne:function(el){act(function(){paintOne(el);});},exportHTML:function(){return downloadPage;},play:togglePlay,playing:function(){return playing;},playTool:function(k){ptool=k;if(playing)playbar();},edit:startEdit,endEdit:endEdit,measure:measure,insert:insertAfter,lib:lib,rewind:rewind,rewindTo:rewindTo,rewindKeep:rewindKeep,peek:peek,state:setDress,dress:function(){return dress;},
    steps:function(){return {undo:undo.map(function(s){return s.label;}),redo:redo.map(function(s){return s.prevLabel;})};}};

  // A small transaction adapter for the sculpting surface. All edits use the
  // same rules, undo stack, storage and export as the original layout editor.
  window.ClayBridge={
    root:root, begin:snapshot,
    write:function(rows,label){
      rows.forEach(function(row){var el=row.el,L=row.bp||'base',id=idOf(el),r=layers[L][id]||(layers[L][id]={});
        Object.keys(row.css).forEach(function(k){if(row.defaults&&k in r)return;var v=row.css[k];if(v==null)delete r[k];else r[k]=String(v);});
        if(label)reasons[L+':'+id]=label;});
      render();
    },
    commit:function(before,label){lastWhy=label;commit(before);},
    restore:restore,undo:back,redo:forward,
    counts:function(){return {undo:undo.length,redo:redo.length};},
    stopMotion:function(){if(raf)cancelAnimationFrame(raf);raf=0;motions.forEach(function(m,e){e.style.translate=e.style.scale=e.style.transformOrigin='';});motions.clear();},
    original:function(enabled){if(enabled)show();else hide();host.style.display=enabled?'':'none';},
    css:function(){return cssText(changeList());},agent:function(){return agentText(changeList());},html:exportDocument,
    text:function(el,value){var id=idOf(el);if(!edited[id]){edited[id]=true;originTexts[id]=el.textContent;}var before=snapshot();el.textContent=value;setRule(el,{'white-space':'pre-wrap'},'base');lastWhy='You edited '+nameOf(el)+'.';commit(before);},
    retain:function(el){[el].concat(Array.prototype.slice.call(el.querySelectorAll('*'))).forEach(function(e){made[idOf(e)]=e;});},
    register:function(el,kind){var id=idOf(el);made[id]=el;inserted[id]={kind:kind};return id;},
    remove:function(el){var before=snapshot();made[idOf(el)]=el;el.remove();lastWhy='You removed '+nameOf(el)+'.';commit(before);render();},
    mobile:function(v){setBP(v?'mobile':'base');hidePill();},
    picture:function(img,file,done){shrinkImage(file,function(url){swapPicture(img,url,file.name);if(done)done();});},
    save:save
  };

  // first run gets the guide; after that, a one-line reminder (or word that the last session came back)
  if(restored)say('Welcome back: your last session is restored. Reset it from the Changes panel.');
  else if(!coach())say('Clay Studio: drag to arrange, Ctrl+K to type what you want, ? for shortcuts.');
})();
