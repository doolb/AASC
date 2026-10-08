/** 释放并置空两类阴影目标；Three r160仅在map为null时按新尺寸重新创建。 */
export function releaseShadowTargets(shadow) {
    const targets = new Set([shadow.map, shadow.mapPass]);
    shadow.map = null;
    shadow.mapPass = null;
    for (const target of targets) target?.dispose();
}

/**
 * 将方向光正交投影的世界网格对齐ShadowMap像素；不移动光或目标，光照方向保持。
 * 保留拟合所得正交范围中心与宽高，再从固定世界原点计算补偿，偏移不超过半个像素。
 * 若沿用上一帧已偏移的边界，连续小位移会累计抵消相机跟随，因而必须从拟合中心重算。
 * 向量在创建时分配一次；更新真实Three阴影矩阵，使后续阴影裁剪与投影保持一致。
 */
export function createShadowCameraAlignment(THREE) {
    const origin = new THREE.Vector3();
    const alignmentStates = new WeakMap();
    return (light) => {
        const shadow = light.shadow;
        const camera = shadow.camera;
        const width = shadow.map?.width || shadow.mapSize.x;
        const height = shadow.map?.height || shadow.mapSize.y;
        const spanX = camera.right - camera.left;
        const spanY = camera.top - camera.bottom;
        if (![width, height, spanX, spanY].every(value => Number.isFinite(value) && value > 0)) return false;
        const previous = alignmentStates.get(light);
        if (previous && [camera.left, camera.right, camera.bottom, camera.top].every((value, index) =>
            Math.abs(value - previous.edges[index]) <= 1e-12 * Math.max(1, Math.abs(value)))) {
            camera.left -= previous.offsetX; camera.right -= previous.offsetX;
            camera.bottom -= previous.offsetY; camera.top -= previous.offsetY;
        }
        const centerX = (camera.left + camera.right) * 0.5;
        const centerY = (camera.bottom + camera.top) * 0.5;
        camera.left = centerX - spanX / 2; camera.right = centerX + spanX / 2;
        camera.bottom = centerY - spanY / 2; camera.top = centerY + spanY / 2;
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
        alignmentStates.set(light, { edges: [camera.left, camera.right, camera.bottom, camera.top], offsetX, offsetY });
        return true;
    };
}

const SHADOW_FIT_EPSILON = 1e-8;

function getBoxCorners(THREE, bounds) {
    const { min, max } = bounds;
    return [
        new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(max.x, min.y, min.z),
        new THREE.Vector3(min.x, max.y, min.z), new THREE.Vector3(max.x, max.y, min.z),
        new THREE.Vector3(min.x, min.y, max.z), new THREE.Vector3(max.x, min.y, max.z),
        new THREE.Vector3(min.x, max.y, max.z), new THREE.Vector3(max.x, max.y, max.z)
    ];
}

function addUniquePoint(points, point) {
    if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) return;
    if (points.some(existing => existing.distanceToSquared(point) <= 1e-14)) return;
    points.push(point.clone());
}

function clipSegmentByPlanes(THREE, start, end, planes) {
    let minimum = 0, maximum = 1;
    for (const plane of planes) {
        const startDistance = plane.distanceToPoint(start);
        const endDistance = plane.distanceToPoint(end);
        if (startDistance < -SHADOW_FIT_EPSILON && endDistance < -SHADOW_FIT_EPSILON) return null;
        if ((startDistance < -SHADOW_FIT_EPSILON) === (endDistance < -SHADOW_FIT_EPSILON)) continue;
        const amount = startDistance / (startDistance - endDistance);
        if (startDistance < 0) minimum = Math.max(minimum, amount);
        else maximum = Math.min(maximum, amount);
        if (minimum > maximum) return null;
    }
    return [start.clone().lerp(end, minimum), start.clone().lerp(end, maximum)];
}

function clipSegmentByBox(THREE, start, end, bounds) {
    let minimum = 0, maximum = 1;
    for (const axis of ['x', 'y', 'z']) {
        const delta = end[axis] - start[axis];
        if (Math.abs(delta) <= SHADOW_FIT_EPSILON) {
            if (start[axis] < bounds.min[axis] || start[axis] > bounds.max[axis]) return null;
            continue;
        }
        let first = (bounds.min[axis] - start[axis]) / delta;
        let last = (bounds.max[axis] - start[axis]) / delta;
        if (first > last) [first, last] = [last, first];
        minimum = Math.max(minimum, first);
        maximum = Math.min(maximum, last);
        if (minimum > maximum) return null;
    }
    return [start.clone().lerp(end, minimum), start.clone().lerp(end, maximum)];
}

function createCameraFrustum(THREE, camera) {
    camera.updateMatrixWorld(true);
    const projectionView = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView);
    const corners = [];
    for (const depth of [-1, 1]) {
        for (const y of [-1, 1]) {
            for (const x of [-1, 1]) corners.push(new THREE.Vector3(x, y, depth).unproject(camera));
        }
    }
    return { frustum, corners };
}

/** 返回主相机视锥与一个世界空间AABB的交集顶点，供各方向光分别投影。 */
export function getCameraBoxIntersectionPoints(THREE, camera, bounds, preparedFrustum = null) {
    if (!bounds || bounds.isEmpty()) return [];
    const { frustum, corners: frustumCorners } = preparedFrustum || createCameraFrustum(THREE, camera);
    if (!frustum.intersectsBox(bounds)) return [];
    const boxCorners = getBoxCorners(THREE, bounds);
    const points = [];
    for (const corner of boxCorners) if (frustum.containsPoint(corner)) addUniquePoint(points, corner);
    for (const corner of frustumCorners) if (bounds.containsPoint(corner)) addUniquePoint(points, corner);

    // 两个凸体的交点只能是双方顶点或一方棱边穿过另一方表面形成的点。
    for (const corners of [boxCorners, frustumCorners]) {
        const againstFrustum = corners === boxCorners;
        for (let index = 0; index < 8; index += 1) {
            for (const bit of [1, 2, 4]) {
                if (index & bit) continue;
                const clipped = againstFrustum
                    ? clipSegmentByPlanes(THREE, corners[index], corners[index | bit], frustum.planes)
                    : clipSegmentByBox(THREE, corners[index], corners[index | bit], bounds);
                if (clipped) for (const point of clipped) addUniquePoint(points, point);
            }
        }
    }
    return points;
}

function convexGroundHull(points) {
    const sorted = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
    const unique = [];
    for (const point of sorted) {
        if (!unique.some(value => Math.hypot(value.x - point.x, value.z - point.z) <= 1e-8)) unique.push(point);
    }
    if (unique.length <= 2) return unique;
    const cross = (origin, a, b) => (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
    const lower = [], upper = [];
    for (const point of unique) {
        while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 1e-12) lower.pop();
        lower.push(point);
    }
    for (const point of unique.slice().reverse()) {
        while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 1e-12) upper.pop();
        upper.push(point);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function clipPolygonByDistance(points, distanceToPoint) {
    if (points.length < 2) return points;
    const clipped = [];
    for (let index = 0; index < points.length; index += 1) {
        const start = points[index], end = points[(index + 1) % points.length];
        const startDistance = distanceToPoint(start), endDistance = distanceToPoint(end);
        const startInside = startDistance >= -SHADOW_FIT_EPSILON;
        const endInside = endDistance >= -SHADOW_FIT_EPSILON;
        if (startInside) clipped.push(start);
        if (startInside !== endInside) {
            const amount = startDistance / (startDistance - endDistance);
            clipped.push(start.clone().lerp(end, amount));
        }
    }
    return clipped;
}

function getVisibleGroundShadowFootprint(THREE, casterBounds, receiverBounds, frustum, lightDirection) {
    if (Math.abs(lightDirection.y) <= 1e-5) return [];
    const planeY = (receiverBounds.min.y + receiverBounds.max.y) * 0.5;
    const projected = [];
    for (const corner of getBoxCorners(THREE, casterBounds)) {
        const amount = (planeY - corner.y) / lightDirection.y;
        if (!Number.isFinite(amount) || amount < 0) continue;
        projected.push(corner.clone().addScaledVector(lightDirection, amount));
    }
    let polygon = convexGroundHull(projected);
    for (const plane of frustum.planes) {
        polygon = clipPolygonByDistance(polygon, point => plane.distanceToPoint(point));
        if (!polygon.length) return [];
    }
    for (const distance of [
        point => point.x - receiverBounds.min.x,
        point => receiverBounds.max.x - point.x,
        point => point.z - receiverBounds.min.z,
        point => receiverBounds.max.z - point.z
    ]) {
        polygon = clipPolygonByDistance(polygon, distance);
        if (!polygon.length) return [];
    }
    return polygon;
}

/**
 * 仅用于独立MMD-AR测试副本：把主相机可见区域和方向光投影统一拟合到光空间。
 * 模型包围盒只在换根时读取；相机连续运动只重算少量视锥交点，不遍历网格。
 */
export function createJointShadowCameraFitter({
    THREE, camera, lights, getRoot, getModelBounds, receiver, getCameraScale,
    targetModelHeight = 1.75, targetOccupancy = 0.78
}) {
    const cached = { root: null, bounds: null, baseMatrix: null, inverseBaseMatrix: null };
    let lastSignature = null;
    let fitCount = 0;
    let lastMaps = [];
    let lastFallback = false;
    const readSignature = (root, cameraScale) => {
        const values = [cameraScale, ...camera.matrixWorld.elements, ...camera.projectionMatrix.elements,
            ...root.matrixWorld.elements, ...receiver.matrixWorld.elements];
        for (const light of lights) {
            const shadowCamera = light.shadow.camera;
            values.push(light.position.x, light.position.y, light.position.z,
                light.target.position.x, light.target.position.y, light.target.position.z,
                shadowCamera.right - shadowCamera.left, shadowCamera.top - shadowCamera.bottom,
                shadowCamera.near, shadowCamera.far);
        }
        return values;
    };
    const signatureChanged = values => !lastSignature || values.length !== lastSignature.length
        || values.some((value, index) => Math.abs(value - lastSignature[index]) > 1e-8 * Math.max(1, Math.abs(value)));
    const getCurrentModelBounds = root => {
        if (cached.root !== root) {
            cached.root = root;
            cached.bounds = getModelBounds(root).clone();
            cached.baseMatrix = root.matrixWorld.clone();
            cached.inverseBaseMatrix = cached.baseMatrix.clone().invert();
        }
        const delta = new THREE.Matrix4().multiplyMatrices(root.matrixWorld, cached.inverseBaseMatrix);
        return cached.bounds.clone().applyMatrix4(delta);
    };
    const setFallbackRange = (light, center, radius, cameraScale) => {
        const extent = Math.max(0.02, radius * 1.18 * 0.5 * cameraScale);
        const shadowCamera = light.shadow.camera;
        shadowCamera.left = -extent; shadowCamera.right = extent;
        shadowCamera.bottom = -extent; shadowCamera.top = extent;
        const distance = light.position.distanceTo(center);
        shadowCamera.near = Math.max(0.1, distance - radius * 2.2);
        shadowCamera.far = Math.max(shadowCamera.near + 1, distance + radius * 2.2);
        shadowCamera.updateProjectionMatrix();
        light.shadow.needsUpdate = true;
    };
    const update = (force = false) => {
        const root = getRoot();
        if (!root?.isObject3D || !receiver?.isObject3D) return false;
        camera.updateMatrixWorld(true);
        root.updateWorldMatrix(true, false);
        receiver.updateWorldMatrix(true, false);
        for (const light of lights) {
            light.updateWorldMatrix(true, false);
            light.target.updateWorldMatrix(true, false);
            light.shadow.updateMatrices(light);
        }
        const requestedScale = Number(getCameraScale());
        const cameraScale = Number.isFinite(requestedScale) ? Math.min(2, Math.max(0.1, requestedScale)) : 1;
        const signature = readSignature(root, cameraScale);
        if (!force && !signatureChanged(signature)) return false;

        const modelBounds = getCurrentModelBounds(root);
        const size = modelBounds.getSize(new THREE.Vector3());
        const center = modelBounds.getCenter(new THREE.Vector3());
        const radius = Math.max(targetModelHeight * 0.65, size.length() * 0.5);
        const receiverBounds = new THREE.Box3().setFromObject(receiver);
        receiverBounds.expandByScalar(Math.max(1e-5, size.y * 1e-5));
        const preparedFrustum = createCameraFrustum(THREE, camera);
        const visibleCasters = getCameraBoxIntersectionPoints(THREE, camera, modelBounds, preparedFrustum);
        const visibleReceivers = getCameraBoxIntersectionPoints(THREE, camera, receiverBounds, preparedFrustum);
        lastMaps = [];
        lastFallback = false;

        for (const light of lights) {
            light.shadow.updateMatrices(light);
            const shadowCamera = light.shadow.camera;
            const lightDirection = light.target.position.clone().sub(light.position).normalize();
            const shadowFootprint = getVisibleGroundShadowFootprint(
                THREE, modelBounds, receiverBounds, preparedFrustum.frustum, lightDirection);
            const worldPoints = [];
            for (const point of visibleCasters) addUniquePoint(worldPoints, point);
            for (const point of visibleReceivers) addUniquePoint(worldPoints, point);
            for (const point of shadowFootprint) addUniquePoint(worldPoints, point);

            if (!worldPoints.length) {
                setFallbackRange(light, center, radius, cameraScale);
                lastFallback = true;
                lastMaps.push({ points: 0, occupancyX: 0, occupancyY: 0, fallback: true });
                continue;
            }

            const lightPoints = worldPoints.map(point => point.clone().applyMatrix4(shadowCamera.matrixWorldInverse));
            const lightBounds = new THREE.Box3().setFromPoints(lightPoints);
            const spanX = Math.max(0.01, lightBounds.max.x - lightBounds.min.x);
            const spanY = Math.max(0.01, lightBounds.max.y - lightBounds.min.y);
            const mapWidth = light.shadow.map?.width || light.shadow.mapSize.x;
            const mapHeight = light.shadow.map?.height || light.shadow.mapSize.y;
            const aspect = Math.max(0.1, mapWidth / Math.max(1, mapHeight));
            // 保留旧自动范围0.5基准；cameraScale仍是相对该基准的倍率，默认值继续为1。
            const viewHeight = Math.max(spanY, spanX / aspect, 0.02) / targetOccupancy * 0.5 * cameraScale;
            const viewWidth = viewHeight * aspect;
            const centerX = (lightBounds.min.x + lightBounds.max.x) * 0.5;
            const centerY = (lightBounds.min.y + lightBounds.max.y) * 0.5;
            const shadowCameraCorners = [...getBoxCorners(THREE, modelBounds), ...getBoxCorners(THREE, receiverBounds)]
                .map(point => point.applyMatrix4(shadowCamera.matrixWorldInverse));
            const depthBounds = new THREE.Box3().setFromPoints(shadowCameraCorners);
            const depthPadding = Math.max(0.1, radius * 0.25);
            const nearest = -depthBounds.max.z;
            const farthest = -depthBounds.min.z;
            shadowCamera.left = centerX - viewWidth * 0.5;
            shadowCamera.right = centerX + viewWidth * 0.5;
            shadowCamera.bottom = centerY - viewHeight * 0.5;
            shadowCamera.top = centerY + viewHeight * 0.5;
            shadowCamera.near = Math.max(0.1, nearest - depthPadding);
            shadowCamera.far = Math.max(shadowCamera.near + 1, farthest + depthPadding);
            shadowCamera.updateProjectionMatrix();
            light.shadow.needsUpdate = true;
            lastMaps.push({ points: worldPoints.length,
                occupancyX: spanX / viewWidth, occupancyY: spanY / viewHeight, fallback: false });
        }
        fitCount += 1;
        lastSignature = readSignature(root, cameraScale);
        return true;
    };
    return { update, forceUpdate: () => update(true),
        getState: () => ({ fitCount, fallback: lastFallback, maps: lastMaps.map(value => ({ ...value })) }) };
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
