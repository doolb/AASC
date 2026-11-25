// 一次性样本试验：所有样本编号来自独立配方，不写入通用网页算法。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const E=require('../../web/contour-lab-3d/engine.js')(),G=require('../../web/contour-lab-3d/boundary-guides.js')(E),P=require('../../web/csi-boundary/partition.js')(E);
const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,name),'utf8'));
const d=read('csi-partition.json'),low=read('artist-low.json'),recipe=read('refine-recipe.json');
assert.equal(d.sourceFingerprint,recipe.sourceFingerprint);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync('D:/down/小闪/moxing/LOW.obj')).digest('hex'),recipe.lowSHA256);
const mesh=d.analysisSource,t=E.topology(mesh),base=d.guides.scales[2].proposal,groups=base.patchGroups.slice(),merged=[];
for(const id of recipe.mergeRegions){
  const count=groups.filter(g=>g===id).length;assert(count>0&&count<=5);
  const links=new Map();
  for(const e of t.edges.values())if(e.faces.length===2){const [a,b]=e.faces.map(f=>groups[f]);if(a===b||a!==id&&b!==id)continue;const next=a===id?b:a;links.set(next,(links.get(next)||0)+E.dist(mesh.vertices[e.a],mesh.vertices[e.b]));}
  const target=[...links].filter(([g])=>!recipe.mergeRegions.includes(g)).sort((a,b)=>b[1]-a[1])[0]?.[0];
  assert.notEqual(target,undefined);groups.forEach((g,i)=>{if(g===id)groups[i]=target;});merged.push({id,target,faces:count});
}
// 合并只允许实际相邻区；逐区连通性和覆盖数量在重拟合前验证。
for(const g of new Set(groups)){const start=groups.indexOf(g),seen=new Set([start]),queue=[start];for(let k=0;k<queue.length;k++)for(const j of t.adj[queue[k]])if(groups[j]===g&&!seen.has(j)){seen.add(j);queue.push(j);}assert.equal(seen.size,groups.filter(v=>v===g).length);}
const keys=[...t.edges].filter(([,e])=>e.faces.length===1||e.faces.length===2&&groups[e.faces[0]]!==groups[e.faces[1]]).map(([k])=>k),graph=G.chains(mesh,keys,t),chains=G.interfaceChains(mesh,keys,t,groups);
for(const c of chains){c.role='major';c.supportedEdges=c.edges.length;}
const area=new Map();groups.forEach((g,i)=>area.set(g,(area.get(g)||0)+t.data[i].area));const scale=d.guides.scale;
const proposal=G.fitNetwork(mesh,t,{keys,groups,chains,nodes:graph.nodes,patches:[...area].map(([id,area])=>({id,area,relativeArea:area/(scale*scale)})),report:{seedEdges:keys.length,edges:keys.length,endpoints:graph.nodes.filter(n=>n.kind==='endpoint').length,junctions:graph.nodes.filter(n=>n.kind==='junction').length,surfaceContrastSplits:[]}},
  {scale,tolerance:scale*.006,regularization:.01,cornerAngle:55,localScaleFitting:true,curveFairing:true});
d.guides.scales[2].proposal=proposal;
delete d.granularityBase;
let result=P.applySmoothing(d,.5);
// 统一缩放及居中只用于参考选点；不会修改输入高低模。
const hb=E.bounds(mesh),lb=E.bounds(low),ratio=(hb.hi[1]-hb.lo[1])/(lb.hi[1]-lb.lo[1]);
const map=p=>E.add(hb.center,E.mul(E.sub(p,lb.center),ratio));
const lt=E.topology(low),adj=low.vertices.map(()=>[]);for(const e of lt.edges.values()){adj[e.a].push(e.b);adj[e.b].push(e.a);}
function route(start,end){const ds=low.vertices.map(()=>Infinity),prev=[],visited=new Set();ds[start]=0;while(!visited.has(end)){let u=-1;for(let i=0;i<ds.length;i++)if(!visited.has(i)&&(u<0||ds[i]<ds[u]))u=i;assert(u>=0&&Number.isFinite(ds[u]),'低模选点之间没有连通路径');visited.add(u);for(const v of adj[u]){const cost=ds[u]+E.dist(low.vertices[u],low.vertices[v]);if(cost<ds[v]){ds[v]=cost;prev[v]=u;}}}const out=[end];while(out[0]!==start)out.unshift(prev[out[0]]);return out;}
const paths=[];
for(const p of recipe.paths){for(const mirror of p.mirror?[false,true]:[false]){
 const ids=p.nodes.map(id=>{if(!mirror)return id;const target=[-low.vertices[id][0],...low.vertices[id].slice(1)];let best=0;low.vertices.forEach((q,i)=>{if(E.dist(q,target)<E.dist(low.vertices[best],target))best=i;});assert(E.dist(low.vertices[best],target)<.01);return best;});
 const nodes=ids.slice(1).reduce((a,id,i)=>a.concat(route(ids[i],id).slice(1)),[ids[0]]);
 paths.push({name:p.name+(p.mirror?(mirror?'·镜像侧':'·参考侧'):''),lowNodes:nodes,points:nodes.map(id=>map(low.vertices[id]))});
}}
// 将参考路径输出给 Blender BVH 做局部表面投射，后续步骤生成独立审查曲线。
fs.writeFileSync(path.join(__dirname,'review-v2-base.json'),JSON.stringify(result));
fs.writeFileSync(path.join(__dirname,'review-paths.json'),JSON.stringify({paths,merged,alignment:{ratio,lowCenter:lb.center,highCenter:hb.center}},null,2));
console.log({groups:new Set(groups).size,merged,paths:paths.length});
