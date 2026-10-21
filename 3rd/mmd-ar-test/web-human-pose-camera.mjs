import { POSE_BODY_KEYS, getPosePoint } from './web-human-pose-semantic.mjs';
import { poseScale } from './web-human-pose-projection.mjs';

// 相机以图片高度为单位拟合，固定FOV；人体比例/姿态和未知焦距使结果只能视为近似匹配。
const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
function axes(p) {
    const [yaw,pitch,roll] = p, s=Math.sin(yaw), c=Math.cos(yaw), sp=Math.sin(pitch), cp=Math.cos(pitch);
    const right=[c,0,-s], down=[sp*s,-cp,sp*c], forward=[-cp*s,-sp,-cp*c], cr=Math.cos(roll), sr=Math.sin(roll);
    return [right.map((v,i)=>cr*v+sr*down[i]), down.map((v,i)=>cr*v-sr*right[i]), forward];
}
function evaluate(p, pairs, focal) {
    const basis=axes(p), depth=Math.exp(p[5]), residuals=[], distances=[];
    for (const pair of pairs) {
        const z=dot(basis[2],pair.point)+depth;
        if (z <= .05) return null;
        const dx=focal*(dot(basis[0],pair.point)+p[3])/z-pair.image[0];
        const dy=focal*(dot(basis[1],pair.point)+p[4])/z-pair.image[1];
        residuals.push(dx,dy); distances.push(Math.hypot(dx,dy));
    }
    const loss=distances.reduce((sum,d,i)=>sum+pairs[i].weight*(d<=.035?d*d:.07*d-.001225),0);
    return { residuals, distances, loss };
}
function solveLinear(matrix, values) {
    const a=matrix.map((row,i)=>[...row,values[i]]), n=values.length;
    for(let c=0;c<n;c++) {
        let pivot=c; for(let r=c+1;r<n;r++) if(Math.abs(a[r][c])>Math.abs(a[pivot][c])) pivot=r;
        if(Math.abs(a[pivot][c])<1e-12) return null;
        [a[c],a[pivot]]=[a[pivot],a[c]];
        const divisor=a[c][c]; for(let k=c;k<=n;k++) a[c][k]/=divisor;
        for(let r=0;r<n;r++) if(r!==c) { const factor=a[r][c]; for(let k=c;k<=n;k++) a[r][k]-=factor*a[c][k]; }
    }
    return a.map(row=>row[n]);
}
function refine(initial,pairs,focal,maxPitch) {
    let p=[...initial], current=evaluate(p,pairs,focal), lambda=.001;
    if(!current) return null;
    for(let step=0;step<35;step++) {
        const jacobian=[];
        for(let k=0;k<6;k++) {
            const next=[...p]; next[k]+=.0001;
            const value=evaluate(next,pairs,focal); if(!value) return {p,...current};
            jacobian.push(value.residuals.map((r,i)=>(r-current.residuals[i])/.0001));
        }
        const normal=Array.from({length:6},()=>Array(6).fill(0)), rhs=Array(6).fill(0);
        for(let row=0;row<current.residuals.length;row++) {
            const i=Math.floor(row/2), d=current.distances[i], weight=pairs[i].weight*Math.min(1,.035/Math.max(d,1e-9));
            for(let a=0;a<6;a++) { rhs[a]-=weight*jacobian[a][row]*current.residuals[row];
                for(let b=0;b<6;b++) normal[a][b]+=weight*jacobian[a][row]*jacobian[b][row]; }
        }
        for(let k=0;k<6;k++) normal[k][k]+=lambda*(normal[k][k]+.0001);
        const delta=solveLinear(normal,rhs); if(!delta) break;
        const next=p.map((v,i)=>v+clamp(delta[i],-1,1));
        next[1]=clamp(next[1],-maxPitch,maxPitch); next[5]=clamp(next[5],Math.log(.6),Math.log(80));
        const value=evaluate(next,pairs,focal);
        if(value && value.loss<current.loss) { p=next; current=value; lambda=Math.max(1e-7,lambda*.3); if(Math.hypot(...delta)<1e-6) break; }
        else lambda=Math.min(1e6,lambda*5);
    }
    return {p,...current};
}
function quaternion(matrix) {
    const m11=matrix[0][0],m12=matrix[0][1],m13=matrix[0][2],m21=matrix[1][0],m22=matrix[1][1],m23=matrix[1][2],m31=matrix[2][0],m32=matrix[2][1],m33=matrix[2][2];
    const trace=m11+m22+m33;
    if(trace>0) { const s=2*Math.sqrt(trace+1); return [(m32-m23)/s,(m13-m31)/s,(m21-m12)/s,s/4]; }
    const i=[m11,m22,m33].indexOf(Math.max(m11,m22,m33)), j=(i+1)%3,k=(i+2)%3;
    const s=2*Math.sqrt(1+matrix[i][i]-matrix[j][j]-matrix[k][k]), out=[0,0,0,0];
    out[i]=s/4; out[j]=(matrix[j][i]+matrix[i][j])/s; out[k]=(matrix[k][i]+matrix[i][k])/s; out[3]=(matrix[k][j]-matrix[j][k])/s; return out;
}
function makeView(p,center,scale,fov,zoom,aspect) {
    const [right,down,forward]=axes(p), depth=Math.exp(p[5])*scale;
    const target=center.map((v,i)=>v-right[i]*p[3]*scale-down[i]*p[4]*scale);
    const position=target.map((v,i)=>v-forward[i]*depth), up=down.map(v=>-v), back=forward.map(v=>-v);
    const rotation=[0,1,2].map(i=>[right[i],up[i],back[i]]), q=quaternion(rotation);
    const viewMatrix=[right[0],up[0],back[0],0,right[1],up[1],back[1],0,right[2],up[2],back[2],0,-dot(right,position),-dot(up,position),-dot(back,position),1];
    const cot=zoom/Math.tan(fov*Math.PI/360), near=.001, far=10000;
    const projectionMatrix=[cot/aspect,0,0,0,0,cot,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
    return { view:{position,quaternion:q,up,target,distance:depth,yaw:Math.atan2(Math.sin(p[0]),Math.cos(p[0])),pitch:p[1],fov,cameraZoom:zoom},
        referenceView:{viewMatrix,projectionMatrix,aspect,fov,zoom,rotation:0} };
}
export async function fitImageCamera(snapshot,pose,{aspect,isCurrent=()=>true,maxPitch=Math.PI/4}={}) {
    const check=()=>{if(!isCurrent()) throw new DOMException('相机匹配已取消','AbortError');}; check();
    const fov=snapshot.view.fov, zoom=snapshot.view.zoom || 1;
    if(!Number.isFinite(aspect)||aspect<=0||!Number.isFinite(fov)||fov<=1||fov>=150||!Number.isFinite(zoom)||zoom<=0) throw new Error('当前透视相机不支持匹配');
    const observation = p => getPosePoint(pose, p.key);
    const source=snapshot.points.filter(p=>POSE_BODY_KEYS.includes(p.key)&&p.world?.length===3&&p.world.every(Number.isFinite)&&observation(p)?.usable);
    if(source.length<6) throw new Error('可信且可对应的身体关键点不足6个');
    const scale=poseScale(source), center=[0,1,2].map(i=>source.reduce((s,p)=>s+p.world[i],0)/source.length);
    const pairs=source.map(p=>({point:p.world.map((v,i)=>(v-center[i])/scale),image:[(observation(p).x-.5)*aspect,observation(p).y-.5],
        weight:observation(p).weight,key:p.key}));
    const spans=[0,1,2].map(i=>Math.max(...pairs.map(p=>p.point[i]))-Math.min(...pairs.map(p=>p.point[i]))).sort((a,b)=>b-a);
    let area=0;
    for(const a of pairs)for(const b of pairs) {
        const u=a.point.map((v,i)=>v-pairs[0].point[i]),v=b.point.map((n,i)=>n-pairs[0].point[i]);
        area=Math.max(area,Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]));
    }
    const imageX=pairs.map(p=>p.image[0]), imageY=pairs.map(p=>p.image[1]);
    if(spans[1]<.04||area<.005||Math.max(...imageX)-Math.min(...imageX)<.015||Math.max(...imageY)-Math.min(...imageY)<.05) throw new Error('身体关键点空间分布退化，请调整姿态后重试');
    const focal=zoom/(2*Math.tan(fov*Math.PI/360));
    const depth=Math.max(2,focal/Math.max(.1,Math.max(...imageY)-Math.min(...imageY))), solutions=[];
    for(const pitch of [-.45,0,.45]) for(const yaw of [-Math.PI,-Math.PI*.75,-Math.PI*.5,-Math.PI*.25,0,Math.PI*.25,Math.PI*.5,Math.PI*.75]) {
        check(); const fit=refine([yaw,pitch,0,0,0,Math.log(depth)],pairs,focal,maxPitch); if(fit) solutions.push(fit);
        await new Promise(resolve=>setTimeout(resolve,0));
    }
    check(); solutions.sort((a,b)=>a.loss-b.loss); const best=solutions[0];
    if(!best) throw new Error('无法稳定匹配相机，请先让角色姿态接近参考图');
    const inliers=best.distances.map((d,i)=>d<=.08?i:-1).filter(i=>i>=0);
    const error=Math.sqrt(inliers.reduce((s,i)=>s+best.distances[i]**2,0)/Math.max(1,inliers.length));
    const totalError=Math.sqrt(best.distances.reduce((s,d,i)=>s+d*d*pairs[i].weight,0)/pairs.reduce((s,p)=>s+p.weight,0));
    const upper=inliers.filter(i=>/Arm$|Elbow$|Wrist$/u.test(pairs[i].key)).length, lower=inliers.length-upper;
    if(inliers.length<Math.max(6,Math.ceil(pairs.length*.7))||upper<2||lower<2||error>.035||totalError>.08) throw new Error('匹配误差较大，请先微调角色姿态或检查参考点');
    const bestAxes=axes(best.p);
    const ambiguous=solutions.some(other=>other.loss<=best.loss+Math.max(1e-7,best.loss*.01)
        &&Math.hypot(...axes(other.p).flatMap((row,i)=>row.map((v,j)=>v-bestAxes[i][j])))>.5);
    if(ambiguous) throw new Error('存在多个接近的匹配视角，请检查姿态或增加可靠参考点');
    const output=makeView(best.p,center,scale,fov,zoom,aspect), matrix=snapshot.view.viewMatrix;
    const baselineError=matrix?.length===16?Math.sqrt(source.reduce((sum,p)=>{
        const w=p.world, x=matrix[0]*w[0]+matrix[4]*w[1]+matrix[8]*w[2]+matrix[12], y=matrix[1]*w[0]+matrix[5]*w[1]+matrix[9]*w[2]+matrix[13], z=-(matrix[2]*w[0]+matrix[6]*w[1]+matrix[10]*w[2]+matrix[14]);
        const point=observation(p); return sum+(focal*x/z-(point.x-.5)*aspect)**2+(-focal*y/z-(point.y-.5))**2;
    },0)/source.length):Infinity;
    return {...output,error,totalError,baselineError,inliers:inliers.length};
}
