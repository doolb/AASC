const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('../engine.js')();
const grid = require('../structure-grid.js')(E);
const template = require('../face-template.js')(E);

// 用实际源 OBJ 验证五档入口。参考低模不在测试参数中，避免把示例引入重建。
const file = process.argv[2];
if (!file) throw Error('请提供目标人物高模或该高模的分析副本 OBJ。');
assert.equal(E.settingsFor({}).characterTemplate, false);
assert.equal(template.locate(E.cube()), null);
// 平坦脸颊上留一条深窄沟，同时在中央保留宽鼻峰。检查拟合能区分两种尺度。
const sample=(x,y)=>.18+.09*Math.exp(-(x*x+y*y)/.008)
  -.06*Math.exp(-(((Math.abs(x)-.2)/.01)**2+((y+.3)/.07)**2));
const field=template.portraitField({map:{sample},x:0,h:0,width:1});
assert(field(.2,-.3)>sample(.2,-.3)+.035);
assert(field(0,0)>field(.2,0)+.045);
const source = E.parseOBJ(fs.readFileSync(file, 'utf8'));
const signature = E.fingerprint(source);
const result = E.process(source, {characterTemplate: true, lowTriangleBudget: 2122}, console.log);
const low = result.levels[2], mid = result.levels[3];
const {stations, addedTriangles, profileRings} = low.mesh.csiReport.characterTemplate;
assert(stations > 0 && addedTriangles === 2 * stations && profileRings > 0);
assert(low.mesh.csiReport.characterTemplate.pairedRailVertices >= 8);
assert.equal(low.mesh.csiReport.characterTemplate.pairedRailVertices % 2, 0);
assert.equal(low.mesh.faceTemplateShading.signature, E.fingerprint(low.mesh));
const anchors = Object.values(low.mesh.faceTemplateShading.anchors);
assert(anchors.length > 0 && anchors.every(({normal, weight}) =>
  Math.abs(E.len(normal) - 1) < 1e-8 && weight > 0 && weight <= 1));
assert(low.audit.valid && low.topologyPreserved && low.audit.triangles <= 2122);
assert.equal(grid.intersections(low.mesh), 0);
assert.equal(mid.mesh.hierarchy.parentFingerprint, E.fingerprint(low.mesh));
// 用导出文件检查实际分界。只改查看器法线或只给面写标签都会漏掉其中一项。
const exported=E.parseOBJ(E.obj(low)),edges=E.topology(low.mesh).edges;
assert.deepEqual(exported.sourceUV.uv,low.uv.uv);
assert.deepEqual(exported.sourceUV.indices,low.uv.indices);
assert(low.uv.report.packingUtilization>.4);
for(const name of ['face-L','face-R','scalp','torso-front','torso-back']){
  assert(low.uv.parts.some(part=>part.group===name&&part.faces.length>20));
}
// 按实际 OBJ 角点累加面积，确保倍率改变了二维坐标，同时保留原有三维网格。
function measureDensity(level){
  const mesh=E.parseOBJ(E.obj(level)),tr=E.triangulate(mesh),parts=new Map(),totals={};
  for(const part of level.uv.parts)for(const fi of part.faces)parts.set(fi,part.group.replace(/-[LR](?:-.+)?$/,''));
  tr.faces.forEach((f,i)=>{
    const parent=tr.source[i],part=parts.get(parent),area=totals[part]??={surface:0,uv:0};
    const [a,b,c]=f.map(id=>mesh.sourceUV.uv[mesh.sourceUV.indices[parent][mesh.faces[parent].indexOf(id)]]);
    area.uv+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
    const [v,w,x]=f.map(id=>mesh.vertices[id]);area.surface+=E.len(E.cross(E.sub(w,v),E.sub(x,v)))/2;
  });
  const density=part=>Math.sqrt(totals[part].uv/totals[part].surface);
  for(const [part,weight] of Object.entries(level.uv.density))
    assert(Math.abs(density(part)/density('boot')-weight/level.uv.density.boot)<1e-5,part);
}
assert.equal(low.uv.density.face,1.75);measureDensity(low);
const override={face:2.2,arm:.85,boot:1.1};
const staged={levels:[result.levels[0],{...low,texture:{width:512}}],settings:result.settings};
const revised=E.rebuildUV(staged,()=>{},override);
assert.equal(revised.levels[0],staged.levels[0]);assert.equal(revised.levels[1].mesh,low.mesh);
assert.equal(revised.levels[1].texture,undefined);assert.equal(staged.levels[1].texture.width,512);
assert.deepEqual(revised.levels[1].uv.density,E.characterUVDensity(override));measureDensity(revised.levels[1]);
assert.throws(()=>E.rebuildUV(staged,()=>{},{arm:NaN}),/UV/);
// 从导出的多边形本身读取边，检查结构带没有被重新合并成斜向面，镜像侧共享排数与列数。
const flow=low.mesh.csiReport.characterTemplate,exportEdges=E.topology(exported).edges;
for(const group of ['leg','sleeve','waist','upperTorso','crown']){
  const bands=flow.bands.filter(b=>b.name===group);
  assert.equal(bands.length,['leg','sleeve'].includes(group)?2:1);
  for(const b of bands){
    assert.equal(b.rings.length,bands[0].rings.length);
    for(let i=0;i<b.rings.length;i++){
      const row=b.rings[i];assert.equal(row.length,bands[0].rings[0].length);
      for(let j=0;j<row.length;j++){
        assert(exportEdges.has(E.key(row[j],row[(j+1)%row.length])));
        if(i)assert(exportEdges.has(E.key(row[j],b.rings[i-1][j])));
      }
    }
  }
}
assert(flow.featureEdges.length>10&&flow.featureEdges.every(key=>exportEdges.has(key)));
const side=low.mesh.headSideShading;
assert.equal(side.signature,E.fingerprint(low.mesh));
assert(side.hardEdges.length>0&&Object.keys(side.sheetCorners).length>1);
let splitCorners=0;
for(const key of side.hardEdges){
  const edge=edges.get(key),[a,b]=edge.faces;
  assert.notEqual(exported.sourceSmoothingGroups[a],exported.sourceSmoothingGroups[b]);
  for(const id of [edge.a,edge.b]){
    const normals=[a,b].map(fi=>exported.sourceNormals.vectors[exported.sourceNormals.indices[fi][exported.faces[fi].indexOf(id)]]);
    if(E.dot(...normals)<.95)splitCorners++;
  }
}
assert(splitCorners>0);
assert.equal(mid.mesh.headSideShading.signature,E.fingerprint(mid.mesh));
assert.equal(E.fingerprint(source), signature);
console.log(JSON.stringify({triangles: low.audit.triangles, vertices: low.audit.vertices, stations, profileRings,
  signature: E.fingerprint(low.mesh), midTriangles: mid.audit.triangles, midGeometry: mid.mesh.hierarchy.intersectionAudit}));
