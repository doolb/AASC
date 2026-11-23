const assert=require('node:assert/strict'),fs=require('node:fs'),E=require('../engine.js')();
const F=fs.existsSync(require.resolve('../engine.js').replace('engine.js','feature-patches.js'))?require('../feature-patches.js')(E):null;

// 闭合的凸起板件：主平台和微小凸点来自同一网格，便于检查块面识别而非模型名。
function raisedPlate(n=20,ripple=0,dual=false){
  const vertices=[],faces=[],main=[],mainFlags=[],panels=[[],[]];
  for(const back of [false,true])for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
    const a=-1+2*x/n,b=-1+2*y/n,block=(dual?Math.abs(Math.abs(a)-.5)<.32:Math.abs(a)<.55)&&Math.abs(b)<.55,button=!dual&&Math.abs(a-.1)<.09&&Math.abs(b-.1)<.09,bridge=dual&&Math.abs(a)<.25&&Math.abs(b)<.2;
    vertices.push([a,b,back?-.15:block?(dual?.15:.4)+(button?.07:ripple*Math.sin(a*8*Math.PI)*Math.sin(b*8*Math.PI)):bridge?.09:0]);mainFlags.push(!back&&block&&!button);
  }
  const count=(n+1)**2,id=(x,y)=>y*(n+1)+x;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const q=[id(x,y),id(x+1,y),id(x+1,y+1),id(x,y+1)];
    for(const f of [[q[0],q[1],q[2]],[q[0],q[2],q[3]]]){
      if(f.every(v=>mainFlags[v])){main.push(faces.length);panels[vertices[f[0]][0]<0?0:1].push(faces.length);}
      faces.push(f);faces.push(f.map(v=>v+count).reverse());
    }
  }
  const border=[];for(let x=0;x<n;x++)border.push(id(x,0));for(let y=0;y<n;y++)border.push(id(n,y));for(let x=n;x>0;x--)border.push(id(x,n));for(let y=n;y>0;y--)border.push(id(0,y));
  border.forEach((a,i)=>{const b=border[(i+1)%border.length];faces.push([a,a+count,b+count],[a,b+count,b]);});
  return {mesh:E.orient({vertices,faces}),main,panels};
}

assert.equal(typeof F?.build,'function','主块面识别模块尚未实现');
const fixture=raisedPlate(),before=E.fingerprint(fixture.mesh),features=F.build(fixture.mesh,{triangleBudget:180,patchCount:24});
assert.equal(E.fingerprint(fixture.mesh),before);assert.equal(features.sourceFingerprint,before);
assert.equal(features.patchGroups.length,fixture.mesh.faces.length);
assert(features.patchGroups.every(g=>Number.isInteger(g)&&g>=0));
const mainGroups=new Map();for(const i of fixture.main){const g=features.patchGroups[i];mainGroups.set(g,(mainGroups.get(g)||0)+1);}
const [dominant,coverage]=[...mainGroups].sort((a,b)=>b[1]-a[1])[0];
assert(coverage/fixture.main.length>.7,'凸起主面应由一个主要平面区域覆盖');
assert(features.patches[dominant].normal[2]>.97,'主面代理应保持前向');
const rippled=raisedPlate(28,.025),rippledFeatures=F.build(rippled.mesh,{triangleBudget:180,patchCount:24}),rippleGroups=new Map();
for(const i of rippled.main){const g=rippledFeatures.patchGroups[i];rippleGroups.set(g,(rippleGroups.get(g)||0)+1);}
assert(Math.max(...rippleGroups.values())/rippled.main.length>.65,'低于预算尺度的小幅起伏不应把主面拆成许多法线方向区');
const paired=raisedPlate(28,0,true),pairedFeatures=F.build(paired.mesh,{triangleBudget:1800,patchCount:24}),dominantOf=indices=>{
  const areas=new Map();for(const i of indices){const g=pairedFeatures.patchGroups[i];areas.set(g,(areas.get(g)||0)+1);}return [...areas].sort((a,b)=>b[1]-a[1])[0][0];
};
assert.notEqual(dominantOf(paired.panels[0]),dominantOf(paired.panels[1]),'由较低连接面相连的两个凸起主面必须保持独立结构分区');
const underside=paired.mesh.faces.map((f,i)=>({i,data:E.faceData(paired.mesh,f)})).filter(({data:d})=>d.center[1]>-.65&&d.center[1]<-.45&&d.center[2]>.01&&d.normal[1]<-.8);
assert(underside.length>0);
assert(underside.filter(({i})=>pairedFeatures.patches[pairedFeatures.patchGroups[i]].normal[1]<-.7).length/underside.length>.7,'凸起块面的下侧转折不能被并入前向主体平面');
const topology=E.topology(fixture.mesh),adj=fixture.mesh.faces.map(()=>[]);
for(const e of topology.edges.values())if(e.faces.length===2){const [a,b]=e.faces;adj[a].push(b);adj[b].push(a);}
for(const p of features.patches){const seen=new Set([p.faces[0]]),queue=[p.faces[0]];for(let i=0;i<queue.length;i++)for(const j of adj[queue[i]])if(features.patchGroups[j]===p.id&&!seen.has(j)){seen.add(j);queue.push(j);}assert.equal(seen.size,p.faces.length,'主块面必须相连');}
const ring=E.torus(),coarse=F.build(ring,{triangleBudget:100,patchCount:12}),fine=F.build(ring,{triangleBudget:800,patchCount:72});
assert(fine.report.normalError<coarse.report.normalError*.8,'较高预算应增加结构复杂度并降低曲面拟合误差');
assert(fine.patches.length>coarse.patches.length);
const box=E.cube(),islands={vertices:[...box.vertices,...box.vertices.map(([x,y,z])=>[x+5,y,z])],faces:[...box.faces,...box.faces.map(f=>f.map(v=>v+box.vertices.length))]},islandFeatures=F.build(islands,{triangleBudget:160,patchCount:16});
const firstIsland=new Set(islandFeatures.patchGroups.slice(0,box.faces.length));
assert(islandFeatures.patchGroups.slice(box.faces.length).every(g=>!firstIsland.has(g)),'不同壳体不得合成同一结构区域');
const moved={vertices:fixture.mesh.vertices.map(([x,y,z])=>[z*3+4,x*3-2,y*3+7]),faces:fixture.mesh.faces.map(f=>f.slice())};
const transformed=F.build(moved,{triangleBudget:180,patchCount:24});
assert(Math.abs(transformed.report.normalError-features.report.normalError)<1e-8,'主块面尺度与姿态变化后应保持误差口径');
console.log('PASS connected feature patches, raised major plane, source immutability, budget refinement and transform invariance');
const G=require('../boundary-guides.js')(E);
assert.equal(typeof G.featureNetwork,'function','共享结构 CSI 接口尚未实现');
const network=G.featureNetwork(fixture.mesh,features,{triangleBudget:180,tolerance:.03});
assert.equal(network.sourceFingerprint,before);assert.equal(E.fingerprint(fixture.mesh),before);
assert.equal(network.patchGroups.length,fixture.mesh.faces.length);
const covered=network.chains.flatMap(c=>c.edges);
assert.equal(covered.length,new Set(covered).size,'共享接口必须只定义一次');
assert.deepEqual(new Set(covered),new Set(network.rawKeys));
assert(network.curves.every(c=>['I','C','S'].includes(c.type)&&[c.p0,c.p1,c.p2,c.p3].flat().every(Number.isFinite)));
const denser=G.featureNetwork(fixture.mesh,features,{triangleBudget:180,tolerance:.008});
assert(denser.anchors.length>=network.anchors.length,'更严格曲线容差不应减少站位');
// 两个环状区域之间只有闭合接口，没有三分交点，也需要闭环支撑锚点。
const halfGroups=ring.faces.map((_,i)=>i<ring.faces.length/2?0:1),halves={sourceFingerprint:E.fingerprint(ring),patchGroups:halfGroups,patches:[0,1].map(id=>({id,normal:id?[1,0,0]:[-1,0,0],faces:halfGroups.map((g,i)=>g===id?i:-1).filter(i=>i>=0)}))};
const annular=G.featureNetwork(ring,halves,{triangleBudget:100,tolerance:.1});
assert(annular.chains.every(c=>new Set(c.vertices.filter(v=>annular.anchors.includes(v))).size>=3),'没有交点的闭合界面至少保留三个站位');
console.log('PASS unique shared CSI interfaces, supported I/C/S fits, tolerance sampling and closed-loop anchors');
const S=require('../structure-grid.js')(E);
assert.equal(typeof S.generateFeatures,'function','结构分区离散构面尚未实现');
const low=S.generateFeatures(fixture.mesh,features,network,{lowTriangleBudget:180}),health=E.audit(low);
assert(health.valid);assert(health.triangles<=180);assert.deepEqual(health.euler,E.audit(fixture.mesh).euler);
assert.equal(health.components,1);assert.equal(health.boundaryEdges,0);
assert.equal(E.fingerprint(fixture.mesh),before);
assert.equal(low.csiPatchGroups.length,low.faces.length);
assert(low.csiBoundaryKeys.every(k=>E.topology(low).edges.has(k)),'CSI 边界必须是实际网格边');
assert.equal(low.csiReport.featurePatches,true);assert.equal(low.csiReport.fallback,false);
const ringNetwork=G.featureNetwork(ring,coarse,{triangleBudget:100,tolerance:.12});
const ringLow=S.generateFeatures(ring,coarse,ringNetwork,{lowTriangleBudget:100});
assert(E.audit(ringLow).valid);assert.deepEqual(E.audit(ringLow).euler,[0]);assert(E.audit(ringLow).triangles<=100);
assert.equal(ringLow.csiHardSurfaceGroups.length,0,'连续环形曲面不应被识别为刚性平面');
assert(ringLow.vertices.every((p,i)=>E.dist(p,ring.vertices[ringLow.csiFeatureAnchorSources[i]])<1e-12),'软曲面站位应保持在源网格上');
const bareRing=S.generateFeatures(ring,coarse,ringNetwork,{lowTriangleBudget:160,refineSurface:false,projectPlanes:false});
const fittedRing=S.generateFeatures(ring,coarse,ringNetwork,{lowTriangleBudget:160,refineSurface:true,projectPlanes:false});
assert(E.audit(fittedRing).triangles>E.audit(bareRing).triangles,'剩余预算应补充曲面站位');
assert(E.audit(fittedRing).triangles<=160);
assert(E.measure(ring,fittedRing).p95Relative<E.measure(ring,bareRing).p95Relative*.95,'曲面站位需要实际降低形体误差');
console.log('PASS source-graph CSI construction, actual shared borders, closed topology and triangle budgets');
const chart={vertices:[[0,0,0],[1,0,0],[0,1,0],[0,-1,.25]],faces:[[0,1,2],[1,0,3]],csiPatchGroups:[0,1],csiSurfaceCharts:true};
assert.equal(E.autoSmooth(chart).groupCount,1,'平顺曲面的块面参数缝不应自动成为着色硬边');
assert.equal(E.autoSmooth({...chart,csiSurfaceCharts:false}).groupCount,2,'原有肩甲结构分区仍应阻断跨界法线');
module.exports={raisedPlate};
