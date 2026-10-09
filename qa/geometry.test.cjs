const assert = require('node:assert/strict');
const G = require('../sculpt-core.js');
const bounds = {w:1000,h:800};
const box = (id,x,y,pin=false)=>({id,x,y,w:150,h:100,font:18,pin});
let passed=0;
function test(name,fn){fn();console.log('PASS '+name);passed++;}
test('push affects nearby pieces, preserves pins and distant pieces',()=>{
  const input=[box('a',100,100),box('b',300,100,true),box('c',800,600)];
  const out=G.push(input,{x:150,y:150},{x:50,y:20},120,bounds);
  assert.equal(out[0].x,150);assert.equal(out[0].y,120);
  assert.deepEqual(out[1],input[1]);assert.deepEqual(out[2],input[2]);assert.equal(input[0].x,100);
});
test('neighbor makes room while held and pinned pieces remain fixed',()=>{
  const input=[box('held',100,100),box('free',210,100),box('pin',600,400,true)];
  const out=G.separate(input,bounds,'held');
  assert.deepEqual(out.items[0],input[0]);assert.deepEqual(out.items[2],input[2]);
  assert.equal(out.unresolved,0);assert.ok(out.items[1].x>=260);
});
test('pieces crowded before a move stay put while the moved piece makes room',()=>{
  const input=[box('a',0,0),box('b',100,0),box('held',600,600)];const crowded=G.crowded(input);
  assert.ok(crowded.has('a|b'));assert.equal(crowded.size,1);
  const out=G.separate(input,bounds,'held',undefined,crowded);
  assert.deepEqual(out.items,input);assert.equal(out.unresolved,0);
  const onto=[box('a',0,0),box('b',100,0),box('held',120,40)];const moved=G.separate(onto,bounds,'held',undefined,crowded);
  assert.deepEqual(moved.items[2],onto[2]);assert.ok(!G.overlaps(moved.items[2],moved.items[1],9.9));
  assert.ok(G.separate(input,bounds).items[1].x>159);
});
test('impossible pinned collisions are reported without shifting pins',()=>{
  const input=[box('a',0,0,true),box('b',50,0,true)];const out=G.separate(input,bounds);
  assert.equal(out.unresolved,1);assert.deepEqual(out.items,input);
});
test('edge blocked pair resolves on the other axis',()=>{
  const a=box('a',0,0,true),b=box('b',20,0);b.w=150;
  const out=G.separate([a,b],{w:170,h:800});assert.equal(out.unresolved,0);assert.deepEqual(out.items[0],a);
});
test('short flow is a no-op, long flow uses arc length and preserves pins',()=>{
  const input=[box('a',0,0),box('b',0,0),box('p',400,400,true)];
  assert.equal(G.flow(input,[{x:0,y:0},{x:30,y:30}],bounds),null);
  assert.deepEqual(G.sample([{x:0,y:0},{x:300,y:0},{x:300,y:100}],.5),{x:200,y:0});
  const out=G.flow(input,[{x:100,y:100},{x:800,y:400}],bounds);
  assert.equal(out[0].x,25);assert.equal(out[1].x,725);assert.deepEqual(out[2],input[2]);
});
test('snapping finds a nearby edge, distant movement stays free',()=>{
  const out=G.snap(box('a',104,200),[box('b',100,400)],bounds);
  assert.equal(out.item.x,100);assert.ok(out.guides.some(g=>g.axis==='x'));
  assert.equal(G.snap(box('a',333,222),[],bounds).item.x,333);
});
test('smooth reduces vertical variance within a row without moving pins',()=>{
  const input=[box('a',0,100),box('b',230,130),box('p',600,600,true)];
  const out=G.smooth(input,{x:180,y:130},300,bounds);
  assert.ok(out[1].y-out[0].y<30);assert.deepEqual(out[2],input[2]);
});
test('repeated growth remains finite, bounded and pin-safe',()=>{
  let out=[box('a',100,100),box('p',500,500,true)];const pin={...out[1]};
  for(let n=0;n<200;n++)out=G.grow(out,{x:250,y:250},n<100?.4:-.4,380,bounds);
  for(const i of out)for(const key of ['x','y','w','h','font'])assert.ok(Number.isFinite(i[key]));
  for(const i of out){assert.ok(i.x>=0&&i.y>=0&&i.x+i.w<=bounds.w&&i.y+i.h<=bounds.h);assert.ok(i.font>=10&&i.font<=120);}
  assert.deepEqual(out[1],pin);
});
// Act: where a take puts the piece at a moment, read back from its stops the way linear keyframes play them.
const play=(t,ms)=>{const pct=ms/(t.duration*1000)*100,s=t.stops;let i=0;while(i<s.length-2&&s[i+1].t<=pct)i++;const a=s[i],b=s[i+1],u=Math.max(0,Math.min(1,(pct-a.t)/(b.t-a.t)));return {x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};};
const perform=(...legs)=>{const out=[{t:0,x:0,y:0}];let t=0,x=0,y=0;legs.forEach(([ms,tx,ty,still])=>{if(still){t+=ms;return;}const n=Math.max(1,Math.round(ms/16));for(let k=1;k<=n;k++)out.push({t:t+ms*k/n,x:x+(tx-x)*k/n,y:y+(ty-y)*k/n});t+=ms;x=tx;y=ty;});out.push({t,x,y});return out;};
test('a take ending where it started loops, keeps its pause and starts where it was let go',()=>{
  const t=G.take(perform([600,-120,0],[500,0,0,true],[100,-80,-30],[600,6,4]));
  assert.equal(t.loop,true);assert.equal(t.delay,1.8);assert.ok(t.duration>1.8&&t.duration<=2.1);
  assert.deepEqual(t.stops[t.stops.length-1],{t:100,x:0,y:0});assert.deepEqual(t.stops[0],{t:0,x:0,y:0});
  for(const ms of [620,800,1000,1080]){const p=play(t,ms);assert.ok(Math.abs(p.x+120)<2&&Math.abs(p.y)<2,'still at '+ms+'ms: '+JSON.stringify(p));}
  const back=play(t,1800);assert.ok(Math.abs(back.x-6)<2&&Math.abs(back.y-4)<2);
});
test('a take ending away from its start swings back from where it was let go',()=>{
  const t=G.take(perform([800,120,-20]));
  assert.equal(t.loop,false);assert.equal(t.delay,t.duration);assert.deepEqual(t.stops[t.stops.length-1],{t:100,x:120,y:-20});
});
test('a take stays on a 140px leash, and too short a take is not kept',()=>{
  const t=G.take(perform([500,300,0],[500,0,-400]));
  for(const s of t.stops)assert.ok(Math.hypot(s.x,s.y)<=140.1,JSON.stringify(s));
  assert.ok(t.stops.some(s=>Math.abs(s.x-140)<.2));assert.equal(G.take(perform([200,80,0])),null);assert.equal(G.take([{t:0,x:0,y:0}]),null);
  assert.deepEqual(G.leash({t:5,x:3,y:4}),{t:5,x:3,y:4});assert.deepEqual(G.leash({x:0,y:-280}),{x:0,y:-140});
});
test('a busy take keeps its shape within its stops: 16 a second, at least 40, at most 160',()=>{
  const off=(t,src)=>{let worst=0,sum=0,n=0;for(let ms=0;ms<=src[src.length-1].t;ms+=25){const want=src.reduce((b,s)=>Math.abs(s.t-ms)<Math.abs(b.t-ms)?s:b),got=play(t,ms),e=Math.hypot(got.x-want.x,got.y-want.y);worst=Math.max(worst,e);sum+=e;n++;}return {worst,mean:sum/n};};
  const wiggle=[{t:0,x:0,y:0}];for(let ms=16;ms<=10000;ms+=16)wiggle.push({t:ms,x:100*Math.sin(ms/400*2*Math.PI),y:30*Math.sin(ms/1300*2*Math.PI)});
  const t=G.take(wiggle);assert.ok(t.stops.length<=160,t.stops.length+' stops');for(let i=1;i<t.stops.length;i++)assert.ok(t.stops[i].t>t.stops[i-1].t);
  const w=off(t,wiggle);assert.ok(w.worst<20&&w.mean<8,'wiggle off by '+JSON.stringify(w));
  const shake=[{t:0,x:0,y:0}];for(let ms=16;ms<=4000;ms+=16)shake.push({t:ms,x:40*Math.sin(ms/200*2*Math.PI),y:0});
  const k=G.take(shake),xs=k.stops.map(s=>s.x);assert.ok(k.stops.length>40&&k.stops.length<=64,k.stops.length+' stops');
  const o=off(k,shake);assert.ok(Math.max(...xs)-Math.min(...xs)>70&&o.worst<25&&o.mean<9,'shake off by '+JSON.stringify(o));
  const glide=perform([400,30,0],[1600,0,0,true]);assert.deepEqual(G.take(glide).stops.map(s=>[s.t,s.x]),[[0,0],[20,30],[100,30]]);
  const circle=[{t:0,x:0,y:0}];for(let ms=16;ms<=2000;ms+=16)circle.push({t:ms,x:60*Math.sin(ms/2000*2*Math.PI),y:60-60*Math.cos(ms/2000*2*Math.PI)});
  const c=G.take(circle);assert.equal(c.loop,true);assert.ok(c.stops.length<=40);
  for(let ms=0;ms<=2000;ms+=50){const want=circle.reduce((b,s)=>Math.abs(s.t-ms)<Math.abs(b.t-ms)?s:b),got=play(c,ms);assert.ok(Math.hypot(got.x-want.x,got.y-want.y)<3,ms+'ms off by '+Math.hypot(got.x-want.x,got.y-want.y).toFixed(2));}
});
console.log(passed+' geometry checks passed');
