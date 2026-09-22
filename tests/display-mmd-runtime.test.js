const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
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

const readPublic = (relativePath) => fs.readFileSync(path.join(PUBLIC_DIR, relativePath), 'utf8');

test('MMD loader dependency files are vendored under the existing Three.js root', () => {
  for (const relativePath of MMD_VENDOR_FILES) {
    assert.equal(fs.existsSync(path.join(VENDOR_DIR, relativePath)), true, relativePath);
  }
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

test('PMX runtime exposes looping model and motion lifecycle methods', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  assert.match(source, /MMDLoader/u);
  assert.match(source, /MMDAnimationHelper/u);
  assert.match(source, /loadMotion/u);
  assert.match(source, /playMotion/u);
  assert.match(source, /THREE\.LoopRepeat/u);
  assert.match(source, /Infinity/u);
  assert.match(source, /playMode/u);
  assert.match(source, /THREE\.LoopOnce/u);
  assert.match(source, /requestAnimationFrame/u);
  assert.match(source, /dispose/u);
});

test('PMX load failures retain a renderable fallback placeholder', () => {
  const displayMmd = readPublic('js/display-mmd.js');
  const source = readPublic('js/display-pmx-runtime.js');
  assert.match(displayMmd, /runtime\?\.showFallback/u);
  assert.match(source, /showFallback/u);
  assert.match(source, /MeshBasicMaterial/u);
});

test('PMX runtime stages model resources before exposing the model to the scene', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  assert.match(source, /new THREE\.LoadingManager\(\)/u);
  assert.match(source, /stagedModel|stagedMesh/u);
  assert.match(source, /waitForLoadingManager|waitForManagedLoad/u);
  assert.match(source, /准备完成后一次性替换|atomic|commit/u);
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
