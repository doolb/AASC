const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'src/apps/web-mediacenter/ui/public');
const VENDOR_DIR = path.join(PUBLIC_DIR, 'js/vendor/three');
const MMD_VENDOR_FILES = [
  'loaders/MMDLoader.js',
  'loaders/TGALoader.js',
  'animation/CCDIKSolver.js',
  'animation/MMDAnimationHelper.js',
  'animation/MMDPhysics.js',
  'libs/mmdparser.module.js',
  'shaders/MMDToonShader.js',
];
const AMMO_VENDOR_HASHES = {
  'libs/ammo.wasm.js': '3fa63c584d4732f72b954c5ea105f1faca99559c95c57ce7bb738d3497f98228',
  'libs/ammo.wasm.wasm': '16be07b989963bddebfef66eab28a4387536eb37014d9df1531dab380bd96a93',
};

const readPublic = (relativePath) => fs.readFileSync(path.join(PUBLIC_DIR, relativePath), 'utf8');
const AMMO_LOADER_PATH = path.join(PUBLIC_DIR, 'js/mmd-ammo-physics.mjs');

const loadFreshAmmoModule = () => import(`${pathToFileURL(AMMO_LOADER_PATH).href}?test=${Date.now()}-${Math.random()}`);

const restoreGlobalProperty = (key, descriptor) => {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  else delete globalThis[key];
};

const withAmmoBrowserGlobals = async ({ document, Ammo }, callback) => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const ammoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Ammo');
  globalThis.document = document;
  globalThis.Ammo = Ammo;
  try {
    return await callback();
  } finally {
    restoreGlobalProperty('document', documentDescriptor);
    restoreGlobalProperty('Ammo', ammoDescriptor);
  }
};

const createAmmoDocument = () => {
  const scripts = [];
  return {
    scripts,
    head: {
      append(script) {
        scripts.push(script);
        queueMicrotask(() => script.onload());
      }
    },
    createElement() {
      return { dataset: {} };
    },
    querySelector() {
      return scripts.find((script) => script.dataset.aascAmmo === 'true') || null;
    }
  };
};

test('MMD loader dependency files are vendored under the existing Three.js root', () => {
  for (const relativePath of MMD_VENDOR_FILES) {
    assert.equal(fs.existsSync(path.join(VENDOR_DIR, relativePath)), true, relativePath);
  }
});

test('Ammo 物理运行时以固定 r160 文件内置在 Three vendor 目录', () => {
  for (const [relativePath, expectedHash] of Object.entries(AMMO_VENDOR_HASHES)) {
    const content = fs.readFileSync(path.join(VENDOR_DIR, relativePath));
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(actualHash, expectedHash, relativePath);
  }
});

test('Ammo 加载器复用同源脚本和初始化后的物理模块', async () => {
  const document = createAmmoDocument();
  const ammoModule = { btVector3() {} };
  let factoryCalls = 0;
  await withAmmoBrowserGlobals({
    document,
    Ammo: (options) => {
      factoryCalls += 1;
      assert.equal(options.locateFile('ammo.wasm.wasm'), '/js/vendor/three/libs/ammo.wasm.wasm');
      return Promise.resolve(ammoModule);
    }
  }, async () => {
    const { AMMO_SCRIPT_URL, ensureAmmoPhysics } = await loadFreshAmmoModule();
    const [first, second] = await Promise.all([ensureAmmoPhysics(), ensureAmmoPhysics()]);
    assert.equal(first, ammoModule);
    assert.equal(second, ammoModule);
    assert.equal(globalThis.Ammo, ammoModule);
    assert.equal(factoryCalls, 1);
    assert.equal(document.scripts.length, 1);
    assert.equal(document.scripts[0].src, AMMO_SCRIPT_URL);
  });
});

test('Ammo 初始化失败后允许下一次 PMX 加载重新尝试', async () => {
  const document = createAmmoDocument();
  const ammoModule = { btVector3() {} };
  await withAmmoBrowserGlobals({
    document,
    Ammo: () => Promise.reject(new Error('WASM unavailable'))
  }, async () => {
    const { ensureAmmoPhysics } = await loadFreshAmmoModule();
    await assert.rejects(ensureAmmoPhysics(), /WASM unavailable/u);
    globalThis.Ammo = () => Promise.resolve(ammoModule);
    assert.equal(await ensureAmmoPhysics(), ammoModule);
    assert.equal(document.scripts.length, 1);
  });
});

test('PMX 仅在刚体数据非空时请求 Ammo 物理解算', async () => {
  const { hasMmdPhysics } = await loadFreshAmmoModule();
  assert.equal(hasMmdPhysics(null), false);
  assert.equal(hasMmdPhysics({ geometry: { userData: { MMD: { rigidBodies: [] } } } }), false);
  assert.equal(hasMmdPhysics({ geometry: { userData: { MMD: { rigidBodies: [{}] } } } }), true);
});

test('vendored MMD modules resolve every relative import without CDN dependencies', () => {
  for (const relativePath of MMD_VENDOR_FILES) {
    const absolutePath = path.join(VENDOR_DIR, relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    assert.doesNotMatch(source, /(?:from|import)\s*['"]https?:\/\//u, relativePath);
    const importPattern = /(?:from|import)\s*['"]([^'"]+)['"]/gu;
    for (const match of source.matchAll(importPattern)) {
      const importPath = match[1];
      if (!importPath.startsWith('.')) {
        continue;
      }
      assert.equal(fs.existsSync(path.resolve(path.dirname(absolutePath), importPath)), true, `${relativePath} -> ${importPath}`);
    }
  }
});

test('display import map keeps three and three/addons on local vendor files', () => {
  const html = readPublic('display.html');
  assert.match(html, /"three":\s*"\.\/js\/vendor\/three\/three\.module\.js"/u);
  assert.match(html, /"three\/addons\/":\s*"\.\/js\/vendor\/three\/"/u);
  assert.doesNotMatch(html, /three(?:\.min)?\.js[^\n]*https?:\/\//u);
});

test('display MMD selects PMX or VRM runtime from a validated model profile', () => {
  const displayMmd = readPublic('js/display-mmd.js');
  const pmxRuntime = path.join(PUBLIC_DIR, 'js/display-pmx-runtime.js');
  assert.equal(fs.existsSync(pmxRuntime), true);
  assert.match(displayMmd, /\/api\/mmd\/resources/u);
  assert.match(displayMmd, /modelType/u);
  assert.match(displayMmd, /display-pmx-runtime\.js/u);
  assert.match(displayMmd, /display-vrm-runtime\.js/u);
  assert.match(displayMmd, /runtime\.dispose/u);
  assert.match(displayMmd, /motionResourceId/u);
});

test('PMX profile validation accepts only local and fixed static same-origin MMD paths', () => {
  const displayMmd = readPublic('js/display-mmd.js');
  const pmxRuntime = readPublic('js/display-pmx-runtime.js');
  const pmxModelRuntime = readPublic('js/mmd-model-runtime.mjs');
  for (const source of [displayMmd, pmxRuntime]) {
    assert.match(source, /MMD_MODEL_PREFIXES\s*=\s*Object\.freeze\(\s*\[/u);
    assert.match(source, /'\/models\/mmd\/'/u);
    assert.match(source, /'\/api\/mmd\/static\/mmd\/'/u);
    assert.match(source, /\[a-f0-9\]\{64\}/u);
    assert.match(source, /url\.includes\(':\/\/'\)/u);
    assert.match(source, /url\.startsWith\('\/\/'\)/u);
    assert.match(source, /url\.includes\('\.\.'\)/u);
    assert.match(source, /\[\?#\\\\\]/u);
    assert.match(source, /MMD_MODEL_PREFIXES\.some\(\(prefix\) => url\.startsWith\(prefix\)\)/u);
    assert.doesNotMatch(source, /https?:\/\/[^'"\s]*miya-v1/u);
  }
  assert.match(displayMmd, /isSameOriginMmdAsset\(profile\.modelUrl, '\.pmx'\)/u);
  assert.match(pmxModelRuntime, /isSameOriginMmdAsset\(profile\.modelUrl, '\.pmx'\)/u);
  assert.match(pmxModelRuntime, /isSameOriginMmdAsset\(profile\.motionUrl, '\.vmd'\)/u);
});

test('PMX runtime exposes looping model and motion lifecycle methods', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  assert.match(source, /MMDLoader/u);
  assert.match(source, /MMDAnimationHelper/u);
  assert.match(source, /loadMotion/u);
  assert.match(source, /playMotion/u);
  assert.match(source, /loopRepeat: THREE\.LoopRepeat/u);
  assert.match(source, /playMode/u);
  assert.match(source, /loopOnce: THREE\.LoopOnce/u);
  assert.match(source, /requestAnimationFrame/u);
  assert.match(source, /dispose/u);
});

test('动作播放开关只切换 PMX animation 状态并由 DisplayMmd 记住', () => {
  const displayMmd = readPublic('js/display-mmd.js');
  const pmxRuntime = readPublic('js/display-pmx-runtime.js');
  const helper = readPublic('js/mmd-pmx-helper.mjs');
  assert.match(displayMmd, /motionPlaybackEnabled:\s*true/u);
  assert.match(displayMmd, /setMotionPlaybackEnabled\(enabled\)/u);
  assert.match(displayMmd, /state\.runtime\.setMotionPlaybackEnabled\?\./u);
  assert.match(pmxRuntime, /setPmxMotionPlaybackEnabled\(prepared\.helper, motionPlaybackEnabled\)/u);
  assert.match(pmxRuntime, /setPmxMotionPlaybackEnabled\(helper\.current, motionPlaybackEnabled\)/u);
  assert.match(helper, /helper\.enabled\.animation = enabled === true/u);
  assert.doesNotMatch(helper, /setPmxMotionPlaybackEnabled[\s\S]{0,180}helper\.enabled\.physics\s*=/u);
});

test('测试页物理开关切换时重载 PMX，关闭后新 helper 不创建 Ammo', () => {
  const displayMmd = readPublic('js/display-mmd.js');
  const pmxRuntime = readPublic('js/display-pmx-runtime.js');
  const helper = readPublic('js/mmd-pmx-helper.mjs');
  assert.match(displayMmd, /physicsEnabled:\s*true/u);
  assert.match(displayMmd, /async function setPhysicsEnabled\(enabled\)/u);
  assert.match(displayMmd, /state\.runtime\?\.setPhysicsEnabled\?\.\(nextEnabled\)/u);
  assert.match(displayMmd, /if \(await loadModel\(profile\)\) return true/u);
  assert.match(pmxRuntime, /physicsEnabled,\s*physicsFps:/u);
  assert.match(helper, /if \(!physicsEnabled \|\| !hasMmdPhysics\(mesh\)\)/u);
});

test('PMX runtime 在中心枢轴前创建可降级的 Ammo 物理 helper', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  assert.match(source, /import \{ ensureAmmoPhysics \} from '\.\/mmd-ammo-physics\.mjs'/u);
  assert.match(source, /import\s*\{[\s\S]*createPmxMotionHelper[\s\S]*stagePmxMesh[\s\S]*\}\s*from '\.\/mmd-pmx-helper\.mjs'/u);
  assert.match(source, /const preparePmxHelper = async \([\s\S]*?resourceId = profile\.motionResourceId[\s\S]*?\) =>/u);
  assert.match(source, /const staged = await stagePmxMesh\(/u);
  assert.match(source, /stagedHelper = staged\.preparedHelper\.helper/u);
  assert.match(source, /stagedPivot\.visible = true/u);
  assert.match(source, /currentRotationPivot = stagedPivot/u);
  assert.match(source, /PMX 物理不可用，已回退骨骼动画/u);
});

test('PMX 首载与切换动作都不预热或在初始化时套用 VMD 首帧', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  const helper = readPublic('js/mmd-pmx-helper.mjs');
  assert.doesNotMatch(source, /PMX_INITIAL_PHYSICS_WARMUP_STEPS|PMX_MOTION_SWITCH_WARMUP_STEPS|physicsWarmupSteps/u);
  assert.match(source, /createMotionHelper\(mesh, clip, profile\.playMode\)/u);
  assert.match(helper, /options\.warmup = 0/u);
  assert.match(helper, /options\.animationWarmup = false/u);
  assert.match(source, /const loadMotionInternal = async \(resourceId\)/u);
  assert.match(source, /preparePmxHelper\(mesh, profile, resourceId\)/u);
});

test('PMX 新模型只在首次实际渲染帧延迟 VMD，物理保持更新', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  const renderFrame = source.slice(source.indexOf('const renderFrame = (now) => {'), source.indexOf('const startRendering = () => {'));
  const loadMotion = source.slice(source.indexOf('const loadMotionInternal = async (resourceId) => {'), source.indexOf('const loadMotion = async (resourceId) => {'));
  const loadModel = source.slice(source.indexOf('const load = async (profile) => {'), source.indexOf('const playMotion = async (resourceId) =>'));
  assert.match(loadModel, /helper\.current = stagedHelper;\s*pendingInitialMotionHelper = stagedHelper/u);
  assert.match(renderFrame, /if \(!visible \|\| disposed\) return;[\s\S]*pendingInitialMotionHelper === frameHelper/u);
  assert.match(renderFrame, /setPmxMotionPlaybackEnabled\(frameHelper, false\);[\s\S]*advancePmxMotionFrame\(\{[\s\S]*physics: frameHelper\?\.objects\?\.get\(currentMesh\)\?\.physics/u);
  assert.match(renderFrame, /finally \{\s*if \(delayInitialMotion\) setPmxMotionPlaybackEnabled\(frameHelper, motionPlaybackEnabled\)/u);
  assert.match(source, /const stopMotion = \(\) => \{\s*pendingInitialMotionHelper = null/u);
  assert.doesNotMatch(loadMotion, /pendingInitialMotionHelper = nextHelper/u);
});

test('PMX 首帧更新物理但不显示模型，第二帧才显示并推进 VMD', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  const renderFrameSource = source.slice(source.indexOf('const renderFrame = (now) => {'), source.indexOf('const startRendering = () => {'));
  const pivot = { visible: true };
  const physics = {};
  const motionHelper = { enabled: { animation: true }, objects: { get: () => ({ physics }) } };
  const motionFrames = [];
  const renderedVisibility = [];
  const context = {
    frameHandle: 0,
    visible: false,
    disposed: false,
    lastFrameAt: 0,
    helper: { current: motionHelper },
    pendingInitialMotionHelper: motionHelper,
    motionPlaybackEnabled: true,
    currentMesh: {},
    currentRotationPivot: pivot,
    physicsGate: { paused: false },
    lightingState: { rotationPhysicsLimit: 720 },
    updateModelRotation() {},
    advancePmxMotionFrame({ helper, physics: framePhysics }) {
      motionFrames.push({ animation: helper.enabled.animation, physics: framePhysics === physics });
    },
    setPmxMotionPlaybackEnabled(helper, enabled) { helper.enabled.animation = enabled; },
    arCameraState: { active: false },
    updateCameraView() {},
    ambientOcclusion: { render() { renderedVisibility.push(pivot.visible); } },
    renderer: { render() {} },
    scene: {},
    camera: {},
    requestAnimationFrame: () => 1
  };
  const renderFrame = vm.runInNewContext(`${renderFrameSource}\nrenderFrame`, context);
  renderFrame(0);
  assert.equal(context.pendingInitialMotionHelper, motionHelper, '隐藏的运行时不消耗首帧');
  context.visible = true;
  renderFrame(16);
  assert.deepEqual(motionFrames, [{ animation: false, physics: true }]);
  assert.deepEqual(renderedVisibility, [false]);
  assert.equal(pivot.visible, true, '首帧绘制后恢复模型原有可见性');
  assert.equal(motionHelper.enabled.animation, true, '首帧绘制后恢复用户播放开关');
  renderFrame(32);
  assert.deepEqual(motionFrames, [
    { animation: false, physics: true },
    { animation: true, physics: true }
  ]);
  assert.deepEqual(renderedVisibility, [false, true]);
});

test('PMX runtime 先推进中心旋转，再让物理约束牵引布料', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  assert.match(source, /advancePmxMotionFrame\(/u);
  assert.doesNotMatch(source, /synchronizePmxPhysicsWithPivot/u);
});

test('PMX load failures retain a renderable fallback placeholder', () => {
  const displayMmd = readPublic('js/display-mmd.js');
  const source = readPublic('js/display-pmx-runtime.js');
  assert.match(displayMmd, /runtime\?\.showFallback/u);
  assert.match(source, /showFallback/u);
  assert.match(source, /MeshBasicMaterial/u);
});

test('PMX runtime keeps staged resources hidden until they are ready', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  assert.match(source, /new THREE\.LoadingManager\(\)/u);
  assert.match(source, /stagedModel|stagedMesh/u);
  assert.match(source, /waitForLoadingManager|waitForManagedLoad/u);
  assert.match(source, /stagedPivot\.visible = true/u);
});

test('MOTION_ADD requires a resource ID and rejects direct URL/path fields', () => {
  const adapterSource = readPublic('js/display-mmd-command-adapter.js');
  const context = { window: {}, console: { warn() {} } };
  vm.runInNewContext(adapterSource, context);
  const adapter = context.window.DisplayMmdCommandAdapter;
  assert.equal(adapter.validateCommand({ type: 'MOTION_ADD' }).valid, false);
  assert.equal(adapter.validateCommand({ type: 'MOTION_ADD', motionUrl: '/models/mmd/motions/miya-default.vmd' }).valid, false);
  assert.equal(adapter.validateCommand({ type: 'MOTION_ADD', resourceId: 'miya-default-motion' }).valid, true);
  assert.equal(adapter.validateCommand({ type: 'MOTION_ADD', resourceId: '../motion' }).valid, false);
});
