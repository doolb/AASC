import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// 静态GLB沿用现有场景和相机，暂存成功后再提交，失败不释放正在显示的角色。
export async function loadStaticCharacter(context, profile, report = context.onProgress) {
    const { THREE } = context;
    const url = new URL(profile.modelUrl, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith('.glb')) throw new Error('角色地址必须是同源GLB');
    const sequence = ++context.modelSequence;
    context.disposed = false;
    let mesh = null, pivot = null;
    const isCurrent = () => !context.disposed && sequence === context.modelSequence;
    try {
        report?.({ phase: '读取西施模型与材质', percent: 1 });
        const gltf = await new GLTFLoader().loadAsync(url.href, event => {
            if (isCurrent()) report?.({ phase: '下载角色', percent: event.total > 0 ? Math.round(80 * event.loaded / event.total) : 1, indeterminate: !event.total });
        });
        mesh = gltf.scene;
        if (!isCurrent()) { context.disposeObject(mesh); return false; }
        // glTF按米导出；放大到PMX常见尺度，以兼容固定near=1与现有AR比例。
        const bounds = new THREE.Box3().setFromObject(mesh), height = bounds.getSize(new THREE.Vector3()).y;
        if (!Number.isFinite(height) || height <= 0) throw new Error('角色没有有效网格');
        const scale = 20 / height;
        mesh.scale.multiplyScalar(scale); mesh.updateWorldMatrix(true, true);
        const normalized = new THREE.Box3().setFromObject(mesh), center = normalized.getCenter(new THREE.Vector3());
        mesh.position.sub(new THREE.Vector3(center.x, normalized.min.y, center.z));
        pivot = context.createModelRotationPivot(mesh); pivot.visible = false;
        context.scene.add(pivot); pivot.updateWorldMatrix(true, true);
        context.applyShadowFlags(mesh);
        report?.({ phase: '准备角色', percent: 95 });
        if (!isCurrent()) { context.scene.remove(pivot); context.disposeObject(mesh); return false; }
        context.clearFallback(); context.disposeCurrentModel();
        context.currentMesh = mesh; context.currentRotationPivot = pivot; context.currentProfile = profile;
        context.helper.current = null; context.pendingInitialMotionHelper = null; context.currentMotionResourceId = null;
        context.resetModelRotation(); pivot.updateWorldMatrix(true, true);
        context.fitCameraToModel(pivot); context.fitShadowCamera(pivot);
        pivot.visible = true; mesh = null; pivot = null;
        context.onStatus('西施已加载'); context.startRendering(); return true;
    } catch (error) {
        if (pivot) context.scene.remove(pivot);
        if (mesh) context.disposeObject(mesh);
        throw error;
    }
}
