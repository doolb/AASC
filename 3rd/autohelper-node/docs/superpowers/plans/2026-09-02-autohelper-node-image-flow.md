# AutoHelper Node.js 图片流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Linux 上建立一个 Node.js + ADB + OpenCV 的图片驱动自动化工具，兼容原 C# 图片文件名规则，并通过 `goto@flowId` 在多个图片目录之间切换。

**Architecture:** 工程采用 TypeScript 分层结构。ADB 客户端只负责设备通信，图片描述解析器只负责文件名 DSL，Flow Loader 只负责当前目录和缓存，OpenCV Matcher 只负责返回匹配分数与矩形，Automation Loop 负责排序、点击、延迟和 `goto` 状态机。CLI 将这些组件组合为 `start`、`capture`、`record` 和 `inspect` 四个入口。

**Tech Stack:** Node.js 25、TypeScript、`@techstark/opencv-js` 5.0.0-release.1 预编译 OpenCV.js/WASM、`pngjs`、`bmp-js`、Vitest、ADB。

**Spec:** `docs/design/image-driven-adb-automation.md`

## Global Constraints

- 工程路径固定为 `/mnt/AASC/3rd/autohelper-node`。
- 原 `/mnt/tmp/autohelper` C# 项目不修改。
- 运行环境为 Linux、Node.js 和 ADB。
- 原有图片文件名参数继续有效，新增 `goto@flowId`。
- 运行时只识别当前 Flow 目录，禁止 `goto` 逃逸流程根目录。
- 默认提供 `--dry-run`，真实设备自动化测试不得发送点击。
- 不实现广告观看、会员购买、游戏进程注入、私有数据读取或反作弊规避。
- 新代码使用 `const/let`，异步操作使用 `async/await`，错误处理使用 `try-catch`，避免全局可变状态。
- 代码注释使用中文，单文件不超过 1000 行。
- 所有生产函数先有一个会失败的测试，再写最小实现。
- 每个任务完成后运行该任务测试并提交一次小变更。

---

## File Map

```text
3rd/autohelper-node/
├── package.json
├── package-lock.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── flows/
│   └── .gitkeep
├── src/
│   ├── cli.ts
│   ├── types.ts
│   ├── adb/adb-client.ts
│   ├── flow/filename-parser.ts
│   ├── flow/flow-loader.ts
│   ├── vision/image-matcher.ts
│   ├── vision/template-cache.ts
│   ├── runtime/action-selector.ts
│   ├── runtime/automation-loop.ts
│   ├── runtime/record-store.ts
│   └── tools/capture-tool.ts
├── test/
│   ├── fixtures/README.md
│   ├── flow/filename-parser.test.ts
│   ├── flow/flow-loader.test.ts
│   ├── adb/adb-client.test.ts
│   ├── vision/image-matcher.test.ts
│   ├── runtime/action-selector.test.ts
│   ├── runtime/automation-loop.test.ts
│   ├── cli/capture-tool.test.ts
│   └── cli/cli.test.ts
├── docs/
│   ├── design.md
│   ├── design/image-driven-adb-automation.md
│   ├── spec.md
│   ├── spec/image-driven-adb-automation.md
│   ├── task/20260902-autohelper-node-image-flow.md
│   ├── todo.md
│   ├── usage.md
│   ├── rules.md
│   └── ref.md
└── changelog.md
```

`docs/design/image-driven-adb-automation.md` 已在前一阶段创建并提交。本计划后续任务会创建实现同步所需的 `spec`、`task`、`todo`、`usage`、`rules`、`ref` 和 `changelog` 文件。

---

### Task 1: 初始化 Node.js 工程和实现文档

**Files:**
- Create: `3rd/autohelper-node/package.json`
- Create: `3rd/autohelper-node/tsconfig.json`
- Create: `3rd/autohelper-node/vitest.config.ts`
- Create: `3rd/autohelper-node/src/types.ts`
- Create: `3rd/autohelper-node/flows/.gitkeep`
- Create: `3rd/autohelper-node/README.md`
- Create: `3rd/autohelper-node/docs/spec.md`
- Create: `3rd/autohelper-node/docs/spec/image-driven-adb-automation.md`
- Create: `3rd/autohelper-node/docs/task/20260902-autohelper-node-image-flow.md`
- Create: `3rd/autohelper-node/docs/todo.md`
- Create: `3rd/autohelper-node/docs/usage.md`
- Create: `3rd/autohelper-node/docs/rules.md`
- Create: `3rd/autohelper-node/docs/ref.md`
- Create: `3rd/autohelper-node/changelog.md`

**Interfaces:**
- `package.json` 提供 `build`、`test`、`start`、`capture`、`record` 和 `inspect` 脚本。
- `types.ts` 导出 `Point`、`Rect`、`ImageDescriptor`、`LoadedTemplate`、`MatchResult`、`FlowContext`、`AdbRunner` 和 `AutomationOptions`。

- [x] **Step 1: 写入工程配置和最小类型声明**

```json
{
  "name": "autohelper-node",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "tsx src/cli.ts start",
    "capture": "tsx src/cli.ts capture",
    "record": "tsx src/cli.ts record",
    "inspect": "tsx src/cli.ts inspect"
  },
  "dependencies": {
    "@techstark/opencv-js": "5.0.0-release.1",
    "bmp-js": "0.1.0",
    "pngjs": "7.0.0"
  },
  "devDependencies": {
    "@types/bmp-js": "0.1.2",
    "@types/node": "26.4.1",
    "@types/pngjs": "6.0.5",
    "tsx": "4.23.13",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

`tsconfig.json` 使用 `module: NodeNext`、`moduleResolution: NodeNext`、`target: ES2022`、`strict: true`、`noEmit: true`。`types.ts` 只放跨模块数据类型，不导入 OpenCV，保证业务单元测试不依赖原生模块初始化。

- [x] **Step 2: 写入 AASC 实现伪代码 spec**

`docs/spec/image-driven-adb-automation.md` 必须同步描述以下伪代码：

```text
启动(args):
  校验 device、flow、flowsRoot
  通过 ADB 查询设备状态
  加载 activeFlowId 对应目录中的 png/bmp
  循环执行 AutomationLoop.tick()

tick():
  frame = adb.screenshot()
  candidates = matcher.matchAll(frame, activeFlow.templates)
  action = selector.choose(candidates)
  如果 action 不存在：等待 interval 后返回
  如果 action.wait：记录结果，不点击，不跳转
  否则：计算点击点，dryRun 时只记录，否则 adb.tap()
  执行 delay
  如果点击成功且 action.gotoFlow 存在：loader.switchTo(action.gotoFlow)
```

- [x] **Step 3: 安装依赖并执行配置检查**

Run: `OPENCV4NODEJS_DISABLE_AUTOBUILD=1 npm install`

Expected: 依赖安装完成；如果原生模块无法加载，输出明确的 OpenCV/Node ABI 错误并在本任务中修复，不进入业务实现。

Run: `npm run build`

Expected: PASS；此时还没有业务测试，编译只验证工程配置和类型文件。

- [x] **Step 4: 写入项目使用说明和任务记录**

`README.md` 描述 Linux 前置条件和四个命令；`docs/usage.md` 描述图片目录、文件名参数、`goto` 示例和 dry-run；`docs/task/...md` 记录需求、受影响模块、自测、兼容性、性能、风险和预计工时；`docs/todo.md` 只记录尚未完成的实现任务。

- [x] **Step 5: 运行测试并提交**

Run: `npm test`

Expected: PASS，测试目录为空或无测试文件时由 Vitest 正常退出；如果 Vitest 将无测试视为失败，加入一个只验证导出类型无运行时副作用的配置测试。

```bash
git add 3rd/autohelper-node
git commit -m "feat: bootstrap autohelper node project"
```

---

### Task 2: 实现图片文件名解析器和 `goto`

**Files:**
- Create: `3rd/autohelper-node/src/flow/filename-parser.ts`
- Create: `3rd/autohelper-node/test/flow/filename-parser.test.ts`
- Modify: `3rd/autohelper-node/src/types.ts`
- Modify: `3rd/autohelper-node/docs/spec/image-driven-adb-automation.md`

**Interfaces:**
- Produces `parseImageDescriptor(flowId: string, filePath: string): ImageDescriptor`。
- `ImageDescriptor` 至少包含 `name`、`flowId`、`filePath`、`queue`、`threshold`、`clickPoint`、`centerClick`、`delayMs`、`loop`、`wait`、`defaultCandidate`、`selectImage` 和 `gotoFlow`。

- [x] **Step 1: 写失败测试**

```ts
it('parses goto and legacy click options from one image stem', () => {
  const descriptor = parseImageDescriptor(
    'launch',
    '/tmp/enter@0.9,clickpoint@0.6&0.5,delay@800,goto@home.png',
  );

  expect(descriptor.name).toBe('enter@0.9,clickpoint@0.6&0.5,delay@800,goto@home');
  expect(descriptor.queue).toBe(0);
  expect(descriptor.threshold).toBe(0.9);
  expect(descriptor.clickPoint).toEqual({ x: 0.6, y: 0.5 });
  expect(descriptor.delayMs).toBe(800);
  expect(descriptor.gotoFlow).toBe('home');
});

it('rejects a goto target that can escape the flow root', () => {
  expect(() => parseImageDescriptor('launch', '/tmp/a@0.9,goto@...png'))
    .toThrow('invalid goto flow id');
});

it('keeps negative queue and legacy flags', () => {
  const descriptor = parseImageDescriptor(
    'home', '/tmp/a@0.8,~10@0.7,default,loop,wait,clickpoint_ab@0&0.png',
  );

  expect(descriptor.queue).toBe(-10);
  expect(descriptor.defaultCandidate).toBe(true);
  expect(descriptor.loop).toBe(true);
  expect(descriptor.wait).toBe(true);
  expect(descriptor.centerClick).toBe(true);
});
```

- [x] **Step 2: 运行指定测试确认按预期失败**

Run: `npm test -- test/flow/filename-parser.test.ts`

Expected: FAIL because `filename-parser.ts` and `parseImageDescriptor` do not exist yet。

- [x] **Step 3: 写最小解析实现**

实现要点：

```text
stem = 去除最后一个图片扩展名
tokens = stem 按逗号分割
descriptor.name = stem
每个 token 按第一个 @ 分割 key/value
numeric key 解析为 queue，~numeric 解析为负 queue
未识别的数值 token 只更新 threshold
识别 clickpoint、clickpoint_ab、delay、loop、wait、default、select、goto
goto value 必须匹配 /^[A-Za-z0-9._-]+$/ 且不能是 . 或 ..
所有错误包含原始文件名
```

`clickpoint` 坐标必须在 `[0, 1]`；`delay` 必须是非负整数；阈值必须是有限数。解析器不得访问文件系统或 OpenCV。

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- test/flow/filename-parser.test.ts`

Expected: PASS，所有解析器测试通过。

- [x] **Step 5: 更新 spec 并提交**

同步补充 `goto` 的解析和安全规则，然后运行 `npm run build`。

```bash
git add 3rd/autohelper-node/src/types.ts 3rd/autohelper-node/src/flow/filename-parser.ts 3rd/autohelper-node/test/flow/filename-parser.test.ts 3rd/autohelper-node/docs/spec/image-driven-adb-automation.md
git commit -m "feat: parse image flow goto metadata"
```

---

### Task 3: 实现 Flow Loader 和当前目录缓存

**Files:**
- Create: `3rd/autohelper-node/src/flow/flow-loader.ts`
- Create: `3rd/autohelper-node/src/vision/template-cache.ts`
- Create: `3rd/autohelper-node/test/flow/flow-loader.test.ts`
- Modify: `3rd/autohelper-node/src/types.ts`

**Interfaces:**
- `new FlowLoader({ flowsRoot, parseDescriptor, loadTemplate })`
- `listFlowIds(): string[]`
- `load(flowId: string): Promise<FlowContext>`
- `switchTo(flowId: string): Promise<FlowContext>`
- `FlowContext` 包含 `id`、`directory`、`descriptors` 和 `templates`。
- `TemplateCache.load(descriptor): Promise<LoadedTemplate>`，同一个绝对文件路径在一次 Flow 生命周期内只加载一次。

- [x] **Step 1: 写失败测试**

```ts
it('loads only image files from the active flow directory', async () => {
  const loader = makeLoaderWithFiles({
    launch: ['a@0.9.png', 'notes.txt'],
    home: ['b@0.8.png'],
  });

  const context = await loader.load('launch');

  expect(context.id).toBe('launch');
  expect(context.descriptors.map(item => item.name)).toEqual(['a@0.9']);
});

it('switches flow and rejects a missing target', async () => {
  const loader = makeLoaderWithFiles({ launch: ['a@0.9,goto@home.png'], home: ['b@0.8.png'] });

  await expect(loader.switchTo('home')).resolves.toMatchObject({ id: 'home' });
  await expect(loader.switchTo('missing')).rejects.toThrow('flow not found: missing');
});

it('rejects flow ids that are not direct child directories', async () => {
  const loader = makeLoaderWithFiles({ launch: ['a@0.9.png'] });

  await expect(loader.load('../home')).rejects.toThrow('invalid flow id');
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm test -- test/flow/flow-loader.test.ts`

Expected: FAIL because `FlowLoader` and `TemplateCache` do not exist。

- [x] **Step 3: 写最小实现**

实现使用 `path.resolve(flowsRoot, flowId)`，并确认结果的父目录仍是 `flowsRoot`；只扫描 `.png` 和 `.bmp`；目录读取和模板读取错误必须带 Flow ID 与文件路径。Loader 不加载其他 Flow。

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- test/flow/flow-loader.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add 3rd/autohelper-node/src/flow/flow-loader.ts 3rd/autohelper-node/src/vision/template-cache.ts 3rd/autohelper-node/test/flow/flow-loader.test.ts 3rd/autohelper-node/src/types.ts
git commit -m "feat: load active image flow directory"
```

---

### Task 4: 实现 Linux ADB Client

**Files:**
- Create: `3rd/autohelper-node/src/adb/adb-client.ts`
- Create: `3rd/autohelper-node/test/adb/adb-client.test.ts`
- Modify: `3rd/autohelper-node/src/types.ts`

**Interfaces:**
- `AdbClient` 构造参数为 `{ serial, runner?: AdbRunner }`。
- `listDevices(): Promise<string[]>`
- `assertConnected(): Promise<void>`
- `screenshot(): Promise<Buffer>`
- `tap(x: number, y: number): Promise<void>`
- `AdbRunner(file: string, args: string[], options): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number }>`。

- [x] **Step 1: 写失败测试**

```ts
it('uses the explicit serial for screenshot and tap', async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const client = new AdbClient({
    serial: '192.168.1.6:5555',
    runner: async (file, args) => {
      calls.push({ file, args });
      return { stdout: Buffer.from('png'), stderr: Buffer.alloc(0), exitCode: 0 };
    },
  });

  await client.screenshot();
  await client.tap(100, 200);

  expect(calls).toEqual([
    { file: 'adb', args: ['-s', '192.168.1.6:5555', 'exec-out', 'screencap', '-p'] },
    { file: 'adb', args: ['-s', '192.168.1.6:5555', 'shell', 'input', 'tap', '100', '200'] },
  ]);
});

it('fails before automation when the selected device is offline', async () => {
  const client = new AdbClient({
    serial: 'offline-device',
    runner: async () => ({ stdout: Buffer.from('offline-device\toffline\n'), stderr: Buffer.alloc(0), exitCode: 0 }),
  });

  await expect(client.assertConnected()).rejects.toThrow('ADB device is not ready');
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm test -- test/adb/adb-client.test.ts`

Expected: FAIL because `AdbClient` does not exist。

- [x] **Step 3: 写最小实现**

使用 `child_process.spawn` 的 Promise 包装器读取二进制 stdout，不使用 shell 重定向或固定截图文件。`tap` 只接受有限整数且必须为非负坐标；命令失败时抛出包含 stderr 的错误。`assertConnected` 通过 `adb devices` 的制表符状态确认目标设备为 `device`。

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- test/adb/adb-client.test.ts`

Expected: PASS。

- [x] **Step 5: 运行真实设备只读冒烟并提交**

Run: `adb devices -l`

Expected: 当前设备 `192.168.1.6:5555` 状态为 `device`。

Run: `npm run build`

Expected: PASS；真实截图调用在 Task 9 的 dry-run 中执行。

```bash
git add 3rd/autohelper-node/src/adb/adb-client.ts 3rd/autohelper-node/test/adb/adb-client.test.ts 3rd/autohelper-node/src/types.ts
git commit -m "feat: add linux adb client"
```

---

### Task 5: 实现 OpenCV 模板匹配和可选 ORB 匹配

**Files:**
- Create: `3rd/autohelper-node/src/vision/image-matcher.ts`
- Create: `3rd/autohelper-node/test/vision/image-matcher.test.ts`
- Modify: `3rd/autohelper-node/src/types.ts`
- Modify: `3rd/autohelper-node/package.json`

**Interfaces:**
- `ImageMatcher` 接口：`match(frame: Buffer, template: LoadedTemplate, method: 'template' | 'orb'): Promise<MatchResult>`。
- `MatchResult` 包含 `score`、`rect`、`matched` 和 `method`。
- `TemplateCache` 负责把模板 PNG/BMP 解码为匹配器需要的 `LoadedTemplate`。

- [x] **Step 1: 写失败测试**

测试使用仓库内的最小 PNG fixture：一个 32×32 的纯色背景和一个 8×8 的高对比度方块，避免依赖游戏截图。测试通过 OpenCV 生成 fixture 或读取固定二进制，不调用 ADB。

```ts
it('returns the template rectangle when normalized template matching succeeds', async () => {
  const matcher = new OpenCvImageMatcher();
  const result = await matcher.match(frameFixture, templateFixture, 'template');

  expect(result.matched).toBe(true);
  expect(result.score).toBeGreaterThan(0.9);
  expect(result.rect).toEqual({ x: 12, y: 9, width: 8, height: 8 });
});

it('returns an unmatched result when the score is below threshold', async () => {
  const matcher = new OpenCvImageMatcher();
  const result = await matcher.match(unrelatedFrameFixture, templateFixture, 'template');

  expect(result.matched).toBe(false);
  expect(result.rect).toBeNull();
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm test -- test/vision/image-matcher.test.ts`

Expected: FAIL because the matcher and fixtures do not exist。

- [x] **Step 3: 验证预编译 OpenCV.js 运行时后写最小实现**

Run: `node --input-type=module -e 'import { createRequire } from "node:module"; const cv = await createRequire(import.meta.url)("@techstark/opencv-js"); console.log(typeof (await cv).Mat)'`

Expected: 输出 `function`；如果直接 ESM 默认导入出现 Promise namespace 兼容错误，使用 `createRequire`，不回退到需要本机编译的 native addon。

使用 `pngjs` 和 `bmp-js` 解码图片，模板匹配使用 `matchTemplate(..., TM_CCOEFF_NORMED)`，返回最大位置和模板尺寸。只有 score 大于等于调用方阈值时才设置 `matched`。ORB 作为同一接口的可选方法；如果特征点不足，返回 `matched: false`，不抛出业务错误。匹配器不执行点击。

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- test/vision/image-matcher.test.ts`

Expected: PASS，模板匹配和低分过滤均通过。

Run: `npm run build`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add 3rd/autohelper-node/src/vision/image-matcher.ts 3rd/autohelper-node/test/vision/image-matcher.test.ts 3rd/autohelper-node/src/types.ts 3rd/autohelper-node/package.json 3rd/autohelper-node/package-lock.json
git commit -m "feat: add opencv image matching"
```

---

### Task 6: 实现候选排序、`select` 和点击坐标计算

**Files:**
- Create: `3rd/autohelper-node/src/runtime/action-selector.ts`
- Create: `3rd/autohelper-node/test/runtime/action-selector.test.ts`
- Modify: `3rd/autohelper-node/src/types.ts`

**Interfaces:**
- `selectAction(candidates: MatchCandidate[], allMatches: Map<string, MatchResult>): SelectedAction | null`
- `resolveClickPoint(descriptor: ImageDescriptor, rect: Rect, frameSize: { width: number; height: number }): Point`
- `SelectedAction` 包含 `descriptor` 和 `match`。

- [x] **Step 1: 写失败测试**

```ts
it('ranks by queue first and score second', () => {
  const selected = selectAction([
    candidate('low-queue', 1, 0.99),
    candidate('high-queue', 10, 0.91),
  ], new Map());

  expect(selected?.descriptor.name).toBe('high-queue');
});

it('requires selectImage in the same flow', () => {
  const selected = selectAction([
    candidate('button', 1, 0.95, { selectImage: 'confirm' }),
  ], new Map([
    ['button', result(0.95)],
    ['confirm', result(0.90)],
  ]));

  expect(selected?.descriptor.name).toBe('button');
});

it('calculates normalized and center click points inside the frame', () => {
  expect(resolveClickPoint(descriptorAt(0.75, 0.25), { x: 10, y: 20, width: 40, height: 80 }, { width: 100, height: 100 }))
    .toEqual({ x: 40, y: 40 });
  expect(resolveClickPoint(centerDescriptor(), { x: 10, y: 20, width: 40, height: 80 }, { width: 100, height: 100 }))
    .toEqual({ x: 50, y: 50 });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm test -- test/runtime/action-selector.test.ts`

Expected: FAIL because selector functions do not exist。

- [x] **Step 3: 写最小实现**

候选先过滤 `queue < 0` 和未达到阈值的结果，再按 queue 降序、score 降序和稳定文件名顺序排序。`selectImage` 必须在同 Flow 且匹配成功；不满足时丢弃候选。点击点使用 `rect.x + rect.width * x` 和 `rect.y + rect.height * y`，四舍五入后做 frame 边界限制。`centerClick` 忽略矩形并点击帧中心。

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- test/runtime/action-selector.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add 3rd/autohelper-node/src/runtime/action-selector.ts 3rd/autohelper-node/test/runtime/action-selector.test.ts 3rd/autohelper-node/src/types.ts
git commit -m "feat: select image actions and resolve taps"
```

---

### Task 7: 实现自动识别循环和 `goto` 状态机

**Files:**
- Create: `3rd/autohelper-node/src/runtime/automation-loop.ts`
- Create: `3rd/autohelper-node/src/runtime/record-store.ts`
- Create: `3rd/autohelper-node/test/runtime/automation-loop.test.ts`
- Modify: `3rd/autohelper-node/src/types.ts`
- Modify: `3rd/autohelper-node/docs/spec/image-driven-adb-automation.md`

**Interfaces:**
- `AutomationLoop` 构造参数为 `{ adb, loader, matcher, selector, options, sleep }`。
- `run(): Promise<void>` 持续执行直到 `AbortSignal`、`once`、错误或 transition 上限。
- `tick(): Promise<TickResult>` 执行一次截图、匹配、动作和状态变更。
- `TickResult` 包含 `flowId`、`actionName`、`clicked`、`gotoFlow` 和 `reason`。
- `RecordStore.append(entry)` 和 `RecordStore.read()` 以 JSONL 保存 Flow ID、图片名和时间。

- [x] **Step 1: 写失败测试**

```ts
it('clicks a matched action and switches to its goto flow', async () => {
  const adb = fakeAdb();
  const loader = fakeLoader({
    launch: contextWith(action('enter', { gotoFlow: 'home' })),
    home: contextWith(action('daily')),
  });
  const loop = new AutomationLoop({ ...fakeDependencies(adb, loader), options: { intervalMs: 0 } });

  const result = await loop.tick();

  expect(adb.taps).toEqual([{ x: 50, y: 50 }]);
  expect(loader.currentId).toBe('home');
  expect(result.gotoFlow).toBe('home');
});

it('does not click or goto for a wait action', async () => {
  const adb = fakeAdb();
  const loader = fakeLoader({ launch: contextWith(action('wait', { wait: true, gotoFlow: 'home' })) });
  const loop = new AutomationLoop({ ...fakeDependencies(adb, loader), options: { intervalMs: 0 } });

  const result = await loop.tick();

  expect(adb.taps).toEqual([]);
  expect(loader.currentId).toBe('launch');
  expect(result.reason).toBe('wait');
});

it('dry-run reports a tap without sending it', async () => {
  const adb = fakeAdb();
  const loader = fakeLoader({ launch: contextWith(action('button')) });
  const loop = new AutomationLoop({ ...fakeDependencies(adb, loader), options: { intervalMs: 0, dryRun: true } });

  const result = await loop.tick();

  expect(adb.taps).toEqual([]);
  expect(result.reason).toBe('dry-run');
});

it('stops when transition limit is reached', async () => {
  const loader = cyclicLoader();
  const loop = new AutomationLoop({ ...fakeDependencies(fakeAdb(), loader), options: { maxTransitions: 2 } });

  await expect(loop.run()).rejects.toThrow('maximum flow transitions exceeded');
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm test -- test/runtime/automation-loop.test.ts`

Expected: FAIL because `AutomationLoop` does not exist。

- [x] **Step 3: 写最小实现**

循环必须严格遵守：截图 → 匹配当前 Flow → 选择 → wait 或 tap → delay → 成功点击后 goto。`goto` 目标由 `FlowLoader.switchTo` 校验，失败时停止而不是继续旧 Flow。`once` 只执行一轮；`dryRun` 不调用 tap，但仍计算坐标和输出结果；所有错误通过 `try-catch` 记录上下文后重新抛出。默认 interval 为 500 毫秒，默认 transition 上限为 100。

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- test/runtime/automation-loop.test.ts`

Expected: PASS。

- [x] **Step 5: 提交**

```bash
git add 3rd/autohelper-node/src/runtime/automation-loop.ts 3rd/autohelper-node/src/runtime/record-store.ts 3rd/autohelper-node/test/runtime/automation-loop.test.ts 3rd/autohelper-node/src/types.ts 3rd/autohelper-node/docs/spec/image-driven-adb-automation.md
git commit -m "feat: run image flow automation loop"
```

---

### Task 8: 实现截图生成、录制和 inspect 工具

**Files:**
- Create: `3rd/autohelper-node/src/tools/capture-tool.ts`
- Create: `3rd/autohelper-node/test/cli/capture-tool.test.ts`
- Modify: `3rd/autohelper-node/src/runtime/record-store.ts`

**Interfaces:**
- `captureTemplate({ adb, flowsRoot, flowId, name, region? }): Promise<string>`
- `cropPng(buffer: Buffer, region: Rect): Promise<Buffer>`
- `recordPath(store: RecordStore): Promise<string[]>`
- `inspectFlow({ adb, loader, matcher, flowId }): Promise<InspectResult>`。

- [ ] **Step 1: 写失败测试**

```ts
it('writes a captured screenshot into the selected flow directory', async () => {
  const output = await captureTemplate({
    adb: fakeAdbReturningPng(),
    flowsRoot: '/tmp/flows',
    flowId: 'launch',
    name: 'close-popup@0.88',
  });

  expect(output).toBe('/tmp/flows/launch/close-popup@0.88.png');
});

it('rejects a capture name that would escape the flow directory', async () => {
  await expect(captureTemplate({
    adb: fakeAdbReturningPng(),
    flowsRoot: '/tmp/flows',
    flowId: 'launch',
    name: '../outside@0.9',
  })).rejects.toThrow('invalid image name');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/cli/capture-tool.test.ts`

Expected: FAIL because capture helpers do not exist。

- [ ] **Step 3: 写最小实现**

截图工具调用 `adb.screenshot()`，验证 Flow ID 和文件名 stem 后写入 `flows/<flowId>/<stem>.png`。若指定 region，使用 OpenCV 裁剪；region 超出截图范围时失败。录制工具只写 JSONL，不自动修改图片文件名；`goto` 仍由用户在图片名中明确指定。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/cli/capture-tool.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add 3rd/autohelper-node/src/tools/capture-tool.ts 3rd/autohelper-node/test/cli/capture-tool.test.ts 3rd/autohelper-node/src/runtime/record-store.ts
git commit -m "feat: add image flow capture tools"
```

---

### Task 9: 实现 CLI、构建命令和 Node.js 自动运行入口

**Files:**
- Create: `3rd/autohelper-node/src/cli.ts`
- Create: `3rd/autohelper-node/test/cli/cli.test.ts`
- Modify: `3rd/autohelper-node/package.json`
- Modify: `3rd/autohelper-node/README.md`
- Modify: `3rd/autohelper-node/docs/usage.md`

**Interfaces:**
- 支持 `start`、`capture`、`record`、`inspect` 子命令。
- `start` 参数：`--device`、`--flow`、`--flows-root`、`--interval`、`--matcher`、`--dry-run`、`--once`、`--max-transitions`。
- `capture` 参数：`--device`、`--flow`、`--flows-root`、`--name`、`--region`。
- 缺少必填参数时退出码为 2；ADB、图片或 Flow 错误退出码为 1；成功退出码为 0。

- [ ] **Step 1: 写失败测试**

```ts
it('parses start options and enables dry-run', () => {
  const options = parseCli(['start', '--device', 'd', '--flow', 'launch', '--dry-run', '--once']);

  expect(options).toMatchObject({
    command: 'start',
    device: 'd',
    flow: 'launch',
    dryRun: true,
    once: true,
  });
});

it('requires device and flow for start', () => {
  expect(() => parseCli(['start'])).toThrow('start requires --device and --flow');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/cli/cli.test.ts`

Expected: FAIL until CLI parsing and dispatch exist。

- [ ] **Step 3: 写最小 CLI 实现**

使用 Node.js `util.parseArgs` 解析命令行，不引入 Web 服务。`start` 创建 ADB Client、Flow Loader、Template Cache、Matcher、Selector 和 Automation Loop；启动前调用 `assertConnected`。捕获 `SIGINT` 后通过 AbortController 停止循环，不主动 kill 或接管其他服务进程。

- [ ] **Step 4: 运行单元测试和构建**

Run: `npm test`

Expected: PASS，所有已完成任务测试通过。

Run: `npm run build`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add 3rd/autohelper-node/src/cli.ts 3rd/autohelper-node/package.json 3rd/autohelper-node/README.md 3rd/autohelper-node/docs/usage.md
git commit -m "feat: add autohelper node cli"
```

---

### Task 10: 用当前 ADB 设备生成安全的 Infinite Nikki 图片流程并验证

**Files:**
- Create: `3rd/autohelper-node/flows/infinity-nikki/README.md`
- Create: `3rd/autohelper-node/flows/infinity-nikki/*.png`（只纳入明确截取的模板）
- Modify: `3rd/autohelper-node/docs/usage.md`
- Modify: `3rd/autohelper-node/docs/task/20260902-autohelper-node-image-flow.md`

**Interfaces:**
- 生成可被 `FlowLoader` 加载的实际 Flow 目录。
- 只使用用户明确要求的安全画面步骤；所有可能领取、购买、观看广告或改变账号资源的动作默认只生成图片，不自动点击。

- [ ] **Step 1: 检查设备和当前游戏画面**

Run: `adb devices -l`

Expected: `192.168.1.6:5555` 为 `device`。

Run: `npm run capture -- --device 192.168.1.6:5555 --flow infinity-nikki --name current@0.90`

Expected: 截图工具创建 `flows/infinity-nikki/current@0.90.png`，不发送点击。

- [ ] **Step 2: 运行 dry-run 单轮识别**

Run: `npm run start -- --device 192.168.1.6:5555 --flow infinity-nikki --dry-run --once --interval 500`

Expected: 输出截图尺寸、当前 Flow、候选图片、匹配分数和拟点击坐标；ADB 调用记录中没有 `input tap`。

- [ ] **Step 3: 由实际画面补充流程图片**

按用户指定的安全流程逐个进入画面，使用 `capture` 生成局部模板，并在文件名中补充 `goto@目标目录`。每个 Flow 的 README 记录图片来源、触发条件和是否允许点击。若用户没有指定具体任务，只保留启动/观察模板，不擅自执行签到、领取或付费相关点击。

- [ ] **Step 4: 做一次真实点击前的人工确认**

Run: `npm run inspect -- --device 192.168.1.6:5555 --flow infinity-nikki`

Expected: 只显示匹配报告；任何进入真实点击的命令必须由用户在明确指定目标 Flow 和图片后再执行。

- [ ] **Step 5: 更新文档并提交**

记录实际模板文件名、截图尺寸、阈值、设备验证结果和未覆盖的流程。然后运行全量测试和构建，再提交。

```bash
npm test
npm run build
git add 3rd/autohelper-node/flows/infinity-nikki 3rd/autohelper-node/docs/usage.md 3rd/autohelper-node/docs/task/20260902-autohelper-node-image-flow.md
git commit -m "feat: add infinity nikki image flow fixtures"
```

---

### Task 11: 完成文档同步、回归验证和任务收尾

**Files:**
- Modify: `3rd/autohelper-node/docs/design/image-driven-adb-automation.md`
- Modify: `3rd/autohelper-node/docs/spec/image-driven-adb-automation.md`
- Modify: `3rd/autohelper-node/docs/task/20260902-autohelper-node-image-flow.md`
- Modify: `3rd/autohelper-node/docs/todo.md`
- Modify: `3rd/autohelper-node/docs/usage.md`
- Modify: `3rd/autohelper-node/changelog.md`
- Modify: `3rd/autohelper-node/README.md`

- [ ] **Step 1: 更新实现状态**

将 design 中“尚未实现”的状态改为已实现部分，并在 spec 中同步实际函数名和伪代码。`todo.md` 删除已完成任务，只保留未覆盖的游戏流程或后续可选能力。

- [ ] **Step 2: 运行质量门禁**

Run: `npm test`

Expected: 所有单元测试 PASS，无未处理 rejection。

Run: `npm run build`

Expected: TypeScript 检查 PASS。

Run: `git diff --check`

Expected: 无空白错误。

Run: `npm run start -- --device 192.168.1.6:5555 --flow infinity-nikki --dry-run --once`

Expected: 真实设备截图 dry-run 成功，不发送点击。

- [ ] **Step 3: 更新 changelog 和使用说明**

按 AASC 格式记录完成日期、修改文件、图片资源命名规则和验证结果。README 必须给出从安装、截图、dry-run 到自动运行的完整命令。

- [ ] **Step 4: 最终检查并提交**

```bash
git status --short -- 3rd/autohelper-node
git diff --check -- 3rd/autohelper-node
git add 3rd/autohelper-node
git commit -m "docs: finalize autohelper node image flow"
```

Expected: 新工程下没有遗漏的未提交改动；父仓库其他用户改动不被加入提交。

---

## Plan Self-Review

- 设计文档中的图片驱动、Linux + ADB、OpenCV、`goto` 目录切换、截图生成、自动运行和安全边界均有对应任务。
- `goto@flowId` 解析、目录安全校验、活动 Flow 缓存切换和自动循环跳转保护均有单元测试计划。
- AASC 要求的 design、spec 伪代码、task、todo、usage、rules、ref、changelog 均有明确文件任务。
- 所有实现任务都先写失败测试，再写最小生产代码；配置文件和文档任务属于 TDD 例外。
- 计划不包含系统级开机自启动、JSON 流程 DSL 或游戏内部接口，符合已确认范围。
- OpenCV 原生绑定兼容性在 Task 5 前置验证；如果当前 Node ABI 不兼容，必须在该任务内解决并同步锁定依赖版本。
