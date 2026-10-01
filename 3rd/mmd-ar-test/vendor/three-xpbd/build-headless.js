'use strict';

// 固定源码离线转换；保留原始文件及哈希，改动都在转换阶段明确应用。
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { transform } = require('esbuild');
const root = __dirname;

function replaceOnce(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error('THREE-XPBD转换锚点不唯一：' + anchor.slice(0, 70));
    return source.replace(anchor, replacement);
}

// 这些固定版本的调试块只含普通大括号；移除整块，不保留虚假的Game/World全局对象。
function removeBlock(source, anchor) {
    const start = source.indexOf(anchor);
    if (start < 0) throw new Error('THREE-XPBD缺少调试块：' + anchor);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth += 1;
        if (source[end] === '}') depth -= 1;
        end += 1;
    }
    if (depth) throw new Error('THREE-XPBD调试块未闭合');
    return source.slice(0, start) + source.slice(end);
}

function patch(name, input) {
    let source = input;
    if (name === 'solver/BaseSolver.ts') return 'export class BaseSolver { debugContact() {} }';
    source = source.replace(/^import .*\b(?:Game|World|BaseScene)\b.*\n/gm, '');
    source = source.replace(/^.*Game\.gui.*\n/gm, '');
    if (name === 'RigidBody.ts') {
        source = removeBlock(source, 'public addTo(');
        source = removeBlock(source, 'if (this.collider instanceof MeshCollider) {');
        // 世界原点的接触也有线性逆质量；回算角速度不能修改保存的上一帧四元数。
        source = replaceOnce(source, 'pos !== null && pos.length() > 0.00001', 'pos !== null');
        source = replaceOnce(source, 'this.prevPose.q.conjugate()', 'this.prevPose.q.clone().conjugate()');
        source = replaceOnce(source, '        else {\n            if (velocityLevel)',
            '        else {\n            dq.subVectors(pos, this.pose.p).cross(corr);\n            if (velocityLevel)');
        source = replaceOnce(source, '            dq.subVectors(pos, this.pose.p);\n            dq.cross(corr);', '');
    }
    if (name === 'Collider.ts') {
        source = source.replace(/^import \* as BufferGeometryUtils.*\n/m, '');
        source = source.replace("three/examples/jsm/geometries/ConvexGeometry.js", '../support/ConvexGeometry.mjs');
        source = source.replace(/    aabbHelper = .*;\n/, '');
        source = source.replace('    convexHull: Mesh;\n', '');
        const start = source.indexOf('        let strippedGeometry =');
        const end = source.indexOf('        const vertices =', start);
        if (start < 0 || end < 0) throw new Error('凸体中间几何锚点缺失');
        source = source.slice(0, start) + source.slice(end);
        const hullStart = source.indexOf('        this.convexHull = new Mesh(');
        const hullEnd = source.indexOf('        for ( let i = 0; i < hullPositionAttribute.count;', hullStart);
        if (hullStart < 0 || hullEnd < 0) throw new Error('凸体调试网格锚点缺失');
        source = source.slice(0, hullStart) + source.slice(hullEnd);
        source = replaceOnce(source, '        return this;\n    }\n\n    public override updateGlobalPose',
            '        convexHull.dispose();\n        return this;\n    }\n\n    public override updateGlobalPose');
    }
    if (name === 'narrowphase/GjkEpa.ts') {
        while (source.includes('if (Game.debugOverlay')) source = removeBlock(source, 'if (Game.debugOverlay');
        source = source.replace(/^.*Game\.scene.*\n/gm, '');
        source = source.replace(/^    private debug.*\n/gm, '');
        source = source.replace(/^import .*ConvexGeometry.*\n/m, '');
        source = source.replace(/^import \{ .* \} from "three";/m, 'import { Matrix4, Plane, Vector4 } from "three";');
        // 裁剪和EPA的退化数据不能传播NaN到PMX骨骼。保持上游算法及迭代上限。
        source = replaceOnce(source, '        if (minDistance == Infinity)',
            '        if (!Number.isFinite(minDistance) || minPolygon.length !== 3)');
        source = replaceOnce(source, '                if (newNormals[newMinFace].w < newMinDistance)',
            '                if (!newNormals.length || !normals.length) return;\n                if (newNormals[newMinFace].w < newMinDistance)');
        // 最小面来自原有面时，同步其witness，不能沿用上一次新增面的顶点。
        source = replaceOnce(source, '                        minFace = i;\n                    }',
            '                        minFace = i;\n                        minPolygon = [polytope[faces[i * 3]], polytope[faces[i * 3 + 1]], polytope[faces[i * 3 + 2]]];\n                    }');
        source = replaceOnce(source, '            const barycentric = this.computeBarycentricCoordinates(contactPoint, minPolygon);',
            '            const barycentric = this.computeBarycentricCoordinates(contactPoint, minPolygon);\n            if (!barycentric.toArray().every(Number.isFinite)) return;');
    }
    if (name === 'solver/XPBDSolver.ts') {
        source = replaceOnce(source, 'const h = (1 / 60) / XPBDSolver.numSubsteps;', 'const h = dt / XPBDSolver.numSubsteps;');
        source = replaceOnce(source, 'const dx = Vec3.mul(contact.n, contact.d);',
            'const dx = Vec3.mul(contact.n, Math.max(0, contact.d - (contact.tolerance ?? 0)));');
        source = replaceOnce(source, 'const threshold = 2.0 * 9.81 * h;',
            'const threshold = Math.max(0.5, 2.0 * (this.gravityMagnitude ?? 9.81) * h, (contact.tolerance ?? 0) / h);');
        source = replaceOnce(source, 'const e = Math.abs(vn) <= threshold ? 0.0 : contact.e;',
            'const e = Math.abs(contact.vn) <= threshold ? 0.0 : contact.e;');
        source = replaceOnce(source, 'const restitution = -vn + Math.max(-e * vn_tilde, 0.0);',
            'const restitution = -vn + (contact.d >= 0 ? Math.max(-e * vn_tilde, 0.0) : -contact.d / h);');
    }
    if (/\b(?:Game|World)\./.test(source)) throw new Error('THREE-XPBD残留演示依赖：' + name);
    return source;
}

async function buildHeadless() {
    const provenance = JSON.parse(await fs.readFile(path.join(root, 'SOURCE.json'), 'utf8'));
    for (const [name, expected] of Object.entries(provenance.three.files)) {
        if (createHash('sha256').update(await fs.readFile(path.join(root, 'upstream-three', name))).digest('hex') !== expected) {
            throw new Error('固定Three凸体辅助源码哈希不符：' + name);
        }
    }
    for (const [name, expected] of Object.entries(provenance.files)) {
        const file = name === 'LICENSE' ? path.join(root, name) : path.join(root, 'upstream', name);
        if (createHash('sha256').update(await fs.readFile(file)).digest('hex') !== expected) throw new Error('固定上游源码哈希不符：' + name);
        if (!name.endsWith('.ts')) continue;
        const relative = name.replace('src/physics/', '');
        const source = patch(relative, await fs.readFile(file, 'utf8'));
        const result = await transform(source, { loader: 'ts', format: 'esm', target: 'es2020', minifySyntax: true });
        const code = result.code.replace(/(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
            (match, start, specifier, end) => /\.mjs$/.test(specifier) ? match : start + specifier + '.mjs' + end);
        const destination = path.join(root, 'esm', relative.replace(/\.ts$/, '.mjs'));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, '// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。\n' + code);
    }
    await fs.mkdir(path.join(root, 'support'), { recursive: true });
    for (const name of ['ConvexGeometry', 'ConvexHull']) {
        const source = await fs.readFile(path.join(root, 'upstream-three', name + '.js'), 'utf8');
        const result = await transform(source.replace('../math/ConvexHull.js', './ConvexHull.mjs'),
            { loader: 'js', format: 'esm', target: 'es2020', minifySyntax: true });
        await fs.writeFile(path.join(root, 'support', name + '.mjs'), result.code);
    }
    const files = {};
    const list = async (directory) => {
        for (const entry of (await fs.readdir(path.join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            const name = directory + '/' + entry.name;
            if (entry.isDirectory()) await list(name);
            else files[name] = createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex');
        }
    };
    await list('esm'); await list('support');
    await fs.writeFile(path.join(root, 'RUNTIME.json'), JSON.stringify({ commit: provenance.commit, files }, null, 2) + '\n');
    console.log('[THREE-XPBD] 固定核心已离线转换为ESM');
}

buildHeadless().catch((error) => { console.error(error); process.exitCode = 1; });
