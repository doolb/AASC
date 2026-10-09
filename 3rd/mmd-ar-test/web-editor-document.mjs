// 工程覆盖与渲染网格分开保存，切换物理/重新加载不会丢失编辑。
const documents = new Map();
export const clone = value => JSON.parse(JSON.stringify(value));
export function validateDocument(value, boneCount) {
    if (!value || !Array.isArray(value.rigidBodies) || !Array.isArray(value.constraints)) throw new Error('工程缺少物理数据');
    if (value.rigidBodies.length > 20000 || value.constraints.length > 40000) throw new Error('物理对象数量超出编辑上限');
    const vector = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6);
    const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
    for (const b of value.rigidBodies) {
        if (![0,1,2].includes(b.type) || ![0,1,2].includes(b.shapeType) || !integer(b.boneIndex,-1,boneCount-1)
            || !integer(b.groupIndex,0,15) || !integer(b.groupTarget,0,65535) || !vector(b.position) || !vector(b.rotation)) throw new Error('刚体类型、引用或坐标无效');
        for (const key of ['width','height','depth','weight','positionDamping','rotationDamping','restitution','friction']) {
            if (!Number.isFinite(b[key]) || b[key]<0 || b[key]>1e6) throw new Error('刚体参数无效：'+key);
        }
        if (!(b.width>0) || (b.shapeType===1 && !(b.height>0 && b.depth>0))) throw new Error('刚体尺寸必须大于0');
        if (b.positionDamping>1 || b.rotationDamping>1 || b.restitution>1) throw new Error('阻尼和恢复系数范围为0～1');
    }
    for (const j of value.constraints) {
        if (!integer(j.rigidBodyIndex1,0,value.rigidBodies.length-1) || !integer(j.rigidBodyIndex2,0,value.rigidBodies.length-1)
            || j.rigidBodyIndex1===j.rigidBodyIndex2) throw new Error('关节必须连接两个不同刚体');
        for (const key of ['position','rotation','translationLimitation1','translationLimitation2','rotationLimitation1','rotationLimitation2','springPosition','springRotation']) if (!vector(j[key])) throw new Error('关节参数无效：'+key);
        if ([...j.springPosition,...j.springRotation].some(n=>n<0)) throw new Error('弹簧刚度不能为负');
    }
    return value;
}
export function putDocument(key, document) { documents.set(key, clone(document)); }
// 来源与加载器处理后的基线随工程保存；复制对象必须取消来源，防止共用同一文件记录。
export function markPmxEditorSources(data) {
    for (const key of ['rigidBodies','constraints']) data[key]?.forEach((item,index)=>{
        const baseline=clone(item);delete baseline._pmxSource;delete baseline._pmxSourceIndex;
        item._pmxSourceIndex=index;item._pmxSource=baseline;
    });
}
export function stageEditorDocument(mesh, profile) {
    if(mesh.geometry?.userData?.MMD)markPmxEditorSources(mesh.geometry.userData.MMD);
    const saved = documents.get(profile.modelUrl);
    if (!saved) return;
    validateDocument(saved,mesh.skeleton.bones.length);
    Object.assign(mesh.geometry.userData.MMD, { rigidBodies: clone(saved.rigidBodies), constraints: clone(saved.constraints) });
}
export function createHistory(initial, onChange) {
    let value=clone(initial), undo=[], redo=[];
    const set=next=>{value=clone(next);onChange(clone(value));};
    return { get:()=>clone(value), canUndo:()=>undo.length>0, canRedo:()=>redo.length>0,
        commit(next){if(JSON.stringify(next)===JSON.stringify(value))return;undo.push(value);if(undo.length>100)undo.shift();redo=[];set(next);},
        undo(){if(undo.length){redo.push(value);set(undo.pop());}},redo(){if(redo.length){undo.push(value);set(redo.pop());}} };
}
export function boneOrigins(mesh, THREE) {
    return mesh.skeleton.boneInverses.map(matrix=>new THREE.Vector3().setFromMatrixPosition(matrix.clone().invert()).toArray());
}
