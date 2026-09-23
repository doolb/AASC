# PMX 内置 Ammo 物理解算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 为含刚体和关节的 PMX 启用内置 Ammo/Bullet 物理解算，同时确保无物理数据或初始化失败时 VMD 骨骼动画仍可用。

**Architecture:** 将 Three.js r160 匹配的 Ammo JavaScript 与 WASM 固定到既有本地 vendor 根目录。PMX runtime 以模块级 Promise 惰性初始化一次 Ammo；创建 MMD helper 时根据 PMX 刚体数据选择物理模式，物理失败时创建无物理 helper 作为降级路径。物理 helper 在中心旋转 pivot 创建前就绪，渲染循环继续由既有 helper 更新骨骼，再更新外层 pivot。

**Tech Stack:** Three.js r160、MMDAnimationHelper、Ammo.js/Bullet WASM、Node.js node:test、Express 静态目录。

**Spec:** docs/superpowers/specs/2026-09-22-pmx-physics-design.md

## Global Constraints

- 固定使用与 three@0.160.0 匹配的 ammo.wasm.js 与 ammo.wasm.wasm，不升级 Three.js。
- 静态资源必须位于 src/apps/web-mediacenter/ui/public/js/vendor/three/libs/，运行时地址只能是同源 /js/vendor/three/libs/...。
- JavaScript SHA-256 必须是 3fa63c584d4732f72b954c5ea105f1faca99559c95c57ce7bb738d3497f98228；WASM SHA-256 必须是 16be07b989963bddebfef66eab28a4387536eb37014d9df1531dab380bd96a93。
- 不新增 WebSocket、HTTP 配置、控制端开关或持久化字段；不修改 VRM SpringBone、MMD URL 白名单或 Offline APK 发布物。
- Ammo 初始化只对 geometry.userData.MMD.rigidBodies 非空的 PMX 进行；同页复用单一 Ammo 实例。
- 物理初始化失败时必须继续显示模型并播放 VMD/IK/grant，状态文字明确说明已回退骨骼动画。
- 每次完成的任务都执行对应定向测试、node --check 与 git diff --check，只提交该任务的文件。

## Review Focus

- Ammo JS 已载入但没有可调用工厂时，模型应降级而不是中断加载（Task 2）。
- WASM 文件丢失、路径被改为第三方 URL 或校验和不一致时，测试必须阻止提交（Task 1）。
- 不含刚体数据的 PMX 不应加载约 64 MB 的 Ammo 内存，且仍保留 VMD、IK 和 grant（Task 2）。
- 带刚体但没有 VMD 的 PMX 仍应创建 physics: true helper 并在渲染循环中更新（Task 2）。
- 模型切换、过期异步请求或销毁期间创建的 helper 必须调用 remove(mesh) 并不得覆盖当前模型（Task 2）。

---

### Task 1: 固定并验证 Ammo 静态资源

**Files:**
- Create: src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.js
- Create: src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.wasm
- Modify: tests/display-mmd-runtime.test.js:10-35

**Interfaces:**
- Consumes: three@0.160.0 发布内容的 examples/jsm/libs/ammo.wasm.js 与 ammo.wasm.wasm。
- Produces: 同源 /js/vendor/three/libs/ammo.wasm.js 脚本工厂及由 locateFile('ammo.wasm.wasm') 解析的 WASM 二进制。

- [ ] **Step 1: 写入先失败的 vendor 资源测试**

~~~js
const crypto = require('node:crypto');

const AMMO_VENDOR_HASHES = {
  'libs/ammo.wasm.js': '3fa63c584d4732f72b954c5ea105f1faca99559c95c57ce7bb738d3497f98228',
  'libs/ammo.wasm.wasm': '16be07b989963bddebfef66eab28a4387536eb37014d9df1531dab380bd96a93',
};

test('Ammo 物理运行时以固定 r160 文件内置在 Three vendor 目录', () => {
  for (const [relativePath, expectedHash] of Object.entries(AMMO_VENDOR_HASHES)) {
    const content = fs.readFileSync(path.join(VENDOR_DIR, relativePath));
    assert.equal(crypto.createHash('sha256').update(content).digest('hex'), expectedHash, relativePath);
  }
});
~~~

- [ ] **Step 2: 运行测试，确认当前资源缺失导致失败**

Run: node --test tests/display-mmd-runtime.test.js

Expected: FAIL，提示 libs/ammo.wasm.js 或 libs/ammo.wasm.wasm 不存在。

- [ ] **Step 3: 预下载不可变版本并保留许可头**

~~~powershell
Invoke-WebRequest -UseBasicParsing -Uri 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/ammo.wasm.js' -OutFile 'src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.js'
Invoke-WebRequest -UseBasicParsing -Uri 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/ammo.wasm.wasm' -OutFile 'src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.wasm'
Get-FileHash 'src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.js' -Algorithm SHA256
Get-FileHash 'src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.wasm' -Algorithm SHA256
~~~

仅在两项输出分别匹配全局约束中的 SHA-256 时保留文件。ammo.wasm.js 的 zlib 许可注释必须原样保留；不从 CDN 运行时加载。

- [ ] **Step 4: 运行定向测试，确认资源与校验和通过**

Run: node --test tests/display-mmd-runtime.test.js

Expected: PASS，Ammo vendor 用例与既有 MMD vendor 用例均通过。

- [ ] **Step 5: 提交固定资源和测试**

~~~bash
git add tests/display-mmd-runtime.test.js src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.js src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.wasm
git commit -m "feat: 内置 PMX Ammo 物理运行时"
~~~

### Task 2: 在 PMX runtime 惰性启用并安全降级物理

**Files:**
- Modify: src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js:12-520
- Modify: tests/display-mmd-runtime.test.js:80-105
- Modify: tests/display-chat-mmd.test.js:143-181

**Interfaces:**
- Consumes: Task 1 提供的同源 Ammo 资源、PMX mesh.geometry.userData.MMD.rigidBodies、既有 MMDAnimationHelper。
- Produces: ensureAmmoPhysics(): Promise<object>、hasMmdPhysics(mesh): boolean、createMotionHelper(mesh, clip, playMode): Promise<{ helper, physicsEnabled, physicsError }> 和 preparePmxHelper(mesh, profile): Promise<{ helper, physicsEnabled, physicsError }>；既有 load()、loadMotion() 和 playMotion() 接口保持不变。

- [ ] **Step 1: 写入先失败的 PMX 物理契约测试**

~~~js
test('PMX runtime 使用一次性的同源 Ammo 初始化，并按刚体数据启用物理解算', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  assert.match(source, /const AMMO_SCRIPT_URL = '\/js\/vendor\/three\/libs\/ammo\.wasm\.js'/u);
  assert.match(source, /const AMMO_WASM_URL = '\/js\/vendor\/three\/libs\/ammo\.wasm\.wasm'/u);
  assert.match(source, /let ammoLoadPromise = null/u);
  assert.match(source, /async function ensureAmmoPhysics\(\)[\s\S]*locateFile[\s\S]*AMMO_WASM_URL/u);
  assert.match(source, /function hasMmdPhysics\(mesh\)[\s\S]*rigidBodies/u);
  assert.match(source, /physics:\s*physicsEnabled/u);
  assert.match(source, /PMX 物理不可用，已回退骨骼动画/u);
});

test('PMX 的物理 helper 在中心枢轴创建前准备，并保留无 VMD 的物理路径', () => {
  const source = readPublic('js/display-pmx-runtime.js');
  assert.match(source, /const preparedHelper = await preparePmxHelper\(stagedMesh, profile\)/u);
  assert.match(source, /stagedHelper = preparedHelper\.helper/u);
  assert.match(source, /currentRotationPivot = createModelRotationPivot\(currentMesh\)/u);
  assert.match(source, /preparePmxHelper[\s\S]*clip = null/u);
});
~~~

- [ ] **Step 2: 运行测试，确认新物理契约在现有 runtime 中失败**

Run: node --test tests/display-mmd-runtime.test.js tests/display-chat-mmd.test.js

Expected: FAIL，缺少 Ammo 常量、单例加载器、刚体检测和 physics: physicsEnabled。

- [ ] **Step 3: 实现同源 Ammo 单例加载器**

在 display-pmx-runtime.js 的模块级常量区新增固定地址与单例状态；不得接受 profile 或 URL 参数。

~~~js
const AMMO_SCRIPT_URL = '/js/vendor/three/libs/ammo.wasm.js';
const AMMO_WASM_URL = '/js/vendor/three/libs/ammo.wasm.wasm';
let ammoLoadPromise = null;

function loadAmmoScript() {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-aasc-ammo="true"]');
    if (existing) return resolve();
    const script = document.createElement('script');
    script.src = AMMO_SCRIPT_URL;
    script.dataset.aascAmmo = 'true';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Ammo 物理脚本加载失败'));
    document.head.append(script);
  });
}

async function ensureAmmoPhysics() {
  if (globalThis.Ammo?.btVector3) return globalThis.Ammo;
  if (!ammoLoadPromise) {
    ammoLoadPromise = loadAmmoScript()
      .then(() => {
        const factory = globalThis.Ammo;
        if (typeof factory !== 'function') throw new Error('Ammo 物理工厂不可用');
        return factory({ locateFile: () => AMMO_WASM_URL });
      })
      .then((ammo) => {
        if (!ammo?.btVector3) throw new Error('Ammo 物理模块初始化失败');
        globalThis.Ammo = ammo;
        return ammo;
      })
      .catch((error) => {
        ammoLoadPromise = null;
        throw error;
      });
  }
  return ammoLoadPromise;
}
~~~

实现 hasMmdPhysics(mesh)，只在 Array.isArray(mesh?.geometry?.userData?.MMD?.rigidBodies) 且数组非空时返回 true。

- [ ] **Step 4: 让 helper 在物理失败时创建无物理回退版本**

将同步的 createMotionHelper 重构为异步 helper 创建流程。保留现有动作循环配置，并为无 VMD 的模型省略 animation 字段而仍添加 mesh。物理 helper 的构造也必须位于 try 内：刚体/关节数据不兼容导致 MMDPhysics 构造失败时，仍要重建 physics: false helper；无物理 helper 也构造失败时才传播关键加载错误。

~~~js
function buildMotionHelper(mesh, clip, playMode, physics) {
  const helper = new MMDAnimationHelper({ sync: false, pmxAnimation: true });
  const options = { physics };
  if (clip) options.animation = clip;
  helper.add(mesh, options);
  const action = helper.objects.get(mesh)?.mixer?._actions?.[0];
  if (action) {
    const shouldLoop = playMode !== 'once';
    action.setLoop(shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce, shouldLoop ? Infinity : 1);
    action.clampWhenFinished = !shouldLoop;
    action.reset().play();
  }
  return helper;
}

async function createMotionHelper(mesh, clip, playMode = 'loop') {
  const physicsRequested = hasMmdPhysics(mesh);
  if (!physicsRequested) {
    return { helper: buildMotionHelper(mesh, clip, playMode, false), physicsEnabled: false, physicsError: null };
  }
  try {
    await ensureAmmoPhysics();
    return { helper: buildMotionHelper(mesh, clip, playMode, true), physicsEnabled: true, physicsError: null };
  } catch (error) {
    const physicsError = error instanceof Error ? error : new Error('Ammo 物理初始化失败');
    return { helper: buildMotionHelper(mesh, clip, playMode, false), physicsEnabled: false, physicsError };
  }
}
~~~

新增 preparePmxHelper(mesh, profile)：有动作资源时加载 VMD，否则传入 null；模型首次加载使用 const preparedHelper = await preparePmxHelper(stagedMesh, profile)，随后写入 stagedHelper = preparedHelper.helper 和 stagedPhysicsError = preparedHelper.physicsError。通过 sequence 检查后再原子替换模型；最终状态在 stagedPhysicsError 存在时显示 PMX 物理不可用，已回退骨骼动画，否则显示 PMX 模型已加载。loadMotionInternal() 同样消费返回对象并继续沿用 sequence、staging 和 disposeStagedResources() 检查。PMX/VMD 下载失败仍保留既有失败语义。

- [ ] **Step 5: 运行定向测试、语法检查和补丁检查**

Run: node --test tests/display-mmd-runtime.test.js tests/display-chat-mmd.test.js

Expected: PASS，包含 Ammo 资源、刚体条件启用、无 VMD 物理路径、初始化失败降级和中心 pivot 回归测试。

Run: node --check src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js

Expected: exit 0。

Run: git diff --check

Expected: exit 0。

- [ ] **Step 6: 提交 PMX 物理解算 runtime 与测试**

~~~bash
git add src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js tests/display-mmd-runtime.test.js tests/display-chat-mmd.test.js
git commit -m "feat: 启用 PMX 内置物理解算"
~~~

### Task 3: 同步项目设计、伪代码、任务与完成记录

**Files:**
- Modify: docs/design/mmd-pmx-vmd-local.md
- Modify: docs/spec/mmd-pmx-vmd-local.md
- Create: docs/task/20260922_PMX物理解算.md
- Modify: docs/todo.md
- Modify: changelog.md

**Interfaces:**
- Consumes: Task 1 的静态资源路径与 SHA-256，Task 2 的 ensureAmmoPhysics、hasMmdPhysics、createMotionHelper、状态文案与降级行为。
- Produces: 与真实 PMX runtime 一致的设计说明、L4 伪代码、任务验收记录和变更日志；todo.md 不保留完成条目。

- [ ] **Step 1: 写入先失败的文档同步断言**

~~~js
test('PMX 物理解算设计和伪代码记录内置 Ammo 与失败降级', () => {
  const design = fs.readFileSync(path.join(ROOT, 'docs/design/mmd-pmx-vmd-local.md'), 'utf8');
  const spec = fs.readFileSync(path.join(ROOT, 'docs/spec/mmd-pmx-vmd-local.md'), 'utf8');
  assert.match(design, /Ammo\.js|Bullet/u);
  assert.match(design, /同源|内置/u);
  assert.match(spec, /ensureAmmoPhysics/u);
  assert.match(spec, /physicsEnabled/u);
  assert.match(spec, /回退骨骼动画/u);
});
~~~

- [ ] **Step 2: 运行文档断言，确认当前项目文档尚未描述该能力**

Run: node --test tests/display-mmd-runtime.test.js

Expected: FAIL，设计文档和伪代码中缺少 Ammo、ensureAmmoPhysics 与降级说明。

- [ ] **Step 3: 按实现结果更新项目文档**

在 docs/design/mmd-pmx-vmd-local.md 记录：固定 r160 Ammo 同源资源、仅刚体 PMX 惰性初始化、单例复用、物理与中心 pivot 的顺序，以及失败时 VMD/IK/grant 不受阻断。

在 docs/spec/mmd-pmx-vmd-local.md 新增以下 L4 伪代码，不写可执行 JavaScript：

~~~text
过程 ensureAmmoPhysics
  ammoPromise 缺失时加载固定同源 JS 和 WASM
  初始化成功后保存 Ammo 模块
  初始化失败时清空 ammoPromise 并返回错误

过程 createPmxHelper
  rigidBodies 非空时等待 Ammo 并设置 physicsEnabled
  初始化失败时将 physicsEnabled 设为 false 并记录降级状态
  helper 添加 mesh、动作和 physicsEnabled
  返回 helper 与物理状态
~~~

创建 docs/task/20260922_PMX物理解算.md，包含范围、资源 SHA-256、受影响文件、测试用例、移动端 64 MB 内存风险、无网络运行和失败降级验收。任务开始时在 docs/todo.md 加入“进行中”，完成时移除该条目。向 changelog.md 增加完成日期、资源文件、物理条件启用、降级行为和实际验证命令。

- [ ] **Step 4: 运行文档与 MMD 回归测试**

Run: node --test tests/display-mmd-runtime.test.js tests/display-chat-mmd.test.js

Expected: PASS，物理解算文档断言与所有既有 MMD 测试通过。

Run: git diff --check

Expected: exit 0。

- [ ] **Step 5: 提交文档完成记录**

~~~bash
git add docs/design/mmd-pmx-vmd-local.md docs/spec/mmd-pmx-vmd-local.md docs/task/20260922_PMX物理解算.md docs/todo.md changelog.md tests/display-mmd-runtime.test.js
git commit -m "docs: 记录 PMX 物理解算实现"
~~~

## Plan Self-Review

- Spec coverage: Task 1 覆盖固定资源、同源路径、版本和 SHA；Task 2 覆盖按需单例加载、刚体检测、无 VMD 支持、中心 pivot 顺序、失败降级和释放；Task 3 覆盖设计、L4 伪代码、任务、待办和变更日志。
- 占位符检查：计划不含未确定任务或延后实现的标记；每个测试与实现步骤均给出文件、命令和预期结果。
- Type consistency: 所有任务统一使用 ensureAmmoPhysics、hasMmdPhysics、createMotionHelper、physicsEnabled、physicsError 和 preparePmxHelper 名称。
- Review focus coverage: 五项风险分别由 Task 1 的 hash/路径断言和 Task 2 的工厂、无刚体、无 VMD、staging/销毁契约测试覆盖。
