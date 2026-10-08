import { resolveLocalAssetUrl } from './web-local-assets.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// PMX工程保留骨架与物理，按材质名称复用工程GLB的完整PBR材质。
export async function applyPmxProjectMaterials(mesh, profile) {
    if (!profile.materialSourceUrl) return;
    const local = resolveLocalAssetUrl(profile.materialSourceUrl);
    const url = new URL(local || profile.materialSourceUrl, location.href);
    if (!local && (url.origin !== location.origin || !url.pathname.endsWith('.glb'))) throw new Error('PMX工程材质源地址无效');
    const gltf = await new GLTFLoader().loadAsync(url.href);
    const sources = new Map(), geometries = new Set(), oldMaterials = new Set(), used = new Set();
    gltf.scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of [].concat(object.material || [])) sources.set(material.name, material);
    });
    const disposeMaterials = materials => {
        const textures = new Set();
        for (const material of materials) {
            for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
            material.dispose();
        }
        for (const texture of textures) texture.dispose();
    };
    try {
        const changes = [];
        mesh.traverse(object => {
            if (!object.isMesh) return;
            const materials = [].concat(object.material).map(old => {
                const material = sources.get(old.name);
                if (!material) throw new Error(`PMX工程缺少源材质：${old.name}`);
                oldMaterials.add(old); used.add(material);
                return material;
            });
            changes.push([object, Array.isArray(object.material) ? materials : materials[0]]);
        });
        for (const [object, materials] of changes) object.material = materials;
        disposeMaterials(oldMaterials);
        // 使用的材质及纹理由PMX实例负责释放，避免切换角色时保留第二套资源。
        const unused = new Set([...sources.values()].filter(material => !used.has(material)));
        // 未使用材质可能共享纹理，只释放未被当前模型引用的部分。
        const retained = new Set([...used].flatMap(material => Object.values(material).filter(value => value?.isTexture)));
        const discarded = new Set();
        for (const material of unused) {
            for (const value of Object.values(material)) if (value?.isTexture && !retained.has(value)) discarded.add(value);
            material.dispose();
        }
        for (const texture of discarded) texture.dispose();
    } catch (error) {
        disposeMaterials(new Set(sources.values()));
        throw error;
    } finally {
        for (const geometry of geometries) geometry.dispose();
    }
}
