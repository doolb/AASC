# 导航系统整体架构设计

日期：2026-09-04

状态：设计稿，暂不包含实现代码

## 1. 设计目标

本设计把现有的图片 Flow 自动化扩展为统一导航服务，支持：

- UI 导航：根据截图、模板匹配和 OCR 生成点击、等待、切换 Flow 等操作。
- 3D 导航：根据动态生成并持久化的 NavMesh 生成移动、转向、跳跃和停止操作。
- 战斗导航：根据战斗状态、敌人状态、技能次数和生存条件规划目标。
- 高级目标和低级目标：高级目标可以反查导航器能力，展开为状态目标和步骤链。
- 多场景协同：UI、战斗和 3D 地图场景可以同时观察，由统一协调器仲裁控制权。
- 设计期检查：AI 或人工编写导航包后，可以生成导航图，检查断链和错误引用。
- 运行期查询：根据当前截图和状态获取解析后的导航链，供执行者和 3D 可视化使用。
- HTTP 扩展：外部通过接口添加目标、Flow、图片、地图观测和 NavMesh 数据，内部自动维护版本和持久化数据。

本设计暂不要求一次实现完整的 3D 重建算法。第一阶段重点是数据模型、文件边界、HTTP 服务边界、导航链和组件职责。

## 2. 核心决定

导航系统由四类数据组成：

~~~
.nav.md        导航逻辑、目标、状态、Flow、规则和图片资源
.navmesh       独立保存的动态三维 NavMesh 网格
session state  运行时状态、目标进度和执行上下文
graph          Markdown 解析后的内存导航图
~~~

.nav.md 不保存 NavMesh 网格本体，只保存 NavMesh 的 ID 或引用。图片可以使用 Base64 嵌入 .nav.md。

## 3. 总体架构

~~~
AI / 人工编辑 / 外部 HTTP 客户端
                |
                v
        Navigation HTTP Service
                |
       +--------+---------+
       |                  |
       v                  v
Package Builder       Map/NavMesh Store
       |                  |
       v                  v
 game.nav.md        scene.navmesh
       \                  /
        v                v
          Navigation Graph
                 |
                 v
       Navigation Coordinator
        /          |          \
       v           v           v
  UiNavigator  CombatNavigator  Spatial3dNavigator
        \          |          /
                 v
        NavigationInstruction
                 |
                 v
        NavigatorExecutor
                 |
        ADB / 浏览器 / 游戏控制端
~~~

旁路数据流：

~~~
截图 / OCR / YOLO / 深度 / 位姿
                |
                v
          Observation Hub
                |
                v
            State Store
                |
                v
        Coordinator 重新规划
~~~

组件职责：

- NavigationHttpService：提供外部 HTTP 接口，不直接承担导航业务判断。
- NavigationPackageBuilder：合并外部数据、生成或更新导航包。
- NavigationGraphCompiler：解析 Markdown，建立内存导航图。
- NavMeshStore：加载、更新、保存独立 NavMesh 文件。
- Navigator：观察自己负责的领域，展开局部目标链并生成指令。
- NavigationCoordinator：合并状态、处理优先级、协调多个导航器和委托关系。
- NavigatorExecutor：执行指令，不负责规划和目标判断。
- VisualizerQuery：返回设计图、运行时导航链和地图数据供可视化。

## 4. 导航包组织

一个游戏可以有多个场景导航包：

~~~
云游戏启动
日常任务
战斗
3D 地图
采集或交互
~~~

对外可以发布为一个游戏级导航包：

~~~
infinity-nikki.nav.md
~~~

内部通过场景区块区分：

~~~markdown
# Game

id: infinity-nikki

# Scenario: netease-cloud

云游戏启动场景定义。

# Scenario: daily

日常任务场景定义。

# Scenario: combat

战斗场景定义。

# Scenario: spatial-map

3D 地图场景定义。
~~~

逻辑上可以独立维护不同场景，运行时则可以只启用相关场景，也可以通过一个文件初始化整个游戏导航环境。

Markdown 可以包含：

- 游戏和场景元数据。
- 高级目标、低级目标和完成条件。
- UI、战斗和地图状态条件。
- Flow、步骤、分支、循环和跨导航器委托。
- 优先级、必选/可选属性和抢占规则。
- UI 或地标识别图片，使用 Base64 嵌入。
- 独立 NavMesh 文件的引用。

示意：

~~~markdown
# Scenario: spatial-map

navmesh: infinity-nikki-world.navmesh

# Goal: reach-safe-area

success: map.safe-area.reached == true

# Flow: reach-safe-area

delegate: Spatial3dNavigator
~~~

Markdown 是人和 AI 可编辑、可审查的交换格式。运行时先解析成内存导航图，不直接逐行解释文本。

## 5. 状态模型

### 5.1 UI 状态

UI 状态使用有序数组表示当前截图中识别到的界面，从底层到顶层排列：

~~~
uis:
  - world
  - calendar
  - reward-dialog

topmost: reward-dialog
~~~

topmost 可以由数组最后一项计算。UI 数组只描述当前快照，不保存历史进度。

UI Flow 可以使用：

~~~
包含 calendar
topmost == calendar
不包含 reward-dialog
~~~

不在 UI 状态中增加 type 字段。UI 的含义通过 ID、Flow 引用和图片资源说明表达。

### 5.2 领域状态

数值和业务事实不放进 uis，按领域命名空间保存：

~~~
combat.active: true
combat.enemyCount: 2
combat.playerHp: 0.82
combat.skill.fireball.count: 1
combat.result: unknown

map.currentRegion: forest
map.position: [x, y, z]
map.poseConfidence: 0.84
~~~

运行时应区分直接观察结果与推断结果，并保留置信度和来源。未确认的状态不能触发高风险操作。

## 6. 目标模型

状态表示“当前是什么”，目标表示“希望达到什么”。低级目标可以表示为状态断言：

~~~
低级目标：打开日常界面
完成条件：topmost == daily
~~~

~~~
低级目标：释放火球三次
完成条件：combat.skill.fireball.count >= 3
~~~

高级目标是低级目标的组合，并可以引用多个导航器：

~~~
高级目标：战斗中释放火球三次后逃跑

低级目标：
  1. combat.skill.fireball.count >= 3
  2. map.safe-area.reached == true
  3. combat.result == escaped
~~~

目标支持：

- success：目标完成条件。
- required：是否为必需目标。
- priority：目标优先级。
- parent：所属高级目标。
- delegate：交给哪个导航器完成。
- before / after：时间约束。
- repeat-until：动态循环的结束条件。
- on-failure：失败后的重试、替代路径或终止策略。

目标完成不等同于场景结束。例如“释放技能三次”完成后，战斗仍然可以继续；战斗场景只有在 combat.active == false 或场景退出条件成立时才结束。

## 7. 导航器体系

### 7.1 Navigator 基类

统一导航器提供以下能力：

1. 观察当前领域状态。
2. 判断自己是否能够处理目标。
3. 将目标展开为局部导航链。
4. 根据最新状态生成当前所需的单次指令。

导航器不直接操作 ADB，也不负责全局优先级仲裁。

### 7.2 UiNavigator

负责：

- 根据图片匹配和 OCR 更新 uis 数组。
- 判断最上层 UI，防止点击被弹窗遮挡的底层界面。
- 处理 UI 状态目标、Flow、按钮匹配和 goto。
- 生成 tap、wait、switch-flow 等指令。

### 7.3 Spatial3dNavigator

负责：

- 根据截图、深度、位姿和运行时地图定位角色。
- 加载并查询独立 NavMesh。
- 判断当前位置、目标区域、障碍物和可通行面。
- 生成路径点和空间导航链。
- 生成 move、turn、jump、stop 等指令。

### 7.4 CombatNavigator

负责：

- 识别战斗是否开始、敌人数量、目标锁定、生命值和技能状态。
- 处理胜利、逃跑等终结目标。
- 处理释放技能次数、闪避次数等动态附加目标。
- 在需要地图移动时委托 Spatial3dNavigator。
- 在需要点击技能或逃跑按钮时委托 UiNavigator。

## 8. 多场景协同和优先级

多个导航包可以同时观察当前截图和状态，但不能各自独立控制执行器：

~~~
UiNavigator          同时观察 UI
CombatNavigator      同时观察战斗
Spatial3dNavigator   同时观察地图
          |
          v
NavigationCoordinator
          |
          v
一个最终控制指令
~~~

建议优先级：

~~~
紧急生存操作       100
战斗逃跑            90
高级目标必需步骤    80
战斗附加目标        70
普通 UI 操作         50
地图探索             30
~~~

子目标默认继承父目标优先级。因此战斗逃跑委托给地图导航时，地图移动仍然拥有逃跑目标的优先级，不会被普通地图探索打断。

典型链：

~~~
combat.active
  -> 检查是否可以直接逃跑
  -> Spatial3dNavigator: reach-safe-area
  -> UiNavigator/CombatNavigator: trigger-escape
  -> combat.result == escaped
~~~

状态观察可以并行，指令执行默认串行。只有明确标记为互不冲突的操作，才允许并行执行。

## 9. 导航图和导航链

需要区分三种对象：

### 9.1 静态导航图

Markdown 解析后的完整设计图，用于：

- AI 编写导航包后的结构检查。
- 查看目标、Flow、状态和导航器之间的关系。
- 生成 Mermaid、JSON 或其他可视化格式。

### 9.2 运行时解析链

根据当前截图、状态和目标，从静态导航图中解析出当前实际分支：

~~~
combat.escape
  -> spatial3d.reach-safe-area
  -> combat.trigger-escape
  -> combat.confirm-escaped
~~~

运行时链可以包含：

- 当前节点和下一节点。
- 等待条件和分支选择结果。
- 动态目标。
- 所属导航器和优先级。
- NavMesh Tile、Polygon ID 和空间路径点。
- partial、blocked 或 replanned 状态。

### 9.3 单次导航指令

当前节点根据最新观察生成的一次操作，例如点击、滑动、移动或跳跃。一个“到达安全区域”节点可以对应多次移动指令，但不应把这些微操作固化为设计链节点。

3D 可视化读取运行时链中的：

~~~
当前节点
NavMesh Tile
多边形 ID
路径点
目标区域
障碍物
跳跃连接
~~~

## 10. NavMesh 独立存储

NavMesh 网格本体不放在 Markdown 中：

~~~
infinity-nikki.nav.md
infinity-nikki-world.navmesh
~~~

Markdown 只保存引用：

~~~
navmesh: infinity-nikki-world.navmesh
~~~

逻辑上是一张地图，物理上建议使用分块 NavMesh：

~~~
world.navmesh
  - tile-0-0
  - tile-0-1
  - tile-1-0
  - dynamic-obstacle-layer
~~~

每个 Tile 至少包含：

- 局部坐标原点和坐标系。
- 顶点、多边形和邻接关系。
- 区域语义和通行代价。
- 跳跃、攀爬或传送等特殊连接。
- 生成版本、更新时间和置信度。

由于 NavMesh 都是动态生成的，运行时需要：

1. 加载已有 NavMesh。
2. 根据新观察更新局部 Tile。
3. 保存新的地图版本。
4. 在下次运行时继续加载和增量扩展。

动态障碍建议作为覆盖层保存，而不是直接破坏原始多边形。这样障碍消失后可以撤销覆盖。

## 11. HTTP 导航服务

### 11.1 服务定位

HTTP 服务是外部客户端和内部导航系统之间的统一入口。外部不直接修改 Markdown 或 NavMesh 文件，而是提交结构化数据，由内部组件完成合并、校验、保存和导出。

~~~
外部客户端
  -> HTTP API
  -> Session / Package / Map 服务
  -> 内部导航协调器
  -> 状态、导航链或指令
~~~

外部客户端可以是：

- 浏览器任务页面。
- AI 编写器。
- 地图采集工具。
- 截图和深度采集程序。
- ADB 控制端。
- 3D 可视化客户端。

### 11.2 会话接口

会话代表一次游戏导航上下文，绑定游戏、场景、设备和当前目标。

~~~
POST /api/v1/sessions
~~~

创建会话并加载一个游戏导航包。请求可以提供 packageId 或一个 .nav.md 入口；服务根据 Markdown 引用自动加载外部 .navmesh 文件。

~~~
POST /api/v1/sessions/{sessionId}/observe
~~~

提交当前截图，也可以附带 OCR、YOLO、深度和位姿结果。服务返回：

~~~
当前 StateSnapshot
当前场景
当前目标进度
运行时导航链
当前候选指令
~~~

~~~
GET /api/v1/sessions/{sessionId}/state
GET /api/v1/sessions/{sessionId}/chain
~~~

用于查询当前状态和导航链，3D 可视化客户端可以直接使用 chain 中的路径点、Tile、Polygon 和目标信息。

~~~
POST /api/v1/sessions/{sessionId}/execution-result
~~~

外部执行者报告一条指令的执行结果。服务更新目标进度、失败次数、状态和必要的重新规划标记。

~~~
POST /api/v1/sessions/{sessionId}/goal
~~~

设置或追加高级目标。目标可以引用导航包中已有的目标，也可以由外部提交动态目标。

### 11.3 导航包接口

~~~
GET  /api/v1/packages/{packageId}
GET  /api/v1/packages/{packageId}/graph
GET  /api/v1/packages/{packageId}/validate
POST /api/v1/packages/{packageId}/data
POST /api/v1/packages/{packageId}/export
~~~

用途：

- 查询导航包元数据和版本。
- 获取静态设计导航图。
- 获取 AI 编写后的校验结果。
- 添加目标、状态、Flow、图片和规则。
- 将内部模型导出为新的 .nav.md。

外部添加数据时，使用结构化数据而不是直接拼接 Markdown 文本。服务负责生成稳定的 ID、处理引用和保留格式。

### 11.4 地图和 NavMesh 接口

~~~
POST /api/v1/maps/{mapId}/observations
POST /api/v1/maps/{mapId}/tiles
GET  /api/v1/maps/{mapId}/tiles
GET  /api/v1/maps/{mapId}/route
POST /api/v1/maps/{mapId}/save
~~~

用途：

- 添加截图、深度、位姿和识别结果。
- 添加或更新一个动态 NavMesh Tile。
- 查询地图 Tile 供可视化。
- 查询当前位置到目标区域的路径。
- 保存新的 NavMesh 版本。

NavMesh 数据通过独立文件由 NavMeshStore 管理，接口只返回 mapId、Tile ID、版本和路径引用，不把大型网格写入 .nav.md。

### 11.5 实时链查询

导航链查询不要求执行任何操作：

~~~
GET /api/v1/sessions/{sessionId}/chain
~~~

返回的运行时链用于：

- 3D 路线显示。
- UI 流程图显示。
- AI 检查当前分支。
- 查看当前阻塞节点。
- 查看跨导航器委托关系。

如果导航链尚未完全确定，应返回 partial，并说明需要的观察条件，而不是伪造完整路径。

### 11.6 版本和并发

所有外部更新都需要带版本信息：

~~~
revision
source: ai / runtime / manual
confidence
timestamp
~~~

更新请求应带 baseRevision。如果服务端版本已经变化，则返回冲突，由客户端重新读取后合并，避免多个采集端覆盖彼此的数据。

包、地图和会话分别维护版本：

~~~
packageRevision
mapRevision
sessionRevision
~~~

## 12. 内部自动维护

HTTP 请求进入后，内部自动完成：

~~~
接收请求
  -> 校验字段和版本
  -> 标准化数据
  -> 更新 Package Model / Map Model / Session Model
  -> 生成或更新 NavMesh
  -> 编译导航图
  -> 运行导航链检查
  -> 持久化
  -> 返回新版本和诊断结果
~~~

建议内部持久化分为：

~~~
导航包源文件：
  game.nav.md

动态地图：
  scene.navmesh

会话和目标进度：
  session store

更新记录：
  navigation event log
~~~

运行时不应每一帧重新写完整 Markdown 或完整 NavMesh。地图采用 Tile 增量保存；导航包和会话在结构变化或检查点时保存。

## 13. 设计期校验

导航包进入运行环境前检查：

- 目标引用的状态、Flow 和资源是否存在。
- goto 和委托目标是否存在。
- 是否有不可到达的节点。
- 分支是否覆盖必要情况。
- 循环是否具有结束条件。
- 高级目标是否能展开为低级目标。
- 导航器委托是否有对应能力。
- 优先级和控制权是否冲突。
- NavMesh 引用是否存在且坐标系匹配。
- 图片 Base64 是否可以解码，资源 ID 是否重复。

校验结果区分：

~~~
error    不能运行，必须修复
warning  可以运行，但可能存在风险
info     设计提示
~~~

AI 编写导航包时，先返回设计图和诊断结果；只有通过必要检查后，才允许进入运行会话。

## 14. 安全边界

HTTP 服务如果可以触发 ADB 或浏览器控制，需要至少具备：

- 会话鉴权。
- 设备白名单。
- 指令来源和目标设备绑定。
- 高风险操作的速度和频率限制。
- dry-run 或只规划模式。
- 每条指令的审计记录。
- 外部提交数据的大小限制。

默认建议让 HTTP 接口返回导航指令，由外部执行者执行；ADB 执行器作为服务内部可选适配器，不直接暴露任意 shell 命令。

## 15. 推荐实现顺序

1. 固定 Markdown 导航包的数据结构和 ID 引用规则。
2. 实现导航包解析器和设计期校验器。
3. 实现静态导航图和运行时导航链模型。
4. 实现 Navigator 基类、UiNavigator 和 NavigatorExecutor。
5. 增加独立 NavMesh Store 和 Tile 接口。
6. 增加动态 NavMesh 的加载、更新和保存。
7. 增加 NavigationCoordinator 的多场景、优先级和委托。
8. 增加 CombatNavigator。
9. 增加 HTTP 服务和外部数据接口。
10. 增加导航链、NavMesh 和 3D 路线可视化输出。

首期可以使用模拟 NavMesh 和模拟状态验证 HTTP、导航链、优先级、委托和保存机制，再接入真实截图、深度和地图重建。
