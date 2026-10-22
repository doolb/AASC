import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { BODY25_NAMES, BODY25_EDGES, NODE_SOURCE } from '../core/body25.mjs';

const PAGE_URL = new URL('../public/index.html', import.meta.url);
const WIDTH = 320;
const HEIGHT = 240;

function section(source, begin, end, includeBegin = false) {
  const first = source.indexOf(begin);
  const last = source.indexOf(end, first + begin.length);
  assert.ok(first >= 0 && last > first, `页面缺少唯一测试边界：${begin}`);
  assert.equal(source.indexOf(begin, first + begin.length), -1, `页面测试边界重复：${begin}`);
  return source.slice(includeBegin ? first : first + begin.length, last);
}

/** 只编译整段inline脚本；只执行提取的纯验证函数，不创建document/window/Canvas/Three/ORT。 */
async function validators({ current = { width: WIDTH, height: HEIGHT }, image = { naturalWidth: WIDTH, naturalHeight: HEIGHT } } = {}) {
  const html = await readFile(PAGE_URL, 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  const inline = scripts[0][1];
  new Script(inline, { filename: 'Node页面完整inline语法检查' }); // 不执行含DOM初始化的IIFE。
  const contract = section(inline, '// NODE_POSE_CONTRACT_BEGIN', '// NODE_POSE_CONTRACT_END');
  const skeleton = section(inline, 'function validSkeletonPose(value)', 'function buildSkeletonMeshes()', true);
  const context = createContext({ current, image }, { codeGeneration: { strings: false, wasm: false } });
  new Script(`${contract}\n${skeleton}\nglobalThis.pageContract = { validPose, validSkeletonPose, names: BODY25_NAMES, edges: BODY25_EDGES, source: NODE_SOURCE };`,
    { filename: 'Node页面提取的纯合同验证' }).runInContext(context, { timeout: 100 });
  return { html, inline, context, ...context.pageContract };
}

/** 纯数组模拟wire，只证明页面合同；不使用ort.Tensor、不运行模型，也不把unknown当GPU实测。 */
function result(device = 'dml:0') {
  const xyz = Array.from({ length: 25 }, (_, index) => [index * .01, index * .02, index * .003]);
  const cameraTranslation = [0, 0, 1];
  const cameraDepth = xyz.map((point) => point[2] + cameraTranslation[2]);
  const focalLengthPx = WIDTH;
  const principalPoint = [WIDTH / 2, HEIGHT / 2];
  const xy = xyz.map((point, index) => [focalLengthPx * point[0] / cameraDepth[index] + principalPoint[0],
    focalLengthPx * point[1] / cameraDepth[index] + principalPoint[1]]);
  return {
    type: 'hmr2.result', schemaVersion: 1, model: 'HMR2.0b', source: NODE_SOURCE, device,
    gpu: device === 'cpu' ? null : { index: Number(device.slice(4)), name: null, nameStatus: 'unknown' }, precision: 'fp32',
    imageSize: [WIDTH, HEIGHT], boxXYXY: [0, 0, WIDTH, HEIGHT], bboxSource: 'full_image_fallback',
    names: [...BODY25_NAMES], edges: BODY25_EDGES.map((edge) => [...edge]), xyz, xy,
    rotations24: Array.from({ length: 24 }, () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]]),
    betas10: Array(10).fill(0), predCam: [1, 0, 0], cameraTranslation, cameraDepth,
    projection: { focalLengthPx, principalPointPx: [...principalPoint] },
    camera: { translation: [...cameraTranslation], focalLengthPx, principalPoint: [...principalPoint] },
    inputTensorSha256: '0'.repeat(64), modelLoadMs: 0, inferenceMs: 0,
    timingMs: { preprocess: 0, modelRun: 0, total: 0, modelLoad: 0,
      hostToDevice: null, network: null, lbs: null, projection: null, deviceToHost: null },
    runtime: { name: 'onnxruntime-node', requestedEp: device === 'cpu' ? 'cpu' : 'dml',
      inputOutputPrecision: 'fp32', internalPrecision: 'unknown', tf32: 'unknown',
      actualAssignment: { status: 'unknown', reason: '纯builtin页面fixture，不是节点EP证据' } },
    memory: { allocator: 'unknown', allocatedMiB: null, reservedMiB: null, peakAllocatedMiB: null,
      peakReservedMiB: null, deviceFreeMiB: null, deviceTotalMiB: null },
  };
}
function clone(value) { return structuredClone(value); }
function bothReject(page, value, label) {
  assert.equal(Boolean(page.validPose(value)), false, `2D未拒绝：${label}`);
  assert.equal(Boolean(page.validSkeletonPose(value)), false, `3D未拒绝：${label}`);
}

test('inline语法/唯一nonce/本地Three路由与canonical BODY25副本，不执行DOM或原生库', async () => {
  const page = await validators();
  assert.deepEqual(JSON.parse(JSON.stringify(page.names)), BODY25_NAMES);
  assert.deepEqual(JSON.parse(JSON.stringify(page.edges)), BODY25_EDGES);
  assert.equal(page.source, NODE_SOURCE);
  assert.equal(page.names.length, 25);
  assert.equal(page.edges.length, 24);
  assert.equal(page.names[2], 'right_shoulder');
  assert.equal(page.names[5], 'left_shoulder');
  assert.equal(page.names[19], 'left_big_toe');
  assert.equal(page.names[22], 'right_big_toe');
  assert.equal((page.html.match(/__HMR_NONCE__/g) || []).length, 1);
  assert.match(page.inline, /import\('\/hmr2-three\.js'\)/);
  assert.doesNotMatch(page.html, /https?:\/\/[^\s"'<]+(?:three|cdn)/i);
  assert.equal('document' in page.context, false);
  assert.equal('window' in page.context, false);
  assert.equal('ort' in page.context, false);
});

test('合法dml:N及显式CPU经共同门禁接受，unknown内部精度/allocator不要求虚构CUDA数字', async () => {
  const page = await validators();
  for (const device of ['dml:0', 'dml:7', 'cpu']) {
    const value = result(device);
    assert.equal(page.validPose(value), true, device);
    assert.equal(page.validSkeletonPose(value), true, device);
    assert.equal(value.runtime.actualAssignment.status, 'unknown');
    assert.equal(value.memory.allocatedMiB, null);
  }
});

test('旧CUDA、错type/source/schema/model/精度/runtime请求EP均由2D与3D共同拒绝', async () => {
  const page = await validators();
  const mutations = [
    ['旧CUDA', (value) => { value.device = 'cuda:0'; value.source = 'official 4D-Humans checkpoint; embedded SMPL buffers via smplx.lbs'; }],
    ['CUDA伪用Node source', (value) => { value.device = 'cuda:0'; }],
    ['旧source伪用DML', (value) => { value.source = 'official 4D-Humans checkpoint; embedded SMPL buffers via smplx.lbs'; }],
    ['错type', (value) => { value.type = 'pose.result'; }],
    ['错schema', (value) => { value.schemaVersion = 2; }],
    ['无schema', (value) => { delete value.schemaVersion; }],
    ['错model', (value) => { value.model = 'HMR2.other'; }],
    ['无source', (value) => { delete value.source; }],
    ['非fp32 I/O', (value) => { value.precision = 'fp16'; }],
    ['runtime I/O矛盾', (value) => { value.runtime.inputOutputPrecision = 'fp16'; }],
    ['无runtime', (value) => { delete value.runtime; }],
    ['空runtime', (value) => { value.runtime = null; }],
    ['无requestedEp', (value) => { delete value.runtime.requestedEp; }],
    ['GPU标签CPU请求', (value) => { value.runtime.requestedEp = 'cpu'; }],
    ['CPU标签DML请求', (value) => { value.device = 'cpu'; }],
    ['CUDA请求', (value) => { value.runtime.requestedEp = 'cuda'; }],
    ['未知请求', (value) => { value.runtime.requestedEp = 'unknown'; }],
  ];
  for (const [label, mutate] of mutations) { const value = result(); mutate(value); bothReject(page, value, label); }
  for (const device of [null, 0, 'dml', 'dml:-1', 'dml:1.5', 'dml:0\n', 'dml:0 ', 'DML:0', 'cpu:0']) {
    const value = result(); value.device = device; bothReject(page, value, String(device));
  }
});

test('canonical名字必须原25点次序，左右交换/重复/长度/类型错误均拒绝', async () => {
  const page = await validators();
  const cases = [];
  const swapped = result(); [swapped.names[2], swapped.names[5]] = [swapped.names[5], swapped.names[2]]; cases.push(swapped);
  const duplicate = result(); duplicate.names[2] = duplicate.names[5]; cases.push(duplicate);
  const renamed = result(); renamed.names[19] = 'right_big_toe'; cases.push(renamed);
  const missing = result(); missing.names.pop(); cases.push(missing);
  const extra = result(); extra.names.push('extra'); cases.push(extra);
  const typed = result(); typed.names[0] = 0; cases.push(typed);
  const notArray = result(); notArray.names = {}; cases.push(notArray);
  for (const [index, value] of cases.entries()) bothReject(page, value, `names case ${index}`);
});

test('canonical连线必须原24条次序与方向；增删/换序/逆向/越界/非整数/坏维度拒绝', async () => {
  const page = await validators();
  const cases = [];
  const swapped = result(); [swapped.edges[0], swapped.edges[1]] = [swapped.edges[1], swapped.edges[0]]; cases.push(swapped);
  const reversed = result(); reversed.edges[0].reverse(); cases.push(reversed);
  const missing = result(); missing.edges.pop(); cases.push(missing);
  const extra = result(); extra.edges.push([0, 1]); cases.push(extra);
  const empty = result(); empty.edges = []; cases.push(empty);
  for (const index of [-1, 25, 1.5, false, '1', NaN, Infinity]) {
    const value = result(); value.edges[0][0] = index; cases.push(value);
  }
  for (const edge of [null, [], [1], [1, 2, 3], {}]) {
    const value = result(); value.edges[0] = edge; cases.push(value);
  }
  for (const [index, value] of cases.entries()) bothReject(page, value, `edges case ${index}`);
});

test('二维25x2必须有限，imageSize为正整数；图外投影允许而不偷偷clamp', async () => {
  const page = await validators();
  for (const size of [undefined, null, [], [WIDTH], [WIDTH, HEIGHT, 1], [0, HEIGHT], [-1, HEIGHT], [1.5, HEIGHT], ['320', HEIGHT], [Infinity, HEIGHT]]) {
    const value = result(); value.imageSize = size; bothReject(page, value, `imageSize ${String(size)}`);
  }
  for (const xy of [undefined, null, [], result().xy.slice(1), [...result().xy, [0, 0]]]) {
    const value = result(); value.xy = xy; bothReject(page, value, 'xy length');
  }
  for (const point of [null, [], [0], [0, 0, 0], [NaN, 0], [0, Infinity], ['0', 0], [false, 0]]) {
    const value = result(); value.xy[0] = point; bothReject(page, value, 'xy point');
  }
  const outside = result(); outside.xy[0] = [-100, HEIGHT + 100];
  assert.equal(page.validPose(outside), true);
  assert.equal(page.validSkeletonPose(outside), true);
  assert.deepEqual(outside.xy[0], [-100, HEIGHT + 100]);
});

test('3D额外25x3有限与当前/自然尺寸一致，公共合法2D不会迫使无效3D绘制', async () => {
  const page = await validators();
  for (const xyz of [undefined, null, [], result().xyz.slice(1), [...result().xyz, [0, 0, 0]]]) {
    const value = result(); value.xyz = xyz;
    assert.equal(page.validPose(value), true);
    assert.equal(Boolean(page.validSkeletonPose(value)), false);
  }
  for (const point of [null, [], [0, 0], [0, 0, 0, 0], [NaN, 0, 0], [0, Infinity, 0], ['0', 0, 0]]) {
    const value = result(); value.xyz[0] = point;
    assert.equal(Boolean(page.validSkeletonPose(value)), false);
  }
  const wrongSize = result(); wrongSize.imageSize = [HEIGHT, WIDTH];
  assert.equal(page.validPose(wrongSize), true);
  assert.equal(Boolean(page.validSkeletonPose(wrongSize)), false);
  const noCurrent = await validators({ current: null });
  assert.equal(Boolean(noCurrent.validSkeletonPose(result())), false);
  const changedCurrent = await validators({ current: { width: WIDTH + 1, height: HEIGHT } });
  assert.equal(Boolean(changedCurrent.validSkeletonPose(result())), false);
  const changedNatural = await validators({ image: { naturalWidth: WIDTH, naturalHeight: HEIGHT + 1 } });
  assert.equal(Boolean(changedNatural.validSkeletonPose(result())), false);
});

test('稀疏数组/空槽不是完整BODY25或有限坐标，普通门禁与3D均拒绝', async () => {
  const page = await validators();
  for (const value of [null, undefined, false, 1, '{}', []]) bothReject(page, value, '非DTO');
  const mutations = [
    (value) => { value.names = Array(25); },
    (value) => { delete value.names[2]; },
    (value) => { value.edges = Array(24); },
    (value) => { delete value.edges[0]; },
    (value) => { value.edges[0] = Array(2); },
    (value) => { delete value.edges[0][1]; },
    (value) => { value.xy = Array(25); },
    (value) => { value.xy[0] = Array(2); },
    (value) => { value.imageSize = Array(2); },
  ];
  for (const mutate of mutations) { const value = clone(result()); mutate(value); bothReject(page, value, '空槽'); }
  for (const xyz of [Array(25), result().xyz.map(() => Array(3))]) {
    const value = clone(result()); value.xyz = xyz;
    assert.equal(page.validPose(value), true);
    assert.equal(Boolean(page.validSkeletonPose(value)), false);
  }
});

test('成功/绘制前保留普通门禁与尺寸检查，3D共享validPose，不新增存储/下载旁路', async () => {
  const page = await validators();
  const handler = section(page.inline, "inferButton.addEventListener('click'", "if (typeof ResizeObserver === 'function')", true);
  const guard = handler.indexOf('if (!validPose(result))');
  const assign = handler.indexOf('pose = result;');
  const success = handler.indexOf("message('推理成功");
  assert.ok(guard >= 0 && assign > guard && success > assign);
  assert.ok(handler.indexOf('result.imageSize[0] !== image.naturalWidth') >= 0);
  assert.match(handler.slice(guard, assign), /return;/);
  assert.match(handler, /fetch\('\/infer'/);
  assert.match(handler, /mode: 'same-origin'/);
  assert.match(page.inline, /function validSkeletonPose\(value\)\s*\{\s*return validPose\(value\)/);
  assert.doesNotMatch(page.inline, /localStorage|sessionStorage|\.download\s*=/);
});
