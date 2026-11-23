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
  const uv=point?.uv||edge.grabUV||edge.a.map((v,i)=>(v+edge.b[i])/2);
  const candidates=buildTopology(item.faces,item.creases).edges.filter(candidate=>candidate.crease&&pointOnFace(face,candidate.a)&&pointOnFace(face,candidate.b));
  const direct=!point&&edge.crease;
  const chosen=direct?edge:candidates.find(candidate=>sameCreaseAxis(candidate,axis))||candidates.sort((a,b)=>Math.abs(signedDistance(a,uv))-Math.abs(signedDistance(b,uv)))[0];
  if(!chosen)return null;
  const side=Math.sign(signedDistance(chosen,centerUV));if(!side)return null;
  return {edge:{...chosen,face:control.face,centerUV},side:direct?undefined:side,handleUV:Math.abs(signedDistance(chosen,uv))>EPS?uv:centerUV,direct};
}

// 抓取点沿固定材料轴的真实圆弧；仅计算一个点，不重复旋转整张纸。
export function orbitPoint(point,a,b,degrees){
  const delta=b.slice(0,3).map((v,i)=>v-a[i]),length=Math.hypot(...delta),n=delta.map(v=>v/length),v=point.map((x,i)=>x-a[i]);
  const r=degrees*Math.PI/180,c=Math.cos(r),s=Math.sin(r),dot=v.reduce((sum,x,i)=>sum+x*n[i],0);
  const cross=[n[1]*v[2]-n[2]*v[1],n[2]*v[0]-n[0]*v[2],n[0]*v[1]-n[1]*v[0]];
  return v.map((x,i)=>a[i]+x*c+cross[i]*s+n[i]*dot*(1-c));
}
// 用投影距离求连续角度；只在距离几乎相同的候选中偏向上次角度，避免前后两支跳变。
export function closestOrbitAngle(project,target,previous,min=-180,max=180){
  const cost=angle=>{const p=project(angle);return (p.x-target.x)**2+(p.y-target.y)**2+1e-5*(angle-previous)**2};
  let best=Math.max(min,Math.min(max,previous)),value=cost(best);
  for(let angle=min;angle<=max;angle+=2){const next=cost(angle);if(next<value){best=angle;value=next}}
  let left=Math.max(min,best-2),right=Math.min(max,best+2);
  for(let i=0;i<18;i++){
    const a=left+(right-left)/3,b=right-(right-left)/3;
    if(cost(a)<cost(b))right=b;else left=a;
  }
  const result=(left+right)/2;
  for(const endpoint of [min,max]){
    // 展平时层位移会重新贴合，容纳很小的表面投影偏差，保证最终能精确展平。
    const p=project(endpoint),nearFlat=Math.abs(endpoint)===180&&Math.abs(result-endpoint)<2&&Math.hypot(p.x-target.x,p.y-target.y)<4;
    if(nearFlat||cost(endpoint)<=cost(result))return endpoint;
  }
  return result;
}
