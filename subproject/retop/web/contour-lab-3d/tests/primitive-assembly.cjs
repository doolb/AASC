const assert=require('node:assert/strict');
const E=require('../engine.js')();
const P=require('../primitives.js')(E);
const cube=E.cube();
const axes=[[.8,.6,0],[-.6,.8,0],[0,0,1]];
const shapes=[['box',[.5,.6,.8]],['sphere',[.75,.75,.75]],['cylinder',[.5,.5,1.1]]];
const source={vertices:[],faces:[]};
for(const [i,[type,radii]] of shapes.entries()){
  const part=P.build(cube,{type,radii,center:[0,0,0],basisOrigin:[i*3,0,0],basisAxes:axes},16);
  const offset=source.vertices.length;source.vertices.push(...part.vertices);
  source.faces.push(...part.faces.map(f=>f.map(v=>v+offset)));
}
function assertCovered(raw,mesh){
  const pieces=new Map();
  mesh.faces.forEach((f,i)=>{
    const group=mesh.primitiveGroups[i];
    if(!pieces.has(group))pieces.set(group,[]);
    for(let j=1;j<f.length-1;j++){
      const [p,q,r]=[f[0],f[j],f[j+1]].map(id=>mesh.vertices[id]);
      const n=E.unit(E.cross(E.sub(q,p),E.sub(r,p)));pieces.get(group).push([n,p]);
    }
  });
  for(const face of raw.faces)assert([...pieces.values()].some(planes=>
    face.every(i=>planes.every(([n,p])=>E.dot(n,E.sub(raw.vertices[i],p))<=1e-9))));
}
const before=E.fingerprint(source),mesh=P.fit(source,{farMidType:'auto',farMidBlockLimit:5});
assert.deepEqual(mesh.primitive.parameters.blocks.map(p=>p.type),shapes.map(s=>s[0]));
assert.equal(mesh.primitive.coverage.uncoveredTriangles,0);assertCovered(source,mesh);
assert.equal(E.fingerprint(source),before);
const restored=P.fit(source,{primitiveOverride:JSON.parse(JSON.stringify(mesh.primitive.parameters))});
assert.deepEqual(restored.vertices,mesh.vertices);assert.deepEqual(restored.faces,mesh.faces);
// 一张细长三角形横跨两个体块。只检查三个顶点的并集不能证明这张面完整覆盖。
const crossing=E.copy(source);crossing.vertices.push([4,1.3,1.4]);
crossing.faces.push([0,source.vertices.length-1,crossing.vertices.length-1]);
const expanded=P.fit(source,{primitiveOverride:mesh.primitive.parameters},()=>{},crossing);
assertCovered(crossing,expanded);
assert.equal(expanded.primitive.coverage.sourceTriangles,E.audit(source).triangles+1);
const one=P.fit(source,{farMidType:'assembly',farMidBlockLimit:1});
assert.equal(one.primitive.parts,1);assertCovered(source,one);
assert.throws(()=>P.fit(cube,{farMidType:'assembly',farMidBlockLimit:0}));
console.log('PASS automatic box / sphere / cylinder selection, part limit, full-source face enclosure, intersecting seams and parameter round trip');

// 正交投影到共同画布，独立统计整个源剪影以外的像素，避免包覆通过但体块过厚。
function frontProjection(mesh,frame){
  const size=160,mask=new Uint8Array(size*size);
  const points=mesh.vertices.map(p=>[(p[0]-frame.lo[0])*frame.scale+4,(p[1]-frame.lo[1])*frame.scale+4]);
  const side=(a,b,x,y)=>(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
  for(const face of mesh.faces)for(let j=1;j+1<face.length;j++){
    const [a,b,c]=[face[0],face[j],face[j+1]].map(k=>points[k]);
    const sign=Math.sign(side(a,b,...c));
    if(!sign)continue;
    const minX=Math.max(0,Math.ceil(Math.min(a[0],b[0],c[0]))),maxX=Math.min(size-1,Math.floor(Math.max(a[0],b[0],c[0])));
    const minY=Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1]))),maxY=Math.min(size-1,Math.floor(Math.max(a[1],b[1],c[1])));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      if(side(a,b,x,y)*sign>=0&&side(b,c,x,y)*sign>=0&&side(c,a,x,y)*sign>=0)mask[y*size+x]=1;
    }
  }
  return mask;
}

if(process.argv[2]){
  const fs=require('node:fs');
  const source=E.parseOBJ(fs.readFileSync(process.argv[2],'utf8'));
  const turn=mesh=>({...mesh,vertices:mesh.vertices.map(([x,y,z])=>[1+.8*x-.6*y,2+.6*x+.8*y,3+z])});
  for(const mesh of [source,turn(source)]){
    const out=P.fit(mesh,{farMidType:'auto',farMidBlockLimit:24});
    const {blocks,regions}=out.primitive.parameters;
    for(const name of ['chest','waist','pelvis','neck'])assert(regions.includes(name),name);
    assert.equal(regions.filter(n=>n.startsWith('front-pouch')).length,4);
    assert.equal(blocks[regions.indexOf('chest')].type,'sectionBody');
    assert.equal(out.primitive.coverage.uncoveredTriangles,0);
    assert.equal(out.primitive.coverage.outsideVertices,0);
    assert(out.primitive.parts<=24&&E.audit(out).valid);
    const bounds=E.bounds(out);
    const frame={lo:bounds.lo,scale:150/Math.max(bounds.hi[0]-bounds.lo[0],bounds.hi[1]-bounds.lo[1])};
    const original=frontProjection(mesh,frame),fitted=frontProjection(out,frame);
    const count=mask=>mask.reduce((sum,v)=>sum+v,0);
    assert(original.every((v,i)=>!v||fitted[i]),'原件投影有外露像素');
    const excess=count(fitted)/count(original)-1;
    console.log('人物正面额外投影面积', (excess*100).toFixed(2)+'%');
    assert(excess<.15,'中远档正面轮廓外扩过多');
    const restored=P.fit(mesh,{primitiveOverride:out.primitive.parameters});
    assert.deepEqual(restored.vertices,out.vertices);
  }
  console.log('PASS automatic chest, waist, pelvis and four front pieces, enclosing each source face after rigid transformation');
}
