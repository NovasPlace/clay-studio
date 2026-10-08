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
console.log(passed+' geometry checks passed');
