const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const E=require('../../web/contour-lab-3d/engine.js')(),G=require('../../web/contour-lab-3d/boundary-guides.js')(E),P=require('../../web/csi-boundary/partition.js')(E);
const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,name),'utf8'));
const d=read('review-v2-base.json'),p=read('review-paths-projected.json'),curves=[];
for(const [i,route] of p.paths.entries())if(route.accepted){
 const closed=route.lowNodes[0]===route.lowNodes.at(-1);
 const points=route.projected.filter((point,j)=>!j||E.dist(point,route.projected[j-1])>1e-8);
 const fitted=G.fitChain(points,{closed,tolerance:d.guides.scale*.002,cornerAngle:80});
 for(const [j,c] of fitted.entries())curves.push({...c,id:'review-'+i+'-'+j,role:'review-guide',fitTolerance:d.guides.scale*.002,errorOverTolerance:c.error>d.guides.scale*.002,sourceEdges:[],name:route.name});
}
d.reviewGuides={version:1,analysisFingerprint:d.analysisFingerprint,curves,source:'美术低模人工选取稀疏路径，统一尺度后投射到当前分析副本；仅为布线候选',paths:p.paths.map(({points,projected,...item})=>item),alignment:p.alignment};
d.reviewEdits={version:1,base:'csi-partition.json',merged:p.merged,approval:'pending'};
d.name='小闪 · 第二版审查（红色分区 / 青色导线）';
P.restore(d);assert.equal(E.fingerprint(d.source),d.sourceFingerprint);
fs.writeFileSync(path.join(__dirname,'csi-partition-v2.json'),JSON.stringify(d));
console.log({groups:new Set(d.guides.scales[2].proposal.patchGroups).size,paths:p.paths.length,accepted:p.paths.filter(p=>p.accepted).length,curves:curves.length,fitOverTolerance:d.postprocess.report.fitOverTolerance});
