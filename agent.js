/* Building together: an agent (Claude Code, Codex, a script) reads this page and changes it while you work.
   Its requests reach the Clay server, which hands them to this editor. Each request is applied here as one step, with
   the same pieces, rules and undo as your hands, and saved like any other change. All of a request, or none of it. */
(function(){
  'use strict';
  const S=window.ClaySculpt;if(!S)return;
  const {B,R,G,field,q,shell}=S;
  const page=(/^\/p\/([^/]+)\//.exec(location.pathname)||[])[1];if(!page)return;
  const inbox='/api/pages/'+page+'/agent',sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const KINDS=['text','card','button','image'];
  const me=[...crypto.getRandomValues(new Uint8Array(8))].map(b=>b.toString(16).padStart(2,'0')).join('');
  // opened out of sight by another Clay tab (host.js) for an agent, rather than by the person
  const hosted=window!==window.top,parent=window.parent,tellHost=m=>{if(hosted)parent.postMessage({...m,page},location.origin);};
  let stale=false,ctl=null,chipTimer=0,minted=0;

  // ---- reading the page ----
  const round=v=>Math.round(v);
  // the words as written (not as styled: a label shown in capitals reads as typed), with line breaks as spaces
  function txt(el){const c=el.cloneNode(true);c.querySelectorAll('br').forEach(b=>b.replaceWith(' '));return c.textContent.trim().replace(/\s+/g,' ');}
  const pinned=el=>getComputedStyle(el).getPropertyValue('--clay-pin').trim()==='1';
  // the separate bits of words in a piece, in reading order: a card's label, title and words; a menu's links
  function parts(el){const all=[...el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,small,li,blockquote,figcaption')];return all.filter(p=>!all.some(o=>o!==p&&p.contains(o))&&txt(p));}
  function hex(c){const m=/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(c);if(!m||m[4]==='0')return null;return '#'+[m[1],m[2],m[3]].map(v=>(+v).toString(16).padStart(2,'0')).join('');}
  function piece(el,r){r=r||R.rect(el);const o={id:el.id,kind:el.dataset.kind||'block',tag:el.tagName.toLowerCase(),x:round(r.x),y:round(r.y),width:round(r.w),height:round(r.h)};
    if(pinned(el))o.pinned=true;
    if(R.isGroup(el)){o.bond=el.dataset.bond;o.members=R.members(el).map(m=>piece(m));return o;}
    if(el.tagName==='IMG'){const s=el.getAttribute('src')||'';o.alt=el.alt;o.picture=/^data:/.test(s)?'embedded in the page':s;return o;}
    const ps=parts(el);if(ps.length)o.parts=ps.map((p,i)=>{const x={part:i,tag:p.tagName.toLowerCase(),text:txt(p)};if(p.hasAttribute('href'))x.link=p.getAttribute('href');return x;});else o.text=txt(el);
    if(el.tagName==='A')o.link=el.getAttribute('href');
    const s=getComputedStyle(el),fill=hex(s.backgroundColor);if(fill)o.fill=fill;o.color=hex(s.color);return o;}
  function describe(){B.stopMotion();B.still(true);try{const b=S.bounds();
    return {page,title:document.title,canvas:{width:round(b.w),height:round(b.h)},
      about:'The desktop layout. x, y, width and height are pixels from the top left of the canvas. Pieces sit where they are put; on phones they stack in reading order by themselves.',
      pieces:S.model().map(u=>piece(u.el,u))};}finally{B.still(false);}}

  // ---- changing it ----
  function find(id){const el=typeof id==='string'&&id&&document.getElementById(id);if(!el||!field.contains(el)||!el.hasAttribute('data-sculpt-item'))throw new Error('There is no piece "'+id+'". Read the page for the pieces and their ids.');return el;}
  function unit(id){const el=find(id);if(el.parentElement!==field)throw new Error('"'+id+'" is inside the group "'+el.parentElement.id+'". Change the group, or ungroup it first.');return el;}
  function num(v,name,fallback){if(v==null)return fallback;const n=+v;if(!Number.isFinite(n))throw new Error(name+' should be a number of pixels.');return n;}
  function words(a,name){const v=a[name];if(typeof v!=='string')throw new Error('Give '+name+' as text.');if(v.length>5000)throw new Error(name+' is too long.');return v;}
  function color(v,name){if(typeof v!=='string'||!CSS.supports('color',v))throw new Error(name+' should be a colour, like #ffd66b or teal.');return v;}
  function bit(el,part,what){if(part==null){if(what==='link'){if(el.tagName==='A')return el;const ls=[...el.querySelectorAll('a')];if(ls.length===1)return ls[0];throw new Error('This piece has '+ls.length+' links. Say which part.');}
      const ps=parts(el);if(!ps.length||ps.length===1&&ps[0]===el)return el;if(ps.length===1)return ps[0];throw new Error('This piece has '+ps.length+' parts. Say which one with "part".');}
    const ps=parts(el),p=ps[+part];if(!p)throw new Error('This piece has parts 0 to '+(ps.length-1)+'.');if(what==='link'&&p.tagName!=='A')throw new Error('Part '+part+' is not a link.');return p;}
  function address(to,pages){if(typeof to!=='string'||!to.trim())throw new Error('Say where it goes: "#id" on this page, "page:<name>", or a web address.');to=to.trim();
    if(to[0]==='#'){if(to!=='#'&&!document.getElementById(to.slice(1)))throw new Error('Nothing on this page has the id "'+to.slice(1)+'".');return to;}
    if(/^page:/.test(to)){const n=to.slice(5);if(!pages.some(p=>p.name===n))throw new Error('There is no page "'+n+'". Pages: '+pages.map(p=>p.name).join(', ')+'.');return '../'+n+'/';}
    const w=S.webAddress(to);if(!w)throw new Error('"'+to+'" is not a web address.');return w;}
  // On a phone the pieces stack in page order, so one an agent adds or moves takes its place in reading order: top to
  // bottom, and left to right along a row.
  function reread(el){if(el.parentElement!==field)return;const r=R.rect(el);
    const next=S.items().find(o=>{if(o===el)return false;const q=R.rect(o);return Math.abs(q.y-r.y)<24?q.x>r.x:q.y>r.y;});
    if(next)field.insertBefore(el,next);else field.appendChild(el);}
  function grow(bottom,label){const b=S.bounds();if(bottom+40>b.h)B.write([{el:field,css:{height:Math.ceil(bottom+40)+'px'}}],label);}
  function lowest(){return Math.max(0,...S.items().map(e=>{const r=R.rect(e);return r.y+r.h;}));}
  function position(el,a,label,fresh){const r=R.rect(el),b=S.bounds(),group=R.isGroup(el),st=group&&(a.width!=null||a.height!=null)?R.resizeState(el):null;
    let w=G.clamp(num(a.width,'width',r.w),32,b.w),h=num(a.height,'height',r.h),x=G.clamp(num(a.x,'x',r.x),0,b.w-w),y=Math.max(0,num(a.y,'y',r.y));
    const css={left:(x/b.w*100).toFixed(4)+'%',top:y.toFixed(2)+'px'};
    if(a.width!=null||fresh)css.width=(w/b.w*100).toFixed(4)+'%';
    if(a.height!=null&&!group){if(el.tagName==='IMG')css.height=h.toFixed(2)+'px';else if(el.dataset.kind!=='text')css['min-height']=h.toFixed(2)+'px';else throw new Error('Text is as tall as its words. Change its size or width instead.');}
    if(a.size!=null){if(el.dataset.kind!=='text')throw new Error('size is the size of the letters in a text piece.');css['font-size']=G.clamp(num(a.size,'size'),10,160)+'px';}
    B.write([{el,css}],label);if(st)R.resize(el,st,w,a.height!=null?h:st.h*w/st.w);grow(R.rect(el).y+R.rect(el).h,label);}
  function make(a,label){let el,kind,tmpl=null;
    // a new card or button looks like one already on the page, unless the agent says which piece to copy
    if(a.like==null&&(a.kind==='card'||a.kind==='button'))tmpl=field.querySelector('[data-sculpt-item][data-kind="'+a.kind+'"]');
    if(a.like!=null||tmpl){const src=tmpl||find(a.like);if(R.isGroup(src))throw new Error('like takes a single piece, not a group.');el=src.cloneNode(true);kind=src.dataset.kind;
      [el,...el.querySelectorAll('*')].forEach(n=>{['data-cs','data-sculpt-selected','data-sculpt-locked'].forEach(k=>n.removeAttribute(k));if(n!==el)n.removeAttribute('id');});
      if(tmpl){const ps=parts(el);(ps.length?ps:[el]).forEach(p=>{p.textContent='';});if(el.tagName==='A')el.setAttribute('href','#');}}
    else{kind=a.kind;if(!KINDS.includes(kind))throw new Error('kind is one of '+KINDS.join(', ')+', or use "like" with the id of a piece to copy its look.');
      el=document.createElement(kind==='card'?'article':kind==='button'?'a':kind==='image'?'img':'p');el.className='piece '+(kind==='card'?'note leaf':kind==='button'?'join':kind==='text'?'intro':'');
      if(kind==='card')el.innerHTML='<small></small><h2></h2><p></p>';else if(kind==='button')el.href='#';}
    let id=a.id;if(id!=null){if(typeof id!=='string'||!/^[a-z][a-z0-9-]{0,40}$/.test(id))throw new Error('id should be short, lowercase letters, digits and dashes.');if(document.getElementById(id))throw new Error('Something already has the id "'+id+'".');}
    else id='piece-'+Date.now().toString(36)+'-'+(++minted);
    el.id=id;el.dataset.sculptItem='';el.dataset.kind=kind;
    if(kind==='image'){const s=a.src;if(typeof s!=='string'||!/^(https?:\/\/|data:image\/)/.test(s))throw new Error('An image needs src: an http(s) address or a data:image URL.');el.src=s;el.alt=typeof a.alt==='string'?a.alt:'';}
    const ps=parts(el).length?parts(el):[...el.querySelectorAll('small,h2,p')];
    if(a.parts!=null){if(!Array.isArray(a.parts)||a.parts.length>ps.length)throw new Error('parts gives the words for each part, up to '+ps.length+' here.');a.parts.forEach((t,i)=>{if(t!=null)ps[i].textContent=String(t);});}
    if(a.text!=null){if(kind==='image')throw new Error('Use alt for a picture\'s words.');(ps[ps.length>1?1:0]||el).textContent=words(a,'text');}
    if(kind==='card'&&a.like==null)ps.forEach(p=>{if(!p.textContent)p.remove();});
    if(a.to!=null){if(el.tagName!=='A')throw new Error('Only a button or a link can go somewhere; this is a '+el.tagName.toLowerCase()+'.');el.setAttribute('href',a.to);}
    field.appendChild(el);B.register(el,kind);
    const b=S.bounds(),src=a.like!=null?R.rect(find(a.like)):tmpl?R.rect(tmpl):null,w=num(a.width,'width',src?src.w:b.w*.27);
    B.write([{el,css:{position:'absolute',...(kind==='image'?{height:num(a.height,'height',190)+'px'}:{})}},S.mobileRules(el)],label);
    position(el,{x:num(a.x,'x',b.w*.06),y:num(a.y,'y',lowest()+24),width:w,size:a.size},label,true);reread(el);return el;}
  // Everything a request says, one action at a time. Throws with the reason if one can't be done.
  function apply(a,pages,label,touched){if(!a||typeof a!=='object')throw new Error('Each action is an object with "do".');
    switch(a.do){
      case 'place':{const el=unit(a.piece);position(el,a,label);if(a.x!=null||a.y!=null)reread(el);touched.add(el);return {ok:true};}
      case 'text':{const el=find(a.piece),t=bit(el,a.part,'text');B.textNow(t,words(a,'text'));if(R.isGroup(R.unit(el)))R.fit(R.unit(el));touched.add(R.unit(el));return {ok:true};}
      case 'link':{const el=find(a.piece),t=bit(el,a.part,'link'),h=address(a.to,pages);B.linkNow(t,h);touched.add(R.unit(el));return {ok:true,link:h};}
      case 'add':{if(a.to!=null)a={...a,to:address(a.to,pages)};const el=make(a,label);touched.add(el);return {ok:true,id:el.id};}
      case 'remove':{let el=find(a.piece);if(R.isGroup(el.parentElement))el=R.peel(el);B.removeNow(el);return {ok:true};}
      case 'paint':{const el=find(a.piece),css={};if(a.fill!=null){css['background-color']=color(a.fill,'fill');css['background-image']='none';}if(a.text!=null)css.color=color(a.text,'text');
        if(!Object.keys(css).length)throw new Error('Give fill, text, or both, as colours.');B.write([{el,css}],label);touched.add(R.unit(el));return {ok:true};}
      case 'pin':{const el=unit(a.piece);B.write([{el,css:{'--clay-pin':a.pinned===false?'0':'1'}}],label);touched.add(el);return {ok:true};}
      case 'group':{if(!Array.isArray(a.pieces)||a.pieces.length<2)throw new Error('pieces lists at least two pieces.');const us=[...new Set(a.pieces.map(unit))];if(us.length<2)throw new Error('pieces lists at least two different pieces.');
        const g=R.wrap(us);if(!g)throw new Error('Those pieces can\'t be grouped.');touched.add(g);return {ok:true,id:g.id};}
      case 'ungroup':{const g=unit(a.piece);if(!R.isGroup(g))throw new Error('"'+a.piece+'" is not a group.');R.ungroup(g).forEach(e=>touched.add(e));return {ok:true};}
      // shorter than the pieces reach fits the canvas to them, so nothing is ever cut off
      case 'canvas':{const want=round(num(a.height,'height')),low=Math.ceil(lowest()),h=Math.max(want,low);B.write([{el:field,css:{height:h+'px'}}],label);
        return h===want?{ok:true,height:h}:{ok:true,height:h,note:'The pieces reach down to '+low+'px, so the canvas ends there.'};}
      default:throw new Error('do is one of place, text, link, add, remove, paint, pin, group, ungroup, canvas.');}}
  const quoted=id=>{const el=document.getElementById(id);return el?'“'+S.pieceName(el).slice(0,32)+'”':'a piece';};
  function phrase(a){if(!a)return '';switch(a.do){case 'place':return 'moved '+quoted(a.piece);case 'text':return 'rewrote '+quoted(a.piece);case 'link':return 'linked '+quoted(a.piece);case 'add':return 'added '+(a.like?'a piece like '+quoted(a.like):'a '+a.kind);
    case 'remove':return 'removed '+quoted(a.piece);case 'paint':return 'painted '+quoted(a.piece);case 'pin':return (a.pinned===false?'unpinned ':'pinned ')+quoted(a.piece);case 'group':return 'grouped '+(a.pieces||[]).length+' pieces';case 'ungroup':return 'ungrouped '+quoted(a.piece);case 'canvas':return 'resized the canvas';default:return a.do;}}
  function summary(list){const p=[...new Set(list.map(phrase))];return p.length<=2?p.join(' and '):p.slice(0,2).join(', ')+' and '+(p.length-2)+' more';}
  async function change(list,who,say){
    if(!Array.isArray(list)||!list.length)return {ok:false,error:'Send a list of actions.'};if(list.length>200)return {ok:false,error:'At most 200 actions at a time.'};
    let pages=[];if(list.some(a=>a&&typeof a.to==='string'&&/^page:/.test(a.to.trim()))){try{const r=await fetch('/api/pages');if(r.ok)pages=await r.json();}catch(e){}}
    const label=who+': '+(typeof say==='string'&&say.trim()?say.trim().slice(0,140):summary(list));
    // text and links that will change are noted first, so Undo knows what they were
    list.forEach(a=>{if(a&&(a.do==='text'||a.do==='link')){try{B.mark(bit(find(a.piece),a.part,a.do),a.do);}catch(e){}}});
    B.stopMotion();B.still(true);const before=B.begin(),touched=new Set(),results=[];
    try{list.forEach((a,i)=>{try{results.push(apply(a,pages,label,touched));}catch(e){throw new Error('Action '+(i+1)+' ('+(a&&a.do)+'): '+e.message);}});}
    catch(e){B.restore(before);B.still(false);S.refresh();return {ok:false,error:e.message+' Nothing was changed.'};}
    B.commit(before,label);B.still(false);S.refresh();S.say(label);
    const live=[...touched].filter(e=>e.isConnected),others=S.items(),warnings=[];
    live.forEach(e=>{e.animate([{outline:'3px solid #6756d4',outlineOffset:'6px'},{outline:'3px solid #6756d400',outlineOffset:'6px'}],{duration:1800,easing:'ease-out'});
      const r=R.rect(e);others.forEach(o=>{if(o!==e&&!(touched.has(o)&&o.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)&&G.overlaps(r,R.rect(o),-2))warnings.push(quoted(e.id)+' overlaps '+quoted(o.id)+'.');});});
    return {ok:true,step:label,results,warnings,page:describe()};}

  // ---- the channel: wait for requests while this tab is showing, answer each one ----
  async function handle(cmd){const who=typeof cmd.as==='string'&&cmd.as.trim()?cmd.as.trim().slice(0,30):'An agent';
    for(let t=0;S.busy()&&t<80;t++)await sleep(100);
    const busy=S.busy();if(busy)return {ok:false,error:busy+' Try again in a moment.'};
    if(stale)return {ok:false,error:'This page was changed somewhere else. The person needs to reload it before anything else can change.'};
    if(!hosted)here(who);if(cmd.read)return {ok:true,page:describe()};
    // the agent hears back once the change is saved on the server, so it holds even if this page closes straight after
    const out=await change(cmd.actions,who,cmd.say);if(out.ok)await new Promise(r=>{B.flush(r);setTimeout(r,8000);});return out;}
  async function listen(){
    for(let wait=1000;;){
      if(document.visibilityState!=='visible'){await new Promise(r=>document.addEventListener('visibilitychange',r,{once:true}));continue;}
      let r;ctl=new AbortController();
      try{r=await fetch(inbox+'?wait=25&editor='+me+(hosted?'&hosted=1':''),{signal:ctl.signal,cache:'no-store'});}catch(e){if(document.visibilityState==='visible'){await sleep(wait);wait=Math.min(wait*2,15000);}continue;}
      wait=1000;if(r.status===204)continue;if(r.status!==200){await sleep(5000);continue;}
      const cmd=await r.json();
      // the person has opened this page themselves: theirs takes over
      if(cmd.close){B.flush(()=>tellHost({clayAgent:'close'}));return;}
      let out;try{out=await handle(cmd);}catch(e){out={ok:false,error:'The editor could not do that: '+e.message};}
      try{await fetch(inbox+'/'+encodeURIComponent(cmd.id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(out)});}catch(e){}
      tellHost({clayAgent:'step',title:document.title,step:out.ok?out.step:''});}}
  // A hidden tab stops waiting, so it never holds one of the browser's few connections to this server, and says it has
  // gone, as a closing one does, so agents are told at once instead of waiting for an answer that won't come.
  const bye=()=>{if(ctl)ctl.abort();try{navigator.sendBeacon(inbox+'/bye?editor='+me);}catch(e){}};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')bye();});
  addEventListener('pagehide',bye);
  addEventListener('clay-save',e=>{if(e.detail.state==='stale')stale=true;});

  window.ClayAgent={describe,change:(list,who,say)=>change(list,who||'Test',say)};
  if(hosted){listen();return;}

  // ---- what you see: who is here, and how to invite one ----
  const chip=document.createElement('span');chip.className='clay-agent-chip';chip.hidden=true;chip.setAttribute('role','status');q('.clay-brand').after(chip);
  function here(who){chip.textContent=who+' is here';chip.hidden=false;clearTimeout(chipTimer);chipTimer=setTimeout(()=>{chip.hidden=true;},120000);}
  const open=document.createElement('button');open.className='clay-agent-open';open.textContent='Agent';open.title='Build this page together with Claude Code, Codex or another agent';q('.clay-export').before(open);
  const box=document.createElement('dialog');box.className='clay-dialog clay-agent';box.setAttribute('aria-labelledby','clay-agent-title');
  box.innerHTML='<div class="row"><h2 id="clay-agent-title">Build this page with an agent</h2><button data-close>Close</button></div>'+
    '<p>An agent such as Claude Code or Codex can read this page and change it while you work on it. Its changes appear here as they happen, one step at a time, and Undo takes them back like your own. It can also make pages and work on ones you don\'t have open, as long as Clay is open somewhere: those open out of sight, and you\'ll find its changes in their history.</p>'+
    '<h3>Claude Code</h3><p>Run this once in a terminal:</p><pre data-for="claude"></pre><button data-copy="claude">Copy</button>'+
    '<h3>Codex</h3><p>Save <a href="/clay-mcp.py" download>clay-mcp.py</a> (it needs Python), then add this to <code>~/.codex/config.toml</code>, with the path to where you saved it:</p><pre data-for="codex"></pre><button data-copy="codex">Copy</button>'+
    '<p class="clay-agent-small">Then ask it something like “In Clay, make the cards on my home page three across”. The key in these lets an agent in, so share it like a password. <button data-rotate>Make a new key</button> shuts out anything using this one.</p>'+
    '<div class="clay-agent-state" role="status" aria-live="polite"></div>';
  shell.appendChild(box);
  const tell=t=>{box.querySelector('.clay-agent-state').textContent=t;};
  function fill(key){const url=location.origin+'/mcp';
    box.querySelector('[data-for=claude]').textContent='claude mcp add --transport http clay '+url+' --header "Authorization: Bearer '+key+'"';
    box.querySelector('[data-for=codex]').textContent='[mcp_servers.clay]\ncommand = "python"\nargs = ["/path/to/clay-mcp.py"]\nenv = { CLAY_URL = "'+location.origin+'", CLAY_AGENT_KEY = "'+key+'" }';}
  async function key(method){const r=await fetch('/api/agent-key',{method,headers:method==='POST'?{'Content-Type':'application/json'}:{},body:method==='POST'?'{}':undefined});if(!r.ok)throw new Error('The server said '+r.status+'.');return (await r.json()).key;}
  open.addEventListener('click',async()=>{tell('');try{fill(await key('GET'));}catch(e){tell('Could not get the key: '+e.message);}box.showModal();});
  box.querySelector('[data-close]').addEventListener('click',()=>box.close());
  box.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{const t=box.querySelector('[data-for='+b.dataset.copy+']').textContent;try{await navigator.clipboard.writeText(t);tell('Copied.');}catch(e){getSelection().selectAllChildren(box.querySelector('[data-for='+b.dataset.copy+']'));tell('Selected. Copy it with Ctrl+C.');}}));
  box.querySelector('[data-rotate]').addEventListener('click',async()=>{try{fill(await key('POST'));tell('New key made. Agents set up with the old one need the new one.');}catch(e){tell('Could not make a new key: '+e.message);}});
  window.addEventListener('keydown',e=>{if(box.open)e.stopImmediatePropagation();},true);

  // this tab can open other pages out of sight for agents, and says what they do there
  addEventListener('clay-host',e=>{if(e.detail.text)S.say(e.detail.text);});
  const h=document.createElement('script');h.src='/host.js';h.dataset.clayRuntime='';document.body.appendChild(h);
  listen();
})();
