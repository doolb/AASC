# Navigation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** 在现有 Node.js + ADB + OpenCV 工程中实现统一导航器、Markdown 导航包、独立动态 NavMesh、设计/运行时导航链和 HTTP 数据接口。

**Architecture:** Markdown 导航包描述目标、状态、Flow、规则和 Base64 图片，独立 NavMesh 文件保存动态三维网格。运行时由 NavigationCoordinator 并行观察 UI、战斗和空间场景，解析跨导航器导航链，再把当前微操作交给 NavigatorExecutor。旧图片 Flow 保持原格式，新导航数据通过人工或 HTTP 上传，不实现旧目录自动转换器。

**Tech Stack:** Node.js 原生 http、TypeScript NodeNext、Node fs/promises、现有 OpenCV.js/ADB/OCR、Vitest；不新增 Web 框架依赖。

**Spec:** docs/superpowers/specs/2026-09-04-navigation-architecture-design.md

## Global Constraints

- 工程路径固定为 /mnt/AASC/3rd/autohelper-node。
- 本轮不实现认证；HTTP 服务保留未来接入 AASC 认证的适配边界。
- 不修改现有图片 Flow 的运行语义；旧目录格式继续可读。
- 新导航包使用 Markdown；UI 和地标图片使用 Base64；NavMesh 网格使用独立文件。
- 外部或人工上传新导航数据；不创建旧图片 Flow 自动转换器。
- 多个场景可以同时观察，但每一轮默认只产生一个最终控制指令。
- 所有生产函数先有一个会失败的测试，再写最小实现。
- 不在真实设备上执行新增自动化动作；ADB 执行测试使用 fake runner 或 dry-run。
- 保留当前工作区已有修改，不覆盖无关文件。

## File Map

Create:

- src/navigation/types.js：导航目标、状态、链、指令和空间观测类型。
- src/navigation/navigator.js：Navigator 抽象基类。
- src/navigation/ui-navigator.js：UI 状态识别和 UI 指令规划。
- src/navigation/spatial3d-navigator.js：空间状态、交互物和 3D 指令规划。
- src/navigation/navigator-executor.js：执行 UI 和空间指令的 ADB 执行者。
- src/navigation/index.js：导航模块统一导出。
- src/vision/yolo-detector.js：autohelper 内部 YOLO 门面和模型选择。
- src/vision/yolo-onnx-backend.js：ONNX YOLO11 检测后端，OCR 不在此模块处理。
- src/vision/local-yolo.js：从 JSON 配置加载本地 YOLO 模型。
- src/navigation/package-types.js：Markdown 导航包的内存模型。
- src/navigation/package-parser.js：Markdown 导航包解析器。
- src/navigation/navigation-graph.js：静态设计图和运行时链解析。
- src/navigation/package-validator.js：导航包引用、分支和循环校验。
- src/navigation/navmesh-store.js：独立 NavMesh 文件的读取、Tile 合并和保存。
- src/navigation/navigation-coordinator.js：多场景状态观察和优先级仲裁。
- src/server/navigation-http-service.js：原生 HTTP 导航服务。
- src/tools/navigation-check.js：导航包检查和链输出工具。
- test/navigation/navigation-types.test.js：核心模型测试。
- test/navigation/navigator.test.js：基类测试。
- test/navigation/ui-navigator.test.js：UI 导航测试。
- test/navigation/spatial3d-navigator.test.js：空间导航测试。
- test/navigation/navigator-executor.test.js：执行者测试。
- test/vision/yolo-detector.test.js：YOLO 内部接口测试。
- test/navigation/navigation-coordinator.test.js：多导航器仲裁测试。
- test/navigation/package-parser.test.js：Markdown 解析测试。
- test/navigation/navigation-graph.test.js：导航链展开测试。
- test/navigation/package-validator.test.js：设计期校验测试。
- test/navigation/navmesh-store.test.js：独立 NavMesh 保存测试。
- test/tools/navigation-check.test.js：检查工具测试。
- test/server/navigation-http-service.test.js：HTTP 服务测试。

Modify:

- src/types.js：在 AdbClientLike 中增加可选 swipe 方法。
- src/adb/adb-client.js：实现并校验 ADB swipe。
- src/cli.js：增加 nav-check、nav-chain 和 nav-serve 入口。
- package.json：增加导航相关脚本（如果 CLI 入口需要独立脚本）。
- docs/usage.md：记录导航包、NavMesh 和 HTTP 接口使用方式。
- README.md：增加导航服务摘要。

## Task 1: 建立导航核心模型

**Interfaces:**

- NavigationMode：ui 或 spatial-3d。
- GameGoal：id、kind、success、priority、required、parent 和 delegate。
- NavigatorState：navigatorId、mode、id、status、confidence、observedAt 和 data。
- NavigationInstruction：ui tap/switch-flow/wait、spatial move/turn/jump/stop 和 none。
- Navigator：getCurrentState(frame)、generateInstruction(frame, target)。

- [ ] Step 1：写失败测试

验证空导航器 ID 被拒绝，测试导航器暴露 id 和 mode，并能表达 unknown-state 的无动作结果。

- [ ] Step 2：运行 RED 检查

Run: npm test -- test/navigation/navigation-types.test.js test/navigation/navigator.test.js

Expected: FAIL，原因是导航核心模块尚未存在。

- [ ] Step 3：写最小实现

创建 src/navigation/types.js 和 src/navigation/navigator.js。基类只负责校验 ID、暴露只读属性和声明抽象方法，不加入业务规划逻辑。

- [ ] Step 4：运行 GREEN 检查

Run: npm test -- test/navigation/navigation-types.test.js test/navigation/navigator.test.js

Expected: PASS。

- [ ] Step 5：提交

~~~bash
git add src/navigation/types.js src/navigation/navigator.js src/navigation/index.js test/navigation/navigation-types.test.js test/navigation/navigator.test.js
git commit -m "feat: add navigation core model"
~~~

## Task 2: 增加 ADB swipe 和指令执行者

**Interfaces:**

- AdbClientLike 增加可选 swipe(x1, y1, x2, y2, durationMs)。
- AdbClient.swipe 使用 adb -s serial shell input swipe。
- AdbNavigatorExecutor.execute(instruction) 返回 executed、reason、mode 和 action。
- move/turn 使用 movement.origin 和 radius；jump 使用 jumpPoint；dry-run 不调用 ADB。

- [ ] Step 1：先运行已有失败测试

Run: npm test -- test/adb/adb-client.test.js test/navigation/navigator-executor.test.js

Expected: FAIL，原因是 swipe 和执行者模块不存在。

- [ ] Step 2：补充失败边界测试

增加负坐标和负 duration 在调用 ADB 前失败的测试；保持 UI tap、spatial move、jump 和 dry-run 测试。

- [ ] Step 3：写最小实现

修改 src/types.js 和 src/adb/adb-client.js；创建 src/navigation/navigator-executor.js，处理 tap、wait、switch-flow、move、turn、jump 和 stop。

- [ ] Step 4：运行 GREEN 检查

Run: npm test -- test/adb/adb-client.test.js test/navigation/navigator-executor.test.js

Expected: PASS。

- [ ] Step 5：提交

~~~bash
git add src/types.js src/adb/adb-client.js src/navigation/navigator-executor.js test/adb/adb-client.test.js test/navigation/navigator-executor.test.js
git commit -m "feat: add navigator instruction executor"
~~~

## Task 3: 实现 autohelper 内部 YOLO 接口

**Interfaces:**

- YoloModelDefinition：id、task、modelPath、labelsPath、inputSize 和 decoder。
- YoloModelRegistry.register(definition)、get(modelId)、list()。
- YoloProvider.detect(frame, options)：Promise<YoloResult>。
- YoloResult：modelId、imageSize、detections；检测结果至少有 classId、className、confidence、left、top、right、bottom。
- LocalYoloDetector 使用本地模型注册表和内部 ONNX backend，不调用 AASC HTTP。
- OCR 继续使用现有 OcrClient 外部接口，不并入 YOLO 模块。

- [ ] Step 1：写失败测试

在 test/vision/yolo-model-registry.test.js 验证模型注册、重复 ID 拒绝、未知模型拒绝和 list 返回稳定顺序。

在 test/vision/yolo-detector.test.js 使用一个 fake backend 验证：

~~~ts
it('runs the selected local model and returns normalized detections', async () => {
  const detector = new LocalYoloDetector({
    registry: registryWith('road-model'),
    backend: {
      detect: async () => [{
        classId: 1,
        className: 'road',
        confidence: 0.94,
        left: 10,
        top: 20,
        right: 80,
        bottom: 90,
      }],
    },
  });

  await expect(detector.detect(Buffer.from('frame'), { modelId: 'road-model' }))
    .resolves.toMatchObject({
      modelId: 'road-model',
      detections: [{ className: 'road', confidence: 0.94 }],
    });
});
~~~

- [ ] Step 2：运行 RED 检查

Run: npm test -- test/vision/yolo-model-registry.test.js test/vision/yolo-detector.test.js

Expected: FAIL，原因是内部 YOLO 注册表和 detector 尚未存在。

- [ ] Step 3：写最小实现

创建 yolo-detector.js 和 local-yolo.js。模型 ID、路径和标签文件由调用方注册；detector 只负责选择模型、调用 backend、校验坐标和返回统一结果。

创建 yolo-onnx-backend.js，使用项目声明的 onnxruntime-web Node 构建加载 ONNX 模型。第一版支持 YOLO11 检测输出；分割模型通过 decoder 扩展点接入，不把检测和分割结果强行混成同一结构。

- [ ] Step 4：运行 GREEN 检查

Run: npm test -- test/vision/yolo-model-registry.test.js test/vision/yolo-detector.test.js

Expected: PASS。

- [ ] Step 5：提交

~~~bash
git add package.json package-lock.json src/vision/local-yolo.js src/vision/yolo-detector.js src/vision/yolo-onnx-backend.js test/vision/yolo-detector.test.js
git commit -m "feat: add extensible local yolo provider"
~~~

## Task 4: 实现 UI、空间和战斗扩展边界

**Interfaces:**

- UiNavigator 接受 StateContext[]、Flow repository、ImageMatcher、可选 OcrClient 和 MatchMethod。
- UiNavigator.getCurrentState(frame) 返回 UI 状态；generateInstruction(frame, target) 返回 tap、switch-flow、wait 或 none。
- Spatial3dNavigator 接受 SpatialPerception，维护可查询的 MapSnapshot，并生成 jump、move、turn、stop。
- CombatNavigator 本轮只定义可注册的领域状态和委托边界，不实现具体战斗识别模型。

- [ ] Step 1：运行已有导航器失败测试

Run: npm test -- test/navigation/ui-navigator.test.js test/navigation/spatial3d-navigator.test.js

Expected: FAIL，原因是 UiNavigator 和 Spatial3dNavigator 尚未实现。

- [ ] Step 2：写最小实现

UiNavigator 复用 locateState、selectAction、resolveClickPoint、decodeImage 和 satisfiesOcr；状态未确认时返回 none，不点击。确认状态后只在当前 Flow 中匹配目标动作。

Spatial3dNavigator 复用 SpatialPerception.analyze，记录 interactables，并按区域和距离生成空间指令。

- [ ] Step 3：补充不确定状态测试

验证 UI ambiguous、空间感知异常和 unknown 区域都不会产生高风险动作。

- [ ] Step 4：运行测试并提交

Run: npm test -- test/navigation

Expected: PASS。

~~~bash
git add src/navigation/ui-navigator.js src/navigation/spatial3d-navigator.js src/navigation/index.js test/navigation
git commit -m "feat: add ui and spatial navigators"
~~~

## Task 5: 实现 Markdown 导航包解析

**Interfaces:**

- parseNavigationPackage(contents, sourcePath): NavigationPackage。
- NavigationPackage 包含 metadata、scenarios、goals、states、flows 和 assets。
- 解析一个或多个 navigation-json fenced block。
- 解析 Markdown 图片中的 data:image/*;base64, URI。
- NavMesh 只解析为 navmesh 引用，不读取网格内容。

- [ ] Step 1：写失败测试

验证一个 Markdown 可以包含多个场景、UI 数组、topmost、目标、Flow、NavMesh 引用和 Base64 图片；验证重复 ID、非法 JSON、非法 Base64 和缺少 package ID 会报带 sourcePath 的错误。

- [ ] Step 2：运行 RED 检查

Run: npm test -- test/navigation/package-parser.test.js

Expected: FAIL，原因是导航包模型和解析器不存在。

- [ ] Step 3：写最小实现

创建 package-types.js 和 package-parser.js。保持解析规则明确：机器数据使用 navigation-json fenced block；图片通过 Markdown image data URI 注册资源；场景通过 Scenario 标题归属。

- [ ] Step 4：运行 GREEN 检查

Run: npm test -- test/navigation/package-parser.test.js

Expected: PASS。

- [ ] Step 5：提交

~~~bash
git add src/navigation/package-types.js src/navigation/package-parser.js test/navigation/package-parser.test.js
git commit -m "feat: parse markdown navigation packages"
~~~

## Task 6: 生成设计图、运行时导航链和校验结果

**Interfaces:**

- compileNavigationGraph(pkg): NavigationGraph。
- resolveNavigationChain(graph, goalId, state): ResolvedNavigationChain。
- validateNavigationPackage(pkg): Diagnostic[]。
- 节点支持 sequence、choice、repeat-until、delegate、verify 和 terminal。
- 静态设计图保留所有分支；运行时链根据当前状态解析实际分支。

- [ ] Step 1：写失败测试

验证战斗逃跑可以展开为 combat、Spatial3dNavigator、UI 和 confirm 节点；验证只要求技能次数的目标不要求战斗退出；验证 repeat-until、choice 和跨导航器 delegate 会出现在链中。

验证校验器能报告缺失 goto、缺失委托目标、不可达节点和无条件循环。

- [ ] Step 2：运行 RED 检查

Run: npm test -- test/navigation/navigation-graph.test.js test/navigation/package-validator.test.js

Expected: FAIL，原因是图编译器、链解析器和校验器不存在。

- [ ] Step 3：写最小实现

使用稳定 ID 建立节点和边；按状态谓词解析 choice；为动态循环保留循环条件；为 delegate 保留目标导航器和父目标优先级；所有引用和循环必须可校验。

- [ ] Step 4：运行 GREEN 检查

Run: npm test -- test/navigation/navigation-graph.test.js test/navigation/package-validator.test.js

Expected: PASS。

- [ ] Step 5：提交

~~~bash
git add src/navigation/navigation-graph.js src/navigation/package-validator.js test/navigation/navigation-graph.test.js test/navigation/package-validator.test.js
git commit -m "feat: compile and validate navigation chains"
~~~

## Task 7: 实现独立动态 NavMesh Store

**Interfaces:**

- NavMeshStore.load(mapId): Promise<NavMeshMap>。
- NavMeshStore.upsertTile(mapId, tile, expectedRevision): Promise<NavMeshMap>。
- NavMeshStore.save(mapId): Promise<NavMeshMap>。
- NavMesh 文件独立于 .nav.md，初版使用版本化 JSON 文件，后续可替换二进制编码。
- Tile 保存顶点、多边形、邻接、区域语义、特殊连接、置信度和版本。

- [ ] Step 1：写失败测试

验证生成 Tile、保存、重新加载、版本冲突和临时文件写入；验证 Markdown 文件不会被 NavMesh 更新修改。

- [ ] Step 2：运行 RED 检查

Run: npm test -- test/navigation/navmesh-store.test.js

Expected: FAIL，原因是 NavMeshStore 不存在。

- [ ] Step 3：写最小实现

创建 navmesh-store.js，按 mapId 保存独立文件，按 Tile ID 合并，使用 expectedRevision 乐观锁，使用临时文件和重命名避免半写入文件。

- [ ] Step 4：运行 GREEN 检查

Run: npm test -- test/navigation/navmesh-store.test.js

Expected: PASS。

- [ ] Step 5：提交

~~~bash
git add src/navigation/navmesh-store.js test/navigation/navmesh-store.test.js
git commit -m "feat: persist dynamic navmesh tiles"
~~~

## Task 8: 增加导航检查和链查询 CLI

**Interfaces:**

- checkNavigationPackage(filePath): Promise<NavigationCheckResult>。
- nav-check 只做设计期解析和校验，不访问 ADB。
- nav-chain 接受 package 文件、goal ID 和 JSON 状态，输出运行时链。
- 输出包含 packageId、diagnostics、staticGraph 和 optional runtimeChain。

- [ ] Step 1：写失败测试

验证有效包没有 error；缺失引用返回带节点 ID 的 error；运行时链按顺序输出节点 ID；动态目标返回 partial 而不是伪造完成。

- [ ] Step 2：运行 RED 检查

Run: npm test -- test/tools/navigation-check.test.js

Expected: FAIL，原因是检查工具和 CLI 命令不存在。

- [ ] Step 3：写最小实现

创建 navigation-check.js；在 cli.js 增加 nav-check 和 nav-chain；保持现有 start、capture、record、inspect 行为不变。

- [ ] Step 4：运行 GREEN 检查

Run: npm test -- test/tools/navigation-check.test.js test/cli/cli.test.js

Expected: PASS。

- [ ] Step 5：提交

~~~bash
git add src/tools/navigation-check.js src/cli.js test/tools/navigation-check.test.js
git commit -m "feat: add navigation graph checks"
~~~

## Task 9: 提供人工上传数据的 HTTP 服务

**Interfaces:**

- createNavigationHttpService(options): http.Server。
- POST /api/v1/sessions：创建会话并加载 .nav.md 与独立 NavMesh 引用。
- POST /api/v1/sessions/{id}/observe：提交截图和可选 OCR、YOLO、深度、位姿，返回状态、链和候选指令。
- GET /api/v1/sessions/{id}/state：返回 StateSnapshot。
- GET /api/v1/sessions/{id}/chain：只查询链，供可视化，不执行动作。
- POST /api/v1/sessions/{id}/goal：设置或追加高级目标。
- POST /api/v1/sessions/{id}/execution-result：接收外部执行者结果。
- GET /api/v1/packages/{id}/graph：返回静态设计图。
- GET /api/v1/packages/{id}/validate：返回设计诊断。
- POST /api/v1/packages/{id}/data：添加结构化目标、Flow、状态、图片或规则。
- POST /api/v1/maps/{id}/observations：提交地图观测。
- POST /api/v1/maps/{id}/tiles：更新独立 NavMesh Tile。
- POST /api/v1/vision/yolo：调用 autohelper 内部注册的 YOLO 模型；OCR 不由此接口处理。
- AuthProvider 只定义未来 AASC 适配边界；本轮不保存密码和本地用户数据。

- [ ] Step 1：写失败测试

验证创建会话、查询设计图、查询导航链、上传结构化数据和更新 NavMesh Tile；验证链查询不会执行 ADB。

- [ ] Step 2：运行 RED 检查

Run: npm test -- test/server/navigation-http-service.test.js

Expected: FAIL，原因是 HTTP 服务不存在。

- [ ] Step 3：写最小实现

使用 Node 原生 http.Server；实现 JSON body 大小限制、路由解析、400/404/409/500 响应和内存会话存储。调用 PackageStore、NavMeshStore、NavigationCoordinator 和 VisualizerQuery，不直接拼接 Markdown，不执行任意 shell。

- [ ] Step 4：运行 GREEN 检查

Run: npm test -- test/server/navigation-http-service.test.js

Expected: PASS。

- [ ] Step 5：提交

~~~bash
git add src/server/navigation-http-service.js test/server/navigation-http-service.test.js src/cli.js package.json
git commit -m "feat: expose navigation data http api"
~~~

## Task 10: 文档同步和完整验证

**Files:**

- Modify: README.md
- Modify: docs/usage.md
- Modify: docs/superpowers/specs/2026-09-04-navigation-architecture-design.md if implementation details need precise correction.

- [ ] Step 1：更新使用说明

记录人工或外部上传 .nav.md 的方式、独立 .navmesh 的引用、nav-check、nav-chain 和 HTTP 服务；说明旧图片 Flow 不会自动转换，认证后续接入 AASC。

- [ ] Step 2：执行完整测试

Run: npm test

Expected: 全部既有测试和新增导航测试通过。

- [ ] Step 3：执行 TypeScript 构建

Run: npm run build

Expected: exit code 0，无 TypeScript 错误。

- [ ] Step 4：执行导航检查和工作区检查

Run:

~~~bash
git diff --check
npm run nav-check -- navigation/infinity-nikki.nav.md
git status --short
~~~

Expected: 导航包没有 error；工作区中只包含本任务预期的新文件和已有用户改动。

- [ ] Step 5：提交文档

~~~bash
git add README.md docs/usage.md
git commit -m "docs: document navigation service workflow"
~~~

## 依赖关系和检查点

~~~text
Task 1 -> Task 2 -> Task 3 -> Task 4
                            |
                            v
                  Task 5 -> Task 6 -> Task 8 -> Task 9 -> Task 10
                            |
                            v
                          Task 7
~~~

每完成一个任务都运行对应测试并做小提交。人工上传的新导航数据必须通过解析和校验；旧图片 Flow 的迁移由外部数据提交完成，不在本项目中增加自动转换工具。
