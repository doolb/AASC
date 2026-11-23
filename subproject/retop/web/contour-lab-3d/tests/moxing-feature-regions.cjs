// 目标资产的只读区域验收。以下坐标仅定位用户红框对应的源高模袋体，不进入通用算法。
const fs=require('node:fs'),assert=require('node:assert/strict'),E=require('../engine.js')(),F=require('../feature-patches.js')(E);
const file=process.argv[2];if(!file)throw Error('请提供目标高模的工作分析副本 OBJ。');
const source=E.parseOBJ(fs.readFileSync(file,'utf8')),signature=E.fingerprint(source),features=F.build(source,{triangleBudget:2122,patchCount:177});
const underside=[];
source.faces.forEach((face,i)=>{
  const d=E.faceData(source,face),p=d.center;
  if(Math.abs(p[0])>.015&&Math.abs(p[0])<.09&&p[1]>.42&&p[1]<.48&&p[2]>.12&&d.normal[1]<-.65)underside.push(i);
});
assert(underside.length>=40,'应定位到目标袋体的真实下侧面。');
const restored=underside.filter(i=>features.patches[features.patchGroups[i]].normal[1]<-.65).length/underside.length;
console.log('袋体下侧独立方向覆盖',restored,'源面数量',underside.length);
assert(restored>.7,'袋体下侧主结构不能被合入前向主体平面。');
assert.equal(E.fingerprint(source),signature);
console.log('PASS target pouch underside regions and immutable source');
