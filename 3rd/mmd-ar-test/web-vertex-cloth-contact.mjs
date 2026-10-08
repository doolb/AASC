// 接触几何共用于CPU求解及静态附着映射；返回重心权重，质量分配覆盖接触两侧。
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const read = (p, id) => [p[id*3], p[id*3+1], p[id*3+2]];
const clamp = v => Math.max(0, Math.min(1, v));
export function closestTriangle(p, a, b, c) {
    const ab=sub(b,a), ac=sub(c,a), ap=sub(p,a), d1=dot(ab,ap), d2=dot(ac,ap);
    if(d1<=0 && d2<=0) return [1,0,0];
    const bp=sub(p,b), d3=dot(ab,bp), d4=dot(ac,bp);
    if(d3>=0 && d4<=d3) return [0,1,0];
    const vc=d1*d4-d3*d2;
    if(vc<=0 && d1>=0 && d3<=0) {const v=d1/(d1-d3); return [1-v,v,0];}
    const cp=sub(p,c), d5=dot(ab,cp), d6=dot(ac,cp);
    if(d6>=0 && d5<=d6) return [0,0,1];
    const vb=d5*d2-d1*d6;
    if(vb<=0 && d2>=0 && d6<=0) {const w=d2/(d2-d6); return [1-w,0,w];}
    const va=d3*d6-d5*d4;
    if(va<=0 && d4-d3>=0 && d5-d6>=0) {const w=(d4-d3)/(d4-d3+d5-d6); return [0,1-w,w];}
    const denominator=va+vb+vc;
    if(Math.abs(denominator)<1e-20) return [1,0,0];
    const v=vb/denominator,w=vc/denominator; return [1-v-w,v,w];
}
export const interpolate = (points, weights) => [0,1,2].map(axis=>points.reduce((s,p,i)=>s+p[axis]*weights[i],0));
export function closestEdges(a,b,c,d) {
    const u=sub(b,a),v=sub(d,c),r=sub(a,c),aa=dot(u,u),ee=dot(v,v),f=dot(v,r);
    let s=0,t=0;
    if(aa<1e-20 && ee<1e-20) return [0,0];
    if(aa<1e-20) t=clamp(f/ee);
    else {
        const cc=dot(u,r);
        if(ee<1e-20) s=clamp(-cc/aa);
        else {
            const bb=dot(u,v),den=aa*ee-bb*bb;
            s=den>1e-20?clamp((bb*f-cc*ee)/den):0;t=(bb*s+f)/ee;
            if(t<0){t=0;s=clamp(-cc/aa);} else if(t>1){t=1;s=clamp((bb-cc)/aa);}
        }
    }
    return [s,t];
}
export function vertexTriangleContact(ids, p, previous, rest, thickness) {
    const points=ids.map(id=>read(p,id)), initial=ids.map(id=>read(rest,id));
    const restWeights=closestTriangle(...initial), restGap=Math.hypot(...sub(initial[0],interpolate(initial.slice(1),restWeights)));
    if(restGap<1e-7) return null; // 原本重叠的正反面不能被厚度强行撑开。
    const gap=Math.min(thickness,restGap*0.5), bary=closestTriangle(...points);
    const difference=sub(points[0],interpolate(points.slice(1),bary)), distance=Math.hypot(...difference);
    const n=cross(sub(points[2],points[1]),sub(points[3],points[1])), area=Math.hypot(...n);
    if(area<1e-12) return null;
    const old=ids.map(id=>read(previous,id)), oldN=cross(sub(old[2],old[1]),sub(old[3],old[1]));
    const side=dot(sub(old[0],old[1]),oldN)>=0?1:-1;
    const signed=dot(difference,n)/area*side;
    const crossed=signed<0 && Math.min(...bary)>1e-6;
    if(!crossed && distance>=gap) return null;
    const normal=crossed || distance<1e-9?n.map(v=>v/area*side):difference.map(v=>v/distance);
    return {ids, coefficients:[1,-bary[0],-bary[1],-bary[2]], normal, depth:crossed?gap-signed:gap-distance};
}
export function edgeEdgeContact(ids,p,rest,thickness) {
    const q=ids.map(id=>read(p,id)), initial=ids.map(id=>read(rest,id)), [rs,rt]=closestEdges(...initial);
    const restGap=Math.hypot(...sub(interpolate(initial.slice(0,2),[1-rs,rs]),interpolate(initial.slice(2),[1-rt,rt])));
    if(restGap<1e-7) return null;
    const [s,t]=closestEdges(...q), d=sub(interpolate(q.slice(0,2),[1-s,s]),interpolate(q.slice(2),[1-t,t]));
    const gap=Math.min(thickness,restGap*0.5), length=Math.hypot(...d);
    if(length>=gap) return null;
    let normal=d;
    if(length<1e-9) normal=cross(sub(q[1],q[0]),sub(q[3],q[2]));
    const size=Math.hypot(...normal);if(size<1e-9)return null;
    return {ids,coefficients:[1-s,s,-(1-t),-t],normal:normal.map(v=>v/size),depth:gap-length};
}
