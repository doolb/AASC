// 手绘吉卜力风场景：修剪草坪棋盘、卵石边、石板路、高脚木屋、栅栏、季节树、小花与远坡风车。
import * as THREE from '../vendor/three.module.min.js';
import { seededRandom } from './presets.mjs?v=20261124e';
import { blobSphere, groundHeight, part, trs, mergeParts, shadeByHeight } from './geometry.mjs?v=20261124e';

// 为大草地与棋盘草坪注入柔和空气透视雾化（20～36 米平滑低饱和融入地平线）
function enhanceGroundAerial(material, sharedHorizon) {
    material.customProgramCacheKey = () => 'pig3d-ground-aerial';
    material.onBeforeCompile = shader => {
        shader.uniforms.uHorizonColor = sharedHorizon;
        shader.vertexShader = shader.vertexShader
            .replace('void main() {', 'varying vec2 vGroundXZ;\nvoid main() {')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader
            .replace('void main() {', 'uniform vec3 uHorizonColor;\nvarying vec2 vGroundXZ;\nvoid main() {')
            .replace(
                '#include <opaque_fragment>',
                `#include <opaque_fragment>
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
    const sharedHorizon = { value: new THREE.Color('#b5dff7') };

    const cols = level.columns;
    const rows = level.rows;
    const halfW = cols / 2;
    const halfH = rows / 2;

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
    const groundMat = new THREE.MeshToonMaterial({ map: groundTex, color: '#7fb35a', gradientMap });
    enhanceGroundAerial(groundMat, sharedHorizon);
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = true;
    group.add(groundMesh);
    disposables.push(groundGeo, groundMat);

    // 2. 棋盘修剪草坪（比外草地略浅，带明暗修剪条纹）
    const lawnGeo = new THREE.PlaneGeometry(cols + 0.5, rows + 0.5);
    lawnGeo.rotateX(-Math.PI / 2);
    const lawnTex = textures.lawn();
    lawnTex.repeat.set(1, Math.max(1, Math.round(rows / 6)));
    const lawnMat = new THREE.MeshToonMaterial({ map: lawnTex, color: '#9fd27a', gradientMap });
    enhanceGroundAerial(lawnMat, sharedHorizon);
    const lawnMesh = new THREE.Mesh(lawnGeo, lawnMat);
    lawnMesh.position.y = 0.008;
    lawnMesh.receiveShadow = true;
    group.add(lawnMesh);
    disposables.push(lawnGeo, lawnMat);

    // 3. 棋盘四周卵石镶边（实例化）
    const rand = seededRandom(level.id * 17 + 3);
    const pebbleGeo = blobSphere(0.18, 3, 0.22, 1, 0.5);
    const pebbleMat = new THREE.MeshToonMaterial({ map: textures.stone(), color: '#cfd5cd', gradientMap });
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

    // 4. 左上石板路（呼应原第 2 关左上景物，放在棋盘外 5.5 格起不挡出路）
    const pathGeo = blobSphere(0.45, 11, 0.18, 1, 0.22);
    const pathMat = new THREE.MeshToonMaterial({ map: textures.stone(), color: '#dfd6c7', gradientMap });
    const pathCount = 15;
    const pathInst = new THREE.InstancedMesh(pathGeo, pathMat, pathCount);
    pathInst.receiveShadow = true;
    for (let i = 0; i < pathCount; i++) {
        const px = -halfW - 5.2 - i * 0.65 + (rand() - 0.5) * 0.45;
        const pz = -halfH - 4.4 - i * 0.25 + (rand() - 0.5) * 0.55;
        dummy.position.set(px, 0.04, pz);
        dummy.rotation.set(0, rand() * Math.PI, 0);
        dummy.scale.set(0.9 + rand() * 0.5, 0.7, 0.75 + rand() * 0.4);
        dummy.updateMatrix();
        pathInst.setMatrixAt(i, dummy.matrix);
    }
    group.add(pathInst);
    disposables.push(pathGeo, pathMat);

    // 5. 右上高脚木屋 + 楼梯 + 花盆（呼应原第 2 关右上角）
    const woodMat = new THREE.MeshToonMaterial({ map: textures.wood(), color: '#c48d59', gradientMap });
    const cabinParts = [];
    const roofColor = '#c96446';
    const wallColor = '#d49d68';
    const postColor = '#8c5d36';
    // 四根木桩与平台
    for (const sx of [-1.4, 1.4]) {
        for (const sz of [-1.1, 1.1]) {
            cabinParts.push(part(new THREE.CylinderGeometry(0.11, 0.12, 1.1, 8), postColor, trs(sx, 0.55, sz)));
        }
    }
    cabinParts.push(part(new THREE.BoxGeometry(3.4, 0.16, 2.8), postColor, trs(0, 1.08, 0)));
    // 主体小屋与斜屋顶
    cabinParts.push(part(new THREE.BoxGeometry(2.6, 1.8, 2.1), wallColor, trs(0.15, 2.04, -0.1)));
    cabinParts.push(part(new THREE.ConeGeometry(2.2, 1.25, 4), roofColor, trs(0.15, 3.55, -0.1, 0, Math.PI / 4, 0)));
    // 暖黄小窗
    cabinParts.push(part(new THREE.BoxGeometry(0.55, 0.55, 0.1), '#ffe694', trs(-0.35, 2.15, 0.96)));
    // 前阶梯
    for (let s = 0; s < 4; s++) {
        cabinParts.push(part(new THREE.BoxGeometry(1.0, 0.1, 0.28), postColor, trs(-0.8, 0.18 + s * 0.25, 1.55 - s * 0.22)));
    }
    // 门口花盆与绿植
    cabinParts.push(part(new THREE.CylinderGeometry(0.24, 0.18, 0.34, 8), '#c7724c', trs(1.15, 1.32, 1.05)));
    cabinParts.push(part(blobSphere(0.32, 4, 0.2, 1, 0.9), '#5fae48', trs(1.15, 1.66, 1.05)));
    const cabinGeo = mergeParts(cabinParts);
    const cabinMesh = new THREE.Mesh(cabinGeo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }));
    cabinMesh.position.set(halfW + 6.4, 0, -halfH - 5.6);
    cabinMesh.rotation.y = -0.35;
    cabinMesh.castShadow = true;
    cabinMesh.receiveShadow = true;
    group.add(cabinMesh);
    // 屋顶积雪层（冬季显示）
    const roofSnowGeo = new THREE.ConeGeometry(2.26, 0.85, 4);
    const roofSnowMat = new THREE.MeshToonMaterial({ color: '#f3f7fb', gradientMap });
    const roofSnow = new THREE.Mesh(roofSnowGeo, roofSnowMat);
    roofSnow.position.set(0.15, 3.78, -0.1);
    roofSnow.rotation.y = Math.PI / 4;
    roofSnow.visible = false;
    cabinMesh.add(roofSnow);
    disposables.push(woodMat, cabinGeo, cabinMesh.material, roofSnowGeo, roofSnowMat);

    // 6. 四周木栅栏（棋盘外 5.2 格环绕，留出正面视角缺口）
    const fenceParts = [];
    const fenceSeg = (x, z, rotY) => {
        fenceParts.push(part(new THREE.CylinderGeometry(0.06, 0.07, 0.72, 6), '#a8764b', trs(x, 0.36, z)));
        fenceParts.push(part(new THREE.BoxGeometry(1.5, 0.08, 0.05), '#bd8758', trs(x + Math.cos(rotY) * 0.75, 0.48, z - Math.sin(rotY) * 0.75, 0, rotY, 0)));
        fenceParts.push(part(new THREE.BoxGeometry(1.5, 0.08, 0.05), '#bd8758', trs(x + Math.cos(rotY) * 0.75, 0.24, z - Math.sin(rotY) * 0.75, 0, rotY, 0)));
    };
    for (let x = -halfW - 4.5; x <= halfW + 3.5; x += 1.55) {
        fenceSeg(x, -halfH - 5.2, 0);
    }
    for (let z = -halfH - 4.2; z <= halfH + 3.5; z += 1.55) {
        fenceSeg(-halfW - 5.4, z, Math.PI / 2);
        fenceSeg(halfW + 5.4, z, Math.PI / 2);
    }
    const fenceGeo = mergeParts(fenceParts);
    const fenceMesh = new THREE.Mesh(fenceGeo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }));
    fenceMesh.castShadow = true;
    fenceMesh.receiveShadow = true;
    group.add(fenceMesh);
    disposables.push(fenceGeo, fenceMesh.material);

    // 7. 远景风车（左后山坡缓慢旋转）
    const millGroup = new THREE.Group();
    millGroup.position.set(-halfW - 11.5, 1.35, -halfH - 11.5);
    millGroup.rotation.y = 0.5;
    const millTower = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.15, 3.8, 10), new THREE.MeshToonMaterial({ color: '#ede4d5', gradientMap }));
    millTower.position.y = 1.9;
    const millCap = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.1, 10), new THREE.MeshToonMaterial({ color: '#c45b44', gradientMap }));
    millCap.position.y = 4.3;
    const rotor = new THREE.Group();
    rotor.position.set(0, 3.5, 0.76);
    const bladeMat = new THREE.MeshToonMaterial({ color: '#f7f1e3', gradientMap });
    const bladeGeo = new THREE.BoxGeometry(0.28, 2.0, 0.06);
    for (let b = 0; b < 4; b++) {
        const pivot = new THREE.Group();
        pivot.rotation.z = (b * Math.PI) / 2;
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.y = 1.1;
        pivot.add(blade);
        rotor.add(pivot);
    }
    millGroup.add(millTower, millCap, rotor);
    group.add(millGroup);
    disposables.push(millTower.geometry, millTower.material, millCap.geometry, millCap.material, bladeGeo, bladeMat);

    // 8. 季节树（10 棵，放置在外围草坡，不遮挡棋盘视角）
    const treePlacements = [
        [-halfW - 6.8, -halfH - 2.2, 1.1], [-halfW - 8.2, 2.5, 1.25], [-halfW - 6.5, halfH + 2.8, 0.95],
        [halfW + 6.9, -halfH + 1.5, 1.15], [halfW + 8.5, 4.2, 1.3], [halfW + 6.4, halfH + 3.4, 1.0],
        [-3.5, -halfH - 7.8, 1.2], [4.2, -halfH - 8.2, 1.05], [-halfW - 10.5, -halfH - 6.5, 1.35], [halfW + 10.2, -halfH - 7.2, 1.25]
    ];
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.9, 7);
    const trunkMat = new THREE.MeshToonMaterial({ color: '#7a5236', gradientMap });
    const crownBlobGeo = blobSphere(1.05, 9, 0.22, 2, 0.86);
    const pineConeGeo = new THREE.ConeGeometry(1.15, 2.4, 9);
    const crownMat = new THREE.MeshToonMaterial({ color: '#f7b8c8', gradientMap });
    const trees = [];
    for (let i = 0; i < treePlacements.length; i++) {
        const [tx, tz, sc] = treePlacements[i];
        const tGroup = new THREE.Group();
        tGroup.position.set(tx, Math.max(0, groundHeight(tx, tz, halfW, halfH) - 0.04), tz);
        tGroup.scale.setScalar(sc);
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.95;
        trunk.castShadow = true;
        // 阔叶/樱花/枫树多球树冠（开启相互投射与接收阴影增强层次）
        const broad = new THREE.Group();
        const c1 = new THREE.Mesh(crownBlobGeo, crownMat); c1.position.set(0, 2.3, 0); c1.castShadow = true; c1.receiveShadow = true;
        const c2 = new THREE.Mesh(crownBlobGeo, crownMat); c2.position.set(-0.65, 1.95, 0.35); c2.scale.setScalar(0.72); c2.castShadow = true; c2.receiveShadow = true;
        const c3 = new THREE.Mesh(crownBlobGeo, crownMat); c3.position.set(0.6, 2.0, -0.3); c3.scale.setScalar(0.68); c3.castShadow = true; c3.receiveShadow = true;
        broad.add(c1, c2, c3);
        // 雪松塔形树冠（冬季启用）
        const pine = new THREE.Group();
        const p1 = new THREE.Mesh(pineConeGeo, crownMat); p1.position.y = 2.0; p1.castShadow = true; p1.receiveShadow = true;
        const p2 = new THREE.Mesh(pineConeGeo, crownMat); p2.position.y = 2.9; p2.scale.setScalar(0.76); p2.castShadow = true; p2.receiveShadow = true;
        pine.add(p1, p2);
        pine.visible = false;

        tGroup.add(trunk, broad, pine);
        group.add(tGroup);
        trees.push({ group: tGroup, broad, pine, phase: i * 0.9 });
    }
    disposables.push(trunkGeo, trunkMat, crownBlobGeo, pineConeGeo, crownMat);

    // 9. 实例化小花（保留外网成片花丛正弦聚簇分布，high/medium 升级为交叉双面 5 瓣星形花）
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
    let fPlaced = 0, fAttempts = 0;
    while (fPlaced < flowerCap && fAttempts < flowerCap * 8) {
        fAttempts++;
        const angle = rand() * Math.PI * 2;
        const r = Math.max(halfW, halfH) + 0.85 + Math.pow(rand(), 1.1) * 15;
        const px = Math.cos(angle) * r * 0.88;
        const pz = Math.sin(angle) * r;
        if (Math.abs(px) < halfW + 0.75 && Math.abs(pz) < halfH + 0.75) continue;
        // 利用平滑三角函数模拟自然花丛聚集，避免均匀散点
        const cluster = Math.sin(px * 0.28 + 1.1) * Math.cos(pz * 0.26 - 0.7) + Math.sin((px + pz) * 0.14);
        if (cluster < -0.25 && rand() < 0.78) continue;
        const hillY = Math.max(0, groundHeight(px, pz, halfW, halfH) - 0.03);
        dummy.position.set(px, hillY + (useStarFlowers ? 0.10 : 0.15) + rand() * 0.10, pz);
        dummy.rotation.set((rand() - 0.5) * 0.28, rand() * Math.PI * 2, (rand() - 0.5) * 0.28);
        const s = 0.75 + rand() * 0.9;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        flowerInst.setMatrixAt(fPlaced, dummy.matrix);
        flowerPaletteIdx[fPlaced] = (fPlaced % 7 === 0) ? 1 : (fPlaced % 5);
        fPlaced++;
    }
    flowerInst.count = fPlaced;
    group.add(flowerInst);
    disposables.push(flowerGeo, flowerMat);

    // 10. 季节限定小道具：夏向日葵、秋稻草堆与南瓜、冬雪人
    const seasonProps = { sunflower: new THREE.Group(), autumn: new THREE.Group(), snowman: new THREE.Group() };
    // 向日葵丛
    const sfMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
    const sfParts = [];
    for (const [sx, sz] of [[-halfW - 4.2, 2.5], [-halfW - 4.7, 3.2], [halfW + 4.4, 2.2]]) {
        sfParts.push(part(new THREE.CylinderGeometry(0.04, 0.05, 0.95, 6), '#4b8d32', trs(sx, 0.47, sz)));
        sfParts.push(part(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 12), '#ffd130', trs(sx, 0.96, sz, Math.PI / 2 - 0.2, 0, 0)));
        sfParts.push(part(new THREE.SphereGeometry(0.12, 8, 8), '#5e371e', trs(sx, 0.96, sz + 0.04)));
    }
    const sfGeo = mergeParts(sfParts);
    seasonProps.sunflower.add(new THREE.Mesh(sfGeo, sfMat));
    // 稻草堆与南瓜
    const auParts = [];
    for (const [hx, hz] of [[-halfW - 5.2, 3.6], [halfW + 5.2, 4.1]]) {
        auParts.push(part(new THREE.CylinderGeometry(0.55, 0.55, 0.85, 12), '#dfba52', trs(hx, 0.42, hz, 0, 0.4, Math.PI / 2)));
    }
    for (const [px, pz] of [[-halfW - 3.6, -2.5], [halfW + 3.8, -1.8], [-halfW - 4.1, 4.5]]) {
        auParts.push(part(blobSphere(0.26, 2, 0.14, 1, 0.72), '#e86f2c', trs(px, 0.2, pz)));
        auParts.push(part(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 6), '#4e6b2c', trs(px, 0.4, pz)));
    }
    const auGeo = mergeParts(auParts);
    seasonProps.autumn.add(new THREE.Mesh(auGeo, sfMat));
    // 雪人
    const snParts = [];
    const smX = -halfW - 4.5, smZ = 2.6;
    snParts.push(part(new THREE.SphereGeometry(0.42, 12, 10), '#f6f9fc', trs(smX, 0.36, smZ)));
    snParts.push(part(new THREE.SphereGeometry(0.29, 12, 10), '#ffffff', trs(smX, 0.92, smZ)));
    snParts.push(part(new THREE.ConeGeometry(0.05, 0.22, 8), '#f3762c', trs(smX, 0.92, smZ + 0.32, Math.PI / 2, 0, 0)));
    snParts.push(part(new THREE.CylinderGeometry(0.24, 0.24, 0.26, 10), '#c8423a', trs(smX, 1.24, smZ)));
    const snGeo = mergeParts(snParts);
    seasonProps.snowman.add(new THREE.Mesh(snGeo, sfMat));
    group.add(seasonProps.sunflower, seasonProps.autumn, seasonProps.snowman);
    disposables.push(sfMat, sfGeo, auGeo, snGeo);

    // 蘑菇点缀
    const mushParts = [];
    for (const [mx, mz] of [[-halfW - 3.2, -3.5], [-halfW - 3.5, -3.1], [halfW + 3.4, -4.1]]) {
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
    function applyPreset(preset, blend = 1, horizonColor = null) {
        if (horizonColor) sharedHorizon.value.copy(horizonColor);
        colTmp.set(preset.ground);
        curGround.lerp(colTmp, blend);
        groundMat.color.copy(curGround);

        colTmp.set(preset.lawn);
        curLawn.lerp(colTmp, blend);
        lawnMat.color.copy(curLawn);

        colTmp.set(preset.foliage[0]);
        curCrown.lerp(colTmp, blend);
        crownMat.color.copy(curCrown);

        const isWinter = preset.treeType === 'pine';
        for (const t of trees) {
            t.broad.visible = !isWinter;
            t.pine.visible = isWinter;
        }
        roofSnow.visible = preset.snowCover > 0.35;
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
        dispose() {
            scene.remove(group);
            for (const d of disposables) d?.dispose?.();
        }
    };
}
