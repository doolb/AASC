// 手绘吉卜力风场景：修剪草坪棋盘、卵石边、石板路、高脚木屋、栅栏、季节树、小花与远坡风车。
import * as THREE from '../vendor/three.module.min.js';
import { seededRandom } from './presets.mjs?v=20261125h';
import { blobSphere, groundHeight, part, trs, mergeParts, shadeByHeight, outlineOf } from './geometry.mjs?v=20261125h';

// 无贴图 PBR 材质预设参数（金属度与粗糙度，随湿润度与积雪动态插值）
export const PBR_SURFACE_PRESETS = {
    ground: { metalness: 0.0, roughness: 0.86, wetRoughness: 0.46, snowRoughness: 0.68 },
    lawn: { metalness: 0.0, roughness: 0.82, wetRoughness: 0.42, snowRoughness: 0.74 },
    wood: { metalness: 0.04, roughness: 0.78, wetRoughness: 0.48 },
    stone: { metalness: 0.06, roughness: 0.82, wetRoughness: 0.44 },
    foliage: { metalness: 0.02, roughness: 0.68, wetRoughness: 0.36 },
    water: { metalness: 0.12, roughness: 0.16, wetRoughness: 0.10, snowRoughness: 0.26 },
    snowProp: { metalness: 0.02, roughness: 0.72, wetRoughness: 0.56 },
    windmill: { metalness: 0.18, roughness: 0.62, wetRoughness: 0.40 },
    cabinWindow: { metalness: 0.08, roughness: 0.22 },
    seasonProp: { metalness: 0.03, roughness: 0.70, wetRoughness: 0.45 }
};

// 为场景 MeshStandardMaterial 物件注入轻量明度校准与冬季雪地漫反射反光增益（维持水粉明快色感同时保留完整 Cook-Torrance PBR 高光/粗糙度）
function enhancePropPbr(material, sharedGround) {
    material.customProgramCacheKey = () => 'pig3d-prop-pbr-v2';
    material.onBeforeCompile = shader => {
        shader.uniforms.uNightMix = sharedGround.uNightMix;
        shader.uniforms.uSnow = sharedGround.uSnow;
        shader.fragmentShader = shader.fragmentShader
            .replace('void main() {', 'uniform float uNightMix;\nuniform float uSnow;\nvoid main() {')
            .replace(
                '#include <opaque_fragment>',
                `#include <opaque_fragment>
                float propSnowLift = 1.0 + smoothstep(0.15, 0.75, uSnow) * mix(0.14, 0.24, uNightMix);
                gl_FragColor.rgb *= mix(1.28, 0.96, uNightMix) * propSnowLift;`
            );
    };
}

// 为大草地与棋盘草坪注入 PBR 交互雪层位移、法线扰动、雪槽迎/背光与雪坎自投影、空气透视与昼夜地面光池
function enhanceGroundAerial(material, sharedGround, isInnerLawn = false) {
    material.customProgramCacheKey = () => (isInnerLawn ? 'pig3d-lawn-pbr-snow-v3' : 'pig3d-ground-pbr-snow-v3');
    material.onBeforeCompile = shader => {
        shader.uniforms.uHorizonColor = sharedGround.uHorizonColor;
        shader.uniforms.uNightMix = sharedGround.uNightMix;
        shader.uniforms.uSnow = sharedGround.uSnow;
        shader.uniforms.uTime = sharedGround.uTime;
        shader.uniforms.uBoardHalf = sharedGround.uBoardHalf;
        shader.uniforms.uInteractMap = sharedGround.uInteractMap;
        shader.uniforms.uSunDir = sharedGround.uSunDir;
        shader.uniforms.uDirectTint = sharedGround.uDirectTint;
        shader.vertexShader = shader.vertexShader
            .replace(
                'void main() {',
                'uniform float uSnow;\nuniform sampler2D uInteractMap;\nvarying vec2 vGroundXZ;\nvoid main() {'
            )
            .replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                vec4 scWorld0 = modelMatrix * vec4(transformed, 1.0);
                vGroundXZ = scWorld0.xz;
                float scSnowV = smoothstep(0.15, 0.70, uSnow);
                if (scSnowV > 0.01) {
                    vec2 scIuv = clamp(vGroundXZ / 48.0 + 0.5, 0.0, 1.0);
                    vec4 scInter = texture2D(uInteractMap, scIuv);
                    float scPress = clamp(scInter.r * 0.88 + scInter.g * 0.95, 0.0, 1.0);
                    float scEps = 1.0 / 256.0;
                    float scN = max(
                        max(texture2D(uInteractMap, clamp(scIuv + vec2(scEps, 0.0), 0.0, 1.0)).r,
                            texture2D(uInteractMap, clamp(scIuv - vec2(scEps, 0.0), 0.0, 1.0)).r),
                        max(texture2D(uInteractMap, clamp(scIuv + vec2(0.0, scEps), 0.0, 1.0)).r,
                            texture2D(uInteractMap, clamp(scIuv - vec2(0.0, scEps), 0.0, 1.0)).r)
                    );
                    float scRim = max(0.0, scN - scPress) * 0.65;
                    transformed.y += scSnowV * (${isInnerLawn ? '0.044' : '0.052'} * (1.0 - scPress * 0.92) + scRim * 0.028);
                }`
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                'void main() {',
                'uniform vec3 uHorizonColor;\nuniform float uNightMix;\nuniform float uSnow;\nuniform float uTime;\nuniform vec2 uBoardHalf;\nuniform sampler2D uInteractMap;\nuniform vec3 uSunDir;\nuniform vec3 uDirectTint;\nvarying vec2 vGroundXZ;\nvoid main() {'
            )
            .replace(
                '#include <normal_fragment_maps>',
                `#include <normal_fragment_maps>
                float scSnowN = smoothstep(0.15, 0.70, uSnow);
                if (scSnowN > 0.01) {
                    vec2 scNuv = clamp(vGroundXZ / 48.0 + 0.5, 0.0, 1.0);
                    float scNeps = 2.0 / 256.0;
                    vec4 iL = texture2D(uInteractMap, clamp(scNuv - vec2(scNeps, 0.0), 0.0, 1.0));
                    vec4 iR = texture2D(uInteractMap, clamp(scNuv + vec2(scNeps, 0.0), 0.0, 1.0));
                    vec4 iD = texture2D(uInteractMap, clamp(scNuv - vec2(0.0, scNeps), 0.0, 1.0));
                    vec4 iU = texture2D(uInteractMap, clamp(scNuv + vec2(0.0, scNeps), 0.0, 1.0));
                    float pL = clamp(iL.r * 0.88 + iL.g * 0.95, 0.0, 1.0);
                    float pR = clamp(iR.r * 0.88 + iR.g * 0.95, 0.0, 1.0);
                    float pD = clamp(iD.r * 0.88 + iD.g * 0.95, 0.0, 1.0);
                    float pU = clamp(iU.r * 0.88 + iU.g * 0.95, 0.0, 1.0);
                    // 凹陷高度 h ∝ -p，故向坑内倾斜法线水平分量为 (pR - pL, pU - pD)
                    vec3 scSlopeView = mat3(viewMatrix) * vec3((pR - pL) * 1.45, 0.0, (pU - pD) * 1.45);
                    normal = normalize(normal + scSlopeView * scSnowN);
                }`
            )
            .replace(
                '#include <opaque_fragment>',
                `#include <opaque_fragment>
                gl_FragColor.rgb *= mix(1.34, 0.94, uNightMix);
                float scSnow = smoothstep(0.15, 0.70, uSnow);
                vec2 scUvF = clamp(vGroundXZ / 48.0 + 0.5, 0.0, 1.0);
                vec4 scInterF = texture2D(uInteractMap, scUvF);
                float scPressF = clamp(scInterF.r * 0.88 + scInterF.g * 0.95, 0.0, 1.0);
                float scFeps = 2.0 / 256.0;
                vec4 fL = texture2D(uInteractMap, clamp(scUvF - vec2(scFeps, 0.0), 0.0, 1.0));
                vec4 fR = texture2D(uInteractMap, clamp(scUvF + vec2(scFeps, 0.0), 0.0, 1.0));
                vec4 fD = texture2D(uInteractMap, clamp(scUvF - vec2(0.0, scFeps), 0.0, 1.0));
                vec4 fU = texture2D(uInteractMap, clamp(scUvF + vec2(0.0, scFeps), 0.0, 1.0));
                float fpL = clamp(fL.r * 0.88 + fL.g * 0.95, 0.0, 1.0);
                float fpR = clamp(fR.r * 0.88 + fR.g * 0.95, 0.0, 1.0);
                float fpD = clamp(fD.r * 0.88 + fD.g * 0.95, 0.0, 1.0);
                float fpU = clamp(fU.r * 0.88 + fU.g * 0.95, 0.0, 1.0);
                float scNb = max(max(fL.r, fR.r), max(fD.r, fU.r));
                float scRimF = max(0.0, scNb - scPressF) * 0.65;
                // 计算拨雪/踩雪凹坑坡向与主光方向夹角，以及向光侧雪坎投下的背阴自投影
                vec2 snowSlopeXZ = vec2(fpR - fpL, fpU - fpD);
                vec2 lightXZ = normalize(uSunDir.xz + vec2(1e-4, 1e-4));
                float wallDot = dot(snowSlopeXZ, lightXZ);
                float backWall = clamp(-wallDot * 1.9, 0.0, 1.0);
                float frontWall = clamp(wallDot * 1.9, 0.0, 1.0);
                vec4 sSun1 = texture2D(uInteractMap, clamp(scUvF + lightXZ * (1.8 / 256.0), 0.0, 1.0));
                vec4 sSun2 = texture2D(uInteractMap, clamp(scUvF + lightXZ * (3.6 / 256.0), 0.0, 1.0));
                float pSun1 = clamp(sSun1.r * 0.88 + sSun1.g * 0.95, 0.0, 1.0);
                float pSun2 = clamp(sSun2.r * 0.88 + sSun2.g * 0.95, 0.0, 1.0);
                float rimShadow = clamp((scPressF - pSun1) * 0.85 + (scPressF - pSun2) * 0.65, 0.0, 1.0);
                float hasTrench = smoothstep(0.03, 0.22, scPressF + backWall + frontWall + scRimF);
                float backShadow = clamp(max(backWall * 0.92, rimShadow * 0.88) + scPressF * 0.22, 0.0, 1.0) * scSnow * hasTrench;
                float frontLit = clamp(frontWall * 0.95 + scRimF * 0.72 * (0.45 + 0.55 * max(dot(normalize(snowSlopeXZ + vec2(1e-4)), lightXZ), 0.0)), 0.0, 1.0) * scSnow;
                vec3 backShadowTint = mix(vec3(0.46, 0.60, 0.86), vec3(0.36, 0.48, 0.76), uNightMix);
                ${isInnerLawn ? `
                if (scSnow > 0.01) {
                    // 冬季棋盘内覆盖蓬松雪层（保留轻微修剪条纹肌理），小猪踏过或玩家拨雪时露出底层覆霜青绿草坪、背光冷蓝雪槽与迎光亮雪垄
                    float lumLawn = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
                    vec3 boardSnow = vec3(lumLawn * 0.30 + 0.64) * vec3(0.90, 0.95, 1.03) * mix(vec3(1.0), vec3(0.45, 0.58, 0.82), uNightMix);
                    float snowReveal = 1.0 - smoothstep(0.10, 0.58, scPressF) * 0.82;
                    vec3 snowUnder = mix(boardSnow, boardSnow * vec3(0.70, 0.80, 0.95), scPressF * 0.45);
                    snowUnder *= mix(vec3(1.0), backShadowTint, backShadow);
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, snowUnder, scSnow * 0.84 * snowReveal);
                    gl_FragColor.rgb *= mix(vec3(1.0), backShadowTint, backShadow * (1.0 - snowReveal * 0.45));
                    gl_FragColor.rgb += uDirectTint * mix(0.24, 0.16, uNightMix) * frontLit;
                }` : `
                if (scSnow > 0.01) {
                    // 冬季外围平滑粉雪质感，被拨开时同样体现迎光雪壁高光与背光雪槽冷蓝阴影
                    float lumSnow = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
                    vec3 powderSnow = vec3(lumSnow * 0.42 + 0.54) * vec3(0.90, 0.94, 1.02);
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, powderSnow, scSnow * 0.56);
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.72, 0.82, 0.96), scPressF * scSnow * 0.52);
                    gl_FragColor.rgb *= mix(vec3(1.0), backShadowTint, backShadow);
                    gl_FragColor.rgb += uDirectTint * mix(0.24, 0.16, uNightMix) * frontLit;
                    // 栅栏暖黄灯串沿雪地投出暖金光晕
                    float dBack = length(vec2(vGroundXZ.x - clamp(vGroundXZ.x, -uBoardHalf.x - 4.4, uBoardHalf.x + 3.0), vGroundXZ.y - (-uBoardHalf.y - 4.9)));
                    float dLeft = length(vec2(vGroundXZ.x - (-uBoardHalf.x - 5.05), vGroundXZ.y - clamp(vGroundXZ.y, -uBoardHalf.y - 4.3, uBoardHalf.y + 1.4)));
                    float dRight = length(vec2(vGroundXZ.x - (uBoardHalf.x + 5.2), vGroundXZ.y - clamp(vGroundXZ.y, -uBoardHalf.y - 2.0, uBoardHalf.y + 3.9)));
                    float dFrontR = length(vec2(vGroundXZ.x - clamp(vGroundXZ.x, uBoardHalf.x + 0.9, uBoardHalf.x + 5.2), vGroundXZ.y - (uBoardHalf.y + 4.35)));
                    float dFence = min(min(dBack, dLeft), min(dRight, dFrontR));
                    float fenceGlow = 1.0 - smoothstep(0.25, 2.45, dFence);
                    gl_FragColor.rgb += vec3(1.0, 0.72, 0.32) * fenceGlow * scSnow * 0.34;
                    // 冬季雪面微闪星光颗粒
                    float snowSp = sin(vGroundXZ.x * 19.7 + vGroundXZ.y * 23.3) * cos(vGroundXZ.x * 17.1 - vGroundXZ.y * 21.9);
                    float spPulse = 0.7 + 0.3 * sin(uTime * 2.5 + vGroundXZ.x * 3.1);
                    gl_FragColor.rgb += vec3(0.92, 0.96, 1.0) * smoothstep(0.985, 0.998, snowSp) * scSnow * spPulse * 0.24;
                }`}
                if (uNightMix > 0.02) {
                    // 月夜左上角银青漫射月光池
                    float moonPool = 1.0 - smoothstep(4.0, 28.0, length(vGroundXZ - vec2(-uBoardHalf.x - 4.0, -uBoardHalf.y - 5.0)));
                    gl_FragColor.rgb += vec3(0.07, 0.15, 0.20) * moonPool * uNightMix;
                }
                ${isInnerLawn ? '' : `
                if (uNightMix > 0.02 || scSnow > 0.05) {
                    // 右上高脚木屋双暖窗投向阶梯前雪地/草地的暖金地面光池
                    float cabinPool = 1.0 - smoothstep(1.1, 6.0, length(vGroundXZ - vec2(uBoardHalf.x + 4.2, -uBoardHalf.y - 3.4)));
                    gl_FragColor.rgb += vec3(0.38, 0.22, 0.06) * cabinPool * max(uNightMix, scSnow * 0.75);
                }`}
                float scDist = length(vGroundXZ);
                float scAerial = smoothstep(20.0, 36.0, scDist) * 0.36;
                float scLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
                vec3 scDesat = mix(gl_FragColor.rgb, vec3(scLum), scAerial * 0.45);
                gl_FragColor.rgb = mix(scDesat, uHorizonColor, scAerial);`
            );
    };
}

// 构建交叉双面 5 瓣花精灵几何体（仅 8 顶点，相比 6 边柱顶点数降为 1/3 且多视角立体）
function createCrossedFlowerGeo() {
    const p1 = new THREE.PlaneGeometry(0.32, 0.32);
    p1.rotateX(-Math.PI / 2 + 0.16);
    p1.translate(0, 0.04, 0);

    const p2 = new THREE.PlaneGeometry(0.32, 0.32);
    p2.rotateX(-Math.PI / 2 + 0.52);
    p2.rotateY(Math.PI / 2);
    p2.translate(0, 0.06, 0);

    const posA = p1.attributes.position.array;
    const posB = p2.attributes.position.array;
    const normA = p1.attributes.normal.array;
    const normB = p2.attributes.normal.array;
    const uvA = p1.attributes.uv.array;
    const uvB = p2.attributes.uv.array;
    const idxA = p1.index.array;
    const idxB = p2.index.array;

    const pos = new Float32Array(posA.length + posB.length);
    pos.set(posA, 0); pos.set(posB, posA.length);
    const norm = new Float32Array(normA.length + normB.length);
    norm.set(normA, 0); norm.set(normB, normA.length);
    const uv = new Float32Array(uvA.length + uvB.length);
    uv.set(uvA, 0); uv.set(uvB, uvA.length);

    const vOffset = posA.length / 3;
    const indices = [];
    for (let i = 0; i < idxA.length; i++) indices.push(idxA[i]);
    for (let i = 0; i < idxB.length; i++) indices.push(idxB[i] + vOffset);

    p1.dispose(); p2.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(indices);
    return geo;
}

export function createScenery(scene, textures, level, tier = 'high') {
    const group = new THREE.Group();
    scene.add(group);
    const disposables = [];
    const gradientMap = textures.gradient3();
    disposables.push(gradientMap);

    const cols = level.columns;
    const rows = level.rows;
    const halfW = cols / 2;
    const halfH = rows / 2;
    const sharedGround = {
        uHorizonColor: { value: new THREE.Color('#b5dff7') },
        uNightMix: { value: 0 },
        uSnow: { value: 0 },
        uTime: { value: 0 },
        uBoardHalf: { value: new THREE.Vector2(halfW, halfH) },
        uInteractMap: { value: textures.noiseMap() },
        uSunDir: { value: new THREE.Vector3(0.4, 0.85, 0.35).normalize() },
        uDirectTint: { value: new THREE.Color('#ffffff') }
    };
    const pbrPropMats = new Map();
    const makePbrMat = (key, opts = {}) => {
        const cfg = PBR_SURFACE_PRESETS[key] || PBR_SURFACE_PRESETS.wood;
        const mat = new THREE.MeshStandardMaterial({
            ...opts,
            metalness: cfg.metalness,
            roughness: cfg.roughness
        });
        enhancePropPbr(mat, sharedGround);
        if (!pbrPropMats.has(key)) pbrPropMats.set(key, []);
        pbrPropMats.get(key).push(mat);
        return mat;
    };

    // 1. 远景起伏大地（76×76，棋盘外平滑抬升成柔和丘陵）
    const groundGeo = new THREE.PlaneGeometry(82, 82, 56, 56);
    groundGeo.rotateX(-Math.PI / 2);
    const gPos = groundGeo.attributes.position;
    for (let i = 0; i < gPos.count; i++) {
        const x = gPos.getX(i), z = gPos.getZ(i);
        gPos.setY(i, groundHeight(x, z, halfW, halfH) - 0.03);
    }
    groundGeo.computeVertexNormals();
    const groundTex = textures.ground();
    groundTex.repeat.set(10, 10);
    const groundMat = new THREE.MeshStandardMaterial({
        map: groundTex,
        color: '#7fb35a',
        metalness: PBR_SURFACE_PRESETS.ground.metalness,
        roughness: PBR_SURFACE_PRESETS.ground.roughness
    });
    enhanceGroundAerial(groundMat, sharedGround, false);
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = true;
    group.add(groundMesh);
    disposables.push(groundGeo, groundMat);

    // 2. 棋盘修剪草坪（48×48 细分网格支持冬季棋盘内 3D 踩雪压陷，比外草地略浅，带明暗修剪条纹）
    const lawnGeo = new THREE.PlaneGeometry(cols + 0.5, rows + 0.5, 48, 48);
    lawnGeo.rotateX(-Math.PI / 2);
    const lawnTex = textures.lawn();
    lawnTex.repeat.set(1, Math.max(1, Math.round(rows / 6)));
    const lawnMat = new THREE.MeshStandardMaterial({
        map: lawnTex,
        color: '#9fd27a',
        metalness: PBR_SURFACE_PRESETS.lawn.metalness,
        roughness: PBR_SURFACE_PRESETS.lawn.roughness
    });
    enhanceGroundAerial(lawnMat, sharedGround, true);
    const lawnMesh = new THREE.Mesh(lawnGeo, lawnMat);
    lawnMesh.position.y = 0.008;
    lawnMesh.receiveShadow = true;
    group.add(lawnMesh);
    disposables.push(lawnGeo, lawnMat);

    // 3. 棋盘四周卵石镶边（实例化）
    const rand = seededRandom(level.id * 17 + 3);
    const pebbleGeo = blobSphere(0.18, 3, 0.22, 1, 0.5);
    const pebbleMat = makePbrMat('stone', { map: textures.stone(), color: '#cfd5cd' });
    const pebblePositions = [];
    for (let x = -halfW - 0.35; x <= halfW + 0.35; x += 0.45) {
        pebblePositions.push([x + (rand() - 0.5) * 0.08, -halfH - 0.35 + (rand() - 0.5) * 0.08]);
        pebblePositions.push([x + (rand() - 0.5) * 0.08, halfH + 0.35 + (rand() - 0.5) * 0.08]);
    }
    for (let z = -halfH + 0.1; z <= halfH - 0.1; z += 0.45) {
        pebblePositions.push([-halfW - 0.35 + (rand() - 0.5) * 0.08, z + (rand() - 0.5) * 0.08]);
        pebblePositions.push([halfW + 0.35 + (rand() - 0.5) * 0.08, z + (rand() - 0.5) * 0.08]);
    }
    const pebbleInst = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pebblePositions.length);
    pebbleInst.receiveShadow = true;
    const dummy = new THREE.Object3D();
    pebblePositions.forEach(([px, pz], idx) => {
        dummy.position.set(px, 0.03, pz);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        dummy.scale.set(0.85 + rand() * 0.5, 0.7 + rand() * 0.4, 0.8 + rand() * 0.45);
        dummy.updateMatrix();
        pebbleInst.setMatrixAt(idx, dummy.matrix);
    });
    group.add(pebbleInst);
    disposables.push(pebbleGeo, pebbleMat);

    // 3b. 棋盘分段粗圆木围框（含四角高出木桩、端头年轮木塞、底部小圆木端头、点缀卵石与冬季厚雪盖，配合统一绘本深棕描边）
    const outlineMat = new THREE.MeshBasicMaterial({ color: '#4c342b', side: THREE.BackSide });
    disposables.push(outlineMat);
    const attachOutline = (mesh, thickness = 0.028) => {
        const edgeGeo = outlineOf(mesh.geometry, thickness);
        const edgeMesh = new THREE.Mesh(edgeGeo, outlineMat);
        mesh.add(edgeMesh);
        disposables.push(edgeGeo);
    };
    const boardParts = [];
    const boardSnowParts = [];
    const bxEdge = halfW + 0.62, bzEdge = halfH + 0.62;
    const hSegs = Math.max(2, Math.round(cols / 3));
    const vSegs = Math.max(2, Math.round(rows / 3));
    const xTotal = bxEdge * 2, zTotal = bzEdge * 2;
    const addLogRail = (x0, z0, x1, z1, count, isHoriz) => {
        for (let i = 0; i < count; i++) {
            const tMid = (i + 0.5) / count;
            const len = (isHoriz ? xTotal : zTotal) / count - 0.14;
            const mx = THREE.MathUtils.lerp(x0, x1, tMid);
            const mz = THREE.MathUtils.lerp(z0, z1, tMid);
            const col = i % 2 === 0 ? '#a86f3f' : '#965f34';
            boardParts.push(part(
                new THREE.CylinderGeometry(0.155, 0.165, len, 9),
                col,
                isHoriz ? trs(mx, 0.13, mz, 0, 0, Math.PI / 2) : trs(mx, 0.13, mz, Math.PI / 2, 0, 0)
            ));
            boardSnowParts.push(part(
                blobSphere(0.16, i + 5, 0.14, 1, 0.42),
                '#f3f7fc',
                isHoriz ? trs(mx, 0.25, mz, 0, 0, 0, len * 2.75, 0.45, 0.85) : trs(mx, 0.25, mz, 0, 0, 0, 0.85, 0.45, len * 2.75)
            ));
            if (i < count - 1) {
                const jx = THREE.MathUtils.lerp(x0, x1, (i + 1) / count);
                const jz = THREE.MathUtils.lerp(z0, z1, (i + 1) / count);
                boardParts.push(part(new THREE.CylinderGeometry(0.17, 0.19, 0.30, 8), '#7a4926', trs(jx, 0.14, jz)));
            }
        }
    };
    addLogRail(-bxEdge, -bzEdge, bxEdge, -bzEdge, hSegs, true);
    addLogRail(-bxEdge, bzEdge, bxEdge, bzEdge, hSegs, true);
    addLogRail(-bxEdge, -bzEdge, -bxEdge, bzEdge, vSegs, false);
    addLogRail(bxEdge, -bzEdge, bxEdge, bzEdge, vSegs, false);
    for (const cx of [-bxEdge, bxEdge]) {
        for (const cz of [-bzEdge, bzEdge]) {
            boardParts.push(part(new THREE.CylinderGeometry(0.20, 0.22, 0.38, 9), '#7d4b27', trs(cx, 0.18, cz)));
            boardParts.push(part(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 9), '#cf9d6b', trs(cx, 0.375, cz)));
            boardSnowParts.push(part(new THREE.SphereGeometry(0.20, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.48), '#f5f9fe', trs(cx, 0.36, cz)));
            // 棋盘四角与鹅卵石内缘向内漫延的冬季雪堆
            const sxIn = Math.sign(cx) * (halfW + 0.12);
            const szIn = Math.sign(cz) * (halfH + 0.12);
            boardSnowParts.push(part(blobSphere(0.32, Math.abs(cx + cz), 0.18, 1, 0.35), '#eef5fc', trs(sxIn, 0.04, szIn)));
        }
    }
    // 棋盘四边内缘薄雪漫边
    for (let ix = -halfW + 0.4; ix <= halfW - 0.4; ix += 1.45) {
        boardSnowParts.push(part(blobSphere(0.24, Math.abs(ix) * 3 + 1, 0.16, 1, 0.30), '#eef5fc', trs(ix, 0.035, -halfH - 0.20, 0, 0, 0, 1.5, 0.32, 0.85)));
        boardSnowParts.push(part(blobSphere(0.24, Math.abs(ix) * 3 + 2, 0.16, 1, 0.30), '#eef5fc', trs(ix, 0.035, halfH + 0.20, 0, 0, 0, 1.5, 0.32, 0.85)));
    }
    for (let iz = -halfH + 0.4; iz <= halfH - 0.4; iz += 1.45) {
        boardSnowParts.push(part(blobSphere(0.24, Math.abs(iz) * 3 + 3, 0.16, 1, 0.30), '#eef5fc', trs(-halfW - 0.20, 0.035, iz, 0, 0, 0, 0.85, 0.32, 1.5)));
        boardSnowParts.push(part(blobSphere(0.24, Math.abs(iz) * 3 + 4, 0.16, 1, 0.30), '#eef5fc', trs(halfW + 0.20, 0.035, iz, 0, 0, 0, 0.85, 0.32, 1.5)));
    }
    // 围框前缘外露短原木端头与点缀卵石
    for (const sx of [-bxEdge * 0.55, bxEdge * 0.45]) {
        boardParts.push(part(new THREE.CylinderGeometry(0.11, 0.12, 0.42, 8), '#9b6438', trs(sx, 0.08, bzEdge + 0.14, Math.PI / 2, 0.12, 0)));
        boardParts.push(part(blobSphere(0.14, 12, 0.18, 1, 0.55), '#aeb7b2', trs(sx + 0.42, 0.05, bzEdge + 0.22)));
    }
    const boardGeo = mergeParts(boardParts);
    const boardMesh = new THREE.Mesh(boardGeo, makePbrMat('wood', { vertexColors: true }));
    boardMesh.castShadow = true;
    boardMesh.receiveShadow = true;
    attachOutline(boardMesh, 0.025);
    group.add(boardMesh);
    const boardSnowGeo = mergeParts(boardSnowParts);
    const boardSnowMat = makePbrMat('snowProp', { color: '#f3f7fc' });
    const boardSnowMesh = new THREE.Mesh(boardSnowGeo, boardSnowMat);
    boardSnowMesh.visible = false;
    group.add(boardSnowMesh);
    disposables.push(boardGeo, boardMesh.material, boardSnowGeo, boardSnowMat);

    // 4. 左上石板路（从西北灌木外侧蜿蜒延伸向远山）
    const pathGeo = blobSphere(0.42, 11, 0.16, 1, 0.20);
    const pathMat = makePbrMat('stone', { map: textures.stone(), color: '#dcd4c6' });
    const pathCount = 12;
    const pathInst = new THREE.InstancedMesh(pathGeo, pathMat, pathCount);
    pathInst.receiveShadow = true;
    for (let i = 0; i < pathCount; i++) {
        const px = -halfW - 4.4 - i * 0.58 - Math.sin(i * 0.55) * 0.45;
        const pz = -halfH - 2.2 - i * 0.78;
        const py = Math.max(0, groundHeight(px, pz, halfW, halfH) - 0.01);
        dummy.position.set(px, py + 0.03, pz);
        dummy.rotation.set(0, rand() * Math.PI, 0);
        dummy.scale.set(0.95 + rand() * 0.42, 0.65, 0.72 + rand() * 0.32);
        dummy.updateMatrix();
        pathInst.setMatrixAt(i, dummy.matrix);
    }
    group.add(pathInst);
    disposables.push(pathGeo, pathMat);

    // 5. 右上原木垒墙人字顶高脚木屋（对称暖光双四格方窗 + 中央木门 + 前阶梯 + 冬季雪顶）
    const woodMat = makePbrMat('wood', { map: textures.wood(), color: '#c48d59' });
    const cabinParts = [];
    const roofColor = '#8f5232';
    const plankColor = '#a9683f';
    const wallColor = '#c88b55';
    const postColor = '#7d4d2a';
    // 高脚木桩与宽木平台
    for (const sx of [-1.55, 1.55]) {
        for (const sz of [-1.25, 1.25]) {
            cabinParts.push(part(new THREE.CylinderGeometry(0.14, 0.16, 1.15, 8), postColor, trs(sx, 0.56, sz)));
        }
    }
    cabinParts.push(part(new THREE.BoxGeometry(3.8, 0.20, 3.2), '#8c5a33', trs(0, 1.12, 0.1)));
    // 堆叠圆木质感墙体与主箱体
    cabinParts.push(part(new THREE.BoxGeometry(2.9, 1.88, 2.3), wallColor, trs(0, 2.12, -0.15)));
    for (let ly = 1.42; ly <= 2.86; ly += 0.28) {
        cabinParts.push(part(new THREE.CylinderGeometry(0.13, 0.13, 3.16, 8), ly % 0.56 < 0.28 ? '#d1965f' : '#bc804d', trs(0, ly, 1.0, 0, 0, Math.PI / 2)));
        cabinParts.push(part(new THREE.CylinderGeometry(0.13, 0.13, 2.54, 8), '#b87c49', trs(-1.46, ly, -0.15, Math.PI / 2, 0, 0)));
        cabinParts.push(part(new THREE.CylinderGeometry(0.13, 0.13, 2.54, 8), '#b87c49', trs(1.46, ly, -0.15, Math.PI / 2, 0, 0)));
    }
    // 人字斜木屋顶（双斜坡木板 + 深木屋脊）
    cabinParts.push(part(new THREE.BoxGeometry(2.35, 0.16, 3.1), plankColor, trs(-0.92, 3.45, -0.15, 0, 0, 0.56)));
    cabinParts.push(part(new THREE.BoxGeometry(2.35, 0.16, 3.1), plankColor, trs(0.92, 3.45, -0.15, 0, 0, -0.56)));
    cabinParts.push(part(new THREE.BoxGeometry(0.28, 0.24, 3.18), roofColor, trs(0, 4.02, -0.15)));
    cabinParts.push(part(new THREE.CylinderGeometry(0.18, 0.20, 0.58, 7), '#7c4e36', trs(0.85, 3.92, -0.75)));
    // 中央深木门与门框
    cabinParts.push(part(new THREE.BoxGeometry(0.68, 1.02, 0.14), '#5e351a', trs(0, 1.70, 1.03)));
    // 两侧窗框十字木条（嵌在发光玻璃之前）
    for (const wx of [-0.82, 0.82]) {
        cabinParts.push(part(new THREE.BoxGeometry(0.60, 0.60, 0.10), '#5e351a', trs(wx, 2.26, 1.02)));
        cabinParts.push(part(new THREE.BoxGeometry(0.54, 0.05, 0.15), '#5e351a', trs(wx, 2.26, 1.05)));
        cabinParts.push(part(new THREE.BoxGeometry(0.05, 0.54, 0.15), '#5e351a', trs(wx, 2.26, 1.05)));
    }
    // 前阶梯（对齐概念图四级宽木阶）
    for (let s = 0; s < 4; s++) {
        cabinParts.push(part(new THREE.BoxGeometry(1.18, 0.11, 0.30), postColor, trs(-0.15, 0.18 + s * 0.26, 1.92 - s * 0.22)));
    }
    const cabinGeo = mergeParts(cabinParts);
    const cabinMesh = new THREE.Mesh(cabinGeo, makePbrMat('wood', { vertexColors: true }));
    cabinMesh.position.set(halfW + 5.8, 0, -halfH - 5.2);
    cabinMesh.rotation.y = -0.42;
    cabinMesh.castShadow = true;
    cabinMesh.receiveShadow = true;
    attachOutline(cabinMesh, 0.026);
    group.add(cabinMesh);
    // 可随冬/夜点亮的小屋对称暖光双窗
    const cabinWinGeo = new THREE.BoxGeometry(0.50, 0.50, 0.08);
    const cabinWinMat = makePbrMat('cabinWindow', { color: '#e8d8a8', emissive: '#ffb842', emissiveIntensity: 0.12 });
    const cabinWin1 = new THREE.Mesh(cabinWinGeo, cabinWinMat);
    cabinWin1.position.set(-0.82, 2.26, 1.05);
    const cabinWin2 = new THREE.Mesh(cabinWinGeo, cabinWinMat);
    cabinWin2.position.set(0.82, 2.26, 1.05);
    cabinMesh.add(cabinWin1, cabinWin2);
    // 冬季人字屋顶厚积雪檐
    const roofSnowParts = [
        part(new THREE.BoxGeometry(2.44, 0.16, 3.20), '#f3f7fc', trs(-0.92, 3.55, -0.15, 0, 0, 0.56)),
        part(new THREE.BoxGeometry(2.44, 0.16, 3.20), '#f3f7fc', trs(0.92, 3.55, -0.15, 0, 0, -0.56)),
        part(new THREE.CylinderGeometry(0.18, 0.18, 3.24, 8), '#ffffff', trs(0, 4.11, -0.15, Math.PI / 2, 0, 0))
    ];
    const roofSnowGeo = mergeParts(roofSnowParts);
    const roofSnowMat = makePbrMat('snowProp', { color: '#f3f7fc' });
    const roofSnow = new THREE.Mesh(roofSnowGeo, roofSnowMat);
    roofSnow.visible = false;
    cabinMesh.add(roofSnow);
    disposables.push(woodMat, cabinGeo, cabinMesh.material, cabinWinGeo, cabinWinMat, roofSnowGeo, roofSnowMat);

    // 6. 粗柱木栅栏布局（对齐概念图：后排、两侧斜合、右下短段，左下保留开阔池塘豁口）+ 冬/暮下垂暖黄灯串与雪帽
    const fenceParts = [];
    const fenceSnowParts = [];
    const fenceBulbCoords = [];
    const addFencePostAndSpan = (x0, z0, x1, z1) => {
        const dx = x1 - x0, dz = z1 - z0;
        const dist = Math.hypot(dx, dz);
        const rotY = Math.atan2(-dz, dx);
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const y0 = Math.max(0, groundHeight(x0, z0, halfW, halfH) - 0.03);
        const y1 = Math.max(0, groundHeight(x1, z1, halfW, halfH) - 0.03);
        const ym = (y0 + y1) / 2;
        fenceParts.push(part(new THREE.CylinderGeometry(0.125, 0.14, 0.88, 8), '#9b683e', trs(x0, y0 + 0.44, z0)));
        fenceParts.push(part(new THREE.CylinderGeometry(0.10, 0.10, 0.02, 8), '#d4a36e', trs(x0, y0 + 0.885, z0)));
        fenceParts.push(part(new THREE.CylinderGeometry(0.06, 0.065, dist, 6), '#b37a4c', trs(mx, ym + 0.62, mz, 0, rotY, Math.PI / 2)));
        fenceParts.push(part(new THREE.CylinderGeometry(0.06, 0.065, dist, 6), '#a87043', trs(mx, ym + 0.30, mz, 0, rotY, Math.PI / 2)));
        fenceSnowParts.push(part(new THREE.SphereGeometry(0.145, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.48), '#f4f8fd', trs(x0, y0 + 0.88, z0)));
        fenceSnowParts.push(part(new THREE.BoxGeometry(dist * 0.9, 0.055, 0.10), '#eff5fc', trs(mx, ym + 0.68, mz, 0, rotY, 0)));
        for (const s of [0.22, 0.5, 0.78]) {
            const sag = s === 0.5 ? 0.09 : 0.04;
            const lx = THREE.MathUtils.lerp(x0, x1, s);
            const lz = THREE.MathUtils.lerp(z0, z1, s);
            fenceBulbCoords.push([lx, THREE.MathUtils.lerp(y0, y1, s) + 0.55 - sag, lz]);
        }
    };
    const buildFencePolyline = pts => {
        for (let i = 0; i < pts.length - 1; i++) {
            addFencePostAndSpan(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        }
        const [lx, lz] = pts[pts.length - 1];
        const ly = Math.max(0, groundHeight(lx, lz, halfW, halfH) - 0.03);
        fenceParts.push(part(new THREE.CylinderGeometry(0.125, 0.14, 0.88, 8), '#9b683e', trs(lx, ly + 0.44, lz)));
        fenceParts.push(part(new THREE.CylinderGeometry(0.10, 0.10, 0.02, 8), '#d4a36e', trs(lx, ly + 0.885, lz)));
        fenceSnowParts.push(part(new THREE.SphereGeometry(0.145, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.48), '#f4f8fd', trs(lx, ly + 0.88, lz)));
    };
    // 后排 + 左斜翼
    const backPts = [];
    for (let t = 0; t <= 5; t++) backPts.push([THREE.MathUtils.lerp(-halfW - 4.4, halfW + 3.0, t / 5), -halfH - 4.9]);
    buildFencePolyline(backPts);
    const leftPts = [];
    for (let t = 0; t <= 4; t++) {
        leftPts.push([
            THREE.MathUtils.lerp(-halfW - 4.7, -halfW - 5.4, t / 4),
            THREE.MathUtils.lerp(-halfH - 4.3, halfH + 1.4, t / 4)
        ]);
    }
    buildFencePolyline(leftPts);
    // 右侧翼（留出右后木屋阶梯通路，右下角转折包住右前角）
    const rightPts = [];
    for (let t = 0; t <= 4; t++) {
        rightPts.push([
            THREE.MathUtils.lerp(halfW + 4.9, halfW + 5.5, t / 4),
            THREE.MathUtils.lerp(-halfH - 2.0, halfH + 3.9, t / 4)
        ]);
    }
    buildFencePolyline(rightPts);
    const frontRightPts = [];
    for (let t = 0; t <= 3; t++) {
        frontRightPts.push([THREE.MathUtils.lerp(halfW + 5.2, halfW + 0.9, t / 3), halfH + 4.35]);
    }
    buildFencePolyline(frontRightPts);

    const fenceGeo = mergeParts(fenceParts);
    const fenceMesh = new THREE.Mesh(fenceGeo, makePbrMat('wood', { vertexColors: true }));
    fenceMesh.castShadow = true;
    fenceMesh.receiveShadow = true;
    attachOutline(fenceMesh, 0.022);
    group.add(fenceMesh);
    const fenceSnowGeo = mergeParts(fenceSnowParts);
    const fenceSnowMat = makePbrMat('snowProp', { color: '#f3f7fc' });
    const fenceSnowMesh = new THREE.Mesh(fenceSnowGeo, fenceSnowMat);
    fenceSnowMesh.visible = false;
    group.add(fenceSnowMesh);
    const fenceBulbGeo = new THREE.SphereGeometry(0.068, 7, 5);
    const fenceBulbMat = new THREE.MeshBasicMaterial({ color: '#ffe074' });
    const fenceBulbInst = new THREE.InstancedMesh(fenceBulbGeo, fenceBulbMat, fenceBulbCoords.length);
    fenceBulbCoords.forEach(([bx, by, bz], bi) => {
        dummy.position.set(bx, by, bz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        fenceBulbInst.setMatrixAt(bi, dummy.matrix);
    });
    fenceBulbInst.visible = false;
    group.add(fenceBulbInst);
    disposables.push(fenceGeo, fenceMesh.material, fenceSnowGeo, fenceSnowMat, fenceBulbGeo, fenceBulbMat);

    // 6b. 左前荷花小池塘（卵石砌边 + 缺口圆荷叶 + 粉红莲花）与角落三丛圆灌木
    const pondGroup = new THREE.Group();
    const pondX = -halfW - 3.6, pondZ = halfH + 3.4;
    pondGroup.position.set(pondX, Math.max(0, groundHeight(pondX, pondZ, halfW, halfH) - 0.01), pondZ);
    const pondWaterGeo = new THREE.CircleGeometry(2.25, 28);
    pondWaterGeo.rotateX(-Math.PI / 2);
    const pondWaterMat = makePbrMat('water', { color: '#64c6e8' });
    const pondWater = new THREE.Mesh(pondWaterGeo, pondWaterMat);
    pondWater.position.y = 0.04;
    pondWater.scale.set(1.14, 1, 0.72);
    pondWater.receiveShadow = true;
    pondGroup.add(pondWater);
    const pondRimParts = [];
    const pondSnowParts = [];
    for (let pi = 0; pi < 22; pi++) {
        const pa = (pi / 22) * Math.PI * 2;
        const rw = 0.24 + (pi % 3) * 0.06;
        const rx = Math.cos(pa) * 2.52, rz = Math.sin(pa) * 1.62;
        pondRimParts.push(part(blobSphere(rw, pi + 7, 0.18, 1, 0.52), pi % 2 === 0 ? '#aeb7b3' : '#cfd6ce', trs(rx, 0.05, rz)));
        pondSnowParts.push(part(blobSphere(rw * 0.88, pi + 29, 0.15, 1, 0.38), '#eff5fc', trs(rx, 0.13, rz)));
    }
    const pondRimGeo = mergeParts(pondRimParts);
    const pondRimMat = makePbrMat('stone', { vertexColors: true });
    const pondRimMesh = new THREE.Mesh(pondRimGeo, pondRimMat);
    pondRimMesh.receiveShadow = true;
    attachOutline(pondRimMesh, 0.02);
    pondGroup.add(pondRimMesh);
    const pondSnowGeo = mergeParts(pondSnowParts);
    const pondSnowMat = makePbrMat('snowProp', { color: '#eff5fc' });
    const pondSnowMesh = new THREE.Mesh(pondSnowGeo, pondSnowMat);
    pondSnowMesh.visible = false;
    pondGroup.add(pondSnowMesh);
    const pondSummerGroup = new THREE.Group();
    const lilyParts = [
        part(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 12, 1, false, 0.2, Math.PI * 1.85), '#5ca848', trs(-0.72, 0.06, 0.12)),
        part(new THREE.CylinderGeometry(0.25, 0.25, 0.03, 12, 1, false, 1.2, Math.PI * 1.85), '#6db854', trs(0.55, 0.06, -0.32)),
        part(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 12, 1, false, 2.4, Math.PI * 1.85), '#529b41', trs(0.32, 0.06, 0.42)),
        part(new THREE.CylinderGeometry(0.20, 0.20, 0.03, 12, 1, false, 0.6, Math.PI * 1.85), '#62ae4c', trs(-0.12, 0.06, -0.45)),
        part(new THREE.SphereGeometry(0.12, 8, 6), '#f8a0bf', trs(-0.72, 0.12, 0.12)),
        part(new THREE.SphereGeometry(0.09, 8, 6), '#f8a0bf', trs(0.55, 0.11, -0.32))
    ];
    const lilyGeo = mergeParts(lilyParts);
    const lilyMat = makePbrMat('foliage', { vertexColors: true });
    pondSummerGroup.add(new THREE.Mesh(lilyGeo, lilyMat));
    pondGroup.add(pondSummerGroup);
    group.add(pondGroup);
    disposables.push(pondWaterGeo, pondWaterMat, pondRimGeo, pondRimMat, pondSnowGeo, pondSnowMat, lilyGeo, lilyMat);

    // 左后拐角三簇圆润灌木丛（冬季覆盖厚雪帽）
    const bushParts = [];
    const bushSnowParts = [];
    const bushSpots = [[-halfW - 2.3, -halfH - 3.3, 1.08], [-halfW - 1.35, -halfH - 3.8, 0.92], [-halfW - 3.25, -halfH - 2.4, 0.88]];
    bushSpots.forEach(([bx, bz, bs], idx) => {
        const by = Math.max(0, groundHeight(bx, bz, halfW, halfH) - 0.03);
        bushParts.push(part(blobSphere(0.58 * bs, idx + 31, 0.18, 1, 0.82), '#54a242', trs(bx, by + 0.38 * bs, bz)));
        bushParts.push(part(blobSphere(0.42 * bs, idx + 39, 0.18, 1, 0.80), '#6ab94f', trs(bx + 0.36 * bs, by + 0.28 * bs, bz + 0.24 * bs)));
        bushSnowParts.push(part(blobSphere(0.48 * bs, idx + 51, 0.14, 1, 0.52), '#f3f7fc', trs(bx, by + 0.56 * bs, bz)));
    });
    const bushGeo = mergeParts(bushParts);
    const bushMesh = new THREE.Mesh(bushGeo, makePbrMat('foliage', { vertexColors: true }));
    bushMesh.castShadow = true;
    bushMesh.receiveShadow = true;
    attachOutline(bushMesh, 0.024);
    group.add(bushMesh);
    const bushSnowGeo = mergeParts(bushSnowParts);
    const bushSnowMat = makePbrMat('snowProp', { color: '#f3f7fc' });
    const bushSnowMesh = new THREE.Mesh(bushSnowGeo, bushSnowMat);
    bushSnowMesh.visible = false;
    group.add(bushSnowMesh);
    disposables.push(bushGeo, bushMesh.material, bushSnowGeo, bushSnowMat);

    // 7. 远景风车（对齐概念图：处于正后中偏右山脊远处剪影）
    const millGroup = new THREE.Group();
    millGroup.position.set(halfW * 0.25 + 1.5, 1.55, -halfH - 18.5);
    millGroup.scale.setScalar(0.84);
    millGroup.rotation.y = 0.05;
    const millTower = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.05, 3.6, 10), makePbrMat('stone', { color: '#9eb2a8' }));
    millTower.position.y = 1.8;
    const millCap = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.95, 10), makePbrMat('windmill', { color: '#7b8e85' }));
    millCap.position.y = 4.05;
    const rotor = new THREE.Group();
    rotor.position.set(0, 3.3, 0.72);
    const bladeMat = makePbrMat('windmill', { color: '#a8bbb2' });
    const bladeGeo = new THREE.BoxGeometry(0.24, 1.85, 0.05);
    for (let b = 0; b < 4; b++) {
        const pivot = new THREE.Group();
        pivot.rotation.z = (b * Math.PI) / 2;
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.y = 1.02;
        pivot.add(blade);
        rotor.add(pivot);
    }
    millGroup.add(millTower, millCap, rotor);
    group.add(millGroup);
    disposables.push(millTower.geometry, millTower.material, millCap.geometry, millCap.material, bladeGeo, bladeMat);

    // 8. 四角主题季节树（10 棵：四季蓬松大冠带深褐描边 + 冬季三层深青松叠厚白雪）
    const treePlacements = [
        [-halfW - 6.8, -halfH - 3.6, 1.12], [-halfW - 8.2, -halfH - 0.6, 1.24],
        [-halfW - 6.6, halfH + 3.2, 1.05], [-halfW - 8.1, halfH + 1.0, 1.18],
        [halfW + 8.4, -halfH - 1.2, 1.15], [halfW + 7.2, -halfH + 1.4, 1.08],
        [halfW + 7.0, halfH + 4.0, 1.06], [halfW + 8.5, halfH + 1.8, 1.22],
        [-halfW - 11.2, -halfH - 6.5, 1.32], [halfW + 10.6, -halfH - 6.2, 1.26]
    ];
    const trunkGeo = new THREE.CylinderGeometry(0.20, 0.30, 2.0, 7);
    const trunkMat = makePbrMat('wood', { color: '#785034' });
    const crownBlobGeo = blobSphere(1.08, 9, 0.22, 2, 0.86);
    const pineConeGeo = new THREE.ConeGeometry(1.18, 1.75, 9);
    const crownMat = makePbrMat('foliage', { color: '#f7b8c8' });
    const pineSnowMat = makePbrMat('snowProp', { color: '#eff6fd' });
    const trees = [];
    for (let i = 0; i < treePlacements.length; i++) {
        const [tx, tz, sc] = treePlacements[i];
        const tGroup = new THREE.Group();
        tGroup.position.set(tx, Math.max(0, groundHeight(tx, tz, halfW, halfH) - 0.04), tz);
        tGroup.scale.setScalar(sc);
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 1.0;
        trunk.castShadow = true;
        // 樱花/阔叶/枫树多团蓬松花冠
        const broad = new THREE.Group();
        const c1 = new THREE.Mesh(crownBlobGeo, crownMat); c1.position.set(0, 2.35, 0); c1.castShadow = true; c1.receiveShadow = true;
        const c2 = new THREE.Mesh(crownBlobGeo, crownMat); c2.position.set(-0.68, 1.98, 0.35); c2.scale.setScalar(0.74); c2.castShadow = true; c2.receiveShadow = true;
        const c3 = new THREE.Mesh(crownBlobGeo, crownMat); c3.position.set(0.62, 2.02, -0.3); c3.scale.setScalar(0.70); c3.castShadow = true; c3.receiveShadow = true;
        broad.add(c1, c2, c3);
        // 冬季三层叠翠深青松枝 + 对应三层厚白雪帽（概念图冬树核心造型）
        const pine = new THREE.Group();
        const pineTiers = [
            { y: 1.75, sc: 1.06 },
            { y: 2.52, sc: 0.84 },
            { y: 3.22, sc: 0.60 }
        ];
        pineTiers.forEach(tierCfg => {
            const foliage = new THREE.Mesh(pineConeGeo, crownMat);
            foliage.position.y = tierCfg.y;
            foliage.scale.setScalar(tierCfg.sc);
            foliage.castShadow = true;
            foliage.receiveShadow = true;
            const snowCap = new THREE.Mesh(pineConeGeo, pineSnowMat);
            snowCap.position.y = tierCfg.y + 0.18 * tierCfg.sc;
            snowCap.scale.set(tierCfg.sc * 0.94, tierCfg.sc * 0.72, tierCfg.sc * 0.94);
            pine.add(foliage, snowCap);
        });
        pine.visible = false;

        tGroup.add(trunk, broad, pine);
        group.add(tGroup);
        trees.push({ group: tGroup, broad, pine, phase: i * 0.9 });
    }
    disposables.push(trunkGeo, trunkMat, crownBlobGeo, pineConeGeo, crownMat, pineSnowMat);

    // 9. 走廊化聚簇花丛（按概念图集中铺设在棋盘左/右两侧通道草带及前后栅栏内缘，留白自然）
    const flowerCap = tier === 'high' ? 1800 : tier === 'medium' ? 900 : 420;
    const flowerUniforms = { uTime: { value: 0 }, uWind: { value: 0.6 } };
    const useStarFlowers = tier !== 'low';
    const flowerGeo = useStarFlowers
        ? createCrossedFlowerGeo()
        : new THREE.CylinderGeometry(0.13, 0.04, 0.05, 6);
    const flowerMat = useStarFlowers
        ? new THREE.MeshBasicMaterial({ map: textures.flowerSprite(), color: '#ffffff', alphaTest: 0.42, side: THREE.DoubleSide })
        : new THREE.MeshBasicMaterial({ color: '#ffffff' });
    if (tier === 'high') {
        flowerMat.customProgramCacheKey = () => 'pig3d-flower-sway';
        flowerMat.onBeforeCompile = shader => {
            shader.uniforms.uTime = flowerUniforms.uTime;
            shader.uniforms.uWind = flowerUniforms.uWind;
            shader.vertexShader = shader.vertexShader
                .replace('void main() {', 'uniform float uTime;\nuniform float uWind;\nvoid main() {')
                .replace(
                    '#include <begin_vertex>',
                    `#include <begin_vertex>
                    vec4 flWorld = instanceMatrix * vec4(transformed, 1.0);
                    float flSway = sin(uTime * 2.2 + flWorld.x * 0.45 + flWorld.z * 0.35) * 0.032 * uWind;
                    transformed.x += flSway;
                    transformed.z += flSway * 0.5;`
                );
        };
    }
    const flowerInst = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCap);
    const flowerPaletteIdx = new Uint8Array(flowerCap);
    const flowerZones = [
        [-halfW - 2.9, 0.4, 1.35, halfH + 1.2],
        [halfW + 2.9, 0.4, 1.35, halfH + 1.4],
        [0.4, halfH + 2.7, halfW + 0.6, 1.15],
        [-1.8, -halfH - 2.8, 2.2, 0.95],
        [2.4, -halfH - 2.7, 2.2, 0.95]
    ];
    let fPlaced = 0, fAttempts = 0;
    while (fPlaced < flowerCap && fAttempts < flowerCap * 8) {
        fAttempts++;
        const zCfg = flowerZones[fAttempts % flowerZones.length];
        const px = zCfg[0] + (rand() - 0.5) * 2 * zCfg[2];
        const pz = zCfg[1] + (rand() - 0.5) * 2 * zCfg[3];
        if (Math.abs(px) < halfW + 0.85 && Math.abs(pz) < halfH + 0.85) continue;
        if (Math.hypot(px - pondX, (pz - pondZ) * 1.4) < 2.85) continue;
        const cluster = Math.sin(px * 0.65 + 1.1) * Math.cos(pz * 0.55 - 0.7);
        if (cluster < -0.15 && rand() < 0.68) continue;
        const hillY = Math.max(0, groundHeight(px, pz, halfW, halfH) - 0.03);
        dummy.position.set(px, hillY + (useStarFlowers ? 0.10 : 0.15) + rand() * 0.08, pz);
        dummy.rotation.set((rand() - 0.5) * 0.25, rand() * Math.PI * 2, (rand() - 0.5) * 0.25);
        const s = 0.78 + rand() * 0.82;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        flowerInst.setMatrixAt(fPlaced, dummy.matrix);
        flowerPaletteIdx[fPlaced] = (fPlaced % 7 === 0) ? 1 : (fPlaced % 5);
        fPlaced++;
    }
    flowerInst.count = fPlaced;
    group.add(flowerInst);
    disposables.push(flowerGeo, flowerMat);

    // 10. 季节限定小道具：夏向日葵、秋稻草堆与南瓜、冬围巾雪人（对齐概念图左侧位置）
    const seasonProps = { sunflower: new THREE.Group(), autumn: new THREE.Group(), snowman: new THREE.Group() };
    const sfMat = makePbrMat('seasonProp', { vertexColors: true });
    const sfParts = [];
    for (const [sx, sz] of [[-halfW - 3.6, 1.2], [-halfW - 4.1, 2.0], [halfW + 3.8, 1.4]]) {
        sfParts.push(part(new THREE.CylinderGeometry(0.04, 0.05, 0.95, 6), '#4b8d32', trs(sx, 0.47, sz)));
        sfParts.push(part(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 12), '#ffd130', trs(sx, 0.96, sz, Math.PI / 2 - 0.2, 0, 0)));
        sfParts.push(part(new THREE.SphereGeometry(0.12, 8, 8), '#5e371e', trs(sx, 0.96, sz + 0.04)));
    }
    const sfGeo = mergeParts(sfParts);
    seasonProps.sunflower.add(new THREE.Mesh(sfGeo, sfMat));
    const auParts = [];
    for (const [hx, hz] of [[-halfW - 4.2, 1.8], [halfW + 4.2, 2.4]]) {
        auParts.push(part(new THREE.CylinderGeometry(0.55, 0.55, 0.85, 12), '#dfba52', trs(hx, 0.42, hz, 0, 0.4, Math.PI / 2)));
    }
    for (const [px, pz] of [[-halfW - 3.4, -1.6], [halfW + 3.6, -1.4], [-halfW - 3.8, 3.2]]) {
        auParts.push(part(blobSphere(0.26, 2, 0.14, 1, 0.72), '#e86f2c', trs(px, 0.2, pz)));
        auParts.push(part(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 6), '#4e6b2c', trs(px, 0.4, pz)));
    }
    const auGeo = mergeParts(auParts);
    seasonProps.autumn.add(new THREE.Mesh(auGeo, sfMat));
    // 冬季条纹围巾笑脸雪人（紧邻左排灌木前）
    const snParts = [];
    const smX = -halfW - 3.4, smZ = -halfH + 0.55;
    snParts.push(part(new THREE.SphereGeometry(0.44, 12, 10), '#f6f9fc', trs(smX, 0.36, smZ)));
    snParts.push(part(new THREE.SphereGeometry(0.30, 12, 10), '#ffffff', trs(smX, 0.92, smZ)));
    snParts.push(part(new THREE.TorusGeometry(0.26, 0.065, 8, 14), '#df8a2d', trs(smX, 0.70, smZ, Math.PI / 2, 0, 0)));
    snParts.push(part(new THREE.BoxGeometry(0.11, 0.30, 0.07), '#cf7820', trs(smX + 0.18, 0.56, smZ + 0.20, 0.2, 0, -0.35)));
    snParts.push(part(new THREE.ConeGeometry(0.055, 0.24, 8), '#f3762c', trs(smX, 0.92, smZ + 0.32, Math.PI / 2, 0, 0)));
    for (const ex of [-0.09, 0.09]) snParts.push(part(new THREE.SphereGeometry(0.028, 6, 5), '#2b2421', trs(smX + ex, 0.98, smZ + 0.27)));
    for (const by of [0.34, 0.48]) snParts.push(part(new THREE.SphereGeometry(0.03, 6, 5), '#2b2421', trs(smX, by, smZ + 0.41)));
    for (const sx of [-1, 1]) snParts.push(part(new THREE.CylinderGeometry(0.02, 0.025, 0.42, 5), '#6b4426', trs(smX + sx * 0.46, 0.64, smZ, 0, 0, sx * -0.9)));
    const snGeo = mergeParts(snParts);
    const snMesh = new THREE.Mesh(snGeo, sfMat);
    attachOutline(snMesh, 0.02);
    seasonProps.snowman.add(snMesh);
    group.add(seasonProps.sunflower, seasonProps.autumn, seasonProps.snowman);
    disposables.push(sfMat, sfGeo, auGeo, snGeo);

    // 蘑菇点缀
    const mushParts = [];
    for (const [mx, mz] of [[-halfW - 3.2, -3.2], [-halfW - 3.5, -2.8], [halfW + 3.4, -3.4]]) {
        mushParts.push(part(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6), '#f5ead8', trs(mx, 0.08, mz)));
        mushParts.push(part(new THREE.SphereGeometry(0.14, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#e3554c', trs(mx, 0.15, mz)));
    }
    const mushGeo = mergeParts(mushParts);
    shadeByHeight(mushGeo, 0, 0.3, 0.15);
    const mushMesh = new THREE.Mesh(mushGeo, sfMat);
    group.add(mushMesh);
    disposables.push(mushGeo);

    const colTmp = new THREE.Color();
    const curGround = new THREE.Color('#7fb35a');
    const curLawn = new THREE.Color('#9fd27a');
    const curCrown = new THREE.Color('#f7b8c8');

    let lastFlowerKey = '';
    function applyPreset(preset, blend = 1, horizonColor = null, lightState = null) {
        if (horizonColor) sharedGround.uHorizonColor.value.copy(horizonColor);
        if (lightState?.sunDir) sharedGround.uSunDir.value.copy(lightState.sunDir).normalize();
        if (lightState?.directTint) sharedGround.uDirectTint.value.copy(lightState.directTint);
        const nightMix = lightState?.nightBlend ?? 0;
        const sunsetMix = lightState?.sunsetBlend ?? 0;
        const duskMix = lightState?.duskMix ?? preset.dusk;
        const isWinter = preset.treeType === 'pine';
        sharedGround.uNightMix.value = nightMix;
        sharedGround.uSnow.value = preset.snowCover;

        // 地面、棋盘及全部场景物件先做预设平滑插值并同步更新 PBR 金属度/粗糙度（按湿润度与积雪插值），再温和染入月夜冷青
        const gPreset = PBR_SURFACE_PRESETS.ground;
        const lPreset = PBR_SURFACE_PRESETS.lawn;
        const snowMix = THREE.MathUtils.clamp(preset.snowCover, 0, 1);
        const wetMix = THREE.MathUtils.clamp(preset.wetness, 0, 1);
        groundMat.metalness = gPreset.metalness;
        groundMat.roughness = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(gPreset.roughness, gPreset.wetRoughness, wetMix),
            gPreset.snowRoughness,
            snowMix
        );
        lawnMat.metalness = lPreset.metalness;
        lawnMat.roughness = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(lPreset.roughness, lPreset.wetRoughness, wetMix),
            lPreset.snowRoughness,
            snowMix
        );
        for (const [key, mats] of pbrPropMats.entries()) {
            const cfg = PBR_SURFACE_PRESETS[key];
            if (!cfg) continue;
            const wetR = cfg.wetRoughness ?? cfg.roughness;
            let nextR = THREE.MathUtils.lerp(cfg.roughness, wetR, wetMix);
            if (cfg.snowRoughness !== undefined) nextR = THREE.MathUtils.lerp(nextR, cfg.snowRoughness, snowMix);
            for (const m of mats) {
                m.metalness = cfg.metalness;
                m.roughness = nextR;
            }
        }

        colTmp.set(preset.ground);
        curGround.lerp(colTmp, blend);
        groundMat.color.copy(curGround).lerp(colTmp.set(isWinter ? '#324a74' : '#183d4a'), nightMix * 0.52);

        colTmp.set(preset.lawn);
        curLawn.lerp(colTmp, blend);
        lawnMat.color.copy(curLawn).lerp(colTmp.set(isWinter ? '#29525e' : '#215258'), nightMix * 0.48);

        colTmp.set(preset.foliage[0]);
        curCrown.lerp(colTmp, blend);
        crownMat.color.copy(curCrown).lerp(colTmp.set(isWinter ? '#1c3b4a' : '#685682'), nightMix * 0.72);

        for (const t of trees) {
            t.broad.visible = !isWinter;
            t.pine.visible = isWinter;
        }
        const snowShown = preset.snowCover > 0.35;
        roofSnow.visible = snowShown;
        boardSnowMesh.visible = snowShown;
        fenceSnowMesh.visible = snowShown;
        bushSnowMesh.visible = snowShown;
        pondSnowMesh.visible = snowShown;
        // 仅冬季点亮栅栏暖黄灯串；非冬季夜晚保持幽暗原木栅栏，由木屋暖窗担当唯一暖光源
        fenceBulbInst.visible = isWinter;
        pondSummerGroup.visible = !isWinter;
        pondWaterMat.color.set(isWinter ? '#9bd5f2' : '#64c6e8').lerp(colTmp.set('#1d3f6e'), nightMix * 0.82);
        outlineMat.color.set('#4c342b').lerp(colTmp.set('#1f2c4f'), Math.max(nightMix * 0.88, isWinter ? 0.55 : 0));

        // 树木枝干、木框、栅栏、木屋、灌木、卵石、石板与冬季雪顶随夜色压暗融入月夜（冬季受雪面环境反光保留更多通透感）
        const propNight = nightMix * (isWinter ? 0.45 : 0.70);
        trunkMat.color.set('#785034').lerp(colTmp.set('#3b3248'), propNight);
        boardMesh.material.color.set('#ffffff').lerp(colTmp.set('#5e5673'), propNight);
        fenceMesh.material.color.set('#ffffff').lerp(colTmp.set('#5e5673'), propNight);
        cabinMesh.material.color.set('#ffffff').lerp(colTmp.set('#5e5673'), propNight);
        bushMesh.material.color.set('#ffffff').lerp(colTmp.set('#2c5863'), nightMix * (isWinter ? 0.50 : 0.74));
        lilyMat.color.set('#ffffff').lerp(colTmp.set('#2c5863'), nightMix * (isWinter ? 0.50 : 0.74));
        pebbleMat.color.set('#cfd5cd').lerp(colTmp.set('#586b8a'), propNight);
        pathMat.color.set('#dcd4c6').lerp(colTmp.set('#556785'), propNight);
        pondRimMat.color.set('#ffffff').lerp(colTmp.set('#5c6e8c'), propNight);
        const nightSnowHex = '#8ba4cf';
        boardSnowMat.color.set('#f3f7fc').lerp(colTmp.set(nightSnowHex), nightMix * 0.56);
        roofSnowMat.color.set('#f3f7fc').lerp(colTmp.set(nightSnowHex), nightMix * 0.56);
        fenceSnowMat.color.set('#f3f7fc').lerp(colTmp.set(nightSnowHex), nightMix * 0.56);
        bushSnowMat.color.set('#f3f7fc').lerp(colTmp.set(nightSnowHex), nightMix * 0.56);
        pondSnowMat.color.set('#eff5fc').lerp(colTmp.set(nightSnowHex), nightMix * 0.56);
        pineSnowMat.color.set('#eff6fd').lerp(colTmp.set(nightSnowHex), nightMix * 0.56);

        const warmGlow = isWinter ? Math.max(0.85, duskMix) : Math.max(0, (duskMix - 0.22) / 0.78);
        cabinWinMat.emissiveIntensity = 0.10 + warmGlow * 1.45;
        cabinWinMat.color.set('#e8d8a8').lerp(colTmp.set('#ffe48a'), warmGlow);
        flowerMat.color.set('#ffffff').lerp(colTmp.set('#ffcf9c'), sunsetMix * 0.35).lerp(colTmp.set('#5c7aa8'), nightMix * 0.78);

        seasonProps.sunflower.visible = preset.props.includes('sunflower');
        seasonProps.autumn.visible = preset.props.includes('haystack');
        seasonProps.snowman.visible = preset.props.includes('snowman') || preset.snowCover > 0.65;

        const visibleFlowers = Math.min(fPlaced, Math.floor(flowerCap * preset.flowerDensity));
        flowerInst.count = visibleFlowers;
        const flowerKey = `${preset.season}:${visibleFlowers}`;
        if (flowerKey !== lastFlowerKey) {
            lastFlowerKey = flowerKey;
            for (let i = 0; i < visibleFlowers; i++) {
                colTmp.set(preset.flowers[flowerPaletteIdx[i] % preset.flowers.length]);
                flowerInst.setColorAt(i, colTmp);
            }
            if (flowerInst.instanceColor) flowerInst.instanceColor.needsUpdate = true;
        }
    }

    function update(dt, time, wind = 0.6) {
        sharedGround.uTime.value = time;
        flowerUniforms.uTime.value = time;
        flowerUniforms.uWind.value = wind;
        rotor.rotation.z -= dt * (0.25 + wind * 0.45);
        for (const t of trees) {
            t.group.rotation.z = Math.sin(time * (1.2 + wind * 0.6) + t.phase) * 0.018 * wind;
        }
    }

    return {
        applyPreset,
        update,
        setInteractTexture(tex) {
            if (tex) sharedGround.uInteractMap.value = tex;
        },
        getGroundPbrState: () => {
            const out = {
                ground: { metalness: groundMat.metalness, roughness: Number(groundMat.roughness.toFixed(3)) },
                lawn: { metalness: lawnMat.metalness, roughness: Number(lawnMat.roughness.toFixed(3)) }
            };
            for (const [key, mats] of pbrPropMats.entries()) {
                if (mats.length) {
                    out[key] = { metalness: mats[0].metalness, roughness: Number(mats[0].roughness.toFixed(3)) };
                }
            }
            return out;
        },
        dispose() {
            scene.remove(group);
            for (const d of disposables) d?.dispose?.();
        }
    };
}
