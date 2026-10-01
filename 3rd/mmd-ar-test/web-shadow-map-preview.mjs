/** 释放并置空两类阴影目标；Three r160仅在map为null时按新尺寸重新创建。 */
export function releaseShadowTargets(shadow) {
    const targets = new Set([shadow.map, shadow.mapPass]);
    shadow.map = null;
    shadow.mapPass = null;
    for (const target of targets) target?.dispose();
}

/**
 * 将方向光正交投影的世界网格对齐ShadowMap像素；不移动光或目标，光照方向保持。
 * 每次先还原等宽高的居中边界，再从固定世界原点计算补偿，偏移不超过半个像素。
 * 若沿用上一帧已偏移的边界，连续小位移会累计抵消相机跟随，因而必须从基准重算。
 * 向量在创建时分配一次；更新真实Three阴影矩阵，使后续阴影裁剪与投影保持一致。
 */
export function createShadowCameraAlignment(THREE) {
    const origin = new THREE.Vector3();
    return (light) => {
        const shadow = light.shadow;
        const camera = shadow.camera;
        const width = shadow.map?.width || shadow.mapSize.x;
        const height = shadow.map?.height || shadow.mapSize.y;
        const spanX = camera.right - camera.left;
        const spanY = camera.top - camera.bottom;
        if (![width, height, spanX, spanY].every(value => Number.isFinite(value) && value > 0)) return false;
        camera.left = -spanX / 2; camera.right = spanX / 2;
        camera.bottom = -spanY / 2; camera.top = spanY / 2;
        camera.updateProjectionMatrix();
        light.updateWorldMatrix(true, false);
        light.target.updateWorldMatrix(true, false);
        shadow.updateMatrices(light);
        origin.set(0, 0, 0).project(camera);
        const pixelX = (origin.x * 0.5 + 0.5) * width;
        const pixelY = (origin.y * 0.5 + 0.5) * height;
        const offsetX = -(Math.round(pixelX) - pixelX) * spanX / width;
        const offsetY = -(Math.round(pixelY) - pixelY) * spanY / height;
        camera.left += offsetX; camera.right += offsetX;
        camera.bottom += offsetY; camera.top += offsetY;
        camera.updateProjectionMatrix();
        shadow.updateMatrices(light);
        shadow.needsUpdate = true;
        return true;
    };
}

/** GPU读回按左下起点，canvas按左上起点；G通道保留占用掩码，避免灰度量化漏算。 */
export function copyShadowPreviewPixels(source, destination, width, height) {
    let occupied = 0;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const from = (y * width + x) * 4;
            const to = ((height - 1 - y) * width + x) * 4;
            const shade = source[from];
            destination[to] = shade;
            destination[to + 1] = shade;
            destination[to + 2] = shade;
            destination[to + 3] = 255;
            if (source[from + 1] > 127) occupied += 1;
        }
    }
    return occupied / (width * height);
}

/** 仅诊断当前真实ShadowMap，不再渲染角色、不改变其阴影相机或贴图。 */
export function createShadowMapPreview({ THREE, renderer, lights, getStatus, root = window }) {
    const side = 256;
    const pixels = new Uint8Array(side * side * 4);
    const viewport = new THREE.Vector4();
    const scissor = new THREE.Vector4();
    let enabled = false;
    let disposed = false;
    let lastUpdate = -Infinity;
    let resources = null;
    let reads = 0;
    let errorMessage = '';
    let rows = [];
    const names = ['主光', '补光'];
    const release = () => {
        if (!resources) return;
        resources.target.dispose();
        resources.material.dispose();
        resources.geometry.dispose();
        resources = null;
    };
    const getRows = () => ['Key', 'Fill'].map(name => {
        const canvas = root.document.getElementById(`mmdArShadowMap${name}Canvas`);
        const status = root.document.getElementById(`mmdArShadowMap${name}Status`);
        const context = canvas?.getContext('2d');
        return { canvas, status, context, image: context?.createImageData(side, side) };
    });
    const allocate = () => {
        if (resources) return resources;
        const target = new THREE.WebGLRenderTarget(side, side, {
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
            depthBuffer: false, stencilBuffer: false
        });
        const material = new THREE.ShaderMaterial({
            uniforms: { shadowTexture: { value: null } },
            vertexShader: 'varying vec2 mapUv; void main(){ mapUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: `#include <packing>
                uniform sampler2D shadowTexture;
                varying vec2 mapUv;
                void main() {
                    float depth = unpackRGBAToDepth(texture2D(shadowTexture, mapUv));
                    float occupied = depth < 0.99999 ? 1.0 : 0.0;
                    // 角色深度放到灰度R；独立G掩码供CPU统计，白背景始终完整保留。
                    gl_FragColor = vec4(mix(1.0, depth * 0.8, occupied), occupied, 0.0, 1.0);
                }`,
            depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false
        });
        const geometry = new THREE.PlaneGeometry(2, 2);
        const scene = new THREE.Scene();
        scene.add(new THREE.Mesh(geometry, material));
        resources = { target, material, geometry, scene, camera: new THREE.Camera() };
        return resources;
    };
    const clearRow = (row, index, message) => {
        row.context.clearRect(0, 0, side, side);
        row.status.textContent = `${names[index]}：${message}`;
    };
    const update = (now) => {
        if (!enabled || disposed || now - lastUpdate < 250) return false;
        const container = root.document.getElementById('mmdArShadowMapPreviewRows');
        if (!container || container.hidden || container.getClientRects().length === 0) return false;
        const bounds = container.getBoundingClientRect();
        if (bounds.bottom <= 0 || bounds.top >= root.innerHeight) return false;
        if (!rows.length) rows = getRows();
        if (rows.some(row => !row.canvas || !row.status || !row.context)) return false;
        lastUpdate = now;
        const saved = { target: renderer.getRenderTarget(), cubeFace: renderer.getActiveCubeFace(),
            mipLevel: renderer.getActiveMipmapLevel(), autoClear: renderer.autoClear,
            scissorTest: renderer.getScissorTest(), shadowEnabled: renderer.shadowMap.enabled };
        renderer.getViewport(viewport);
        renderer.getScissor(scissor);
        try {
            renderer.autoClear = true;
            renderer.setScissorTest(false);
            // 预览场景没有光，也无需重新推进主场景阴影；恢复时沿用原启用值。
            renderer.shadowMap.enabled = false;
            for (let index = 0; index < lights.length; index += 1) {
                const light = lights[index];
                const row = rows[index];
                const status = getStatus(index, saved.shadowEnabled);
                if (!saved.shadowEnabled || status || !light.castShadow || !light.shadow.map) {
                    clearRow(row, index, status || '等待阴影贴图');
                    continue;
                }
                const { target, material, scene, camera } = allocate();
                const map = light.shadow.map;
                material.uniforms.shadowTexture.value = map.texture;
                renderer.setRenderTarget(target);
                renderer.render(scene, camera);
                renderer.readRenderTargetPixels(target, 0, 0, side, side, pixels);
                reads += 1;
                const coverage = copyShadowPreviewPixels(pixels, row.image.data, side, side);
                row.context.putImageData(row.image, 0, 0);
                row.status.textContent = `${names[index]}：${map.width} × ${map.height} · 角色像素覆盖约 ${(coverage * 100).toFixed(1)}%`;
            }
            errorMessage = '';
            return true;
        } catch (error) {
            errorMessage = error?.message || String(error);
            for (let index = 0; index < rows.length; index += 1) clearRow(rows[index], index, '预览不可用');
            return false;
        } finally {
            renderer.shadowMap.enabled = saved.shadowEnabled;
            renderer.autoClear = saved.autoClear;
            renderer.setRenderTarget(saved.target, saved.cubeFace, saved.mipLevel);
            renderer.setViewport(viewport);
            renderer.setScissor(scissor);
            renderer.setScissorTest(saved.scissorTest);
        }
    };
    return {
        setEnabled(value) {
            const next = value === true && !disposed;
            if (next === enabled) return;
            enabled = next;
            lastUpdate = -Infinity;
            if (!enabled) { release(); rows = []; }
        },
        update,
        getState: () => ({ enabled, allocated: resources !== null, reads, error: errorMessage }),
        dispose() { disposed = true; enabled = false; release(); rows = []; }
    };
}
