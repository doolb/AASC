// 角色与棋盘物件程序化建模：猪、小象、小鸭、铁笼、各类机制配件与提示指示器。
import * as THREE from '../vendor/three.module.min.js';
import { PART, part, trs, mergeParts, shadeGradient, outlineOf, curlTail, helixTube } from './geometry.mjs?v=20261125j';

// 机制配件与铁笼的无贴图 PBR 金属度/粗糙度预设
export const PBR_ACCESSORY_PRESETS = {
    steel: { metalness: 0.82, roughness: 0.26 },
    gold: { metalness: 0.86, roughness: 0.22 },
    spring: { metalness: 0.72, roughness: 0.28 },
    ironBomb: { metalness: 0.68, roughness: 0.42 },
    paintedRed: { metalness: 0.16, roughness: 0.46 },
    rope: { metalness: 0.04, roughness: 0.82 }
};

export const DIR_ANGLES = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 };
export const DIR_VECTORS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// 计算棋盘实体的精确占格列表（与 engine.mjs 保持一致）。
export function entityCells(pig) {
    if (pig.shape) return pig.shape.map(([sx, sy]) => [pig.x + sx, pig.y + sy]);
    const horizontal = pig.direction === 'east' || pig.direction === 'west';
    const w = pig.width || 1;
    const cells = [];
    for (let offset = 0; offset < pig.length; offset++) {
        for (let side = 0; side < w; side++) {
            cells.push([pig.x + (horizontal ? offset : side), pig.y + (horizontal ? side : offset)]);
        }
    }
    return cells;
}

// 网格坐标转世界坐标中心。
export function gridToWorldCenter(cells, columns, rows, target = new THREE.Vector3()) {
    let sx = 0, sy = 0;
    for (let i = 0; i < cells.length; i++) {
        sx += cells[i][0];
        sy += cells[i][1];
    }
    const n = cells.length || 1;
    return target.set(sx / n - columns / 2 + 0.5, 0, sy / n - rows / 2 + 0.5);
}

// 根据棋盘格坐标生成局部尺寸（默认朝向 +Z 为长度方向），保留前版造型并将中段肚子微微加粗。
function buildPigGeometry(length, width, kind) {
    const parts = [];
    const bodyColor = kind === 'bomb' ? '#ef807a' : kind === 'timer_bomb' ? '#eb7c77' : '#ef8f8a';
    const bellyColor = '#fac2ba';
    const earColor = '#e2716b';
    const snoutColor = '#e66a6a';
    const legColor = '#e88a84';
    const hoofColor = '#854540';
    const tailColor = '#ce6f6c';
    const cheekColor = '#ff6575';

    const totalLen = Math.max(1.5, length) * 0.92;
    const radius = Math.min(0.4, 0.34 * Math.min(width, 1.3));
    const capLen = Math.max(0.25, totalLen - radius * 2.15);

    // 躯干（沿 Z 轴胶囊）+ 中段微微加粗鼓起的圆肚子
    parts.push(part(new THREE.CapsuleGeometry(radius, capLen, 4, 10), bodyColor, trs(0, radius + 0.09, -0.04, Math.PI / 2, 0, 0), PART.BODY));
    parts.push(part(new THREE.SphereGeometry(radius, 10, 8), bodyColor, trs(0, radius + 0.08, -0.05, 0, 0, 0, 1.15, 1.05, (capLen + radius * 0.85) / (radius * 1.9)), PART.BODY));
    // 圆润浅色下肚皮
    parts.push(part(new THREE.SphereGeometry(radius * 0.92, 9, 7), bellyColor, trs(0, radius * 0.72 + 0.07, -0.04, 0, 0, 0, 1.08, 0.76, (capLen + radius * 1.4) / (radius * 1.8)), PART.BODY));

    const headZ = capLen * 0.5 + radius * 0.56;
    const headY = radius + 0.16;
    // 头部：从下颌深饱和珊瑚粉平滑渐变到额顶暖蜜桃粉，强化面部立体感与水粉色彩饱和度
    const headGeo = shadeGradient(new THREE.SphereGeometry(radius * 0.86, 12, 10), '#d9635e', '#faafa6', 'y');
    parts.push(part(headGeo, null, trs(0, headY, headZ, 0, 0, 0, 1.04, 0.98, 0.96), PART.HEAD));
    // 腮红
    for (const sx of [-1, 1]) {
        parts.push(part(new THREE.SphereGeometry(0.065, 6, 5), cheekColor, trs(sx * radius * 0.68, headY - 0.05, headZ + radius * 0.5, 0, 0, 0, 1.1, 0.72, 0.45), PART.HEAD));
    }
    // 鼻筒与双鼻孔
    const snoutZ = headZ + radius * 0.84;
    parts.push(part(new THREE.CylinderGeometry(0.115, 0.13, 0.1, 9), snoutColor, trs(0, headY - 0.03, snoutZ, Math.PI / 2, 0, 0, 1.15, 1, 0.88), PART.HEAD));
    for (const sx of [-1, 1]) {
        parts.push(part(new THREE.SphereGeometry(0.024, 5, 4), '#7b3e3b', trs(sx * 0.046, headY - 0.025, snoutZ + 0.046), PART.HEAD));
    }
    // 垂耳（左右微倾）
    for (const sx of [-1, 1]) {
        parts.push(part(new THREE.ConeGeometry(0.095, 0.2, 6), earColor, trs(sx * radius * 0.68, headY + radius * 0.64, headZ + 0.03, 0.48, 0, -sx * 0.52, 0.85, 1, 0.5), PART.EAR));
    }
    // 四肢与蹄子
    const legZ = capLen * 0.42 + radius * 0.28;
    const legX = radius * 0.54;
    for (const sz of [-1, 1]) {
        for (const sx of [-1, 1]) {
            const lz = sz * legZ - 0.04;
            const lx = sx * legX;
            parts.push(part(new THREE.CylinderGeometry(0.065, 0.055, 0.16, 6), legColor, trs(lx, 0.1, lz)));
            parts.push(part(new THREE.CylinderGeometry(0.056, 0.058, 0.045, 6), hoofColor, trs(lx, 0.025, lz)));
        }
    }
    // 螺旋卷尾
    const tailZ = -capLen * 0.5 - radius * 0.82;
    parts.push(part(curlTail(0.085, 0.024), tailColor, trs(0, radius + 0.13, tailZ, 0.2, Math.PI / 2, 0), PART.TAIL));
    return mergeParts(parts);
}

// 眼睛以眼窝中心为局部 Y=0 原点合并，确保眨眼缩小时眼球原位闭合而不向下掉出头部。
function buildPigEyesGeometry(length, width) {
    const totalLen = Math.max(1.5, length) * 0.92;
    const radius = Math.min(0.4, 0.34 * Math.min(width, 1.3));
    const capLen = Math.max(0.25, totalLen - radius * 2.15);
    const headZ = capLen * 0.5 + radius * 0.56;
    const headY = radius + 0.16;
    const eyeY = headY + 0.065;
    const parts = [];
    for (const sx of [-1, 1]) {
        const ex = sx * radius * 0.42;
        const ez = headZ + radius * 0.72;
        parts.push(part(new THREE.SphereGeometry(0.046, 8, 8), '#34201d', trs(ex, 0, ez)));
        parts.push(part(new THREE.SphereGeometry(0.018, 6, 6), '#ffffff', trs(ex + sx * 0.012, 0.018, ez + 0.036)));
    }
    return { geo: mergeParts(parts), eyeY };
}

function buildElephantGeometry(length, width) {
    const parts = [];
    const gray = '#9aa8b8';
    const light = '#bcc8d6';
    const dark = '#6d7b8c';
    const ivory = '#fff6e0';
    const wSpan = width * 0.84;
    const lSpan = length * 0.88;
    const bodyR = Math.min(0.68, wSpan * 0.46);
    const capLen = Math.max(0.4, lSpan - bodyR * 1.9);

    parts.push(part(new THREE.CapsuleGeometry(bodyR, capLen, 10, 16), gray, trs(0, bodyR + 0.14, -0.05, Math.PI / 2, 0, 0)));
    const headZ = capLen * 0.48 + bodyR * 0.55;
    const headY = bodyR + 0.22;
    parts.push(part(new THREE.SphereGeometry(bodyR * 0.74, 14, 12), gray, trs(0, headY, headZ)));
    // 大扇耳
    for (const sx of [-1, 1]) {
        parts.push(part(new THREE.SphereGeometry(bodyR * 0.62, 12, 10), gray, trs(sx * bodyR * 0.72, headY + 0.05, headZ - 0.1, 0.15, sx * 0.35, 0, 0.25, 1.05, 0.82)));
        parts.push(part(new THREE.SphereGeometry(bodyR * 0.44, 10, 8), '#dfa6ab', trs(sx * bodyR * 0.7, headY + 0.04, headZ - 0.06, 0.15, sx * 0.35, 0, 0.22, 0.95, 0.7)));
    }
    // 弯曲长鼻与象牙
    parts.push(part(new THREE.CylinderGeometry(0.11, 0.075, 0.56, 10), light, trs(0, headY - 0.2, headZ + bodyR * 0.68, -0.32, 0, 0)));
    parts.push(part(new THREE.SphereGeometry(0.085, 8, 8), light, trs(0, headY - 0.43, headZ + bodyR * 0.78)));
    for (const sx of [-1, 1]) {
        parts.push(part(new THREE.ConeGeometry(0.04, 0.24, 8), ivory, trs(sx * 0.18, headY - 0.12, headZ + bodyR * 0.66, Math.PI * 0.62, 0, -sx * 0.18)));
        parts.push(part(new THREE.SphereGeometry(0.055, 8, 8), '#2c2220', trs(sx * bodyR * 0.38, headY + 0.12, headZ + bodyR * 0.55)));
        parts.push(part(new THREE.SphereGeometry(0.02, 6, 6), '#ffffff', trs(sx * bodyR * 0.39, headY + 0.14, headZ + bodyR * 0.59)));
    }
    // 粗壮四腿
    for (const sz of [-1, 1]) {
        for (const sx of [-1, 1]) {
            const lx = sx * bodyR * 0.48;
            const lz = sz * (capLen * 0.42 + bodyR * 0.22) - 0.05;
            parts.push(part(new THREE.CylinderGeometry(0.14, 0.13, 0.26, 10), gray, trs(lx, 0.13, lz)));
            parts.push(part(new THREE.CylinderGeometry(0.135, 0.14, 0.05, 10), dark, trs(lx, 0.025, lz)));
        }
    }
    return mergeParts(parts);
}

function buildDuckGeometry() {
    const parts = [];
    const yellow = '#ffd94a';
    const belly = '#fff0a6';
    const orange = '#ff8b2b';
    parts.push(part(new THREE.SphereGeometry(0.28, 12, 10), yellow, trs(0, 0.28, -0.02, 0, 0, 0, 0.95, 0.85, 1.15)));
    parts.push(part(new THREE.SphereGeometry(0.22, 10, 8), belly, trs(0, 0.24, 0.02, 0, 0, 0, 0.88, 0.72, 1.0)));
    parts.push(part(new THREE.SphereGeometry(0.2, 12, 10), yellow, trs(0, 0.52, 0.11)));
    // 扁嘴
    parts.push(part(new THREE.CylinderGeometry(0.08, 0.11, 0.12, 10), orange, trs(0, 0.49, 0.31, Math.PI / 2, 0, 0, 1.35, 1, 0.52)));
    // 小翅膀与尾翘
    for (const sx of [-1, 1]) {
        parts.push(part(new THREE.SphereGeometry(0.11, 8, 8), '#f7c52e', trs(sx * 0.25, 0.31, -0.02, 0, 0, -sx * 0.3, 0.42, 0.8, 1.25)));
        parts.push(part(new THREE.SphereGeometry(0.03, 6, 6), '#2a1f1c', trs(sx * 0.11, 0.56, 0.26)));
        parts.push(part(new THREE.SphereGeometry(0.012, 5, 5), '#ffffff', trs(sx * 0.11, 0.57, 0.285)));
    }
    parts.push(part(new THREE.ConeGeometry(0.09, 0.18, 6), yellow, trs(0, 0.38, -0.29, -0.8, 0, 0)));
    return mergeParts(parts);
}

// 构造小道具工厂：按种类/尺寸缓存几何体，共用卡通材质与描边材质。
export function createModelFactory(textures) {
    const gradientMap = textures.gradient3();
    // Painted Valley 手绘水粉双阶明暗着色器：保持经典哑光水粉质感与顶面微辉，随太阳/月亮实时转光，并仅在明暗交界线叠加次表面散射 (SSS)
    const toonMat = new THREE.ShaderMaterial({
        vertexColors: true,
        uniforms: {
            uLightDir: { value: new THREE.Vector3(-0.74, 0.44, 0.50).normalize() },
            uLightColor: { value: new THREE.Color('#fffdf6') },
            uTimeTint: { value: new THREE.Color('#ffffff') },
            uNightMix: { value: 0 },
            uMoonFactor: { value: 1 },
            uSnow: { value: 0 }
        },
        vertexShader: /* glsl */`
            varying vec3 vColor;
            varying vec3 vWorldNormal;
            void main() {
                vColor = color;
                vWorldNormal = normalize(mat3(modelMatrix) * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform vec3 uLightDir;
            uniform vec3 uLightColor;
            uniform vec3 uTimeTint;
            uniform float uNightMix;
            uniform float uMoonFactor;
            uniform float uSnow;
            varying vec3 vColor;
            varying vec3 vWorldNormal;
            void main() {
                vec3 N = normalize(vWorldNormal);
                float ndl = dot(N, normalize(uLightDir));
                float litStep = smoothstep(mix(0.06, -0.08, uNightMix), mix(0.30, 0.48, uNightMix), ndl);
                float hiStep = smoothstep(0.56, 0.80, ndl);
                float wrapGrad = smoothstep(-0.62, 0.72, ndl);
                float topRim = smoothstep(0.55, 0.94, N.y) * 0.09;

                // 夜晚区分受光亮面与暗面：亮面按晴/阴/雨月光强弱柔和照亮（晴夜适中不刺眼），同时压低 topRim/hiStep 消除塑料反光
                vec3 litBase = vColor * mix(vec3(1.0), uTimeTint, 0.22 + 0.26 * uNightMix);
                vec3 shadeBase = vColor * mix(vec3(1.0), uTimeTint, 0.28 + 0.44 * uNightMix * (1.0 - uSnow * 0.20));
                vec3 moonSilver = mix(uLightColor, mix(vec3(1.0, 0.98, 0.96), uLightColor, 0.54), uNightMix);
                vec3 litCol = litBase * moonSilver * mix(vec3(1.06, 0.94, 0.90), vec3(1.18, 1.08, 1.00), wrapGrad) * mix(1.0, 0.54 + 0.38 * uMoonFactor, uNightMix)
                    + vec3(0.04, 0.025, 0.015) * (1.0 - uNightMix * 0.90)
                    + hiStep * uLightColor * 0.08 * (1.0 - uNightMix * 0.88)
                    + topRim * mix(vec3(1.0), uLightColor, 0.65) * (1.0 - uNightMix * 0.85);
                vec3 shadeCol = shadeBase * mix(vec3(0.42, 0.31, 0.39), vec3(0.56, 0.42, 0.48), wrapGrad)
                    * mix(vec3(1.0), mix(vec3(0.58, 0.68, 0.96), vec3(0.72, 0.82, 1.02), uSnow), uNightMix * 0.72)
                    * (1.0 + uSnow * (0.18 + 0.14 * (1.0 - N.y * 0.40)));

                // 仅在明暗交界线 (ndl ≈ 0.16 附近) 精准叠加柔和的暖桃粉次表面散射带
                float termSSS = exp(-pow((ndl - 0.16) / 0.20, 2.0));
                vec3 sssTint = mix(vec3(1.0, 0.42, 0.34), vec3(0.54, 0.50, 0.84), uNightMix * 0.65);
                vec3 sssBand = litBase * sssTint * termSSS * mix(0.28, 0.16, uNightMix);

                gl_FragColor = vec4(mix(shadeCol, litCol, litStep) + sssBand, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `
    });
    const outlineMat = new THREE.MeshBasicMaterial({ color: '#7a3f3b', side: THREE.BackSide });
    const eyeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const metalMat = new THREE.MeshStandardMaterial({ color: '#c4d5ea', ...PBR_ACCESSORY_PRESETS.steel });
    const goldMat = new THREE.MeshStandardMaterial({ color: '#f2be3d', ...PBR_ACCESSORY_PRESETS.gold });
    const blueCoilMat = new THREE.MeshStandardMaterial({ color: '#397aa9', ...PBR_ACCESSORY_PRESETS.rope });
    const springMat = new THREE.MeshStandardMaterial({ color: '#4fa2ff', ...PBR_ACCESSORY_PRESETS.spring });
    const redMat = new THREE.MeshStandardMaterial({ color: '#c84231', ...PBR_ACCESSORY_PRESETS.paintedRed });
    const bombMat = new THREE.MeshStandardMaterial({ color: '#2b2629', ...PBR_ACCESSORY_PRESETS.ironBomb });

    const geoCache = new Map();
    const outlineCache = new Map();
    const eyesCache = new Map();
    const disposables = [toonMat, outlineMat, eyeMat, metalMat, goldMat, blueCoilMat, springMat, redMat, bombMat];

    function cachedGeo(key, builder, thickness = 0.026) {
        if (!geoCache.has(key)) {
            const g = builder();
            const o = outlineOf(g, thickness);
            geoCache.set(key, g);
            outlineCache.set(key, o);
            disposables.push(g, o);
        }
        return [geoCache.get(key), outlineCache.get(key)];
    }

    // 配件用复用的基础几何体
    const lockBodyGeo = new THREE.BoxGeometry(0.32, 0.28, 0.16);
    const lockArchGeo = new THREE.TorusGeometry(0.11, 0.032, 8, 16, Math.PI);
    const ropeRingGeo = new THREE.TorusGeometry(0.36, 0.042, 8, 18);
    const springCoilGeo = helixTube(0.35, 3.2, 0.85, 0.036, 40);
    const bombBlockGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    const timerSphereGeo = new THREE.SphereGeometry(0.24, 12, 10);
    const fuseGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6);
    const scissorBladeGeo = new THREE.BoxGeometry(0.06, 0.025, 0.42);
    const scissorRingGeo = new THREE.TorusGeometry(0.075, 0.02, 6, 12);
    const badgePlaneGeo = new THREE.PlaneGeometry(0.56, 0.34);
    const sparkGeo = new THREE.OctahedronGeometry(0.06, 0);
    const sparkMat = new THREE.MeshBasicMaterial({ color: '#ffd95b' });
    const shadowGeo = new THREE.CircleGeometry(0.48, 12);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({ color: '#3b2419', transparent: true, opacity: 0.38, depthWrite: false });
    disposables.push(lockBodyGeo, lockArchGeo, ropeRingGeo, springCoilGeo, bombBlockGeo, timerSphereGeo, fuseGeo, scissorBladeGeo, scissorRingGeo, badgePlaneGeo, sparkGeo, sparkMat, shadowGeo, shadowMat);

    // 构造朝向相机但保持平面可读的数字牌（Sprite）。
    function createBadge(text, style) {
        const tex = textures.label(String(text), style);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(0.66, 0.4, 1);
        sprite.userData = { lastText: String(text), style };
        return sprite;
    }

    function updateBadge(sprite, text, style) {
        const s = String(text);
        if (sprite.userData.lastText === s && sprite.userData.style === style) return;
        sprite.userData.lastText = s;
        sprite.userData.style = style;
        sprite.material.map = textures.label(s, style);
        sprite.material.needsUpdate = true;
    }

    function createActor(pig) {
        const root = new THREE.Group();
        const visual = new THREE.Group();
        root.add(visual);
        root.rotation.y = DIR_ANGLES[pig.direction] ?? 0;

        const isElephant = pig.kind === 'elephant';
        const w = pig.width || 1;
        const len = pig.length || 2;
        const key = isElephant ? `ele:${len}:${w}` : `pig:${len}:${w}:${pig.kind}`;
        const [bodyGeo, outGeo] = cachedGeo(key, () => isElephant ? buildElephantGeometry(len, w) : buildPigGeometry(len, w, pig.kind), isElephant ? 0.032 : 0.024);

        const bodyMesh = new THREE.Mesh(bodyGeo, toonMat);
        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        bodyMesh.userData.pigId = pig.id;
        const outMesh = new THREE.Mesh(outGeo, outlineMat);
        visual.add(bodyMesh, outMesh);

        // 地面接触软阴影，所有画质下均可增强立体锚定感。
        const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
        shadowMesh.position.y = 0.012;
        shadowMesh.scale.set(w * 0.92, 1, Math.max(1.2, len * 0.95));
        root.add(shadowMesh);

        let eyeMesh = null;
        if (!isElephant) {
            const eKey = `eyes:${len}:${w}`;
            if (!eyesCache.has(eKey)) {
                const eyeData = buildPigEyesGeometry(len, w);
                eyesCache.set(eKey, eyeData);
                disposables.push(eyeData.geo);
            }
            const eyeData = eyesCache.get(eKey);
            eyeMesh = new THREE.Mesh(eyeData.geo, eyeMat);
            eyeMesh.position.y = eyeData.eyeY;
            visual.add(eyeMesh);
        }

        // 紧凑拾取包围盒，覆盖小猪轮廓作为精确网格拾取的补充。
        const hitBox = new THREE.Mesh(
            new THREE.BoxGeometry(Math.max(0.76, w * 0.84), isElephant ? 1.25 : 0.74, Math.max(1.35, len * 0.88)),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitBox.position.set(0, isElephant ? 0.62 : 0.37, 0);
        hitBox.userData.pigId = pig.id;
        root.add(hitBox);

        // 根据特殊机制附加 3D 配件。
        const acc = { kind: pig.kind };
        const topY = 0.88;
        if (pig.kind === 'lock') {
            const lockGroup = new THREE.Group();
            lockGroup.position.set(0, topY, 0);
            const lb = new THREE.Mesh(lockBodyGeo, goldMat);
            const la = new THREE.Mesh(lockArchGeo, goldMat);
            la.position.y = 0.14;
            lockGroup.add(lb, la);
            const badge = createBadge(pig.unlockAfter, 'gold');
            badge.position.set(0, 0.34, 0);
            lockGroup.add(badge);
            visual.add(lockGroup);
            acc.lockGroup = lockGroup;
            acc.lockArch = la;
            acc.badge = badge;
        } else if (pig.kind === 'scissors') {
            const scGroup = new THREE.Group();
            scGroup.position.set(0, topY + 0.05, 0);
            const b1 = new THREE.Mesh(scissorBladeGeo, metalMat);
            const b2 = new THREE.Mesh(scissorBladeGeo, metalMat);
            b1.rotation.y = 0.38;
            b2.rotation.y = -0.38;
            const r1 = new THREE.Mesh(scissorRingGeo, redMat);
            const r2 = new THREE.Mesh(scissorRingGeo, redMat);
            r1.rotation.x = Math.PI / 2;
            r2.rotation.x = Math.PI / 2;
            r1.position.set(0.08, 0, -0.22);
            r2.position.set(-0.08, 0, -0.22);
            scGroup.add(b1, b2, r1, r2);
            visual.add(scGroup);
            acc.scGroup = scGroup;
            acc.blade1 = b1;
            acc.blade2 = b2;
        } else if (pig.kind === 'rope') {
            const ropeGroup = new THREE.Group();
            ropeGroup.position.set(0, 0.44, -0.02);
            const coils = [];
            for (let i = 0; i < 4; i++) {
                const coil = new THREE.Mesh(ropeRingGeo, blueCoilMat);
                coil.position.z = (i - 1.5) * 0.22;
                ropeGroup.add(coil);
                coils.push(coil);
            }
            visual.add(ropeGroup);
            acc.ropeGroup = ropeGroup;
            acc.coils = coils;
        } else if (pig.kind === 'spring') {
            const sp = new THREE.Mesh(springCoilGeo, springMat);
            sp.rotation.x = Math.PI / 2;
            sp.position.set(0, 0.45, -0.44);
            visual.add(sp);
            acc.spring = sp;
        } else if (pig.kind === 'bomb') {
            const bGroup = new THREE.Group();
            bGroup.position.set(0, topY, 0);
            const block = new THREE.Mesh(bombBlockGeo, redMat);
            const badge = createBadge(pig.bombCount, 'red');
            badge.position.set(0, 0.34, 0);
            bGroup.add(block, badge);
            visual.add(bGroup);
            acc.bombBlock = block;
            acc.badge = badge;
        } else if (pig.kind === 'timer_bomb') {
            const tGroup = new THREE.Group();
            tGroup.position.set(0, topY + 0.04, 0);
            const sphere = new THREE.Mesh(timerSphereGeo, bombMat);
            const fuse = new THREE.Mesh(fuseGeo, goldMat);
            fuse.position.set(0.06, 0.24, 0);
            fuse.rotation.z = -0.35;
            const spark = new THREE.Mesh(sparkGeo, sparkMat);
            spark.position.set(0.11, 0.32, 0);
            const badge = createBadge(`${pig.timerSeconds}s`, 'timer');
            badge.position.set(0, 0.45, 0);
            tGroup.add(sphere, fuse, spark, badge);
            visual.add(tGroup);
            acc.spark = spark;
            acc.timerSphere = sphere;
            acc.badge = badge;
        }

        return { root, visual, bodyMesh, eyeMesh, hitBox, acc, phase: (pig.id * 1.73) % (Math.PI * 2), blinkTimer: 1.5 + (pig.id % 5) * 0.7 };
    }

    function updateActorAccessory(actor, pig, state, time) {
        const acc = actor.acc;
        if (acc.kind === 'lock') {
            const left = Math.max(0, pig.unlockAfter - state.exitCount);
            acc.lockGroup.visible = left > 0;
            if (left > 0) updateBadge(acc.badge, left, 'gold');
        } else if (acc.kind === 'rope') {
            const count = state.remainingScissors;
            acc.ropeGroup.visible = count > 0;
            for (let i = 0; i < acc.coils.length; i++) {
                acc.coils[i].visible = i < count;
                if (i < count) {
                    const offset = (i - (count - 1) / 2) * 0.24;
                    acc.coils[i].position.z = offset;
                }
            }
        } else if (acc.kind === 'scissors') {
            const open = 0.28 + Math.sin(time * 4.5 + actor.phase) * 0.14;
            acc.blade1.rotation.y = open;
            acc.blade2.rotation.y = -open;
            acc.scGroup.position.y = 0.94 + Math.sin(time * 3 + actor.phase) * 0.03;
        } else if (acc.kind === 'bomb') {
            updateBadge(acc.badge, pig.bombCount, 'red');
        } else if (acc.kind === 'timer_bomb') {
            updateBadge(acc.badge, `${pig.timerSeconds}s`, 'timer');
            const s = 0.8 + Math.sin(time * 18 + actor.phase) * 0.35;
            acc.spark.scale.setScalar(s);
            acc.spark.rotation.y = time * 8;
            if (acc.timerSphere) {
                const urgent = pig.timerSeconds <= 10 ? 1 + Math.abs(Math.sin(time * 10)) * 0.16 : 1;
                acc.timerSphere.scale.setScalar(urgent);
            }
        }
    }

    function createDuck() {
        const [geo, out] = cachedGeo('duck', buildDuckGeometry, 0.02);
        const root = new THREE.Group();
        const mesh = new THREE.Mesh(geo, toonMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const oMesh = new THREE.Mesh(out, outlineMat);
        root.add(mesh, oMesh);
        return root;
    }

    function createCage(cage) {
        const group = new THREE.Group();
        const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.12, 8);
        const barGeo = new THREE.CylinderGeometry(0.032, 0.032, 1.0, 6);
        const cageMat = new THREE.MeshStandardMaterial({ color: '#9ab9d9', ...PBR_ACCESSORY_PRESETS.steel });
        disposables.push(postGeo, barGeo, cageMat);

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [cx, cy] of cage.cells) {
            minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
            minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        }
        const spanX = maxX - minX + 1;
        const spanZ = maxY - minY + 1;
        // 铁笼外框立柱（按边缘分布，保持内部小猪清晰可见）
        for (let i = 0; i <= spanX; i++) {
            for (const sz of [0, spanZ]) {
                const post = new THREE.Mesh(postGeo, cageMat);
                post.position.set(i - spanX / 2, 0.56, sz - spanZ / 2);
                post.castShadow = true;
                group.add(post);
            }
        }
        for (let j = 1; j < spanZ; j++) {
            for (const sx of [0, spanX]) {
                const post = new THREE.Mesh(postGeo, cageMat);
                post.position.set(sx - spanX / 2, 0.56, j - spanZ / 2);
                post.castShadow = true;
                group.add(post);
            }
        }
        // 顶部四周横梁
        const topX = new THREE.Mesh(barGeo, cageMat);
        topX.rotation.z = Math.PI / 2;
        topX.scale.set(1, spanX, 1);
        for (const sz of [-spanZ / 2, spanZ / 2]) {
            const beam = topX.clone();
            beam.position.set(0, 1.12, sz);
            group.add(beam);
        }
        const topZ = new THREE.Mesh(barGeo, cageMat);
        topZ.rotation.x = Math.PI / 2;
        topZ.scale.set(1, spanZ, 1);
        for (const sx of [-spanX / 2, spanX / 2]) {
            const beam = topZ.clone();
            beam.position.set(sx, 1.12, 0);
            group.add(beam);
        }

        const badge = createBadge(cage.unlockAfter, 'steel');
        badge.scale.set(0.95, 0.58, 1);
        badge.position.set(0, 1.52, 0);
        group.add(badge);
        return { group, badge, updateCount: left => updateBadge(badge, left, 'steel') };
    }

    // 表面贴花式提示环（地面贴花 + 直接投影贴附到小猪背部的 3D 表面贴花）+ 卡通浮标 + 受阻碰撞叉号。
    function createMarkers() {
        const decalTex = textures.hintDecal();
        const ringGeo = new THREE.PlaneGeometry(1.75, 1.75);
        const ringMat = new THREE.MeshBasicMaterial({
            map: decalTex,
            transparent: true,
            opacity: 0.94,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.018;
        ring.renderOrder = 2;

        // 投影到选中猪体表面的立体贴花着色器（沿顶部法线投影旋转纹样）
        const bodyDecalUniforms = {
            uMap: { value: decalTex },
            uTime: { value: 0 },
            uSize: { value: new THREE.Vector2(1.4, 2.0) }
        };
        const bodyDecalMat = new THREE.ShaderMaterial({
            uniforms: bodyDecalUniforms,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
            vertexShader: /* glsl */`
                varying vec3 vLocalPos;
                varying vec3 vLocalNorm;
                void main() {
                    vLocalPos = position;
                    vLocalNorm = normalize(normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D uMap;
                uniform float uTime;
                uniform vec2 uSize;
                varying vec3 vLocalPos;
                varying vec3 vLocalNorm;
                void main() {
                    float topMask = smoothstep(0.05, 0.55, vLocalNorm.y);
                    if (topMask <= 0.01) discard;
                    vec2 centered = vLocalPos.xz / uSize;
                    float c = cos(uTime * 0.9), s = sin(uTime * 0.9);
                    vec2 uv = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c) + 0.5;
                    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
                    vec4 tex = texture2D(uMap, uv);
                    float a = tex.a * topMask * 0.92;
                    if (a < 0.03) discard;
                    gl_FragColor = vec4(tex.rgb, a);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `
        });
        const bodyDecal = new THREE.Mesh(new THREE.BufferGeometry(), bodyDecalMat);
        bodyDecal.renderOrder = 3;
        bodyDecal.visible = false;

        const arrowGroup = new THREE.Group();
        const arrowMat = new THREE.MeshStandardMaterial({ color: '#ff9642', emissive: '#ff7018', emissiveIntensity: 0.25, ...PBR_ACCESSORY_PRESETS.paintedRed });
        const arrowEdgeMat = new THREE.MeshBasicMaterial({ color: '#6b361a', side: THREE.BackSide });
        const coneGeo = new THREE.ConeGeometry(0.2, 0.34, 8);
        const cone = new THREE.Mesh(coneGeo, arrowMat);
        cone.rotation.x = Math.PI;
        const coneOut = new THREE.Mesh(coneGeo, arrowEdgeMat);
        coneOut.rotation.x = Math.PI;
        coneOut.scale.setScalar(1.16);
        const stemGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.24, 8);
        const stem = new THREE.Mesh(stemGeo, arrowMat);
        stem.position.y = 0.24;
        arrowGroup.add(cone, coneOut, stem);

        const crossGroup = new THREE.Group();
        const crossMat = new THREE.MeshBasicMaterial({ color: '#ff4f5e', transparent: true, opacity: 0.95 });
        const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.1), crossMat);
        const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.1), crossMat);
        bar1.rotation.z = Math.PI / 4;
        bar2.rotation.z = -Math.PI / 4;
        crossGroup.add(bar1, bar2);
        crossGroup.visible = false;

        // 3D 新手点击手势贴图精灵，悬停在提示目标上方做轻点动画
        const handMat = new THREE.SpriteMaterial({
            map: textures.handPointer(),
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        const handSprite = new THREE.Sprite(handMat);
        // 将精灵枢轴对齐贴图中食指指尖位置（Canvas -0.42 rad 旋转后的指尖 UV），确保任意视角旋转都精准指在目标猪身上
        handSprite.center.set(0.35, 0.84);
        handSprite.scale.set(0.96, 0.96, 1);
        handSprite.renderOrder = 25;
        handSprite.visible = false;

        disposables.push(ringGeo, ringMat, bodyDecalMat, bodyDecal.geometry, arrowMat, arrowEdgeMat, coneGeo, stemGeo, crossMat, bar1.geometry, handMat);
        return { ring, bodyDecal, bodyDecalUniforms, arrowGroup, crossGroup, handSprite };
    }

    function setLightState(lightState) {
        if (!lightState) return;
        if (lightState.sunDir) toonMat.uniforms.uLightDir.value.copy(lightState.sunDir).normalize();
        if (lightState.directTint) toonMat.uniforms.uLightColor.value.copy(lightState.directTint);
        if (lightState.timeTint) toonMat.uniforms.uTimeTint.value.copy(lightState.timeTint);
        toonMat.uniforms.uNightMix.value = THREE.MathUtils.clamp(lightState.nightBlend ?? 0, 0, 1);
        toonMat.uniforms.uMoonFactor.value = THREE.MathUtils.clamp(lightState.moonFactor ?? 1, 0, 1.2);
        toonMat.uniforms.uSnow.value = THREE.MathUtils.clamp(lightState.snowCover ?? 0, 0, 1);
    }

    return {
        createActor,
        updateActorAccessory,
        createDuck,
        createCage,
        createMarkers,
        setLightState,
        getLightState: () => ({
            lightDir: {
                x: toonMat.uniforms.uLightDir.value.x,
                y: toonMat.uniforms.uLightDir.value.y,
                z: toonMat.uniforms.uLightDir.value.z
            },
            lightColor: `#${toonMat.uniforms.uLightColor.value.getHexString()}`,
            timeTint: `#${toonMat.uniforms.uTimeTint.value.getHexString()}`,
            nightMix: toonMat.uniforms.uNightMix.value,
            moonFactor: toonMat.uniforms.uMoonFactor.value,
            accessoryPbr: {
                steel: { metalness: metalMat.metalness, roughness: metalMat.roughness },
                gold: { metalness: goldMat.metalness, roughness: goldMat.roughness },
                spring: { metalness: springMat.metalness, roughness: springMat.roughness },
                ironBomb: { metalness: bombMat.metalness, roughness: bombMat.roughness },
                paintedRed: { metalness: redMat.metalness, roughness: redMat.roughness },
                rope: { metalness: blueCoilMat.metalness, roughness: blueCoilMat.roughness }
            }
        }),
        dispose() {
            for (const item of disposables) item?.dispose?.();
        }
    };
}
