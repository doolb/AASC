// 可交互实例化草地：风浪、鼠标拨草、小猪占位压倒、滑动踩踏轨迹、季节着色与积雪/湿润。
import * as THREE from '../vendor/three.module.min.js';
import { seededRandom } from './presets.mjs?v=20261123c';
import { groundHeight } from './geometry.mjs?v=20261123c';
import { entityCells, gridToWorldCenter } from './models.mjs?v=20261123c';

const INTERACT_SIZE = 256;
const WORLD_SPAN = 48; // 交互贴图覆盖 [-24, 24] 世界区间
const DESKTOP_GRASS_COUNTS = { high: 140000, medium: 36000, low: 22000 };
const MOBILE_GRASS_COUNTS = { high: 36000, medium: 22000, low: 12000 };

// 按设备类型、性能档位与软光栅标记计算草叶数量（手机端每档较桌面端往下降一档）
export function grassCountForTier(tier = 'high', isMobile = false, isSoftware = false) {
    if (isSoftware) return 1500;
    const table = isMobile ? MOBILE_GRASS_COUNTS : DESKTOP_GRASS_COUNTS;
    return table[tier] || table.high;
}

// 构建 5 段渐细弯折草叶几何体（参考 Painted Valley 清晰可见的水粉刷痕草叶宽度）。
function createBladeGeometry() {
    const segs = 5;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const w = 0.072 * (1 - t * 0.86);
        const y = t;
        const bendZ = t * t * 0.16;
        positions.push(-w, y, bendZ, w, y, bendZ);
        uvs.push(0, t, 1, t);
        if (i < segs) {
            const base = i * 2;
            indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

export function createGrass(scene, textures, level, tier = 'high', isSoftware = false) {
    const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
    const maxBlades = grassCountForTier(tier, isMobile, isSoftware);
    const cols = level.columns;
    const rows = level.rows;
    const halfW = cols / 2;
    const halfH = rows / 2;

    const bladeGeo = createBladeGeometry();
    const offsets = new Float32Array(maxBlades * 2);
    const baseYs = new Float32Array(maxBlades);
    const heights = new Float32Array(maxBlades);
    const angles = new Float32Array(maxBlades);
    const tints = new Float32Array(maxBlades);

    const rand = seededRandom(level.id * 31 + 19);
    const innerTarget = Math.floor(maxBlades * 0.28);
    let idx = 0;

    // 先在棋盘区加密矮草（不遮挡小猪底部）
    while (idx < innerTarget) {
        const x = (rand() - 0.5) * (cols + 0.6);
        const z = (rand() - 0.5) * (rows + 0.6);
        offsets[idx * 2] = x;
        offsets[idx * 2 + 1] = z;
        baseYs[idx] = 0;
        heights[idx] = 0.10 + rand() * 0.09;
        angles[idx] = rand() * Math.PI * 2;
        tints[idx] = rand();
        idx++;
    }
    // 再在外围草坪布置中高草（棋盘外 0.4～22 格，靠中心略密，并贴合丘陵起伏高度）
    while (idx < maxBlades) {
        const u = rand() * 2 - 1;
        const v = rand() * 2 - 1;
        // 偏向中心分布
        const sx = Math.sign(u) * Math.pow(Math.abs(u), 1.35) * 24;
        const sz = Math.sign(v) * Math.pow(Math.abs(v), 1.35) * 24;
        if (Math.abs(sx) < halfW + 0.35 && Math.abs(sz) < halfH + 0.35) continue;
        const dist = Math.hypot(Math.max(0, Math.abs(sx) - halfW), Math.max(0, Math.abs(sz) - halfH));
        offsets[idx * 2] = sx;
        offsets[idx * 2 + 1] = sz;
        baseYs[idx] = Math.max(0, groundHeight(sx, sz, halfW, halfH) - 0.03);
        heights[idx] = dist < 3 ? 0.28 + rand() * 0.24 : 0.42 + rand() * 0.48;
        angles[idx] = rand() * Math.PI * 2;
        tints[idx] = rand();
        idx++;
    }

    bladeGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
    bladeGeo.setAttribute('aBaseY', new THREE.InstancedBufferAttribute(baseYs, 1));
    bladeGeo.setAttribute('aHeight', new THREE.InstancedBufferAttribute(heights, 1));
    bladeGeo.setAttribute('aAngle', new THREE.InstancedBufferAttribute(angles, 1));
    bladeGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 1));

    // CPU 交互贴图：R=踩踏（随时间衰减）、G=角色占位、B=保留
    const interactData = new Uint8Array(INTERACT_SIZE * INTERACT_SIZE * 4);
    const interactTex = new THREE.DataTexture(interactData, INTERACT_SIZE, INTERACT_SIZE, THREE.RGBAFormat);
    interactTex.magFilter = THREE.LinearFilter;
    interactTex.minFilter = THREE.LinearFilter;
    interactTex.needsUpdate = true;

    const uniforms = {
        uTime: { value: 0 },
        uWind: { value: 0.6 },
        uSnow: { value: 0 },
        uWet: { value: 0 },
        uNoiseMap: { value: textures.noiseMap() },
        uInteractMap: { value: interactTex },
        uRootColor: { value: new THREE.Color('#74bf54') },
        uTipColor: { value: new THREE.Color('#b4e07e') },
        uSunDir: { value: new THREE.Vector3(0.4, 0.85, 0.35).normalize() },
        uShadowEnabled: { value: 0 },
        uShadowMap: { value: textures.noiseMap() },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uShadowTexel: { value: 1 / 1024 },
        uShadowStrength: { value: 0.9 },
        uHorizonColor: { value: new THREE.Color('#b5dff7') }
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */`
            attribute vec2 aOffset;
            attribute float aBaseY;
            attribute float aHeight;
            attribute float aAngle;
            attribute float aTint;
            uniform float uTime;
            uniform float uWind;
            uniform float uSnow;
            uniform mat4 uShadowMatrix;
            uniform sampler2D uNoiseMap;
            uniform sampler2D uInteractMap;
            varying float vY;
            varying float vTint;
            varying float vTrample;
            varying vec2 vWorldXZ;
            varying vec4 vShadowCoord;
            void main() {
                float h = aHeight * (1.0 - uSnow * 0.35);
                float c = cos(aAngle), s = sin(aAngle);
                vec3 localPos = vec3(
                    position.x * c - position.z * s,
                    position.y * h,
                    position.x * s + position.z * c
                );
                vec2 worldXZ = aOffset;
                vec2 iUv = worldXZ / ${WORLD_SPAN.toFixed(1)} + 0.5;
                vec4 inter = texture2D(uInteractMap, clamp(iUv, 0.0, 1.0));
                float trample = inter.r;
                float occupy = inter.g;

                // 计算踩踏梯度，沿远离踩踏中心方向倒伏。
                float eps = 1.0 / ${INTERACT_SIZE.toFixed(1)};
                float rL = texture2D(uInteractMap, clamp(iUv - vec2(eps, 0.0), 0.0, 1.0)).r;
                float rR = texture2D(uInteractMap, clamp(iUv + vec2(eps, 0.0), 0.0, 1.0)).r;
                float rD = texture2D(uInteractMap, clamp(iUv - vec2(0.0, eps), 0.0, 1.0)).r;
                float rU = texture2D(uInteractMap, clamp(iUv + vec2(0.0, eps), 0.0, 1.0)).r;
                vec2 pushDir = vec2(rL - rR, rD - rU);
                float pushLen = length(pushDir);
                vec2 bendDir = pushLen > 0.001 ? pushDir / pushLen : vec2(c, s);

                // 风场波浪
                vec2 windUv = worldXZ * 0.025 + vec2(uTime * 0.055, uTime * 0.032);
                vec4 nSample = texture2D(uNoiseMap, windUv);
                float wave = sin(uTime * 2.1 + nSample.r * 6.2831 + worldXZ.x * 0.25) * 0.5 + 0.5;
                float sway = (wave * 0.26 + nSample.g * 0.14 - 0.1) * uWind * uv.y * uv.y;

                float flatten = clamp(trample * 0.72 + occupy * 0.85, 0.0, 0.9);
                localPos.y *= (1.0 - flatten);
                localPos.xz += vec2(1.0, 0.45) * sway * (1.0 - occupy * 0.7);
                localPos.xz += bendDir * (trample * 0.32 + occupy * 0.18) * uv.y;

                vec3 worldPos = vec3(worldXZ.x + localPos.x, aBaseY + localPos.y, worldXZ.y + localPos.z);
                vY = uv.y;
                vTint = aTint;
                vTrample = trample;
                vWorldXZ = worldXZ;
                vShadowCoord = uShadowMatrix * vec4(worldPos, 1.0);
                gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform float uTime;
            uniform float uSnow;
            uniform float uWet;
            uniform float uShadowEnabled;
            uniform float uShadowTexel;
            uniform float uShadowStrength;
            uniform sampler2D uNoiseMap;
            uniform sampler2D uShadowMap;
            uniform vec3 uRootColor;
            uniform vec3 uTipColor;
            uniform vec3 uSunDir;
            uniform vec3 uHorizonColor;
            varying float vY;
            varying float vTint;
            varying float vTrample;
            varying vec2 vWorldXZ;
            varying vec4 vShadowCoord;
            const vec4 UNPACK_DEPTH = (255.0 / 256.0) / vec4(256.0 * 256.0 * 256.0, 256.0 * 256.0, 256.0, 1.0);
            float unpackDepth(vec4 v) { return dot(v, UNPACK_DEPTH); }
            void main() {
                // Painted Valley 双阶明暗水粉草叶：根部柔和承接明亮草地、叶尖高饱和亮黄绿，约 13% 混入金色麦草秆。
                vec3 base = mix(uRootColor, uTipColor, 0.28 + 0.72 * smoothstep(0.0, 0.80, vY));
                if (vTint > 0.87) {
                    vec3 straw = mix(vec3(0.74, 0.78, 0.44), vec3(0.92, 0.88, 0.58), smoothstep(0.08, 0.88, vY));
                    base = mix(base, straw, 0.76);
                }
                // 雨天湿润与冬季草尖积雪先参与表面基底色混合，再统一经过光照/云影/实时阴影计算，确保冬季雪草同样接收投影
                base = mix(base, base * 0.90 + vec3(0.06, 0.09, 0.11) * vY * vY, uWet * 0.65);
                base = mix(base, vec3(0.95, 0.97, 1.0), uSnow * smoothstep(0.35, 0.95, vY) * 0.85);
                vec4 patchN = texture2D(uNoiseMap, vWorldXZ * 0.025);
                // 大尺度晴天受光亮部与冷润阴影区对比（单根草叶内仍保留亮根底色）
                float sunPatch = smoothstep(0.38, 0.62, patchN.b);
                vec3 patchTint = mix(vec3(0.76, 0.82, 0.86), vec3(1.16, 1.14, 1.02), sunPatch);
                base *= patchTint * (0.97 + (vTint - 0.5) * 0.08);
                // 移动云影（拉大晴天云影暗部与阳光区层次）
                float cloud = texture2D(uNoiseMap, vWorldXZ * 0.015 + vec2(uTime * 0.01, uTime * 0.006)).r;
                float shadowK = mix(0.72, 1.12, smoothstep(0.36, 0.64, cloud));
                base *= shadowK;
                // 采样太阳方向光阴影贴图（5 点 PCF），在线性空间匹配地面的冷青阴影强度，让树影/木屋/栅栏/小猪阴影清晰落到草叶上
                if (uShadowEnabled > 0.5) {
                    vec3 sc = vShadowCoord.xyz / vShadowCoord.w;
                    if (sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0 && sc.z <= 1.0) {
                        float bias = 0.0009;
                        float s = (sc.z - bias > unpackDepth(texture2D(uShadowMap, sc.xy))) ? 1.0 : 0.0;
                        s += (sc.z - bias > unpackDepth(texture2D(uShadowMap, sc.xy + vec2(-0.8, -0.8) * uShadowTexel))) ? 1.0 : 0.0;
                        s += (sc.z - bias > unpackDepth(texture2D(uShadowMap, sc.xy + vec2(0.8, -0.8) * uShadowTexel))) ? 1.0 : 0.0;
                        s += (sc.z - bias > unpackDepth(texture2D(uShadowMap, sc.xy + vec2(-0.8, 0.8) * uShadowTexel))) ? 1.0 : 0.0;
                        s += (sc.z - bias > unpackDepth(texture2D(uShadowMap, sc.xy + vec2(0.8, 0.8) * uShadowTexel))) ? 1.0 : 0.0;
                        base *= mix(vec3(1.0), vec3(0.22, 0.30, 0.38), (s * 0.2) * uShadowStrength);
                    }
                }
                // 踩踏微暗
                base *= 1.0 - vTrample * 0.06;
                // 远景柔和空气透视雾化，使边缘草叶平滑融入地平线，不与地貌产生硬割裂
                float gAerial = smoothstep(20.0, 36.0, length(vWorldXZ)) * 0.36;
                float gLum = dot(base, vec3(0.299, 0.587, 0.114));
                base = mix(mix(base, vec3(gLum), gAerial * 0.45), uHorizonColor, gAerial);
                gl_FragColor = vec4(base, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `
    });

    const mesh = new THREE.InstancedMesh(bladeGeo, material, maxBlades);
    mesh.frustumCulled = false;
    scene.add(mesh);

    let trampleDirty = false;
    const tmpCenter = new THREE.Vector3();

    // 在指定世界坐标写入 R 通道踩踏值。
    function stamp(wx, wz, radius = 0.75, strength = 1.0) {
        const cx = ((wx / WORLD_SPAN) + 0.5) * INTERACT_SIZE;
        const cz = ((wz / WORLD_SPAN) + 0.5) * INTERACT_SIZE;
        const pr = Math.ceil((radius / WORLD_SPAN) * INTERACT_SIZE);
        const minX = Math.max(0, Math.floor(cx - pr));
        const maxX = Math.min(INTERACT_SIZE - 1, Math.ceil(cx + pr));
        const minZ = Math.max(0, Math.floor(cz - pr));
        const maxZ = Math.min(INTERACT_SIZE - 1, Math.ceil(cz + pr));
        const valMax = Math.round(THREE.MathUtils.clamp(strength, 0, 1) * 255);
        for (let z = minZ; z <= maxZ; z++) {
            for (let x = minX; x <= maxX; x++) {
                const d = Math.hypot(x - cx, z - cz) / Math.max(1, pr);
                if (d > 1) continue;
                const falloff = (1 - d) * (1 - d);
                const idx4 = (z * INTERACT_SIZE + x) * 4;
                const v = Math.round(valMax * falloff);
                if (v > interactData[idx4]) interactData[idx4] = v;
            }
        }
        trampleDirty = true;
    }

    // 每帧重绘 G 通道（在场小猪/动物占格压扁下方草叶），衰减 R 通道，并同步实时方向光阴影贴图。
    function update(dt, time, state, actorPositions, preset, shadowData = null, horizonColor = null) {
        uniforms.uTime.value = time;
        if (horizonColor) uniforms.uHorizonColor.value.copy(horizonColor);
        if (shadowData && shadowData.enabled && shadowData.map) {
            uniforms.uShadowEnabled.value = 1;
            uniforms.uShadowMap.value = shadowData.map;
            uniforms.uShadowMatrix.value.copy(shadowData.matrix);
            uniforms.uShadowTexel.value = shadowData.texel;
            uniforms.uShadowStrength.value = shadowData.strength;
        } else {
            uniforms.uShadowEnabled.value = 0;
        }
        if (preset) {
            uniforms.uWind.value = preset.wind;
            uniforms.uSnow.value = preset.snowCover;
            uniforms.uWet.value = preset.wetness;
            uniforms.uRootColor.value.set(preset.grassRoot);
            uniforms.uTipColor.value.set(preset.grassTip);
        }

        // 清空 G 通道
        for (let i = 1; i < interactData.length; i += 4) interactData[i] = 0;

        const markCell = (wx, wz, radius = 0.55) => {
            const cx = ((wx / WORLD_SPAN) + 0.5) * INTERACT_SIZE;
            const cz = ((wz / WORLD_SPAN) + 0.5) * INTERACT_SIZE;
            const pr = Math.ceil((radius / WORLD_SPAN) * INTERACT_SIZE);
            const minX = Math.max(0, Math.floor(cx - pr));
            const maxX = Math.min(INTERACT_SIZE - 1, Math.ceil(cx + pr));
            const minZ = Math.max(0, Math.floor(cz - pr));
            const maxZ = Math.min(INTERACT_SIZE - 1, Math.ceil(cz + pr));
            for (let z = minZ; z <= maxZ; z++) {
                for (let x = minX; x <= maxX; x++) {
                    if (Math.hypot(x - cx, z - cz) <= pr) interactData[(z * INTERACT_SIZE + x) * 4 + 1] = 255;
                }
            }
        };

        if (state) {
            for (const pig of state.pigs) {
                if (pig.gone) continue;
                const pos = actorPositions.get(pig.id);
                if (pos) {
                    markCell(pos.x, pos.z, 0.72);
                } else {
                    gridToWorldCenter(entityCells(pig), cols, rows, tmpCenter);
                    markCell(tmpCenter.x, tmpCenter.z, 0.65);
                }
            }
            for (const [dx, dy] of state.ducks || []) {
                markCell(dx - halfW + 0.5, dy - halfH + 0.5, 0.42);
            }
        }

        // 踩踏逐渐回弹
        let anyTrample = false;
        const decay = Math.pow(0.42, dt);
        for (let i = 0; i < interactData.length; i += 4) {
            if (interactData[i] > 0) {
                interactData[i] = Math.floor(interactData[i] * decay);
                if (interactData[i] > 0) anyTrample = true;
            }
        }
        if (trampleDirty || anyTrample || state) {
            interactTex.needsUpdate = true;
            trampleDirty = anyTrample;
        }
    }

    return {
        stamp,
        update,
        setTierCount(nextTier) {
            mesh.count = Math.min(maxBlades, grassCountForTier(nextTier, isMobile, isSoftware));
        },
        getCount: () => mesh.count,
        dispose() {
            scene.remove(mesh);
            bladeGeo.dispose();
            material.dispose();
            interactTex.dispose();
        }
    };
}
