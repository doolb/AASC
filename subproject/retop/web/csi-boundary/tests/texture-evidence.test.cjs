const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../../contour-lab-3d/engine.js')();
const T=require('../texture-evidence.js')(E);
test('分析结果不持久化原始贴图像素',()=>{
 const P=require('../partition.js')(E),out=P.analyze(E.cube(),{textureImage:{width:1,height:1,data:[0,0,0,255]},textureStrength:0,csiSmoothing:0});
 assert.equal(Object.hasOwn(out.settings,'textureImage'),false);
});
function strip(){const vertices=[],faces=[];for(let y=0;y<5;y++)for(let x=0;x<9;x++)vertices.push([x,y,0]);for(let y=0;y<4;y++)for(let x=0;x<8;x++){const a=y*9+x;faces.push([a,a+1,a+10],[a,a+10,a+9]);}return {vertices,faces};}
test('窄色带成为连通小区，零强度保持原区，不跨父区',()=>{
 const m=strip(),t=E.topology(m),base=m.faces.map(()=>0),colors=t.data.map(d=>d.center[0]>3&&d.center[0]<4?[.8,.1,.1]:[.1,.5,.2]);
 assert.deepEqual(T.segment(m,base,colors,0,.7).groups,base);
 const r=T.segment(m,base,colors,.8,.7);assert.equal(new Set(r.groups).size,3);
 assert.equal(new Set(r.groups.filter((_,i)=>colors[i][0]===.8)).size,1);
 const parents=base.map((_,i)=>i<32?0:1),q=T.segment(m,parents,colors,.8,.7);
 for(const g of new Set(q.groups))assert.equal(new Set(parents.filter((_,i)=>q.groups[i]===g)).size,1);
});
test('UV缝不单独切区，纯色图片采样保持一个区',()=>{
 const m=strip();m.sourceUV={uv:[[.1,.2],[.9,.8],[.2,.7]],indices:m.faces.map(()=>[0,1,2])};
 const image={width:2,height:2,data:new Uint8Array(Array(4).fill([40,80,120,255]).flat())};
 const ev=T.sample(m,m,image);assert.equal(ev.coverage,1);assert.equal(new Set(T.segment(m,m.faces.map(()=>0),ev.colors,1,1).groups).size,1);
 assert.throws(()=>T.sample({...m,sourceUV:undefined},m,image),/UV/);
 assert.throws(()=>T.segment(m,m.faces.map(()=>0),ev.colors,NaN,.7),/强度/);
});
test('OBJ V轴、代理映射和远离表面的拒绝',()=>{
 const m={vertices:[[0,0,0],[1,0,0],[0,1,0]],faces:[[0,1,2]],sourceUV:{uv:[[.5,1],[.5,1],[.5,1]],indices:[[0,1,2]]}};
 const image={width:1,height:2,data:[255,0,0,255,0,0,255,255]};
 assert.deepEqual(T.sample(m,m,image).colors[0],[1,0,0]);
 const proxy={vertices:m.vertices.map(p=>[p[0],p[1],p[2]+.001]),faces:m.faces};
 assert.equal(T.sample(m,proxy,image).coverage,1);
 const far={...proxy,vertices:proxy.vertices.map(p=>[p[0],p[1],100])};assert.equal(T.sample(m,far,image).coverage,0);
});
test('贴图细分结果可回读、重复应用不累积、零强度还原基线且保留审查导线',()=>{
 const P=require('../partition.js')(E),m=strip(),fp=E.fingerprint(m),base=m.faces.map(()=>0),colors=E.topology(m).data.map(d=>d.center[0]>3&&d.center[0]<4?[.8,.1,.1]:[.1,.5,.2]);
 const d={schema:'retop/csi-partition',version:1,source:m,analysisSource:m,sourceFingerprint:fp,analysisFingerprint:fp,boundary:{sourceFingerprint:fp},settings:{},granularity:.7,csiSmoothing:0,
  guides:{scale:E.bounds(m).diagonal,scales:[{},{},{proposal:{patchGroups:base,rawKeys:[]}},{proposal:{patchGroups:base,rawKeys:[]}}]},
  textureEvidence:{version:1,analysisFingerprint:fp,colors,coverage:1},reviewGuides:{version:1,analysisFingerprint:fp,curves:[]}};
 const out=P.applyTexture(d,null,.8);assert.equal(new Set(out.guides.scales[2].proposal.patchGroups).size,3);P.restore(out);
 const again=P.applyTexture(out,null,.8);assert.deepEqual(again.guides.scales[2].proposal.patchGroups,out.guides.scales[2].proposal.patchGroups);
 const zero=P.applyTexture(out,null,0);assert.deepEqual(zero.guides.scales[2].proposal.patchGroups,base);assert.deepEqual(zero.reviewGuides,d.reviewGuides);
 const bad=structuredClone(out);bad.textureEvidence.analysisFingerprint='bad';assert.throws(()=>P.restore(bad),/贴图/);
});
