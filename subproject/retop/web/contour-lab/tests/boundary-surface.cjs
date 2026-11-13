const assert=require('node:assert/strict'),fs=require('node:fs');
const E=require('../engine.js'),F=require('../flow.js')(E),B=require('../boundary-surface.js')(E,F),U=require('../flow-uv.js')(E),report=[];
const line=(p0,p3,id)=>({p0,p3,p1:p0.map((v,k)=>v+(p3[k]-v)/3),p2:p0.map((v,k)=>v+2*(p3[k]-v)/3),kind:'I',id,faces:[0],role:'outer'});
function check(name,level,width,components=1){
  const saved=JSON.stringify(level),m=B.build(level,width,{continuousUV:false,includeInternal:true});assert.equal(JSON.stringify(level),saved);assert(m.audit.valid);assert.equal(m.audit.components,components);assert.equal(m.edges.length,F.edges(level).length);
  const independent=U.auditTriangles(m.triangles.map(t=>t.v.map(i=>m.vertices[i])),m.diagonal**2*1e-12);assert.equal(independent.overlaps,0);assert.equal(independent.collapsed,0);
  for(const e of m.audit.edgeUVRanges){assert.equal(e.minU,0);assert.equal(e.maxU,1);assert.equal(e.minV,0);assert.equal(e.maxV,1);}
  assert(m.triangles.every(t=>E.area(t.uv.map(i=>m.uv[i]))>0));
  const boundary=new Map(),owners=new Map();for(const t of m.triangles)for(let i=0;i<3;i++){const a=t.v[i],b=t.v[(i+1)%3],k=[a,b].sort((x,y)=>x-y).join(':');owners.set(k,(owners.get(k)||0)+1);}
  for(const [k,n]of owners)if(n===1)for(const v of k.split(':'))boundary.set(v,(boundary.get(v)||0)+1);assert([...boundary.values()].every(n=>n===2),'ribbon boundaries must be closed without T junctions');
  const obj=B.obj(m);assert.equal((obj.match(/^v /gm)||[]).length,m.vertices.length);assert.equal((obj.match(/^vt /gm)||[]).length,m.uv.length);assert.equal((obj.match(/^f /gm)||[]).length,m.triangles.length);assert(obj.includes('g edge_'));assert(B.svg(m).includes('patternTransform="matrix('));assert(B.svg(m,{uv:true}).includes('data-boundary-surface="uv"'));
  const entries=obj.trim().split('\n'),positions=entries.filter(s=>s.startsWith('v ')).map(s=>s.split(' ').slice(1).map(Number)),uvs=entries.filter(s=>s.startsWith('vt ')).map(s=>s.split(' ').slice(1).map(Number)),faces=entries.filter(s=>s.startsWith('f ')).map(s=>s.split(' ').slice(1).map(s=>s.split('/').map(Number)));
  assert.equal(entries.filter(s=>s.startsWith('o ')).length,1);for(let i=0;i<faces.length;i++)for(let j=0;j<3;j++){const t=m.triangles[i],corner=2-j,[v,u]=faces[i][j];assert.deepEqual(positions[v-1],[m.vertices[t.v[corner]][0],(-m.vertices[t.v[corner]][1])||0,0]);assert.deepEqual(uvs[u-1],m.uv[t.uv[corner]]);}
  report.push({name,edges:m.edges.length,components,triangles:m.triangles.length,requestedWidth:width,effectiveWidth:m.effectiveWidth,locallyNarrowed:m.audit.widthReduced,overlaps:0,sourceUnchanged:true,perEdgeUV01:true,closedBoundaries:true});console.log('PASS boundary surface',name);return m;
}
const square={id:'square',partitionEdges:[[0,0],[100,0],[100,80],[0,80]].map((p,i,a)=>line(p,a[(i+1)%a.length],i))};
const thin=check('square narrow',square,2),wide=check('square wide',square,8);assert(wide.audit.area>thin.audit.area*3);
check('T junction with open ends',{id:'T',partitionEdges:[line([0,0],[60,0],0),line([60,0],[120,0],1),line([60,0],[60,65],2)]},6);
check('four-way junction',{id:'cross',partitionEdges:[[0,50],[100,50],[50,0],[50,100]].map((p,i)=>line([50,50],p,i))},5);
check('acute branch',{id:'acute',partitionEdges:[line([0,0],[100,0],0),line([0,0],[100,12],1),line([0,0],[-80,60],2)]},12);
check('one curved C and one S',{id:'curves',partitionEdges:[{p0:[0,0],p1:[25,-35],p2:[75,-35],p3:[100,0],kind:'C',id:0},{p0:[100,0],p1:[120,45],p2:[180,-45],p3:[200,0],kind:'S',id:1}]},4);
check('disconnected inputs remain separate',{id:'disjoint',partitionEdges:[line([0,0],[100,0],0),line([0,50],[100,50],1)]},4,2);
const ref=JSON.parse(fs.readFileSync('artifacts/contour-lab/current-reference8-vectors.json'));for(const level of ref.levels)check('reference8 '+level.id,level,4);
const transform=p=>[50+.8*(p[0]*Math.cos(.7)-p[1]*Math.sin(.7)),90+.8*(p[0]*Math.sin(.7)+p[1]*Math.cos(.7))],original=ref.levels[4];check('rotated translated scaled reference8',{...original,partitionEdges:original.partitionEdges.map(e=>({...e,...Object.fromEntries(['p0','p1','p2','p3'].map(k=>[k,transform(e[k])]))}))},3.2);
const dense=JSON.parse(fs.readFileSync('artifacts/contour-lab/square-middle300.json')).levels[4];check('300-part boundary network',dense,4);
for(const value of [0,-1,Infinity,NaN,65])assert.throws(()=>B.build(square,value),/宽度/);
fs.writeFileSync('artifacts/contour-lab/boundary-surface-report.json',JSON.stringify({report,uvOverlapIntentional:true,geometrySource:'analytic graphs and archived current reference8 vectors; no contour-engine recomputation claim'},null,2)+'\n');
