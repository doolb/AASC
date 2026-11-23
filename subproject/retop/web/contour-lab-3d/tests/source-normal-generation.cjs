// 手动集成验收：在不加载颜色图、也不执行烘焙的情况下生成并回读法线和平滑组。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const E=require('../engine.js')(),file=process.argv[2],out=process.argv[3],budget=Number(process.argv[4]||2122);
if(!file||!out)throw Error('请提供源 OBJ 路径、独立输出目录和可选三角面预算。');
const start=Date.now(),source=E.parseOBJ(fs.readFileSync(file,'utf8')),signature=E.fingerprint(source);
assert(source.sourceNormals,'源模型应具有逐角显式法线。');
let last='';
const result=E.process(source,{lowTriangleBudget:budget},message=>{
  if(message.includes('法线')&&message!==last){last=message;console.log(message);}
});
assert.equal(E.fingerprint(source),signature);
assert(result.levels[2].audit.triangles<=budget);
fs.mkdirSync(out,{recursive:true});
const levels=result.levels.slice(2).map(level=>{
  const m=level.mesh,n=m.surfaceNormals;
  assert(n&&n.hits>0);assert.equal(n.hits+n.misses,m.faces.reduce((sum,f)=>sum+f.length,0));
  assert.equal(m.smoothingReport.partitionSource,'source-normals');
  const obj=E.obj(level),read=E.parseOBJ(obj);
  assert.equal(E.audit(read).triangles,level.audit.triangles);
  const expected=E.cornerNormals(m);
  assert(read.sourceNormals.indices.every((f,i)=>f.every((id,j)=>E.dist(read.sourceNormals.vectors[id],expected[i][j])<1e-12)));
  assert.deepEqual(read.sourceSmoothingGroups,m.smoothingGroups);
  fs.writeFileSync(path.join(out,level.id+'.obj'),obj);
  return {id:level.id,triangles:level.audit.triangles,groups:m.smoothingReport.groups,sharpEdges:m.smoothingReport.sharpEdges,hits:n.hits,misses:n.misses};
});
const report={seconds:(Date.now()-start)/1000,sourceFingerprint:signature,sourceNormalVectors:source.sourceNormals.vectors.length,budget,levels};
fs.writeFileSync(path.join(out,'normal-generation.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
