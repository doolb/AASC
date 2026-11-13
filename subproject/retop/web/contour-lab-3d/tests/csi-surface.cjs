const assert=require('node:assert/strict'),fs=require('node:fs'),E=require('../engine.js')(),C=require('../csi-surface.js')(E);
const reference=require('../../../artifacts/contour-lab-3d/shoulder-rounded-corners-result.json'),source=E.orient(reference.source),proposal=reference.guides.scales[2].proposal,before=JSON.stringify({source,proposal});let cases=0;
function test(name,run){run();cases++;console.log('PASS',name);}
function convex(mesh){for(const f of mesh.faces){const p=f.map(v=>mesh.vertices[v]),n=E.faceData(mesh,f).normal;for(let j=0;j<4;j++)assert(E.dot(E.cross(E.sub(p[(j+1)%4],p[j]),E.sub(p[(j+2)%4],p[(j+1)%4])),n)>1e-7*E.dist(p[(j+1)%4],p[j])*E.dist(p[(j+2)%4],p[(j+1)%4]),'concave quad');assert(E.dot(E.cross(E.sub(p[1],p[0]),E.sub(p[2],p[0])),E.cross(E.sub(p[2],p[0]),E.sub(p[3],p[0])))>0,'opposed triangles');}}
function topology(mesh){const a=E.audit(mesh);assert(a.valid);assert.equal(a.quads,a.faces);assert.deepEqual(a.euler,E.audit(source).euler);assert.equal(a.components,1);assert.equal(a.boundaryEdges,0);convex(mesh);}
const low=C.generate(source,proposal,{lowSubdivisions:1}).mesh;
function grid(mesh,patch){const [U,V]=patch.grid,g=Array.from({length:V+1},()=>[]);mesh.faces.filter((_,i)=>mesh.csiPatchGroups[i]===patch.id).forEach((f,i)=>{const x=i%U,y=Math.floor(i/U);g[y][x]=f[0];g[y][x+1]=f[1];g[y+1][x+1]=f[2];g[y+1][x]=f[3];});return g;}
test('rim center lane crosses curved CSI joints without drifting toward a corner',()=>{
  const rims=low.csiReport.patches.filter(p=>p.fairing.rimFamilyAxis);assert(rims.length>=4,'end patches must join the rim width family');
  const locked=new Set(low.csiReport.centeredRimVertices);let checked=0,exact=0;
  for(const p of rims){const g=grid(low,p),[U,V]=p.grid,u=p.fairing.rimFamilyAxis==='u',T=u?U:V,N=u?V:U;assert.equal(T%2,0);
    for(let j=0;j<=N;j++){
      const row=u?g[j]:g.map(r=>r[j]),a=low.vertices[row[0]],b=low.vertices[row[T]],mid=low.vertices[row[T/2]],d=E.sub(b,a),fraction=E.dot(E.sub(mid,a),d)/E.dot(d,d),relativeOffset=E.dist(mid,E.mul(E.add(a,b),.5))/E.len(d);
      assert(Math.abs(fraction-.5)<.05,'center lane is biased toward one rail');
      assert(relativeOffset<.09,'center lane jumped to a small CSI corner');
      // A curved CSI cap's arc midpoint need not lie on its straight chord.
      // Away from those caps, keep the previous exact midpoint guarantee.
      if(relativeOffset<1e-10)exact++;
      if(j>0&&j<N)assert(locked.has(row[T/2]),'repair may move the center lane');checked++;
    }
  }
  assert(exact>checked*.75,'curved-cap corrections spread over the entire rim');
});
test('shared rim joints include an actual half-arclength sample and retain original corner knots',()=>{
  const curves=new Map(proposal.curves.map(c=>[c.id,c])),boundary=new Set(low.csiEdges.flatMap(e=>e.vertices));let multi=0;
  function length(edge){const ps=edge.curves.flatMap(id=>{const c=curves.get(id);return Array.from({length:2049},(_,i)=>{const t=i/2048,s=1-t;return [0,1,2].map(k=>s**3*c.p0[k]+3*s*s*t*c.p1[k]+3*s*t*t*c.p2[k]+t**3*c.p3[k]);});});return ps.slice(1).reduce((sum,p,i)=>sum+E.dist(p,ps[i]),0);}
  for(const patch of low.csiReport.patches.filter(p=>p.fairing.rimFamilyAxis)){
    const g=grid(low,patch),[U,V]=patch.grid,u=patch.fairing.rimFamilyAxis==='u',rows=u?[g[0],g[V]]:[g.map(r=>r[0]),g.map(r=>r[U])];
    for(const row of rows){const es=low.csiEdges.filter(e=>e.vertices.every(v=>row.includes(v))),total=es.reduce((s,e)=>s+length(e),0),mid=row[(row.length-1)/2];let traveled=0;
      for(const e of es){const forward=row.indexOf(e.vertices[0])<row.indexOf(e.vertices.at(-1)),at=e.vertices.indexOf(mid);if(at<0)continue;
        const ordered=es.filter(x=>row.indexOf(x.vertices[Math.floor(x.vertices.length/2)])<row.indexOf(e.vertices[Math.floor(e.vertices.length/2)]));
        traveled=ordered.reduce((s,x)=>s+length(x),0)+length(e)*(forward?e.parameters[at]:1-e.parameters[at]);
        assert(Math.abs(traveled/total-.5)<1e-4,'joint center is an ordinal rather than the arc midpoint');
      }
      assert(boundary.has(mid));if(es.length>1){multi++;for(const e of es){const cs=e.curves.map(id=>curves.get(id));for(const point of [cs[0].p0,cs.at(-1).p3])assert(row.some(v=>E.dist(low.vertices[v],point)<1e-9),'mandatory CSI corner was moved/lost');}}
    }
  }assert(multi>=2,'must cover both sides of the shared tiny-edge joint');
});
test('rim cross-lines follow the local structure instead of pairing independent ordinals',()=>{
  for(const patch of low.csiReport.patches.filter(p=>p.fairing.widthAxis)){
    const [U,V]=patch.grid,g=Array.from({length:V+1},()=>[]);
    low.faces.filter((_,i)=>low.csiPatchGroups[i]===patch.id).forEach((f,i)=>{const x=i%U,y=Math.floor(i/U);g[y][x]=f[0];g[y][x+1]=f[1];g[y+1][x+1]=f[2];g[y+1][x]=f[3];});
    const u=patch.fairing.widthAxis==='u',A=(u?g.map(row=>row[0]):g[0]).map(i=>low.vertices[i]),B=(u?g.map(row=>row[U]):g[V]).map(i=>low.vertices[i]),angles=[];
    for(let i=1;i<A.length-1;i++){
      const along=E.unit(E.add(E.unit(E.sub(A[i+1],A[i-1])),E.unit(E.sub(B[i+1],B[i-1])))),across=E.unit(E.sub(B[i],A[i]));
      angles.push(Math.asin(E.clamp(Math.abs(E.dot(along,across)),0,1))*180/Math.PI);
    }
    assert(angles.reduce((s,v)=>s+v,0)/angles.length<3,'cross-lines still lean along the rim');
    assert(Math.max(...angles)<15,'large local cross-line skew remains');
  }
});
test('paired CSI corners share one cross-section instead of adjacent stations',()=>{
  const matches=low.csiReport.budget.pairedLandmarks;assert(matches.length>0);
  function vertex(node){for(const e of low.csiEdges){const logical=proposal.interfaces.find(i=>i.id===e.interfaceId).edges.find(l=>l.id===e.logicalEdge);if(logical.startNode===node)return e.vertices[0];if(logical.endNode===node)return e.vertices.at(-1);}throw Error('Missing CSI corner');}
  for(const match of matches){const patch=low.csiReport.patches.find(p=>p.id===match.patch),[U,V]=patch.grid,g=Array.from({length:V+1},()=>[]);
    low.faces.filter((_,i)=>low.csiPatchGroups[i]===patch.id).forEach((f,i)=>{const x=i%U,y=Math.floor(i/U);g[y][x]=f[0];g[y][x+1]=f[1];g[y+1][x+1]=f[2];g[y+1][x]=f[3];});
    const u=patch.fairing.widthAxis==='u',n=match.station;
    assert.equal(u?g[n][0]:g[0][n],vertex(match.nodeA));assert.equal(u?g[n][U]:g[V][n],vertex(match.nodeB));
  }
});
test('hard corners retain close support samples on both incident sides',()=>{
  const nodes=new Set(low.csiReport.budget.pairedLandmarks.flatMap(p=>[p.nodeA,p.nodeB]));let checked=0;
  for(const e of low.csiEdges){const l=proposal.interfaces.find(i=>i.id===e.interfaceId).edges.find(l=>l.id===e.logicalEdge),n=e.parameters.length-1;if(n<4)continue;
    for(const end of [false,true])if(nodes.has(end?l.endNode:l.startNode)){
      const relative=n*(end?1-e.parameters[n-1]:e.parameters[1]);assert(relative<.7,'corner neighbor is not denser than the nominal spacing');assert(relative>.05,'corner support collapsed onto the corner');checked++;
    }
  }
  assert(checked>=4,'both sides of both paired corners must be checked');
});
test('local curvature sampling improves CSI chord fit without adding faces',()=>{
  const cm=new Map(proposal.curves.map(c=>[c.id,c]));let uniformError=0,adaptiveError=0,nonuniform=false;
  const cubic=(c,t)=>{const s=1-t;return [0,1,2].map(k=>s**3*c.p0[k]+3*s*s*t*c.p1[k]+3*s*t*t*c.p2[k]+t**3*c.p3[k]);};
  const distance=(p,a,b)=>{const d=E.sub(b,a),t=E.clamp(E.dot(E.sub(p,a),d)/E.dot(d,d),0,1);return E.dist(p,E.add(a,E.mul(d,t)));};
  for(const edge of low.csiEdges){
    const table=edge.curves.flatMap(id=>Array.from({length:1025},(_,i)=>cubic(cm.get(id),i/1024))),arc=[0];
    for(let i=1;i<table.length;i++)arc.push(arc.at(-1)+E.dist(table[i-1],table[i]));
    function point(t){const target=t*arc.at(-1);let a=0,b=arc.length-1;while(b-a>1){const j=(a+b)>>1;if(arc[j]<target)a=j;else b=j;}const f=(target-arc[a])/(arc[b]-arc[a]||1);return E.add(E.mul(table[a],1-f),E.mul(table[b],f));}
    const n=edge.vertices.length-1,uniform=Array.from({length:n+1},(_,i)=>point(i/n));
    assert.equal(edge.parameters[0],0);assert.equal(edge.parameters[n],1);
    for(let i=1;i<=n;i++)assert(edge.parameters[i]>edge.parameters[i-1]);
    nonuniform ||= edge.parameters.some((v,i)=>Math.abs(v-i/n)>.01);
    for(let i=0;i<n;i++)for(const f of [.125,.25,.5,.75,.875]){
      uniformError=Math.max(uniformError,distance(point((i+f)/n),uniform[i],uniform[i+1]));
      adaptiveError=Math.max(adaptiveError,distance(point(edge.parameters[i]*(1-f)+edge.parameters[i+1]*f),low.vertices[edge.vertices[i]],low.vertices[edge.vertices[i+1]]));
    }
  }
  assert(nonuniform,'all edges still use uniform spacing');
  assert(adaptiveError<uniformError*.85,'curvature sampling did not improve fixed-count chord fit');
});
test('verified hard corners attract nearby samples without moving corner points',()=>{
  const without=C.generate(source,{...proposal,sourceCorners:[]}).mesh,nodes=new Set(proposal.sourceCorners.flatMap(c=>c.nodes));let withGap=0,withoutGap=0;
  assert.deepEqual(low.faces,without.faces);
  for(const edge of low.csiEdges){
    const other=without.csiEdges.find(e=>e.id===edge.id),logical=proposal.interfaces.find(i=>i.id===edge.interfaceId).edges.find(e=>e.id===edge.logicalEdge),n=edge.parameters.length-1;
    for(const i of [0,n])assert.deepEqual(low.vertices[edge.vertices[i]],without.vertices[other.vertices[i]]);
    if(n<2)continue;
    for(const end of [false,true])if(nodes.has(end?logical.endNode:logical.startNode)){
      withGap+=end?1-edge.parameters[n-1]:edge.parameters[1];withoutGap+=end?1-other.parameters[n-1]:other.parameters[1];
    }
  }
  assert(withoutGap>0);assert(withGap<withoutGap*.9,'no meaningful extra density near verified corners');
});
test('independent geometric audit catches crossings and accepts the generated cage',()=>{const check=require('./triangle-crossings.cjs'),crossed={vertices:[[-1,0,0],[1,0,0],[0,1,0],[0,.2,-1],[0,.2,1],[0,-1,0]],faces:[[0,1,2],[3,4,5]]};assert(check(crossed,E)>0);assert.equal(check(low,E),0);});
test('actual CSI patch topology replaces the primitive cage',()=>{topology(low);assert(!low.csiReport.fallback);assert.equal(low.csiReport.intersectionAudit.remainingNonadjacentTrianglePairs,0);assert.equal(low.hierarchy.parentLevel,'middle-csi');assert.deepEqual([...new Set(low.csiPatchGroups)].sort(),proposal.patches.map(p=>p.id).sort());assert.notEqual(E.fingerprint(low),E.fingerprint(reference.levels[2].mesh));assert(low.csiReport.csiOnly);assert.equal(low.csiReport.highSurfaceQueries,0);assert.equal(low.csiReport.boundaryError.target,"CSI");});
test('every shared CSI segment is an actual two-sided mesh edge',()=>{const t=E.topology(low);for(const k of low.csiBoundaryKeys){const e=t.edges.get(k);assert(e);assert.equal(e.faces.length,2);assert.notEqual(low.csiPatchGroups[e.faces[0]],low.csiPatchGroups[e.faces[1]]);}const boundaries=[...t.edges].filter(([,e])=>e.faces.length===2&&low.csiPatchGroups[e.faces[0]]!==low.csiPatchGroups[e.faces[1]]).map(([k])=>k);assert.deepEqual(new Set(boundaries),new Set(low.csiBoundaryKeys));assert.equal(new Set(low.faces.flat()).size,low.vertices.length);});
test('boundary positions lie on the analytic CSI curves, not the raw triangle edges',()=>{const curves=new Map(proposal.curves.map(c=>[c.id,c])),scale=E.bounds(source).diagonal;function sample(c,t){const lerp=(a,b)=>a.map((v,i)=>v*(1-t)+b[i]*t),a=lerp(c.p0,c.p1),b=lerp(c.p1,c.p2),d=lerp(c.p2,c.p3);return lerp(lerp(a,b),lerp(b,d));}for(const edge of low.csiEdges){const samples=edge.curves.flatMap(id=>Array.from({length:2049},(_,i)=>sample(curves.get(id),i/2048)));for(const vi of edge.vertices)assert(Math.min(...samples.map(p=>E.dist(p,low.vertices[vi])))<scale*.0005);}});
test('face provenance stays in its own source patch',()=>{low.faces.forEach((f,i)=>assert.equal(proposal.patchGroups[low.faceSources[i]],low.csiPatchGroups[i]));assert.equal(JSON.stringify({source,proposal}),before);});
test('structured grid interiors have no isolated inset rings or poles',()=>{const boundary=new Set(low.csiEdges.flatMap(e=>e.vertices)),t=E.topology(low);for(let v=0;v<low.vertices.length;v++)if(!boundary.has(v)){assert.equal(t.incident[v].length,4);assert.equal(new Set(t.incident[v].map(fi=>low.csiPatchGroups[fi])).size,1);}assert(low.csiReport.structured);for(const patch of low.csiReport.patches){assert.deepEqual(patch.grid.map(Math.floor),patch.grid);assert.equal(patch.grid[0]*patch.grid[1],patch.faces);}assert.equal(low.csiReport.intersectionAudit.edgeRotations,0);});
test('CSI side junctions do not extend a sharp crease across the broad patch',()=>{
  // Shoulder back-view regression: compare with the former Coons construction
  // on the SAME current boundary samples/grid, so extra faces alone cannot pass.
  const patch=low.csiReport.patches.find(p=>p.id===1),[U,V]=patch.grid,
    cells=low.faces.filter((_,i)=>low.csiPatchGroups[i]===patch.id),grid=Array.from({length:V+1},()=>[]);
  cells.forEach((f,i)=>{const x=i%U,y=Math.floor(i/U);grid[y][x]=f[0];grid[y][x+1]=f[1];grid[y+1][x+1]=f[2];grid[y+1][x]=f[3];});
  const at=(x,y)=>low.vertices[grid[y][x]],mid=Math.floor(U/2),coons=(x,y)=>{
    const u=x/U,v=y/V;
    return E.sub(E.add(E.add(E.mul(at(x,0),1-v),E.mul(at(x,V),v)),E.add(E.mul(at(0,y),1-u),E.mul(at(U,y),u))),E.add(E.add(E.mul(at(0,0),(1-u)*(1-v)),E.mul(at(U,0),u*(1-v))),E.add(E.mul(at(U,V),u*v),E.mul(at(0,V),(1-u)*v))));
  };
  function turns(points){return points.slice(1,-1).map((p,i)=>{
    const a=E.unit([p[0]-points[i][0],p[1]-points[i][1],0]),b=E.unit([points[i+2][0]-p[0],points[i+2][1]-p[1],0]);
    return Math.acos(E.clamp(E.dot(a,b),-1,1));
  });}
  const smooth=turns(grid.map((_,y)=>at(mid,y))),raw=turns(grid.map((_,y)=>coons(mid,y)));
  assert(smooth[0]<raw[0]*.25,'junction disturbance still propagates to the middle');
  assert(Math.max(...smooth)<Math.max(...raw)*.7,'interior still has a strong isolated turn');
  assert(Math.max(...grid.flatMap((row,y)=>row.map((_,x)=>E.dist(at(x,y),coons(x,y)))))<E.bounds(source).diagonal*.02,'fairing flattened/changed the large form too much');
  assert(low.csiReport.patches.every(p=>p.fairing.relativeResidual<1e-6));
});
test('whole-strip densities obey different face budgets',()=>{const fine=C.generate(source,proposal,{lowFaceBudget:700}).mesh,coarse=C.generate(source,proposal,{lowFaceBudget:392}).mesh;for(const [mesh,budget]of [[coarse,392],[low,500],[fine,700]]){topology(mesh);assert(mesh.faces.length<=budget);assert.equal(mesh.csiReport.budget.limit,budget);assert.equal(require('./triangle-crossings.cjs')(mesh,E),0);const boundary=new Set(mesh.csiEdges.flatMap(e=>e.vertices)),t=E.topology(mesh);for(let v=0;v<mesh.vertices.length;v++)if(!boundary.has(v))assert.equal(t.incident[v].length,4);}assert(coarse.faces.length<low.faces.length);assert(low.faces.length<fine.faces.length);assert(low.csiReport.boundaryError.maxRelative<.02);assert.throws(()=>C.generate(source,proposal,{lowFaceBudget:0}),/上限/);});
test('editing a CSI handle changes the generated geometry',()=>{const p=structuredClone(proposal),c=p.curves.find(c=>c.type==='C');c.p1=E.add(c.p1,[.02,-.01,.015]);c.p2=E.add(c.p2,[.02,-.01,.015]);const m=C.generate(source,p).mesh;topology(m);assert.notEqual(E.fingerprint(m),E.fingerprint(low));assert.notEqual(m.csiReport.guideSignature,low.csiReport.guideSignature);});
test('reconstruction is independent of object names, axes, translation and scale',()=>{const transform=p=>[17-2.3*p[1],-4+2.3*p[0],8+2.3*p[2]],m={...source,name:'unrelated',vertices:source.vertices.map(transform)},p=structuredClone(proposal);p.curves.forEach(c=>{for(const k of ['p0','p1','p2','p3'])c[k]=transform(c[k]);});const out=C.generate(m,p).mesh;topology(out);assert(out.faces.length<=500);assert.deepEqual(out.faces,low.faces);assert.deepEqual(out.csiEdges.map(({parameters,...e})=>e),low.csiEdges.map(({parameters,...e})=>e));out.csiEdges.forEach((e,j)=>e.parameters.forEach((v,i)=>assert(Math.abs(v-low.csiEdges[j].parameters[i])<1e-8)));for(let id=0;id<low.vertices.length;id++)assert(E.dist(out.vertices[id],transform(low.vertices[id]))<1e-6);assert(out.csiReport.csiOnly);});
test('fixed CSI ignores high-poly shape, fitting controls and source-surface APIs',()=>{const changed={...source,vertices:source.vertices.map(([x,y,z])=>[x*1.4+y*.2,y*.7,z*1.8+.3*x])},strict=require('../csi-surface.js')(E,{surface(){throw Error('High surface queried');}}),out=strict.generate(changed,proposal,{fitIterations:8,fitStrength:.1}).mesh;assert.deepEqual(out.vertices,low.vertices);assert.deepEqual(out.faces,low.faces);assert.deepEqual(out.csiEdges,low.csiEdges);assert.equal(out.csiReport.highSurfaceQueries,0);assert.equal(JSON.stringify({source,proposal}),before);});
test('non-disk patches are explicitly unsupported instead of filled across holes',()=>{const p={...proposal,patches:[{id:0}],patchGroups:source.faces.map(()=>0)},out=C.generate(source,p);assert.equal(out.supported,false);assert(out.reason.includes('切缝'));assert(!out.mesh);});
test('straight CSI box uses small conforming quad grids and preserves hard corners',()=>{const cube=E.cube(),text=JSON.stringify(cube),r=E.process(cube,{farMidType:'box',manualEdges:[...E.topology(cube).edges.keys()]});assert.equal(r.levels[2].audit.faces,24);assert(!r.levels[2].mesh.csiReport.fallback);convex(r.levels[2].mesh);for(const p of cube.vertices)assert(r.levels[2].mesh.vertices.some(v=>E.dist(v,p)<1e-12));assert.equal(r.levels[3].mesh.hierarchy.parentLevel,'legacy-primitive-low');assert.equal(JSON.stringify(cube),text);});
test('OBJ round trip preserves the generated quads and geometry',()=>{const text=E.obj({id:'low',mesh:low,uv:E.uvAtlas(low)}),round=E.parseOBJ(text);assert.deepEqual(round.vertices,low.vertices);assert.deepEqual(round.faces,low.faces);assert(text.includes('vt '));});
fs.writeFileSync('artifacts/contour-lab-3d/csi-surface-unit-report.json',JSON.stringify({cases,sourceFingerprint:E.fingerprint(source),meshFingerprint:E.fingerprint(low),quads:low.faces.length,budget:low.csiReport.budget,csiOnly:true,sourceShapeIgnored:true,error:low.csiReport.boundaryError,originalUnchanged:JSON.stringify({source,proposal})===before},null,2)+'\n');console.log(cases+' CSI surface cases passed');
