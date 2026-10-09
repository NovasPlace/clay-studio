/* Deterministic geometry for Clay Studio. No network, model, or runtime dependencies. */
(function(scope){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const copy=items=>items.map(i=>({...i}));
  function contain(i,b){i.w=clamp(i.w,32,b.w);i.h=clamp(i.h,24,b.h);i.x=clamp(i.x,0,b.w-i.w);i.y=clamp(i.y,0,b.h-i.h);return i;}
  function influence(i,p,r){const dx=Math.max(i.x-p.x,0,p.x-i.x-i.w),dy=Math.max(i.y-p.y,0,p.y-i.y-i.h);const t=clamp(1-Math.hypot(dx,dy)/r,0,1);return t*t*(3-2*t);}
  function snap(item,others,bounds,threshold=7){const i={...item},guides=[];
    for(const axis of ['x','y']){const size=axis==='x'?'w':'h',limit=bounds[size];const targets=[0,limit/2,limit];
      others.forEach(o=>targets.push(o[axis],o[axis]+o[size]/2,o[axis]+o[size]));let best=threshold+1,delta=0,target=0;
      for(const offset of [0,i[size]/2,i[size]])for(const t of targets){const d=t-(i[axis]+offset);if(Math.abs(d)<best){best=Math.abs(d);delta=d;target=t;}}
      if(best<=threshold){i[axis]+=delta;guides.push({axis,at:target});}}
    return {item:contain(i,bounds),guides};}
  // Pairs already crowded before a gesture (closer than the 10px Make room keeps), so the gesture can leave them be.
  const pair=(a,b)=>a<b?a+'|'+b:b+'|'+a;
  function crowded(items){const out=new Set();for(let j=0;j<items.length;j++)for(let k=j+1;k<items.length;k++){const p=items[j],q=items[k];
    if(Math.min(p.x+p.w,q.x+q.w)-Math.max(p.x,q.x)+10>0&&Math.min(p.y+p.h,q.y+q.h)-Math.max(p.y,q.y)+10>0)out.add(pair(p.id,q.id));}return out;}
  function separate(items,bounds,held=null,passes=28,settled=null){const a=copy(items),heldIds=new Set(Array.isArray(held)?held:[held]);let unresolved=0;
    for(let n=0;n<passes;n++){let changed=false;
      for(let j=0;j<a.length;j++)for(let k=j+1;k<a.length;k++){const p=a[j],q=a[k];const ox=Math.min(p.x+p.w,q.x+q.w)-Math.max(p.x,q.x)+10,oy=Math.min(p.y+p.h,q.y+q.h)-Math.max(p.y,q.y)+10;if(ox<=0||oy<=0)continue;
        if(settled&&!heldIds.has(p.id)&&!heldIds.has(q.id)&&settled.has(pair(p.id,q.id)))continue;
        const lp=p.pin||heldIds.has(p.id),lq=q.pin||heldIds.has(q.id);if(lp&&lq)continue;
        const axis=ox<oy?'x':'y',dist=axis==='x'?ox:oy,sz=axis==='x'?'w':'h';const sign=p[axis]+p[sz]/2<=q[axis]+q[sz]/2?-1:1;
        const was=[p.x,p.y,q.x,q.y];if(!lp)p[axis]+=sign*dist*(lq?1:.5);if(!lq)q[axis]-=sign*dist*(lp?1:.5);contain(p,bounds);contain(q,bounds);
        // At an edge, move the pair along the other axis instead of endlessly pressing against the boundary.
        if(was.every((v,z)=>Math.abs(v-[p.x,p.y,q.x,q.y][z])<.01)){const alt=axis==='x'?'y':'x',d=axis==='x'?oy:ox,ss=alt==='x'?'w':'h',sg=p[alt]+p[ss]/2<=q[alt]+q[ss]/2?-1:1;if(!lp)p[alt]+=sg*d*(lq?1:.5);if(!lq)q[alt]-=sg*d*(lp?1:.5);contain(p,bounds);contain(q,bounds);}
        changed=true;}
      if(!changed)break;}
    // Resolve edge traps using the nearest free rectangle, only when relaxation stalls.
    const left=(p,q)=>settled&&!heldIds.has(p.id)&&!heldIds.has(q.id)&&settled.has(pair(p.id,q.id));
    for(const i of a){if(i.pin||heldIds.has(i.id))continue;const rest=a.filter(o=>o!==i);if(rest.some(o=>overlaps(i,o,2)&&!left(i,o))){const free=nearestFree(i,rest,bounds);if(free){i.x=free.x;i.y=free.y;}}}
    for(let j=0;j<a.length;j++)for(let k=j+1;k<a.length;k++){if(overlaps(a[j],a[k],-2)&&!left(a[j],a[k]))unresolved++;}
    return {items:a,unresolved};}
  function push(items,p,delta,r,bounds){return items.map(i=>{if(i.pin)return {...i};const f=influence(i,p,r);return contain({...i,x:i.x+delta.x*f,y:i.y+delta.y*f},bounds);});}
  function grow(items,p,amount,r,bounds){return items.map(i=>{if(i.pin)return {...i};const f=influence(i,p,r),k=Math.exp(amount*f),w=clamp(i.w*k,i.minW||64,i.maxW||bounds.w),h=clamp(i.h*k,i.minH||30,bounds.h);return contain({...i,x:i.x+(i.w-w)/2,y:i.y+(i.h-h)/2,w,h,font:clamp((i.font||18)*k,i.minFont||14,120)},bounds);});}
  function smooth(items,p,r,bounds){const a=copy(items),affected=a.filter(i=>!i.pin&&influence(i,p,r)>.1);if(!affected.length)return a;
    // Cluster by vertical center, then ease a cluster toward an even, level row.
    const rows=[];affected.sort((a,b)=>a.y+a.h/2-b.y-b.h/2).forEach(i=>{let row=rows.find(row=>Math.abs(row[0].y+row[0].h/2-i.y-i.h/2)<Math.max(70,i.h*.6));if(!row)rows.push(row=[]);row.push(i);});
    rows.forEach(row=>{row.sort((a,b)=>a.x-b.x);const top=row.reduce((s,i)=>s+i.y,0)/row.length;const left=row[0].x,right=Math.max(...row.map(i=>i.x+i.w));const total=row.reduce((s,i)=>s+i.w,0),gap=row.length>1?clamp((right-left-total)/(row.length-1),16,48):0;let x=(left+right-total-gap*(row.length-1))/2;
      row.forEach(i=>{const f=.2*influence(i,p,r);i.x+=(x-i.x)*f;i.y+=(top-i.y)*f;contain(i,bounds);x+=i.w+gap;});});return a;}
  function pathLength(path){let n=0;for(let i=1;i<path.length;i++)n+=Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y);return n;}
  function sample(path,t){const length=pathLength(path);if(!length)return {...path[0]};let need=clamp(t,0,1)*length;
    for(let j=1;j<path.length;j++){const a=path[j-1],b=path[j],d=Math.hypot(b.x-a.x,b.y-a.y);if(d&&need<=d)return {x:a.x+(b.x-a.x)*need/d,y:a.y+(b.y-a.y)*need/d};need-=d;}return {...path[path.length-1]};}
  function flow(items,path,bounds){if(path.length<2)return null;const free=items.filter(i=>!i.pin),length=pathLength(path);if(!free.length||length<Math.max(60,free.reduce((s,i)=>s+i.w,0)*.65))return null;
    const placed=new Map();free.forEach((i,j)=>{const p=sample(path,free.length===1?.5:j/(free.length-1));placed.set(i.id,contain({...i,x:p.x-i.w/2,y:p.y-i.h/2},bounds));});return items.map(i=>placed.get(i.id)||{...i});}
  function envelope(items){const x=Math.min(...items.map(i=>i.x)),y=Math.min(...items.map(i=>i.y));return {x,y,w:Math.max(...items.map(i=>i.x+i.w))-x,h:Math.max(...items.map(i=>i.y+i.h))-y};}
  function overlaps(a,b,gap=0){return Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>-gap&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>-gap;}
  function nearestFree(i,others,bounds){const xs=[clamp(i.x,0,bounds.w-i.w),0,bounds.w-i.w],ys=[clamp(i.y,0,bounds.h-i.h),0,bounds.h-i.h];
    others.forEach(o=>{xs.push(o.x-i.w-10,o.x+o.w+10);ys.push(o.y-i.h-10,o.y+o.h+10);});let best=null,cost=Infinity;
    for(const x of new Set(xs))for(const y of new Set(ys)){if(x<0||y<0||x+i.w>bounds.w+.01||y+i.h>bounds.h+.01)continue;const c={...i,x,y};if(others.some(o=>overlaps(c,o,9.9)))continue;const d=(x-i.x)**2+(y-i.y)**2;if(d<cost){cost=d;best=c;}}return best;}
  function magnet(i,others,bounds,distance=28){if(!['text','button'].includes(i.kind)||i.font>34)return null;let best=null;
    for(const o of others){if(o.pin||!['card','image','group'].includes(o.kind)||i.w>o.w*1.7)continue;
      const ox=Math.min(i.x+i.w,o.x+o.w)-Math.max(i.x,o.x),oy=Math.min(i.y+i.h,o.y+o.h)-Math.max(i.y,o.y);
      const choices=[];if(ox>Math.min(i.w,o.w)*.4){choices.push({side:'below',x:o.x+(o.w-i.w)/2,y:o.y+o.h+14,d:Math.abs(i.y-o.y-o.h-14)});choices.push({side:'above',x:o.x+(o.w-i.w)/2,y:o.y-i.h-14,d:Math.abs(i.y+i.h+14-o.y)});}
      if(oy>Math.min(i.h,o.h)*.4){choices.push({side:'right',x:o.x+o.w+14,y:o.y+(o.h-i.h)/2,d:Math.abs(i.x-o.x-o.w-14)});choices.push({side:'left',x:o.x-i.w-14,y:o.y+(o.h-i.h)/2,d:Math.abs(i.x+i.w+14-o.x)});}
      for(const c of choices){if(c.d>distance||c.x<0||c.y<0||c.x+i.w>bounds.w||c.y+i.h>bounds.h)continue;if(!best||c.d<best.distance)best={target:o.id,side:c.side,distance:c.d,item:{...i,x:c.x,y:c.y}};}}
    return best;}
  function inPolygon(p,path){let inside=false;for(let i=0,j=path.length-1;i<path.length;j=i++){const a=path[i],b=path[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
  function lasso(items,path){if(path.length<2)return [];let area=0;for(let i=0;i<path.length;i++){const a=path[i],b=path[(i+1)%path.length];area+=a.x*b.y-b.x*a.y;}
    const rectangle=Math.abs(area)<1200,box=envelope(path.map(p=>({...p,w:0,h:0})));
    if(rectangle&&(box.w<20||box.h<20))return [];
    return items.filter(i=>!i.pin&&(rectangle?i.x+i.w/2>=box.x&&i.x+i.w/2<=box.x+box.w&&i.y+i.h/2>=box.y&&i.y+i.h/2<=box.y+box.h:inPolygon({x:i.x+i.w/2,y:i.y+i.h/2},path))).map(i=>i.id);}
  // Act: a piece follows the pointer on a leash, and the performance becomes a loop. Samples are offsets from home with
  // times in milliseconds. Between two events far apart in time the piece was held still, so it stays put until just
  // before the next one. The take is read every 20ms, then thinned to the stops that keep it within a pixel of what was
  // played, as far as 16 stops a second allow (at least 40, at most 160). Ending near the start closes the loop, with a
  // short way back and a start where it was let go; ending anywhere else, it swings back the way it came.
  const ACT={reach:140,close:24,stops:40,rate:16,most:160,every:20,shortest:300};
  function leash(p,reach=ACT.reach){const d=Math.hypot(p.x,p.y);return d>reach?{...p,x:p.x*reach/d,y:p.y*reach/d}:{...p};}
  function take(samples,o={}){const {reach,close,stops,rate,most,every,shortest}={...ACT,...o},s=[];
    samples.forEach(p=>{const q=leash(p,reach);if(s.length&&q.t<=s[s.length-1].t)s[s.length-1]={...q,t:s[s.length-1].t};else s.push(q);});
    if(s.length<2||s[s.length-1].t-s[0].t<shortest)return null;const t0=s[0].t,end=s[s.length-1].t-t0;
    let j=0;const at=t=>{while(j<s.length-2&&s[j+1].t-t0<=t)j++;const a=s[j],b=s[j+1],from=b.t-a.t>50?b.t-16-t0:a.t-t0,u=clamp((t-from)/Math.max(1,b.t-t0-from),0,1);
      return {t,x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};};
    const pts=[];for(let t=0;t<end;t+=every)pts.push(at(t));pts.push({t:end,x:s[s.length-1].x,y:s[s.length-1].y});
    const first=pts[0],last=pts[pts.length-1],away=Math.hypot(last.x-first.x,last.y-first.y),loop=away<=close;let duration=end,delay=0;
    if(loop&&away>.5){delay=end;duration=end+clamp(away*8,40,300);pts.push({t:duration,x:first.x,y:first.y});}else if(loop){last.x=first.x;last.y=first.y;}else delay=end;
    // Best first: the stretch that strays furthest from a straight line gets a stop where it strays most, until every
    // stretch is within a pixel or the stops run out, so a busy take keeps as much of its shape as it can.
    const stray=(a,b)=>{const p=pts[a],q=pts[b];let w=0,at=-1;for(let k=a+1;k<b;k++){const u=(pts[k].t-p.t)/(q.t-p.t),e=Math.hypot(pts[k].x-p.x-(q.x-p.x)*u,pts[k].y-p.y-(q.y-p.y)*u);if(e>w){w=e;at=k;}}return {a,b,w,at};};
    const runs=[stray(0,pts.length-1)],budget=clamp(Math.round(duration/1000*rate),stops,most);
    while(runs.length<budget-1){let i=0;runs.forEach((r,k)=>{if(r.w>runs[i].w)i=k;});const r=runs[i];if(r.w<=1)break;runs.splice(i,1,stray(r.a,r.at),stray(r.at,r.b));}
    const out=[];[0,...runs.map(r=>r.b)].forEach(k=>{const p=pts[k],t=Math.round(p.t/duration*10000)/100;if(out.length&&out[out.length-1].t>=t)out.pop();out.push({t,x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10});});
    out[0].t=0;out[out.length-1].t=100;
    return {stops:out,duration:Math.round(duration)/1000,delay:Math.round(delay)/1000,loop};}
  const api={clamp,copy,contain,influence,snap,crowded,separate,push,grow,smooth,pathLength,sample,flow,envelope,overlaps,nearestFree,magnet,lasso,inPolygon,ACT,leash,take};
  if(typeof module==='object'&&module.exports)module.exports=api;else scope.ClayGeometry=api;
})(typeof globalThis!=='undefined'?globalThis:this);
