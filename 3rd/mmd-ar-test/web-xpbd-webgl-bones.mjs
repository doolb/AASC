import { Matrix4, Quaternion, Vector3 } from 'three';

// 只处理能精确复现顺序回写的骨架：每骨至多一个写入体、父体先于子体、骨骼本身无缩放。
// 不满足时由外层保持原CPU同步路径；模型根的缩放由两个不同的根矩阵映射，允许非单位模型缩放。
export function inspectDirectBoneTopology(mesh, bodies) {
    const bones = mesh?.skeleton?.bones || [];
    if (!bones.length || bones.length > 1024) return { reason: 'GPU骨骼数不在1–1024范围' };
    const parents = bones.map(bone => bones.indexOf(bone.parent));
    const writer = new Int32Array(bones.length).fill(-1);
    const chains = [];
    for (let i = 0; i < bones.length; i += 1) {
        const chain = [], visited = new Set();
        for (let at = i; at >= 0; at = parents[at]) {
            if (visited.has(at) || chain.length >= 64) return { reason: 'GPU骨骼存在循环或超过64级' };
            visited.add(at); chain.unshift(at);
        }
        chains.push(chain);
        if (bones[i].parent?.isBone && parents[i] < 0) return { reason: '骨骼父节点不在当前骨架中' };
        if (parents[i] < 0 && bones[i].parent !== mesh) return { reason: '骨骼根存在额外非骨骼父节点' };
        if (bones[i].scale.distanceToSquared(new Vector3(1, 1, 1)) > 1e-8) return { reason: '暂不支持缩放骨骼' };
    }
    for (const [index, body] of bodies.entries()) {
        const boneIndex = body.params.boneIndex;
        if (body.params.type === 0 || boneIndex < 0) continue;
        if (writer[boneIndex] >= 0) return { reason: '同一骨骼存在多个物理写入体' };
        writer[boneIndex] = index;
    }
    for (let i = 0; i < bones.length; i += 1) {
        if (writer[i] < 0) continue;
        for (const parent of chains[i].slice(0, -1)) {
            if (writer[parent] > writer[i]) return { reason: '刚体先写子骨后写父骨，不能等价合成' };
        }
    }
    return { parents, chains, writer };
}

const pixel = `
precision highp float;
precision highp int;
precision highp sampler2D;
uniform int uWidth, uBoneCount, uBodyCount, uAnimated, uResetInterpolation;
uniform sampler2D uLocal, uInfo, uChain, uPreviousPalette, uInverseBind, uBind;
uniform sampler2D uOffsets, uBodyBone, uPreviousTargets, uState;
uniform mat4 uPhysicsRoot, uRenderRoot, uPreviousRenderInverse;
out vec4 outputValue;
vec4 data(sampler2D t,int i){ivec2 s=textureSize(t,0);return texelFetch(t,ivec2(i%s.x,i/s.x),0);}
mat4 matrixAt(sampler2D t,int i){return mat4(data(t,i*4),data(t,i*4+1),data(t,i*4+2),data(t,i*4+3));}
vec4 mulQ(vec4 a,vec4 b){return vec4(a.w*b.xyz+b.w*a.xyz+cross(a.xyz,b.xyz),a.w*b.w-dot(a.xyz,b.xyz));}
vec3 rotateQ(vec4 q,vec3 p){return p+2.0*cross(q.xyz,cross(q.xyz,p)+q.w*p);}
vec4 rotation(mat4 m){
 vec3 x=m[0].xyz,y=m[1].xyz,z=m[2].xyz;
 x/=max(length(x),1e-20);y/=max(length(y),1e-20);z/=max(length(z),1e-20);
 float a=x.x,b=y.y,c=z.z,s;
 vec4 q;
 if(a+b+c>0.0){s=sqrt(1.0+a+b+c)*2.0;q=vec4((y.z-z.y)/s,(z.x-x.z)/s,(x.y-y.x)/s,s*.25);}
 else if(a>b && a>c){s=sqrt(1.0+a-b-c)*2.0;q=vec4(s*.25,(y.x+x.y)/s,(z.x+x.z)/s,(y.z-z.y)/s);}
 else if(b>c){s=sqrt(1.0+b-a-c)*2.0;q=vec4((y.x+x.y)/s,s*.25,(y.z+z.y)/s,(z.x-x.z)/s);}
 else{s=sqrt(1.0+c-a-b)*2.0;q=vec4((z.x+x.z)/s,(y.z+z.y)/s,s*.25,(x.y-y.x)/s);}
 return normalize(q);
}
mat4 pose(vec3 p,vec4 q){
 q=normalize(q);vec3 x=q.xyz*2.0;vec3 xx=q.xyz*x, w=x*q.w;
 return mat4(vec4(1.0-xx.y-xx.z,q.x*x.y+w.z,q.x*x.z-w.y,0.0),
             vec4(q.y*x.x-w.z,1.0-xx.x-xx.z,q.y*x.z+w.x,0.0),
             vec4(q.z*x.x+w.y,q.z*x.y-w.x,1.0-xx.x-xx.y,0.0),vec4(p,1.0));
}
// 由上一帧GPU最终骨骼纹理恢复局部P/Q：暂停、无mixer时不能读取已落后的CPU物理骨树。
mat4 previousLocal(int bone,int parent){
 mat4 m=matrixAt(uPreviousPalette,bone)*matrixAt(uBind,bone);
 if(parent>=0) m=inverse(matrixAt(uPreviousPalette,parent)*matrixAt(uBind,parent))*m;
 else m=uPreviousRenderInverse*m;
 return m;
}
mat4 sourceLocal(int bone,int parent,int writing){
 if(uAnimated==0 && writing>0){return previousLocal(bone,parent);}
 return pose(data(uLocal,bone*2).xyz,data(uLocal,bone*2+1));
}
mat4 bodyPose(int body){return pose(data(uState,body*6).xyz,data(uState,body*6+1));}
// 同步基准在父体先更新的拓扑下，type1同时写world位置与旋转，type2只写旋转。
// 未运行物理的锚点要保留上一帧GPU写入骨的局部姿态，其他骨取本帧CPU动作/IK。
mat4 worldBone(int bone,bool solved){
 mat4 world=uPhysicsRoot;
 vec4 info=data(uInfo,bone);
 for(int step=0;step<64;step++){
  if(step>=int(info.w+.5))break;
  int current=int(data(uChain,bone*64+step).x+.5);
  vec4 meta=data(uInfo,current);int parent=int(meta.x),body=int(meta.y)-1;
  mat4 local=sourceLocal(current,parent,int(meta.y));
  world=world*local;
  if(solved && body>=0){
   mat4 boundBody=bodyPose(body)*pose(data(uOffsets,body*4).xyz,data(uOffsets,body*4+1));
   if(int(meta.z)==1){world=boundBody;}
   else if(int(meta.z)==2){world=pose(world[3].xyz,rotation(boundBody));}
  }
 }
 return world;
}
`;

export const bonePaletteShader = pixel + `
void main(){int i=int(gl_FragCoord.x)+int(gl_FragCoord.y)*uWidth,bone=i/4;
 if(bone>=uBoneCount){outputValue=vec4(0);return;}
 mat4 finalBone=uRenderRoot*inverse(uPhysicsRoot)*worldBone(bone,true)*matrixAt(uInverseBind,bone);
 outputValue=finalBone[i%4];
}`;

export const boneTargetShader = pixel + `
void main(){int i=int(gl_FragCoord.x)+int(gl_FragCoord.y)*uWidth,body=i/4,col=i%4;
 if(body>=uBodyCount){outputValue=vec4(0);return;}
 vec3 currentP=data(uPreviousTargets,body*4+2).xyz;
 vec4 currentQ=data(uPreviousTargets,body*4+3);
 int bone=int(data(uBodyBone,body).x);
 if(bone>=0){
  mat4 world=worldBone(bone,false);
  vec4 offsetP=data(uOffsets,body*4+2),offsetQ=data(uOffsets,body*4+3);
  vec4 boneQ=rotation(world);
  currentP=world[3].xyz+rotateQ(boneQ,offsetP.xyz);
  currentQ=normalize(mulQ(boneQ,offsetQ));
 } else if(int(data(uBodyBone,body).y)==0){
  currentP=data(uOffsets,body*4+2).xyz;currentQ=data(uOffsets,body*4+3);
 }
 if(col==0) outputValue=vec4(uResetInterpolation!=0?currentP:data(uPreviousTargets,body*4+2).xyz,0.0);
 if(col==1) outputValue=uResetInterpolation!=0?currentQ:data(uPreviousTargets,body*4+3);
 if(col==2) outputValue=vec4(currentP,0.0);
 if(col==3) outputValue=currentQ;
}`;

// 源和目标都属于求解器的gpu state，由它统一计入64MiB预算、编译、销毁。
export function createGpuBonePalette(gpu, mesh, bodies) {
    const topology = inspectDirectBoneTopology(mesh, bodies);
    if (topology.reason) return { reason: topology.reason };
    const { bones, boneInverses } = mesh.skeleton;
    const count = bones.length, n = bodies.length;
    const local = gpu.data(new Float32Array(count * 8));
    const meta = new Float32Array(count * 4), chain = new Float32Array(count * 64 * 4);
    const inverse = new Float32Array(count * 16), bind = new Float32Array(count * 16);
    const offsets = new Float32Array(Math.max(1, n) * 16), bodyBone = new Float32Array(Math.max(1, n) * 4);
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
    for (let i = 0; i < count; i += 1) {
        const body = topology.writer[i];
        meta.set([topology.parents[i], body + 1, body < 0 ? 0 : bodies[body].params.type, topology.chains[i].length], i * 4);
        for (let k = 0; k < topology.chains[i].length; k += 1) chain[(i * 64 + k) * 4] = topology.chains[i][k];
        boneInverses[i].toArray(inverse, i * 16);
        boneInverses[i].clone().invert().toArray(bind, i * 16);
    }
    for (let i = 0; i < n; i += 1) {
        const body = bodies[i];
        body.inverseOffset.decompose(position, rotation, scale);
        offsets.set(position.toArray(), i * 16); offsets.set(rotation.toArray(), i * 16 + 4);
        body.offset.decompose(position, rotation, scale);
        offsets.set(position.toArray(), i * 16 + 8); offsets.set(rotation.toArray(), i * 16 + 12);
        bodyBone[i * 4] = body.params.boneIndex; bodyBone[i * 4 + 1] = body.params.type;
    }
    const info = gpu.data(meta), paths = gpu.data(chain), inv = gpu.data(inverse), rest = gpu.data(bind);
    const rigidOffsets = gpu.data(offsets), rigidBones = gpu.data(bodyBone);
    const size = Math.max(4, Math.ceil(Math.sqrt(count * 4) / 4) * 4);
    if (size > gpu.gl.getParameter(gpu.gl.MAX_TEXTURE_SIZE)) return { reason: 'GPU骨骼纹理超出设备纹理大小' };
    const palette = [gpu.target(size * size), gpu.target(size * size)];
    const targets = [gpu.target(n * 4), gpu.target(n * 4)];
    const initialTargets = gpu.data(new Float32Array(Math.max(1, n) * 16));
    const paletteMaterial = gpu.material(bonePaletteShader), targetMaterial = gpu.material(boneTargetShader);
    const initialPalette = gpu.material(`precision highp float;precision highp int;precision highp sampler2D;
        uniform int uWidth;uniform sampler2D uState;uniform mat4 uRootCorrection;out vec4 outputValue;
        vec4 readAt(int i){ivec2 d=textureSize(uState,0);return texelFetch(uState,ivec2(i%d.x,i/d.x),0);}
        void main(){int i=int(gl_FragCoord.x)+int(gl_FragCoord.y)*uWidth;
        mat4 m=mat4(readAt((i/4)*4),readAt((i/4)*4+1),readAt((i/4)*4+2),readAt((i/4)*4+3));
        mat4 transformed=uRootCorrection*m;outputValue=transformed[i%4];}`);
    let slot = 0, ready = false, targetReady = false, resetInterpolation = false;
    const previousRenderInverse = new Matrix4(), rootCorrection = new Matrix4(), inverseRoot = new Matrix4();
    const originalTexture = mesh.skeleton.boneTexture || (mesh.skeleton.computeBoneTexture(), mesh.skeleton.boneTexture);
    const detach = () => { if (mesh.skeleton.boneTexture !== originalTexture) mesh.skeleton.boneTexture = originalTexture; };
    const invalidate = () => { detach(); ready = false; targetReady = false; resetInterpolation = false; };
    const writeLocals = () => {
        for (let i = 0; i < count; i += 1) {
            const bone = bones[i], at = i * 8;
            if (bone.scale.distanceToSquared(scale.set(1, 1, 1)) > 1e-8) throw new Error('动画缩放骨骼不支持GPU直连');
            local.image.data.set(bone.position.toArray(), at);
            local.image.data.set(bone.quaternion.toArray(), at + 4);
        }
        local.needsUpdate = true;
    };
    const common = (physicsRoot, renderRoot, state, animated, uniforms = {}) => ({
        uBoneCount: count, uBodyCount: n, uAnimated: animated ? 1 : 0,
        uPhysicsRoot: physicsRoot, uRenderRoot: renderRoot, uPreviousRenderInverse: previousRenderInverse,
        uLocal: local, uInfo: info, uChain: paths, uPreviousPalette: palette[slot].texture,
        uInverseBind: inv, uBind: rest, uOffsets: rigidOffsets, uBodyBone: rigidBones,
        uState: state, ...uniforms
    });
    const initialize = (physicsRoot, renderRoot) => {
        if (ready) return;
        detach();
        mesh.updateMatrixWorld(true); mesh.skeleton.update();
        rootCorrection.copy(renderRoot).multiply(inverseRoot.copy(physicsRoot).invert());
        gpu.draw(initialPalette, palette[slot], { uState: originalTexture, uRootCorrection: rootCorrection });
        previousRenderInverse.copy(renderRoot).invert(); ready = true;
        const data = initialTargets.image.data;
        for (let i = 0; i < n; i += 1) {
            for (let at = 0; at < 4; at += 1) {
                const source = [bodies[i].targetPosition, bodies[i].targetQuaternion,
                    bodies[i].targetPosition, bodies[i].targetQuaternion][at];
                data.set(source.toArray(), i * 16 + at * 4);
            }
        }
        initialTargets.needsUpdate = true; targetReady = false;
    };
    const prepareTargets = (physicsRoot, renderRoot, state, animated) => {
        initialize(physicsRoot, renderRoot);
        writeLocals();
        const next = 1 - slot;
        gpu.draw(targetMaterial, targets[next], common(physicsRoot, renderRoot, state, animated, {
            uPreviousTargets: targetReady ? targets[slot].texture : initialTargets,
            uResetInterpolation: resetInterpolation ? 1 : 0
        }));
        resetInterpolation = false; targetReady = true;
        return targets[next].texture;
    };
    const finish = (physicsRoot, renderRoot, state, animated) => {
        const next = 1 - slot;
        gpu.draw(paletteMaterial, palette[next], common(physicsRoot, renderRoot, state, animated));
        previousRenderInverse.copy(renderRoot).invert();
        slot = next;
        mesh.skeleton.boneTexture = palette[slot].texture;
    };
    return { reason: '', prepareTargets, finish, invalidate, detach,
        resetInterpolation: () => { resetInterpolation = true; }, get active() { return mesh.skeleton.boneTexture !== originalTexture; },
        get texture() { return palette[slot].texture; }, get target() { return palette[slot]; } };
}
