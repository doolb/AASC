const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'../..'),E=require(root+'/web/contour-lab-3d/engine.js')(),P=require(root+'/web/csi-boundary/partition.js')(E),G=require(root+'/web/contour-lab-3d/boundary-guides.js')(E),oldDir=root+'/artifacts/moxing-csi-review-2026-11-24/';
const read=f=>JSON.parse(fs.readFileSync(f)),d=read(oldDir+'csi-review-v4-texture-details.json'),v2=read(oldDir+'csi-review-v2-proxy.json'),mesh=d.analysisSource,t=E.topology(mesh);
const recipe={version:1,analysisFingerprint:d.analysisFingerprint,source:'csi-review-v4-texture-details.json',bootBaseIds:[2,4,34,43,44,47,48,63,64,65],method:'美术结构参考的局部图割：靴口带、鞋面、完整鞋底；仅用于本样本',sole:{center:.031,edgeRise:.012,zScale:.13},cuff:{height:.099,zSlope:.04},band:.012,bootTextureGate:{maxY:.155,redBlueRatio:1.14,greenBlueRatio:1.06}};
fs.writeFileSync(path.join(__dirname,'boots-recipe.json'),JSON.stringify(recipe,null,2));
const selected=new Set(recipe.bootBaseIds),ids=v2.guides.scales[2].proposal.patchGroups.flatMap((g,i)=>selected.has(g)?[i]:[]),allowed=new Set(ids),groups=d.guides.scales[2].proposal.patchGroups.slice();
// 原父区把部分靴舌错误连到了裤腿；仅补入与靴部相邻、低于裤脚且颜色符合靴面的面。
for(let q=0;q<ids.length;q++)for(const j of t.adj[ids[q]]){const c=d.textureEvidence.colors[j],gate=recipe.bootTextureGate;if(!allowed.has(j)&&t.data[j].center[1]<gate.maxY&&c&&c[0]>c[2]*gate.redBlueRatio&&c[1]>c[2]*gate.greenBlueRatio){allowed.add(j);ids.push(j);}}
function cut(faces,threshold){
 const local=new Map(faces.map((f,i)=>[f,i])),n=faces.length,source=n,sink=n+1,adj=Array.from({length:n+2},()=>[]);
 function edge(a,b,c){const x={to:b,cap:c,rev:adj[b].length},y={to:a,cap:0,rev:adj[a].length};adj[a].push(x);adj[b].push(y)}
 faces.forEach((f,i)=>{const p=t.data[f].center,s=(p[1]-threshold(p))/recipe.band;edge(source,i,s>1?1e6:Math.max(0,s));edge(i,sink,s< -1?1e6:Math.max(0,-s));});
 for(const e of t.edges.values())if(e.faces.length===2&&e.faces.every(f=>local.has(f))){const [a,b]=e.faces,bend=1-E.dot(t.data[a].normal,t.data[b].normal),length=E.dist(mesh.vertices[e.a],mesh.vertices[e.b]);const w=.6*Math.exp(-8*Math.max(0,bend))*length/.007;edge(local.get(a),local.get(b),w);edge(local.get(b),local.get(a),w);}
 while(true){const level=Array(n+2).fill(-1),q=[source];level[source]=0;for(let j=0;j<q.length;j++)for(const e of adj[q[j]])if(e.cap>1e-10&&level[e.to]<0){level[e.to]=level[q[j]]+1;q.push(e.to)}if(level[sink]<0)break;const next=Array(n+2).fill(0);
 function send(v,flow){if(v===sink)return flow;for(;next[v]<adj[v].length;next[v]++){const e=adj[v][next[v]];if(e.cap<=1e-10||level[e.to]!==level[v]+1)continue;const f=send(e.to,Math.min(flow,e.cap));if(f>1e-10){e.cap-=f;adj[e.to][e.rev].cap+=f;return f}}return 0}
 while(send(source,1e9)>1e-10){}
 }
 const seen=new Set([source]),q=[source];for(let j=0;j<q.length;j++)for(const e of adj[q[j]])if(e.cap>1e-10&&!seen.has(e.to)){seen.add(e.to);q.push(e.to)}return new Set(faces.filter((_,i)=>seen.has(i)));
}
let next=Math.max(...groups)+1;const regions=[];
for(const side of [-1,1]){
 const faces=ids.filter(i=>Math.sign(t.data[i].center[0])===side);
 const aboveSole=cut(faces,p=>recipe.sole.center+recipe.sole.edgeRise*Math.min(1,(p[2]/recipe.sole.zScale)**2));
 const aboveCuff=cut(faces,p=>recipe.cuff.height+recipe.cuff.zSlope*p[2]);
 const labels=[next++,next++,next++];for(const i of faces)groups[i]=!aboveSole.has(i)?labels[0]:aboveCuff.has(i)?labels[2]:labels[1];
 // 原网格凹槽可能留下极小孤岛；仅在同一靴子的相邻区间消除，按最长共享边选择合并对象。
 for(let pass=0;pass<3;pass++){const seen=new Set(),components=[];for(const start of faces)if(!seen.has(start)){const q=[start];seen.add(start);for(let j=0;j<q.length;j++)for(const k of t.adj[q[j]])if(allowed.has(k)&&groups[k]===groups[start]&&!seen.has(k)){seen.add(k);q.push(k)}components.push(q)}
 const largest=new Map();for(const c of components)if(!largest.has(groups[c[0]])||largest.get(groups[c[0]]).length<c.length)largest.set(groups[c[0]],c);
 for(const c of components){if(largest.get(groups[c[0]])===c)continue;const votes=new Map();for(const i of c)for(const j of t.adj[i])if(allowed.has(j)&&groups[j]!==groups[i])votes.set(groups[j],(votes.get(groups[j])||0)+1);const best=[...votes].sort((a,b)=>b[1]-a[1])[0];if(best)for(const i of c)groups[i]=best[0];}
 }
 regions.push({side,labels,faces:labels.map(g=>faces.filter(i=>groups[i]===g).length)});
}
const changed=groups.flatMap((g,i)=>g!==d.guides.scales[2].proposal.patchGroups[i]?[i]:[]);if(changed.some(i=>!allowed.has(i)))throw Error('范围外标签改变');
fs.writeFileSync(path.join(__dirname,'boots-groups.json'),JSON.stringify({groups,ids,regions}));console.log({regions,oldRegions:new Set(ids.map(i=>d.guides.scales[2].proposal.patchGroups[i])).size,newRegions:new Set(ids.map(i=>groups[i])).size,total:new Set(groups).size});
if(process.argv.includes('--preview'))process.exit(0);
const before=d.guides.scales[2].proposal;delete d.postprocess;delete d.granularityBase;console.time('rebuild');
const out=P.applySmoothing(P.repartition(d,d.granularity,console.log,groups),d.csiSmoothing,console.log);
out.name='小闪第五版 · 靴部结构修正';out.reviewEdits={...d.reviewEdits,boots:{recipe:'boots-recipe.json',regions,selectedFaces:ids.length,approval:'pending'}};
// 此次审查基线记录最终标签，避免旧脚部的无语义父区继续被当作已确认结构。
out.textureBase=out.guides.scales[2].proposal;out.granularityBase=out.guides.scales[2].proposal;
P.restore(out);fs.writeFileSync(path.join(__dirname,'csi-review-v5-boots.json'),JSON.stringify(out));console.timeEnd('rebuild');console.log({groups:new Set(groups).size,interfaces:out.postprocess.fittedNetwork.interfaces.length,over:out.postprocess.report.fitOverTolerance});
