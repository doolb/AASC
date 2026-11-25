// 一次性样本试验：所有样本编号来自独立配方，不写入通用网页算法。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const E=require('../../web/contour-lab-3d/engine.js')(),G=require('../../web/contour-lab-3d/boundary-guides.js')(E),P=require('../../web/csi-boundary/partition.js')(E);
const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,name),'utf8'));
const d=read('csi-review-v2-proxy.json'),mesh=d.analysisSource,t=E.topology(mesh),base=d.guides.scales[2].proposal,labels=base.patchGroups.slice(),fine=labels.slice();
// 样本审查策略：只细分大区，不恢复已合并的胸袋微小区域。
const plan=[[8,7],[19,4],[61,4],[3,7],[2,4],[43,4],[25,3],[13,3],[14,3]],splits=[];let next=Math.max(...labels)+1;
const links=t.adj.map((ns,i)=>ns.map(j=>[j,E.dist(t.data[i].center,t.data[j].center)*(1+3*(1-E.dot(t.data[i].normal,t.data[j].normal)))]));
function grow(ids,seeds){const members=new Set(ids),ds=new Map(ids.map(i=>[i,Infinity])),owners=new Map(),done=new Set();seeds.forEach((i,g)=>{ds.set(i,0);owners.set(i,g);});while(done.size<ids.length){let u=-1,best=Infinity;for(const i of ids)if(!done.has(i)&&ds.get(i)<best){u=i;best=ds.get(i);}if(u<0)break;done.add(u);for(const [v,c] of links[u])if(members.has(v)&&!done.has(v)&&best+c<ds.get(v)){ds.set(v,best+c);owners.set(v,owners.get(u));}}return {ds,owners};}
for(const [parent,count] of plan){const ids=labels.flatMap((g,i)=>g===parent?[i]:[]);if(ids.length<count*60)continue;const seeds=[ids[0]];while(seeds.length<count){const r=grow(ids,seeds);seeds.push(ids.reduce((a,b)=>r.ds.get(a)>r.ds.get(b)?a:b));}const r=grow(ids,seeds),sizes=seeds.map((_,g)=>ids.filter(i=>r.owners.get(i)===g).length);if(Math.min(...sizes)<40)continue;const map=seeds.map((_,i)=>i?next++:parent);for(const i of ids)fine[i]=map[r.owners.get(i)];splits.push({parent,sizes});}
const groups=P.hierarchy(mesh,labels,fine).groups(.7);console.log('finer',new Set(groups).size,splits);
const keys=[...t.edges].filter(([,e])=>e.faces.length===1||e.faces.length===2&&groups[e.faces[0]]!==groups[e.faces[1]]).map(([k])=>k),graph=G.chains(mesh,keys,t),chains=G.interfaceChains(mesh,keys,t,groups);
for(const c of chains){c.role='major';c.supportedEdges=c.edges.length;}
const area=new Map();groups.forEach((g,i)=>area.set(g,(area.get(g)||0)+t.data[i].area));const scale=d.guides.scale;
const proposal=G.fitNetwork(mesh,t,{keys,groups,chains,nodes:graph.nodes,patches:[...area].map(([id,area])=>({id,area,relativeArea:area/(scale*scale)})),report:{seedEdges:keys.length,edges:keys.length,endpoints:graph.nodes.filter(n=>n.kind==='endpoint').length,junctions:graph.nodes.filter(n=>n.kind==='junction').length,surfaceContrastSplits:[]}},
  {scale,tolerance:scale*.006,regularization:.01,cornerAngle:55,localScaleFitting:true,curveFairing:true});
d.guides.scales[2].proposal=proposal;
delete d.granularityBase;
let result=P.applySmoothing(d,.5);

result.granularity=.7;result.settings.granularity=.7;result.reviewEdits={...d.reviewEdits,finer:{method:'父区内曲面测地距离多源生长，0.7层级选择；待美术审查',splits}};result.name='小闪第三版 · 较细分区（代理审查）';P.restore(result);fs.writeFileSync(path.join(__dirname,'csi-review-v3-finer.json'),JSON.stringify(result));console.log({groups:new Set(groups).size,interfaces:result.postprocess.fittedNetwork.interfaces.length,overTolerance:result.postprocess.report.fitOverTolerance});
