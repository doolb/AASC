import { createSkeletonSelection, normalizeSkeletonSize } from './web-skeleton-selection.mjs';
import { createSkeletonCharacterDepth, normalizeSkeletonOccludedOpacity } from './web-skeleton-character-depth.mjs';

// 独立网页骨骼诊断：只读取动作/物理更新后的骨骼，不进入角色场景或 Ammo 世界。
export const SKELETON_COLORS = Object.freeze({ 0: 0xff3333, 2: 0xffd633, 1: 0x33e066, none: 0x9ca3af });
const TYPE_PRIORITY = Object.freeze({ 0: 1, 2: 2, 1: 3 });

/** 使用加载器最终交给物理的刚体参数；骨骼元数据可能仍是 type 转换前的值。 */
export function classifySkeletonBones(mesh) {
    const bones = mesh?.skeleton?.bones || [];
    const types = Array(bones.length).fill('none');
    const bodies = mesh?.geometry?.userData?.MMD?.rigidBodies;
    for (const body of Array.isArray(bodies) ? bodies : []) {
        const index = body?.boneIndex;
        const type = body?.type;
        if (!Number.isInteger(index) || index < 0 || index >= bones.length
            || !Number.isInteger(type) || !Object.hasOwn(TYPE_PRIORITY, type)) continue;
        if (TYPE_PRIORITY[type] > (TYPE_PRIORITY[types[index]] || 0)) types[index] = type;
    }
    return types;
}

/**
 * 用独立场景在角色绘制后叠加实例球，避免影响 AO、阴影、射线和角色包围盒。
 * 所有逐帧临时向量/矩阵复用；关闭开关时不会逐个访问骨骼。
 */
export function createSkeletonOverlay({ THREE, renderer, camera }) {
    const scene = new THREE.Scene();
    scene.name = 'mmd-ar-skeleton-overlay';
    const depthScene = new THREE.Scene();
    // 球面深度预绘不包含文字或选中轴，避免透明混合留下后方球的颜色。
    const ballDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
    const characterDepth = createSkeletonCharacterDepth({ THREE, renderer, camera });
    const selection = createSkeletonSelection({ THREE, renderer, camera, scene });
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const bounds = new THREE.Box3();
    let enabled = false;
    let occlusionEnabled = false;
    let occludedOpacity = 0.5;
    let disposed = false;
    let model = null;
    let types = [];
    let radius = 0.0035;
    let sizeMultiplier = 1;
    let geometry = null;
    let groups = [];
    let generation = 0;
    let releasedGroups = 0;
    let updateCount = 0;
    let drawCount = 0;

    const releaseResources = () => {
        for (const group of groups) {
            scene.remove(group.mesh);
            // InstancedMesh.dispose 释放 renderer 管理的 instanceMatrix/instanceColor 缓冲。
            group.mesh.dispose();
            group.mesh.material.dispose();
            depthScene.remove(group.depthMesh);
            group.depthMesh.dispose();
            releasedGroups += 1;
        }
        groups = [];
        geometry?.dispose();
        geometry = null;
    };

    const setModel = (mesh) => {
        releaseResources();
        model = disposed ? null : mesh;
        characterDepth.setModel(model);
        selection.setModel(model);
        types = classifySkeletonBones(model);
        if (!model) return;
        generation += 1;
        // 只读取本地几何高度，不借助角色世界包围盒，也不修改原几何的 boundingBox。
        const attribute = model.geometry?.getAttribute?.('position');
        const height = attribute ? bounds.setFromBufferAttribute(attribute).getSize(scale).y : 1;
        radius = Number.isFinite(height) && height > 0 ? height * 0.0035 : 0.0035;
    };

    const createResources = () => {
        if (geometry || !types.length) return;
        geometry = new THREE.SphereGeometry(1, 8, 6);
        for (const type of ['none', 0, 2, 1]) {
            const indices = types.flatMap((value, index) => value === type ? [index] : []);
            if (!indices.length) continue;
            const material = new THREE.MeshBasicMaterial({ color: SKELETON_COLORS[type],
                transparent: characterDepth.supported && occludedOpacity < 1,
                depthTest: occlusionEnabled, depthWrite: false, toneMapped: false });
            characterDepth.prepareMaterial(material);
            const mesh = new THREE.InstancedMesh(geometry, material, indices.length);
            mesh.name = `mmd-ar-skeleton-${type}`;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = false;
            scene.add(mesh);
            const depthMesh = new THREE.InstancedMesh(geometry, ballDepthMaterial, indices.length);
            depthMesh.instanceMatrix = mesh.instanceMatrix;
            depthMesh.frustumCulled = false;
            depthScene.add(depthMesh);
            groups.push({ type, indices, mesh, depthMesh });
        }
    };

    const render = (modelVisible = true) => {
        if (disposed || !enabled || !model || !modelVisible || !model.visible || !types.length) {
            selection.hide();
            return false;
        }
        createResources();
        model.updateWorldMatrix(true, true);
        model.getWorldScale(scale);
        const baseWorldRadius = radius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
        const worldRadius = baseWorldRadius * sizeMultiplier;
        for (const group of groups) {
            for (let index = 0; index < group.indices.length; index += 1) {
                position.setFromMatrixPosition(model.skeleton.bones[group.indices[index]].matrixWorld);
                matrix.makeScale(worldRadius, worldRadius, worldRadius).setPosition(position);
                group.mesh.setMatrixAt(index, matrix);
            }
            group.mesh.instanceMatrix.needsUpdate = true;
        }
        selection.update(worldRadius, baseWorldRadius * 16);
        characterDepth.capture();
        updateCount += 1;
        const autoClear = renderer.autoClear;
        try {
            renderer.autoClear = false;
            // 先得到本层最近球面，再混合半透明颜色；预绘不清除已绘角色/碰撞体颜色。
            // 这样球间遮挡与角色遮挡处透明度彼此独立，跨类型和组内实例都正确比较。
            if (occlusionEnabled) {
                renderer.clearDepth();
                renderer.render(depthScene, camera);
            }
            renderer.render(scene, camera);
            drawCount += 1;
        } finally {
            renderer.autoClear = autoClear;
        }
        return true;
    };

    // 诊断快照只在显式查询时生成，测试不需要向 window 暴露 Three 或模型对象。
    const getState = () => ({
        enabled, occlusionEnabled, occludedOpacity, sizeMultiplier, ...characterDepth.getState(),
        ...selection.getState(), boneCount: types.length, generation, releasedGroups, updateCount, drawCount,
        resourceGroups: groups.length,
        counts: Object.fromEntries(['none', 0, 2, 1].map(type => [type, types.filter(value => value === type).length])),
        samples: groups.map(group => {
            group.mesh.getMatrixAt(0, matrix);
            return { type: group.type, color: group.mesh.material.color.getHex(),
                boneIndex: group.indices[0], boneName: model.skeleton.bones[group.indices[0]].name,
                screen: selection.getScreenPoint(group.indices[0]),
                position: position.setFromMatrixPosition(matrix).toArray(),
                bonePosition: model.skeleton.bones[group.indices[0]].getWorldPosition(position).toArray() };
        })
    });

    return Object.freeze({
        setModel, render, getState,
        setOcclusion: value => {
            occlusionEnabled = value === true;
            for (const group of groups) {
                group.mesh.material.depthTest = occlusionEnabled;
            }
            return occlusionEnabled;
        },
        setOccludedOpacity: value => {
            occludedOpacity = normalizeSkeletonOccludedOpacity(value);
            characterDepth.setOpacity(occludedOpacity);
            for (const group of groups) {
                const transparent = characterDepth.supported && occludedOpacity < 1;
                if (group.mesh.material.transparent === transparent) continue;
                group.mesh.material.transparent = transparent;
                group.mesh.material.needsUpdate = true;
            }
            return occludedOpacity;
        },
        setSize: value => { sizeMultiplier = normalizeSkeletonSize(value); return sizeMultiplier; },
        setNamesVisible: selection.setNamesVisible,
        pick: selection.pick, observePhysics: selection.observePhysics,
        clearContacts: selection.clearContacts, getBodyFilter: selection.getBodyFilter, hide: selection.hide,
        setVisible: value => { enabled = value === true; selection.setVisible(enabled); if (!enabled) selection.hide(); },
        dispose: () => { disposed = true; setModel(null); selection.dispose(); characterDepth.dispose(); ballDepthMaterial.dispose(); }
    });
}
