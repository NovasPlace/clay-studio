/* An agent can work on pages nobody has open: any Clay tab that is showing (the page list, or another page) opens them
   here, out of sight, in the editor itself, so the changes go through the same pieces, rules, undo and saving as yours.
   A page opened this way closes after two minutes without requests, or as soon as you open it yourself. */
(function(){
  'use strict';
  if(window!==window.top||window.ClayHost)return;
  const me=[...crypto.getRandomValues(new Uint8Array(8))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const IDLE=120000,open=new Map(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let ctl=null;
  const tell=(text,page)=>window.dispatchEvent(new CustomEvent('clay-host',{detail:{text,page}}));
  function idle(name){const h=open.get(name);if(!h)return;clearTimeout(h.timer);h.timer=setTimeout(()=>close(name),IDLE);}
  function close(name){const h=open.get(name);if(!h)return;open.delete(name);clearTimeout(h.timer);let done=false;
    const end=()=>{if(!done){done=true;h.frame.remove();tell('',name);}};
    try{h.frame.contentWindow.ClayBridge.flush(end);}catch(e){end();}setTimeout(end,3000);}
  function host(name,who){if(open.has(name)){idle(name);return;}
    const f=document.createElement('iframe');f.setAttribute('aria-hidden','true');f.tabIndex=-1;
    f.style.cssText='position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;visibility:hidden';
    f.src='/p/'+encodeURIComponent(name)+'/?agent';document.body.appendChild(f);open.set(name,{frame:f,timer:0});idle(name);
    tell((who||'An agent')+' is working on “'+name+'” out of sight.',name);}
  // the editors opened here say what they did, and when the person has opened the page themselves
  addEventListener('message',e=>{const d=e.data;if(e.origin!==location.origin||!d||!d.clayAgent||!open.has(d.page))return;
    if(d.clayAgent==='step'){idle(d.page);if(d.step)tell(d.step+' (on “'+d.title+'”)',d.page);}
    if(d.clayAgent==='close')close(d.page);});
  async function listen(){
    for(let wait=1000;;){
      if(document.visibilityState!=='visible'){await new Promise(r=>document.addEventListener('visibilitychange',r,{once:true}));continue;}
      let r;ctl=new AbortController();
      try{r=await fetch('/api/host?wait=25&host='+me,{signal:ctl.signal,cache:'no-store'});}catch(e){if(document.visibilityState==='visible'){await sleep(wait);wait=Math.min(wait*2,15000);}continue;}
      wait=1000;if(r.status===204)continue;if(r.status!==200){await sleep(5000);continue;}
      try{const s=await r.json();if(typeof s.open==='string')host(s.open,s.as);}catch(e){}}}
  const bye=()=>{if(ctl)ctl.abort();try{navigator.sendBeacon('/api/host/bye?host='+me);}catch(e){}};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')bye();});
  addEventListener('pagehide',bye);
  window.ClayHost={pages:()=>[...open.keys()],close};
  listen();
})();
