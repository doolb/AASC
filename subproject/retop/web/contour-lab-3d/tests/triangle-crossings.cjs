// Independent segment/plane + dot-product barycentric check. Proper crossings
// only: shared vertices, coplanarity and endpoint-only contacts are excluded.
module.exports=function triangleCrossings(mesh,E){
 const tr=E.triangulate(mesh),D=E.bounds(mesh).diagonal,epsilon=D*1e-8;
 function segment(p,q,a,b,c){const x=E.sub(b,a),y=E.sub(c,a),n=E.cross(x,y),d=E.sub(q,p),den=E.dot(n,d);if(Math.abs(den)<D**3*1e-12)return false;const t=E.dot(n,E.sub(a,p))/den;if(t<=1e-7||t>=1-1e-7)return false;const v=E.sub(E.add(p,E.mul(d,t)),a),xx=E.dot(x,x),xy=E.dot(x,y),yy=E.dot(y,y),vx=E.dot(v,x),vy=E.dot(v,y),det=xx*yy-xy*xy;if(det<D**4*1e-20)return false;const s=(vx*yy-vy*xy)/det,u=(vy*xx-vx*xy)/det;return s>=-1e-7&&u>=-1e-7&&s+u<=1+1e-7;}
 const triangles=tr.faces.map(ids=>{const points=ids.map(id=>tr.vertices[id]);return {ids,points,lo:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),hi:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))};}).sort((a,b)=>a.lo[0]-b.lo[0]);let count=0;
 for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length&&triangles[j].lo[0]<=triangles[i].hi[0]+epsilon;j++){const a=triangles[i],b=triangles[j];if(a.ids.some(v=>b.ids.includes(v))||a.lo.some((v,k)=>v>b.hi[k]+epsilon||b.lo[k]>a.hi[k]+epsilon))continue;if(a.points.some((p,k)=>segment(p,a.points[(k+1)%3],...b.points))||b.points.some((p,k)=>segment(p,b.points[(k+1)%3],...a.points)))count++;}return count;
};
