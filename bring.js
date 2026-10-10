/* Bring in your server: drop a compose file onto the page (or docker ps, or one app a line), or paste it, and each app
   it runs arrives as a card that opens it. Cards already on the page for those apps get their links, and dropping the
   file again brings only what is new, so a page shaped by hand is never rebuilt. All of it is one step and one Undo. */
(function(){
  'use strict';
  const S=window.ClaySculpt,C=window.ClayCompose;if(!S||!C||window.ClayBring)return;
  const {B,R,G,field,shell,say}=S,norm=C.norm;
  const LOOP=/^(127\.\d+\.\d+\.\d+|localhost|\[?::1\]?|0\.0\.0\.0|)$/i,COLORS=['sun','leaf','sky','rose','water','lilac'];
  const list=(xs,n=3)=>xs.length>n?xs.slice(0,n).join(', ')+' and '+(xs.length-n)+' more':xs.length>1?xs.slice(0,-1).join(', ')+' and '+xs[xs.length-1]:xs.join('');
  const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mem='';try{mem=localStorage.getItem('clay-server')||'';}catch(e){}

  // ---- the cards already here ----
  // a piece that is a link, or holds just one: cards and buttons, alone or in groups
  function linkOf(el){if(el.tagName==='A')return el;const a=el.querySelectorAll('a');return a.length===1?a[0]:null;}
  const linked=()=>[...field.querySelectorAll('[data-sculpt-item]')].filter(el=>(el.dataset.kind==='card'||el.dataset.kind==='button')&&linkOf(el));
  const named=el=>((el.querySelector('small')||el.querySelector('h1,h2,h3,h4')||el).textContent||'').trim();
  // an example card, or one still waiting for its address
  const nowhere=h=>!h||h==='#'||h==='#top'||h==='#'+field.id;
  // the server the page's apps are on: where the cards Clay brought in or linked already point by port, most often (a
  // card linked by hand may well be on another machine)
  function pageServer(){const n={};linked().filter(el=>el.dataset.app).forEach(el=>{const m=/^https?:\/\/(\[[^\]]+\]|[^/:?#\s]+):\d+/i.exec(linkOf(el).getAttribute('href')||'');if(m&&!LOOP.test(m[1]))n[m[1]]=(n[m[1]]||0)+1;});
    return Object.keys(n).sort((a,b)=>n[b]-n[a])[0]||'';}
  const here=()=>LOOP.test(location.hostname)?'':location.hostname;
  // the server as someone types it: 192.168.1.20, nas.lan, fd00::2 or an address they copied; null if it isn't one
  function host(v){v=String(v||'').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i,'').replace(/[/?#].*$/,'');let m=/^\[([0-9a-f:.]+)\](?::\d{1,5})?$/i.exec(v);if(m)return '['+m[1].toLowerCase()+']';
    if(/^[0-9a-f:.]+$/i.test(v)&&(v.match(/:/g)||[]).length>=2)return '['+v.toLowerCase()+']';
    m=/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::\d{1,5})?$/i.exec(v);return m&&!LOOP.test(m[1])?m[1].toLowerCase():null;}
  // apps reached by a port on the server need to know which server
  const needs=f=>f.apps.some(a=>a.link&&!a.link.href&&!a.link.ip);
  function hrefOf(a,h){const l=a.link;if(!l)return null;if(l.href)return l.href;const at=l.ip?(l.ip.includes(':')?'['+l.ip+']':l.ip):h;if(!at)return null;
    return (l.https?'https':'http')+'://'+at+(l.port===(l.https?443:80)?'':':'+l.port)+(l.path||'');}

  // What a file means for this page: cards to link, cards already here, cards still waiting for an address, and apps to
  // bring in. A card is an app's by what Clay brought it in or linked it as, by its label, or by already going to the
  // app's address. Links that will change are noted before the step begins, so Undo knows what they were.
  function prepare(found,h){const cards=linked(),mine=new Set(),p={found,host:h,link:[],same:[],waiting:[],add:[],idle:[]};
    found.apps.forEach(a=>{const names=new Set(a.names),href=hrefOf(a,h),free=c=>!mine.has(c);
      const el=cards.find(c=>free(c)&&c.dataset.app===a.key)||cards.find(c=>free(c)&&(!c.dataset.app||nowhere(linkOf(c).getAttribute('href')))&&names.has(norm(named(c))))||href&&cards.find(c=>free(c)&&linkOf(c).getAttribute('href')===href);
      if(!el){p.add.push({app:a,href});return;}mine.add(el);const l=linkOf(el),now=l.getAttribute('href');
      if(href&&nowhere(now)){p.link.push({el,l,app:a,href});B.mark(l,'link');}else if(!href&&nowhere(now))p.waiting.push({el,app:a});else p.same.push({el,app:a});});
    // the page's example cards for apps that aren't in the file
    p.idle=cards.filter(c=>!mine.has(c)&&c.dataset.kind==='card'&&nowhere(linkOf(c).getAttribute('href'))&&C.app(named(c)));
    return p;}

  // ---- new cards ----
  function palette(){const has=new Set();for(const sh of document.styleSheets){let rs;try{rs=sh.cssRules;}catch(e){continue;}
      for(const r of rs)if(r.selectorText)COLORS.forEach(c=>{if(new RegExp('\\.'+c+'(?![\\w-])').test(r.selectorText))has.add(c);});}
    return COLORS.filter(c=>has.has(c));}
  // a new card looks like the page's own: a copy of its first link card (or any card), in the app's colour
  function template(){const all=[...field.querySelectorAll('[data-sculpt-item][data-kind="card"]')];return all.find(e=>e.tagName==='A'&&e.parentElement===field)||all.find(e=>e.parentElement===field)||all[0]||null;}
  function slug(s){let id=String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'app';if(!/^[a-z]/.test(id))id='app-'+id;let n=id,k=1;while(document.getElementById(n))n=id+'-'+(++k);return n;}
  function card(a,href,tm,color){const el=document.createElement('a'),src=tm||Object.assign(document.createElement('a'),{className:'piece note leaf',innerHTML:'<small></small><h2></h2><p></p>'});
    [...src.attributes].forEach(x=>{if(!/^(id|href|style|data-cs|data-sculpt-selected|data-sculpt-locked|data-app|data-sculpt-item|data-kind)$/.test(x.name))el.setAttribute(x.name,x.value);});
    el.innerHTML=src.innerHTML;el.querySelectorAll('*').forEach(n=>{n.removeAttribute('id');n.removeAttribute('data-cs');});
    const small=el.querySelector('small'),title=el.querySelector('h1,h2,h3,h4'),words=el.querySelector('p');
    if(small)small.textContent=norm(a.name)===norm(a.title)?'':a.name;if(title)title.textContent=a.title;if(words)words.textContent=a.blurb;
    [small,title,words].forEach(n=>{if(n&&!n.textContent)n.remove();});if(!title&&!words)el.textContent=a.title;
    if(color){COLORS.forEach(c=>el.classList.remove(c));el.classList.add(color);}
    el.id=slug(a.key);el.dataset.sculptItem='';el.dataset.kind='card';el.dataset.app=a.key;el.setAttribute('href',href||'#');return el;}
  // On a phone the pieces stack in page order. A new card goes straight after whatever comes just before it in reading
  // order (the piece before it, not the one after: page order isn't always reading order, and a note placed high up
  // but written last would otherwise split the cards).
  const later=(a,b)=>Math.abs(a.y-b.y)<24?a.x>b.x:a.y>b.y;
  function reread(el){const r=R.rect(el),before=S.items().filter(o=>o!==el&&later(r,R.rect(o)));
    if(before.length)before.reduce((a,o)=>later(R.rect(o),R.rect(a))?o:a).after(el);else field.prepend(el);}
  // Where new cards go: free places in the page's own grid of cards, then new rows below it. Whatever sat under the
  // cards moves down as far as they reach, and the canvas grows with it; a pinned piece stays, and the rows go round
  // it. A page with no cards starts a row of three where the file was dropped, never across a piece.
  // Everything is measured where it rests, and motion stays held afterwards if it was held before (an agent's request
  // holds it for the whole request).
  function place(made,at,label,tm){const b=S.bounds(),mine=new Set(made),moved=[],held=document.documentElement.hasAttribute('data-clay-drag');B.stopMotion();
    try{const all=S.model().filter(u=>!mine.has(u.el));B.still(true);const tr=tm&&R.rect(tm),cards=all.filter(u=>u.kind==='card'),ws=cards.map(u=>u.w).sort((p,q)=>p-q);
      // as wide as most of the page's cards, whatever one of them has been stretched to
      const w=Math.min(b.w*.9,ws.length?ws[ws.length>>1]:tr?tr.w:b.w*.27);
      made.forEach(el=>B.write([{el,css:{position:'absolute',left:'0%',top:'0px',width:(w/b.w*100).toFixed(4)+'%'}},S.mobileRules(el)],label));
      const hs=made.map(el=>el.getBoundingClientRect().height),xs=[],rows=[];
      // the grid's columns: card edges far enough apart to hold a card between them, inside the canvas
      cards.map(u=>u.x).sort((p,q)=>p-q).forEach(x=>{if(x+w<=b.w+.5&&(!xs.length||x>=xs[xs.length-1]+w+8))xs.push(x);});
      cards.slice().sort((p,q)=>p.y-q.y).forEach(u=>{const r=rows.find(r=>Math.abs(r.y-u.y)<24);if(r)r.bottom=Math.max(r.bottom,u.y+u.h);else rows.push({y:u.y,bottom:u.y+u.h});});
      let gap=24;if(rows.length>1){const g=rows.slice(1).map((r,k)=>r.y-rows[k].bottom).sort((p,q)=>p-q);gap=G.clamp(g[g.length>>1],16,80);}else if(xs.length>1)gap=G.clamp(xs[1]-xs[0]-w,16,80);
      if(cards.length<2||!xs.length){const x0=cards.length&&cards[0].x+w<=b.w?cards[0].x:b.w*.06;xs.length=0;for(let x=x0;x+w<=b.w*.98+.5;x+=w+gap)xs.push(x);if(!xs.length)xs.push(Math.max(0,b.w-w));}
      let top=0;if(!rows.length){top=G.clamp(at?at.y-hs[0]/2:Math.max(gap,...all.filter(u=>u.w<b.w*.9).map(u=>u.y+u.h+gap)),0,b.h);
        for(let cut;(cut=all.filter(u=>u.y<top-1&&u.y+u.h>top+1)).length;)top=Math.max(...cut.map(u=>u.y+u.h))+gap;}
      const spots=[],taken=all.map(u=>({x:u.x,y:u.y,w:u.w,h:u.h})),pins=all.filter(u=>u.pin);let k=0;
      rows.forEach(row=>xs.forEach(x=>{if(k>=made.length)return;const r={x,y:row.y,w,h:hs[k]};if(!taken.concat(spots).some(o=>G.overlaps(r,o,9.9)))spots.push({...r,el:made[k++]});}));
      const floor=rows.length?Math.max(...rows.map(r=>r.bottom)):top;let y=rows.length?floor+gap:top;
      while(k<made.length){const row=[];let i=k;xs.forEach(x=>{if(i<made.length){row.push({x,y,w,h:hs[i],el:made[i]});i++;}});
        const hit=pins.filter(q=>row.some(s=>G.overlaps(s,q,9.9)));if(hit.length){y=Math.max(...hit.map(q=>q.y+q.h))+gap;continue;}
        spots.push(...row);k=i;y=Math.max(...row.map(s=>s.y+s.h))+gap;}
      const deepest=Math.max(...spots.map(s=>s.y+s.h)),shift=Math.max(0,deepest-floor+(rows.length?0:gap));
      const below=all.filter(u=>!u.pin&&shift&&u.y>=floor-1),items=all.map(u=>below.includes(u)?{...u,y:u.y+shift}:{...u}),fresh=spots.map(s=>({id:s.el.id,el:s.el,x:s.x,y:s.y,w:s.w,h:s.h,kind:'card'}));
      const res=G.separate(items.concat(fresh),{w:b.w,h:Math.max(b.h+shift,deepest+gap)},fresh.map(u=>u.id),undefined,G.crowded(all)).items,to=new Map(res.map(u=>[u.el,u]));
      made.forEach(el=>{const u=to.get(el);B.write([{el,css:{left:(u.x/b.w*100).toFixed(4)+'%',top:u.y.toFixed(2)+'px'}}],label);});
      all.forEach(u=>{const v=to.get(u.el),dx=v.x-u.x,dy=v.y-u.y;if(Math.abs(dx)<.5&&Math.abs(dy)<.5)return;
        B.write([{el:u.el,css:Math.abs(dx)<.5?{top:v.y.toFixed(2)+'px'}:{left:(v.x/b.w*100).toFixed(4)+'%',top:v.y.toFixed(2)+'px'}}],label);moved.push({el:u.el,dx,dy});});
      // the canvas keeps the room it had below its lowest piece
      const low=Math.max(...res.map(u=>u.y+u.h)),room=G.clamp(b.h-Math.max(0,...all.map(u=>u.y+u.h)),0,40),tall=Math.ceil(Math.max(b.h+(below.length?shift:0),low+room));if(tall>b.h)B.write([{el:field,css:{height:tall+'px'}}],label);
      made.forEach(reread);}
    finally{B.still(held);}
    return moved;}
  // Everything in the step: links first, then the new cards and the room they need.
  function apply(p,label){p.link.forEach(x=>{B.linkNow(x.l,x.href);x.el.dataset.app=x.app.key;});p.waiting.forEach(x=>{x.el.dataset.app=x.app.key;});
    const tm=template(),pal=tm&&COLORS.some(c=>tm.classList.contains(c))?palette():[],made=[];let prev='';
    p.add.forEach((x,k)=>{let c=pal.length?pal.includes(x.app.color)?x.app.color:pal[k%pal.length]:'';if(c&&c===prev&&pal.length>1)c=pal[(pal.indexOf(c)+1)%pal.length];prev=c;
      const el=card(x.app,x.href,tm,c);field.appendChild(el);B.register(el,'card');made.push(el);});
    const moved=made.length?place(made,p.at,label,tm):[];return {...p,made,moved};}

  // ---- what happened, in words ----
  function words(r,from,agent){const f=r.found,s=[],made=r.made.length,ln=r.link.length,same=r.same.length;
    const at=r.host&&r.add.concat(r.link).some(x=>x.href&&!x.app.link.href&&!x.app.link.ip)?', at '+r.host:'';
    if(made)s.push('Brought in '+(made===1?r.add[0].app.name:made+' apps')+' from '+from+at+'.');
    if(ln)s.push(ln===1?'“'+S.pieceName(r.link[0].el)+'” now opens '+r.link[0].app.name+(made?'':at)+'.':ln+' cards already here now open their apps'+(made?'':at)+'.');
    if(!made&&!ln)s.push(same?'Nothing new in '+from+': '+(same===1?r.waiting.length?'the app with an address is':'its app is':'all '+same+' apps'+(r.waiting.length?' with an address':'')+' are')+' already here.':'Nothing new in '+from+'.');
    else if(same)s.push(same+' already here.');
    // apps with no address in the file, whether their card is new or was already here
    const none=r.add.filter(x=>!x.href).map(x=>x.app).concat(r.waiting.map(x=>x.app));
    if(none.length)s.push('No address yet for '+(none.length===1&&none[0].note?none[0].name+', which '+none[0].note:list(none.map(a=>a.name)))+(agent?': link '+(none.length===1?'its card':'them')+' once you know where.':': grab '+(none.length===1?'its card':'one')+' and press K.'));
    const guessed=r.add.filter(x=>x.href&&x.app.guess).map(x=>x.app.name);if(guessed.length)s.push('Guessed the port for '+list(guessed)+'.');
    if(f.helpers.length)s.push('Left out '+(f.helpers.length===1?'a helper':f.helpers.length+' helpers')+': '+list(f.helpers.map(x=>x.service))+'.');
    if(f.skipped.length)s.push('Also left out '+f.skipped.slice(0,2).map(x=>x.service+', which '+x.why).join('; ')+(f.skipped.length>2?'; and '+(f.skipped.length-2)+' more':'')+'.');
    if(r.idle.length)s.push('Not in '+from+', so still unlinked: '+list(r.idle.map(named))+'.');
    if(f.missing.length)s.push(agent?'Send its .env as "env" for '+list(f.missing)+'.':'Drop its .env file with it for '+list(f.missing)+'.');
    if(made||ln)s.push('One Undo takes it all back.');
    return s.join(' ');}
  // The new cards fly out from where the file landed. They are measured where they rest first, before any of them moves.
  function burst(r,at){const rs=r.made.map(el=>R.rect(el)),vs=r.made.map(el=>el.getBoundingClientRect()),still_=reduce();
    if(at&&!still_){r.made.forEach((el,k)=>{const b=rs[k],dx=at.x-b.x-b.w/2,dy=at.y-b.y-b.h/2;
        el.animate([{transform:'translate('+dx+'px,'+dy+'px) scale(.2) rotate('+(k%2?-10:10)+'deg)',opacity:0},{opacity:1,offset:.3},{transform:'none',opacity:1}],{duration:760,delay:80+k*90,easing:'cubic-bezier(.2,.85,.25,1.15)',fill:'backwards'});});
      r.moved.forEach(m=>m.el.animate([{transform:'translate('+(-m.dx)+'px,'+(-m.dy)+'px)'},{transform:'none'}],{duration:520,easing:'cubic-bezier(.3,.7,.3,1)'}));
      r.link.forEach(x=>x.el.animate([{outline:'3px solid #168365',outlineOffset:'6px'},{outline:'3px solid #16836500',outlineOffset:'6px'}],{duration:1600,easing:'ease-out'}));}
    // they come into view above the tools and the hint if they landed below them, as far as keeps the first in view too
    if(!vs.length)return;const bar=shell.querySelector('.clay-bottom').getBoundingClientRect(),floor=bar.height?bar.top-16:innerHeight-150;
    const by=Math.min(vs[vs.length-1].bottom-floor,vs[0].top-110);if(by>0)scrollBy({top:by,behavior:still_?'auto':'smooth'});}
  function go(found,h,at,from){const p=prepare(found,h);p.at=at;
    if(!p.link.length&&!p.add.length){say(words({...p,made:[],moved:[]},from));return;}
    B.stopMotion();const before=B.begin(),n=p.add.length,label=n?'You brought in '+(n===1?p.add[0].app.name:n+' apps')+' from '+from+'.':'You linked '+(p.link.length===1?'a card':p.link.length+' cards')+' to their apps.';
    let r;try{r=apply(p,label);}catch(e){B.restore(before);S.refresh();say('That couldn’t be brought in: '+e.message);return;}
    B.commit(before,label);S.select(null);S.refresh();say(words(r,from));burst(r,at);
    if(h&&needs(found)){mem=h;try{localStorage.setItem('clay-server',h);}catch(e){}}}
  function start(found,from,at,shift){
    if(!found.apps.length){say(found.problems[0]||(found.helpers.length?'Only helpers in '+from+' ('+list(found.helpers.map(x=>x.service))+'), and no apps with a page of their own.':'There are no apps in '+from+' to bring in.'));return;}
    const h=pageServer();if(needs(found)&&(shift||!h)){open({found,from,at,typed:false});return;}
    go(found,h,at,from);}
  // a compose file, its .env, docker ps saved to a file: anything that isn't a picture
  const text=f=>!/^image\//.test(f.type)&&!/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|heic)$/i.test(f.name)&&f.size<=2*1024*1024;
  async function drop(files,s,at,shift){const fs=files.filter(text).slice(0,20);let got;
    try{got=await Promise.all(fs.map(async f=>({name:f.name,text:await f.text()})));}catch(e){say('That file couldn’t be read.');return;}
    if(s&&s.trim())got.push({name:'',text:s});const found=C.read(got);if(!fs.length&&!found.apps.length)return;
    const names=got.filter(f=>f.name&&!/(^|[\\/])\.env(\.[\w-]+)?$/i.test(f.name)).map(f=>f.name);
    start(found,names.length>1?names[0]+' and '+(names.length-1)+' more':names[0]||'what you dropped',at,shift);}
  function middle(){const r=field.getBoundingClientRect(),top=Math.max(r.top,0),bottom=Math.min(r.bottom,innerHeight);return {x:r.width/2,y:(top+bottom)/2-r.top};}

  // ---- the dialog: where the server is, the first time; or paste and type apps, from Add + ----
  const box=document.createElement('dialog');box.className='clay-dialog clay-bring';box.setAttribute('aria-labelledby','clay-bring-title');
  box.innerHTML='<form method="dialog"><h2 id="clay-bring-title">Bring in your server</h2>'+
    '<p class="clay-bring-how">Drop your <code>compose.yaml</code> here or paste it, or the output of <code>docker ps</code>, or type one app a line, like <code>Jellyfin 192.168.1.20:8096</code>. Each app arrives as a card that opens it.</p>'+
    '<textarea aria-label="Your server’s apps" spellcheck="false" autocomplete="off"></textarea><p class="clay-bring-found" role="status" aria-live="polite"></p>'+
    '<label class="clay-bring-where">Your server’s address, the one your family’s phones and computers use<input type="text" placeholder="192.168.1.20 or myserver.lan" autocomplete="off" spellcheck="false"></label>'+
    '<p class="clay-bring-later">Next time, its apps go to the same server. To choose another, hold Shift as you drop the file.</p><p class="clay-bring-error" role="alert"></p>'+
    '<div class="actions"><button class="primary" value="ok">Bring them in</button><button value="cancel" formnovalidate>Cancel</button></div>'+
    '<p class="clay-bring-note">Clay reads only names, images, ports and a few labels. Passwords and other settings in the file are never read or saved.</p></form>';
  shell.appendChild(box);
  const $=s=>box.querySelector(s),area=$('textarea'),where=$('.clay-bring-where input'),ok=$('[value=ok]'),err=t=>{$('.clay-bring-error').textContent=t;};
  let job=null,typing=0;
  function show(){const f=job.found||{apps:[],helpers:[],problems:[]},n=f.apps.length;
    $('.clay-bring-found').textContent=n?n+(n===1?' app: ':' apps: ')+list(f.apps.map(a=>a.name),6)+'.'+(f.helpers.length?' Leaving out '+(f.helpers.length===1?'a helper':f.helpers.length+' helpers')+'.':''):job.typed&&area.value.trim()?f.problems[0]||'No apps in that yet.':'';
    $('.clay-bring-where').hidden=!needs(f);$('.clay-bring-later').hidden=job.typed||!needs(f);ok.textContent=n?'Bring in '+(n===1?'1 app':n+' apps'):'Bring them in';}
  function open(o){job=o;$('.clay-bring-how').hidden=area.hidden=!o.typed;area.value='';err('');where.value=pageServer()||here()||mem;show();box.returnValue='';box.showModal();
    if(o.typed)area.focus();else{where.focus();where.select();}}
  area.addEventListener('input',()=>{clearTimeout(typing);typing=setTimeout(()=>{if(!job)return;job.found=C.read([{name:'',text:area.value}]);err('');show();},150);});
  // a file dropped on the dialog is brought in the same way as one dropped on the page
  box.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
  box.addEventListener('drop',e=>{const fs=[...e.dataTransfer.files];if(!fs.length)return;e.preventDefault();const at=job&&job.at;box.close();drop(fs,'',at||middle(),e.shiftKey);});
  $('form').addEventListener('submit',e=>{if(!e.submitter||e.submitter.value!=='ok'||!job)return;
    if(job.typed){clearTimeout(typing);job.found=C.read([{name:'',text:area.value}]);show();}
    const f=job.found;if(!f||!f.apps.length){e.preventDefault();err(job.typed?f&&f.problems[0]||'Paste your compose file, or type your apps, first.':'There are no apps in that to bring in.');return;}
    let h=pageServer();if(needs(f)){h=host(where.value);if(!h){e.preventDefault();err('Type your server’s address, like 192.168.1.20 or myserver.lan.');where.focus();return;}}
    job.host=h;job.go=true;});
  box.addEventListener('close',()=>{const j=job;job=null;if(box.returnValue==='ok'&&j&&j.go)go(j.found,j.host,j.at,j.from);});
  window.addEventListener('keydown',e=>{if(box.open)e.stopImmediatePropagation();},true);
  // Pasting a compose file, docker ps or a list of apps onto the page brings them in too.
  addEventListener('paste',e=>{if(box.open||!S.active())return;const t=e.target;if(t&&(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||t.isContentEditable))return;
    const d=e.clipboardData;if(!d)return;const fs=[...d.files].filter(text),at=S.at()||middle();
    if(fs.length){e.preventDefault();drop(fs,'',at,false);return;}
    const s=d.getData('text/plain');if(!s.trim())return;const found=C.read([{name:'',text:s}]);if(!found.apps.length)return;e.preventDefault();start(found,'what you pasted',at,false);});

  // An agent's "apps" action: the same, from text, inside the step it is already taking. What it sent is read before the
  // step; it is matched to the cards when its turn comes, so it sees the page as the request's earlier actions left it.
  function agentRead(a){if(typeof a.from!=='string'||!a.from.trim())throw new Error('from is the text of a compose file, docker ps output, or one app a line (“Jellyfin 192.168.1.20:8096”).');
    if(a.from.length>2000000)throw new Error('from is too long.');let env={};
    if(a.env!=null){if(typeof a.env==='string')env=C.dotenv(a.env);else if(typeof a.env==='object'&&!Array.isArray(a.env))Object.keys(a.env).forEach(k=>{env[k]=String(a.env[k]);});else throw new Error('env is the text of a .env file, or names and their values.');}
    const found=C.read([{name:'',text:a.from}],{env});if(!found.apps.length)throw new Error(found.problems[0]||'There are no apps in from'+(found.helpers.length?', only helpers ('+list(found.helpers.map(x=>x.service))+')':'')+'.');
    let h=pageServer()||here();if(a.server!=null){h=host(a.server);if(!h)throw new Error('server is the address the family’s devices use for it, like 192.168.1.20 or myserver.lan.');}
    if(needs(found)&&!h)throw new Error('Say which address the family’s devices use for the server, as "server": "192.168.1.20".');
    return {found,host:h};}
  // every link an apps action might give an address to, noted before the step so Undo knows what it was
  function markAll(){linked().forEach(el=>{const l=linkOf(el);if(nowhere(l.getAttribute('href')))B.mark(l,'link');});}
  window.ClayBring={drop,open:()=>open({found:null,from:'what you pasted',at:middle(),typed:true}),agentRead,markAll,prepare,apply,words,isOpen:()=>box.open};
})();
