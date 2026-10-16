const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
// 按当前文件锚定工作区，保留报告与人物分割的共享资源，不依赖启动时cwd。
const folder = __dirname, project = path.resolve(folder, '../../..');
const root = path.join(project, '3rd/mmd-ar-test/web-dist'), ort = path.join(project, 'node_modules/onnxruntime-web/dist');
const poseUrl = '/js/vendor/pose/rtmpose-m-body7-384x288.onnx';
const poseCache = path.join(project, '3rd/mmd-ar-test/model-cache/pose-onnx/rtmpose-m-body7-384x288.onnx');
// 三图路径只保存在忽略的本机配置，与HMR推理共用，避免两份映射漂移。
const sampleConfig = JSON.parse(fs.readFileSync(path.join(folder, 'hmr2-sam3d/sample-config.json'), 'utf8'));
const samples = Object.fromEntries(sampleConfig.samples.map((sample) => [sample.name, sample.image]));
exports.start = async () => {
    const server = http.createServer((req, res) => {
        try {
            const url = new URL(req.url, 'http://localhost'), name = decodeURIComponent(url.pathname);
            if (name === '/infer') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><html><body>本地姿态模型试验</body></html>'); }
            const roots = [['/_depth/', folder], ['/ort/', ort]];
            const match = roots.find(([prefix]) => name.startsWith(prefix));
            const file = samples[name.slice(8)] && name.startsWith('/sample/') ? samples[name.slice(8)]
                // 正式MediaPipe构建不再分发RTMPose；人物分割试验仍复用既有固定缓存。
                : name === poseUrl ? poseCache
                : match ? path.resolve(match[1], '.' + name.slice(match[0].length - 1))
                : path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
            const allowed = Object.values(samples).includes(file) || (name === poseUrl && file === poseCache)
                || file.startsWith((match?.[1] || root) + path.sep);
            if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-cache');
            // 仅在隔离试验服务器给工厂返回值加只读观察引用，确保FK与实际物理使用同一个rig。
            // 原运行文件不落盘改写，工厂计算、返回对象、更新顺序均不变。
            if (name.endsWith('/web-human-physics-rig.mjs')) {
                const text = fs.readFileSync(file, 'utf8');
                const marker = /return \{ model, nodes, pelvis, initial, metersPerUnit, animatedPoses, write, restore,\s*targetToLocal, targetToWorld, targetRotationToLocal, targetRotationToWorld \};/u;
                if (!marker.test(text)) throw new Error('rig观察位置不符');
                let observed = text.replace(marker, 'const observedRig = { model, nodes, pelvis, initial, metersPerUnit, animatedPoses, write, restore, targetToLocal, targetToWorld, targetRotationToLocal, targetRotationToWorld }; globalThis.__depthNativeRig = observedRig; return observedRig;');
                // 候选实验只在显式注入快照时统一rig采样前的骨骼初值；正常页面不进入此分支。
                // 原始rig构造/限位/物理计算仍原样执行，便于隔离左右对应这一变量。
                observed = observed.replace('export function createHumanPhysicsRig(model) {', `export function createHumanPhysicsRig(model) {
                    const fixture = globalThis.__correspondenceSeed;
                    if (fixture) {
                        if (fixture.length !== model.bones.length) throw new Error('候选快照骨骼数量不符');
                        model.bones.forEach((entry, index) => {
                            const saved = fixture[index];
                            if (entry.bone.name !== saved.name) throw new Error('候选快照骨骼名称不符');
                            entry.bone.position.fromArray(saved.position); entry.bone.quaternion.fromArray(saved.quaternion); entry.bone.scale.fromArray(saved.scale);
                        });
                    }
                    globalThis.__correspondenceFixture = model.bones.map(entry => ({ name: entry.bone.name,
                        position: entry.bone.position.toArray(), quaternion: entry.bone.quaternion.toArray(), scale: entry.bone.scale.toArray() }));`);
                return res.end(observed);
            }
            fs.createReadStream(file).pipe(res);
        } catch (error) { res.writeHead(500).end(error.message); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${server.address().port}` };
};
