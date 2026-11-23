import {buildTopology,pointOnFace} from './paper-topology.mjs';

const EPS=1e-7;
const signedDistance=(edge,uv)=>{
  const dx=edge.b[0]-edge.a[0],dy=edge.b[1]-edge.a[1];
  return (dx*(uv[1]-edge.a[1])-dy*(uv[0]-edge.a[0]))/Math.hypot(dx,dy);
};
// 同一直折痕可被交点分成多段，选择轴时按材料直线匹配，不依赖线段的方向或长度。
export function sameCreaseAxis(left,right){
  return !!left&&!!right&&Math.abs(signedDistance(left,right.a))<EPS&&Math.abs(signedDistance(left,right.b))<EPS;
}

// 只从用户实际拾取到的材料面寻找已有折痕，避免重叠后误用另一层的近邻折线。
export function separationPick(item,point,edge,axis){
  const control=point||edge;if(!control)return null;
  const face=item.faces[control.face];if(!face)return null;
  const centerUV=face.reduce((sum,p)=>[sum[0]+p[3]/face.length,sum[1]+p[4]/face.length],[0,0]);
  const uv=point?.uv||edge.a.map((v,i)=>(v+edge.b[i])/2);
  const candidates=buildTopology(item.faces,item.creases).edges.filter(candidate=>candidate.crease&&pointOnFace(face,candidate.a)&&pointOnFace(face,candidate.b));
  const direct=!point&&edge.crease;
  const chosen=direct?edge:candidates.find(candidate=>sameCreaseAxis(candidate,axis))||candidates.sort((a,b)=>Math.abs(signedDistance(a,uv))-Math.abs(signedDistance(b,uv)))[0];
  if(!chosen)return null;
  const side=Math.sign(signedDistance(chosen,centerUV));if(!side)return null;
  return {edge:{...chosen,face:control.face,centerUV},side:direct?undefined:side,handleUV:Math.abs(signedDistance(chosen,uv))>EPS?uv:centerUV,direct};
}
