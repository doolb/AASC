import { BufferAttribute, MeshDepthMaterial, MeshDistanceMaterial, RGBADepthPacking } from 'three';

const bindings = new WeakMap(), owners = new WeakMap();
const DECLARATIONS = `
attribute vec2 aascClothUv;
uniform float aascClothEnabled;
uniform sampler2D aascClothPosition;
uniform sampler2D aascClothNormal;
`;
// 同一mesh换VMD时旧/新物理可并存；按当前geometry选择纹理，不能捕获旧后端。
export function bindGpuClothObject(mesh, geometry, binding, uv) {
    geometry.setAttribute('aascClothUv', new BufferAttribute(uv, 2));
    bindings.set(geometry, binding);
    let owner = owners.get(mesh);
    if (!owner) {
        owner = { refs: 0, before: mesh.onBeforeRender, shadow: mesh.onBeforeShadow,
            depth: mesh.customDepthMaterial, distance: mesh.customDistanceMaterial, materials: new Map() };
        if (mesh.isSkinnedMesh) {
            owner.customDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
            owner.customDistance = new MeshDistanceMaterial();
            mesh.customDepthMaterial = owner.customDepth; mesh.customDistanceMaterial = owner.customDistance;
        }
        const prepare = (currentGeometry, material) => {
            const current = bindings.get(currentGeometry);
            let entry = owner.materials.get(material);
            if (!entry) {
                entry = { compile: material.onBeforeCompile, cache: material.customProgramCacheKey,
                    uniforms: { aascClothEnabled: { value: 0 }, aascClothPosition: { value: null }, aascClothNormal: { value: null } } };
                const compile = function(shader, renderer) {
                    entry.compile.call(this, shader, renderer);
                    Object.assign(shader.uniforms, entry.uniforms);
                    shader.vertexShader = DECLARATIONS + shader.vertexShader;
                    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
                        if(aascClothEnabled>0.5){
                            vec4 clothPoint=texture2D(aascClothPosition,aascClothUv);
                            if(clothPoint.w>0.5)transformed=clothPoint.xyz;
                        }
                        #include <project_vertex>`);
                    shader.vertexShader = shader.vertexShader.replace('#include <skinnormal_vertex>', `
                        #include <skinnormal_vertex>
                        if(aascClothEnabled>0.5){
                            vec4 clothNormal=texture2D(aascClothNormal,aascClothUv);
                            if(clothNormal.w>0.5)objectNormal=clothNormal.xyz;
                        }`);
                };
                entry.wrapper = compile; material.onBeforeCompile = compile;
                material.customProgramCacheKey = function() { return entry.cache.call(this) + '|vertex-cloth-gpu-v1'; };
                material.needsUpdate = true; owner.materials.set(material, entry);
            }
            entry.uniforms.aascClothEnabled.value = current?.ready ? 1 : 0;
            entry.uniforms.aascClothPosition.value = current?.target?.texture[0] || null;
            entry.uniforms.aascClothNormal.value = current?.target?.texture[1] || null;
        };
        mesh.onBeforeRender = function(renderer, scene, camera, g, material, group) {
            owner.before.call(this, renderer, scene, camera, g, material, group); prepare(g, material);
        };
        mesh.onBeforeShadow = function(renderer, object, camera, shadowCamera, g, material, group) {
            owner.shadow.call(this, renderer, object, camera, shadowCamera, g, material, group); prepare(g, material);
        };
        owners.set(mesh, owner);
    }
    owner.refs++;
    return () => {
        bindings.delete(geometry); owner.refs--;
        if (owner.refs) return;
        mesh.onBeforeRender = owner.before; mesh.onBeforeShadow = owner.shadow;
        if (mesh.customDepthMaterial === owner.customDepth) mesh.customDepthMaterial = owner.depth;
        if (mesh.customDistanceMaterial === owner.customDistance) mesh.customDistanceMaterial = owner.distance;
        owner.customDepth?.dispose(); owner.customDistance?.dispose();
        for (const [material, entry] of owner.materials) {
            if (material.onBeforeCompile !== entry.wrapper) continue;
            material.onBeforeCompile = entry.compile; material.customProgramCacheKey = entry.cache; material.needsUpdate = true;
        }
        owners.delete(mesh);
    };
}
