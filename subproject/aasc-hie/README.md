# AASC-HIE

AASC-HIE（Hierarchical Intelligence & Execution）是一个受生物自主行为启发的、配置驱动的实时导航与行动系统。

它把“看见什么、理解当前状态、选择下一步、执行动作、根据反馈修正”拆成可替换的识别层、计算层、执行层，并在其上提供三层自主行为：本能层、肌肉记忆层和智能层。系统既可以服务于游戏 UI、地图和战斗导航，也可以扩展到现实导航等需要持续感知与决策的场景。

项目使用纯 JavaScript ESM 实现。游戏规则、状态、目标、流程和导航数据通过配置与导航包描述；运行时不绑定某个游戏，也不要求使用大模型才能工作。

## 核心模型

```text
截图 / 传感器 / OCR / YOLO / 深度
                 │
                 ▼
识别层 ───────► 世界状态与时间 ───────► 计算层
                                           │
                         ┌─────────────────┼─────────────────┐
                         ▼                 ▼                 ▼
                      本能层          肌肉记忆层          智能层
                    立即安全反应      配置化导航流程      规划、模拟、学习
                         │                 │                 │
                         └──────────────► 指令与导航链 ◄─────┘
                                           │
                                           ▼
                              校验层 ───► 执行层
                                           │
                                           ▼
                                  ADB / 浏览器 / 外部设备
                                           │
                                           └──反馈回到世界状态
```

### 三层自主行为

- **本能层（Instinct）**：处理低延迟、强约束的安全行为，例如停止、躲避、越界保护、碰撞风险和失控恢复。它拥有最高的即时优先级，不依赖大模型。
- **肌肉记忆层（Muscle Memory）**：通过配置保存稳定、可重复的 UI 流程、移动方式、操作组合和已验证的导航链。它根据当前状态匹配动作；发现数据缺失、状态不一致或连续失败时，上报 `NavigationGap`。
- **智能层（Intelligence）**：根据高级目标进行规划、反查低级目标、模拟预演、生成或更新导航数据。它可以调用大模型，也可以由规则或人工实现。智能层能够通过标准导航数据接口更新肌肉记忆层；根据网上资料生成的粗略地图必须标记低置信度，最终仍由识别与运行时反馈校正。

高级目标可以拆成多个低级目标。低级目标通常表现为状态值或状态变化，例如“任务界面已打开”“日常完成数达到目标”“战斗胜利”“技能使用次数达到要求”。多个 UI 可以同时存在，状态集合会同时记录所有已识别 UI 以及最上层 UI。

## 分层职责

### 识别层 `src/recognition`

负责把外部输入转换成观察结果，不负责点击或移动：

- OpenCV 图片匹配与模板识别；
- 可插拔的 YOLO 检测/分割模型；
- 按状态配置按需调用的外部 OCR 服务；
- 多帧、深度和关键物体定位接口；
- 观察结果中的置信度、时间戳和来源信息。

OCR 只用于需要读取动态状态值的场景，例如每日任务完成条件；稳定且不易变化的文字优先使用普通 OpenCV 匹配。模型文件不随仓库打包，放在 `models/` 并通过配置引用。

### 计算层 `src/computation`

负责状态、空间和决策计算：

- 游戏时钟、世界状态融合、状态版本和单位跟踪；
- UI、地图、2.5D、3D 体积和横版导航；
- 动态 NavMesh 生成、更新、保存和加载；
- 目标规划、优先级调度、战斗模拟和导航警报；
- 生成单次导航命令，或返回用于检查和可视化的完整导航链。

战斗场景使用可配置的 `BattleNavigator`，普通战斗动作由战斗计划描述；逃跑和撤退目标可以委托给地图导航器。战斗模拟器支持胜利、逃跑、技能次数等附加目标，警报引擎负责按时间和优先级发布提醒。

地图中的路面、水面和障碍物不是单个点，而是可参与计算的面或体。NavMesh 是运行时动态生成的数据资源，独立保存，不嵌入 Markdown 导航包。

### 执行层 `src/execution`

负责执行已校验的指令：

- ADB 执行器；
- 浏览器/云游戏执行器接口；
- 指令校验、过期检查、状态版本检查和置信度门槛；
- dry-run、人工接管和告警输出。

执行默认关闭。必须显式启用，并注入 ADB 或浏览器适配器；账号登录、验证码等人工步骤保持手动处理。

### 运行时与服务层

- `src/runtime`：固定时间步调度、观察更新、会话、事件日志、运行时发现和实时状态。
- `src/server`：HTTP 导航服务，使外部浏览器、任务系统或其他客户端可以使用同一套导航器接口。
- `src/packages`：导航包的读取、校验、发布和操作接口。

## 导航包与数据文件

一个游戏可以有多个场景导航包，例如主界面、地图、战斗和逃跑。运行时可以同时加载多个场景，根据优先级选择当前链路；战斗中的逃跑动作也可以把地图导航作为后续链路。

```text
/mnt/AASC/subproject/aasc-hie/
├── packages/                         # 导航包（Markdown + Base64 图片）
│   └── *.nav.md
├── navmesh/maps/                     # 独立 NavMesh 文件
│   └── *.navmesh
├── models/                           # 外部 YOLO/深度模型说明与配置
├── data/rules/                       # 游戏规则、目标与版本资料
├── src/
│   ├── recognition/                  # OpenCV、YOLO、OCR、观察结果
│   ├── computation/                  # 状态、导航、规划、NavMesh、模拟
│   │   ├── goal-manager.js            # 高级目标、子目标与进度关联
│   │   └── progress-store.js          # 每日/每周/版本进度
│   ├── execution/                    # ADB、浏览器、指令与告警执行
│   ├── runtime/                      # 实时循环和会话管理
│   ├── packages/                     # 导航包处理
│   ├── server/                       # HTTP API
│   └── cli.js                        # 命令行入口
└── test/                             # 单元测试与导航包测试
```

HIE、`retop` 和 `remote-gamepad` 位于 `/mnt/AASC/subproject/` 下；旧 `/mnt/aasc-hie` 路径仍可使用。这三个子工程与 `aasc-game` 统一由 AASC 主仓库管理。

猪关卡脚本可通过 `GameTaskBridge` 读取识别、计划、结果和卡关证据，并可选报告到 `NavigationGapQueue`。脚本运行默认禁用，启用后由现有脚本负责逐步验证；桥接器本身不执行点击。接口说明见 [关卡任务桥接](docs/usage.md#关卡任务桥接)。

导航包使用 Markdown，图片以 Base64 保存，因此调用方可以把一个完整导航包作为单个文件传入。推荐把目录和文件名同时作为人类可读的语义标识，例如 `states/daily-home`、`flows/open-daily`、`goals/week-1`；具体绑定关系由 Markdown 中的 ID、状态、前置条件、匹配规则、动作和目标字段表达。

典型数据关系如下：

```text
高级目标
  └── 低级目标 / 状态值
        └── 目标 flow
              └── state 匹配规则（图片、OCR 或 YOLO）
                    └── 导航命令（点击、滑动、移动、等待、告警）
```

目标进度按日、周和版本保存。每日会话开始时清理每日进度；进入游戏后重新读取动态子目标，再由状态判断是否完成。配置可以声明目标的完成条件、重置周期、依赖目标、优先级和失败策略。

目标管理位于智能层的规划部分：`GoalManager` 负责把高级目标拆成可执行的子目标并附加当前进度，`ProgressStore` 负责每日、每周、版本和持久目标的保存与周期切换。进度存储可以使用内存，也可以通过文件或外部存储适配器持久化。

运行时可通过 `autoAdvanceGoals` 开启子目标自动推进，通过 `autoClearCompletedGoal` 在目标完成后清除当前目标；两项默认关闭，避免改变已有调用方的行为。

## 导航闭环

运行时每个时间步执行以下过程：

1. 接收当前截图或传感器观察；
2. 识别 UI、单位、地形和动态状态；
3. 合并世界状态并更新时间与状态版本；
4. 依次运行本能层、肌肉记忆层和智能层；
5. 生成导航链或下一条命令；
6. 校验命令后交给执行器，或在 dry-run 模式输出；
7. 记录结果、进度和告警，并把反馈用于下一次判断。

肌肉记忆层连续 5 次无法按照预期状态推进时，会记录提示，要求人工或智能层检查并更新导航包。导航链可以单独返回，用于设计检查、AI 编写导航包时的验证和 3D 可视化，并不等同于立即执行。

## HTTP API

服务入口：

```sh
node src/cli.js nav-serve
```

默认使用 dry-run。当前主要接口包括：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/v1/packages/:id/operations` | 对导航包执行标准数据操作 |
| `POST` | `/api/v1/packages/:id/validate` | 校验导航包 |
| `POST` | `/api/v1/packages/:id/publish` | 发布导航包 |
| `POST` | `/api/v1/navmesh/:id/observations` | 添加地图观察数据 |
| `POST` | `/api/v1/navmesh/:id/rebuild` | 重建并保存 NavMesh |
| `GET` | `/api/v1/runtime/state` | 获取当前世界状态与进度 |
| `GET` | `/api/v1/runtime/goal` | 获取当前外部指定目标 |
| `PUT` | `/api/v1/runtime/goal` | 设置当前外部指定目标 |
| `DELETE` | `/api/v1/runtime/goal` | 清除当前外部指定目标 |
| `GET` | `/api/v1/runtime/goals` | 获取全部目标及进度 |
| `GET` | `/api/v1/runtime/goals/:id` | 获取单个目标树 |
| `POST` | `/api/v1/runtime/goals/:id/progress` | 更新目标进度 |
| `POST` | `/api/v1/runtime/goals/:id/pause` | 暂停当前目标 |
| `POST` | `/api/v1/runtime/goals/:id/resume` | 恢复当前目标 |
| `POST` | `/api/v1/runtime/observations` | 输入当前截图/观察结果 |
| `POST` | `/api/v1/runtime/simulate` | 预演导航链或战斗状态 |
| `GET` | `/api/v1/runtime/alerts` | 获取导航警报 |
| `GET` | `/api/v1/runtime/gaps` | 获取待修复导航缺口 |
| `GET` | `/api/v1/runtime/chain` | 获取当前或目标导航链 |
| `POST` | `/api/v1/runtime/command` | 请求单次导航命令 |

认证接口预留给 AASC 权限系统接入；当前服务层保持注入式设计，不把某个大模型或账号系统写死在导航器内部。

## CLI

```sh
npm install
npm test
npm run build

# 校验导航包
node src/cli.js nav-check --file packages/honor-of-kings.nav.md

# 根据观察数据生成或更新 NavMesh
node src/cli.js nav-map-build \\
  --map honor-of-kings-25d \\
  --file data/maps/observations.json

# 启动 HTTP 导航服务
node src/cli.js nav-serve

# 外部指定当前目标（连接到已配置的运行时控制器时）
node src/cli.js nav-goal set --goal-id daily-inspiration --priority 800
node src/cli.js nav-goal get
node src/cli.js nav-goal clear
```

也可以使用已有 npm scripts：`npm test`、`npm run build`、`npm start`、`npm run nav-check`、`npm run nav-chain`、`npm run nav-serve` 和 `npm run nav-map-build`。

## 当前边界与安全默认值

王者荣耀当前使用只读状态识别包，覆盖大厅、设置、训练入口、战斗 HUD 和赛后界面。采样数据、按钮边界和识别范围见[状态识别操作说明](docs/operations/hok-practice.md)。这一阶段不包含自动战斗或 NavMesh 生成。

- 项目核心是通用导航器，不针对某个游戏写死坐标、包名或操作逻辑。
- YOLO、AnyDepth、ORB-SLAM3 等属于可插拔识别/建图能力；运行时可只用关键物体、OpenCV 和移动速度估计定位，不强制每帧运行深度模型。
- 静态图片可以用于建图，但不会计算速度；带时间戳的多帧输入才会产生速度或轨迹估计。
- `/navmesh/maps` 中的网格可以动态生成和保存；示例地图是结构验证数据，不代表真实游戏地图精度。
- 命令执行默认关闭，且必须同时满足显式开关、适配器、状态版本、有效期和安全校验。
- `manual` 命令会返回 `manual-handoff`，不调用 ADB，并暂停当前目标；人工完成登录、验证码等步骤后可通过目标接口恢复。
- ADB 或设备执行异常会转换为 `execution-error`，累计达到 `commandFailureLimit` 后要求人工复核。
- 识别层不直接操作设备，智能层不绕过执行层直接点击；所有外部动作都经过执行器。

## 发展路线

1. 完善导航包 Markdown schema、版本管理和外部认证接入。
2. 增加更多通用 YOLO 分割模型、深度模型和多帧重建适配器。
3. 将 NavMesh、观察轨迹、速度和可视化导航链整合为地图工具。
4. 增加战斗导航、单位预测、时间驱动警报和人工接管面板。
5. 让智能层能够根据 `NavigationGap` 和低置信度地图，通过标准接口生成候选数据，再由校验与反馈逐步固化为肌肉记忆。

## 许可证与项目状态

项目处于持续开发阶段。外部模型、游戏资源、账号和服务的使用须遵守对应的许可证、服务条款与适用法律。
