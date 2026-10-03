import { Quaternion, Euler, Vector3 } from 'three';
import { common } from './web-xpbd-webgl-shaders.mjs';

// 图着色只在模型建立时执行，同一颜色内的关节不共享可写刚体。
// 直接全锁绑定只查询原静态集合，严格避免把静态标记沿动态子链传播。
export function prepareTopology(bodies, joints) {
    const originalStatic = new Set(bodies.filter(b => !b.dynamic).map(b => b.index));
    const fixed = new Set(originalStatic), bindings = new Map();
    for (const j of joints) {
        const p = j.params;
        if (!p.translationLimitation1.every((x, i) => x === p.translationLimitation2[i])
            || !p.rotationLimitation1.every((x, i) => x === p.rotationLimitation2[i])) continue;
        const sa = originalStatic.has(j.a.index), sb = originalStatic.has(j.b.index);
        if (sa === sb) continue;
        const anchor = sa ? j.a : j.b, body = sa ? j.b : j.a;
        if (fixed.has(body.index)) continue;
        const rotation = j.rotationA.clone().multiply(new Quaternion().setFromEuler(new Euler(...p.rotationLimitation1)))
            .multiply(j.rotationB.clone().invert()).normalize();
        const offset = j.localA.clone().add(new Vector3(...p.translationLimitation1).applyQuaternion(j.rotationA))
            .sub(j.localB.clone().applyQuaternion(rotation));
        if (sb) { rotation.invert(); offset.negate().applyQuaternion(rotation); }
        fixed.add(body.index); bindings.set(body.index, { anchor: anchor.index, rotation, offset });
    }
    const colors = [], jointColors = new Int32Array(joints.length).fill(-1);
    joints.forEach((j, index) => {
        if (fixed.has(j.a.index) && fixed.has(j.b.index)) return;
        let color = colors.findIndex(set => !set.has(j.a.index) && !set.has(j.b.index));
        if (color === -1) { color = colors.length; colors.push(new Set()); }
        colors[color].add(j.a.index); colors[color].add(j.b.index); jointColors[index] = color;
    });
    const map = new Float32Array(Math.max(1, colors.length * bodies.length) * 4).fill(-1);
    joints.forEach((j, index) => { const c = jointColors[index]; if (c < 0) return;
        map[(c * bodies.length + j.a.index) * 4] = index;
        map[(c * bodies.length + j.b.index) * 4] = index;
    });
    const excluded = new Set(joints.map(j => Math.min(j.a.index, j.b.index) * bodies.length + Math.max(j.a.index, j.b.index)));
    const pairs = [], adjacent = bodies.map(() => []);
    for (let a = 0; a < bodies.length; a += 1) for (let b = a + 1; b < bodies.length; b += 1) {
        const x = bodies[a], y = bodies[b];
        if (fixed.has(a) && fixed.has(b) || excluded.has(a * bodies.length + b)) continue;
        if (!(x.params.groupTarget & (1 << y.params.groupIndex)) || !(y.params.groupTarget & (1 << x.params.groupIndex))) continue;
        if (pairs.length >= 32768) throw new Error('允许碰撞对超过32768，使用CPU XPBD');
        const index = pairs.length; pairs.push([a, b]); adjacent[a].push(index); adjacent[b].push(index);
    }
    return { fixed, bindings, map, colors: colors.length, jointColors, pairs, adjacent };
}

// 每个关节使用局部副本顺序求六轴；同色关节写各自结果，再由刚体pass收集。
// lambda的12个槽分别保存硬限位与弹簧乘子，柔度按alpha/h²参与求解。
export const jointShader = common + `
struct Joint{int id;vec3 la;vec3 lb;vec4 ra;vec4 rb;vec3 pl;vec3 ph;vec3 rl;vec3 rh;vec3 pk;vec3 rk;};
Joint joint(int id){Joint j;j.id=id;j.la=fetchData(uJoints,id*12+1).xyz;j.lb=fetchData(uJoints,id*12+2).xyz;
 j.ra=fetchData(uJoints,id*12+3);j.rb=fetchData(uJoints,id*12+4);j.pl=fetchData(uJoints,id*12+5).xyz;j.ph=fetchData(uJoints,id*12+6).xyz;
 j.rl=fetchData(uJoints,id*12+7).xyz;j.rh=fetchData(uJoints,id*12+8).xyz;j.pk=fetchData(uJoints,id*12+9).xyz;j.rk=fetchData(uJoints,id*12+10).xyz;return j;}
float linearFrame(Body a,Body b,Joint j,int i,out vec3 n,out vec3 ga,out vec3 gb){vec3 pa=point(a,j.la),pb=point(b,j.lb);n=qr(qm(a.q,j.ra),axis(i));
 ga=-cross(pb-a.p,n);gb=cross(pb-b.p,n);return dot(pb-pa,n);}
float angularFrame(Body a,Body b,Joint j,int i,out vec3 ga,out vec3 gb){vec4 qa=qm(a.q,j.ra),qb=qm(b.q,j.rb);vec3 e=eulerXYZ(qm(qi(qa),qb));
 vec3 ax=qr(qa,vec3(1,0,0)),ay=qr(qa,vec3(0,cos(e.x),sin(e.x))),az=qr(qa,vec3(sin(e.y),-sin(e.x)*cos(e.y),cos(e.x)*cos(e.y)));
 gb=cross(i==0?ay:i==1?az:ax,i==0?az:i==1?ax:ay)/max(.01,cos(e.y));ga=-gb;return e[i];}
float limitSpeed(float x,float lo,float hi,float speed,float tolerance){if(lo>hi)return 0.0;if(lo==hi)return -speed;
 if(x<=lo+tolerance&&speed<0.0)return max(speed,min(0.0,(lo-x)/uH))-speed;
 if(x>=hi-tolerance&&speed>0.0)return min(speed,max(0.0,(hi-x)/uH))-speed;return 0.0;}
void main(){int idx=pixelIndex(),id=idx/11,f=idx%11;if(id>=uJointCount){outputValue=vec4(0);return;}
 vec4 ids=fetchData(uJoints,id*12);Body a=body(int(ids.x)),b=body(int(ids.y));Joint j=joint(id);
 float lambda[12];for(int i=0;i<12;i++)lambda[i]=0.0;
 if(int(ids.z)==uColor){for(int i=0;i<3;i++){vec3 n,ga,gb;float x;
 if(uMode==0){
 if(j.pk[i]>0.0){x=linearFrame(a,b,j,i,n,ga,gb);lambda[i+6]+=correct(a,b,n,ga,gb,x,1.0/j.pk[i],lambda[i+6]);}
 x=linearFrame(a,b,j,i,n,ga,gb);if(j.pl[i]<=j.ph[i]&&(x<j.pl[i]||x>j.ph[i]||j.pl[i]==j.ph[i]))lambda[i]+=correct(a,b,n,ga,gb,x-clamp(x,j.pl[i],j.ph[i]),0.0,lambda[i]);
 if(j.rk[i]>0.0){x=angularFrame(a,b,j,i,ga,gb);lambda[i+9]+=correct(a,b,vec3(0),ga,gb,x,1.0/j.rk[i],lambda[i+9]);}
 x=angularFrame(a,b,j,i,ga,gb);if(j.rl[i]<=j.rh[i]&&(x<j.rl[i]||x>j.rh[i]||j.rl[i]==j.rh[i]))lambda[i+3]+=correct(a,b,vec3(0),ga,gb,x-clamp(x,j.rl[i],j.rh[i]),0.0,lambda[i+3]);
 }
 if(uMode==1&&j.rl[i]==j.rh[i]){x=angularFrame(a,b,j,i,ga,gb);correct(a,b,vec3(0),ga,gb,x-j.rl[i],0.0,0.0);}
 if(uMode==2){x=linearFrame(a,b,j,i,n,ga,gb);float speed=dot(n,b.v-a.v)+dot(ga,a.w)+dot(gb,b.w);impulse(a,b,n,ga,gb,limitSpeed(x,j.pl[i],j.ph[i],speed,min(a.tol,b.tol)));
 x=angularFrame(a,b,j,i,ga,gb);speed=dot(ga,a.w)+dot(gb,b.w);impulse(a,b,vec3(0),ga,gb,limitSpeed(x,j.rl[i],j.rh[i],speed,1e-4));}
 }}
 if(f<4){outputValue=f==0?vec4(a.p,0):f==1?a.q:f==2?vec4(b.p,0):b.q;return;}
 if(f<7){int k=(f-4)*4;outputValue=vec4(lambda[k],lambda[k+1],lambda[k+2],lambda[k+3]);return;}
 outputValue=f==7?vec4(a.v,0):f==8?vec4(a.w,0):f==9?vec4(b.v,0):vec4(b.w,0);
}`;
export const jointGather = common + `
uniform sampler2D uCorrections;
void main(){int idx=pixelIndex(),id=idx/6,f=idx%6;if(id>=uCount){outputValue=vec4(0);return;}
 int j=int(fetchData(uMap,uColor*uCount+id).x);outputValue=fetchData(uState,idx);if(j<0)return;
 vec4 ids=fetchData(uJoints,j*12);bool first=int(ids.x)==id;
 if(uMode!=2&&f<2)outputValue=fetchData(uCorrections,j*11+(first?0:2)+f);
 if(uMode==2&&f>=2&&f<=3)outputValue=fetchData(uCorrections,j*11+(first?7:9)+f-2);
}`;
