# AutoHelper Node.js 图片驱动 ADB 自动化设计

## 状态

设计已确认，尚未实现。

## 目标

在 `/mnt/AASC/3rd/autohelper-node` 新建一个 Linux 优先的 Node.js 工程，参考 `/mnt/tmp/autohelper` 中 C# 项目的图片识别和自动点击设计，通过 ADB 获取 Android 设备画面、使用 OpenCV 识别图片，并依据图片文件名中的规则执行点击、等待和流程目录切换。

第一目标是支持《无限暖暖》的图片流程，同时保留原项目图片驱动方式，使后续流程可以只通过新增图片和文件名规则完成，不需要为每个任务编写 JavaScript 代码。

## 已确认的约束

- 工程路径固定为 `/mnt/AASC/3rd/autohelper-node`。
- 运行环境为 Linux、Node.js 和 ADB。
- 原 C# 项目不修改，Node.js 工程独立实现。
- 流程由图片描述，文件名是流程节点和动作参数的载体。
- 使用文件名中的 `goto@目标目录` 进行多目录流程切换。
- 不使用广告观看、会员购买或其他付费操作作为自动化步骤。
- 目录切换必须限制在流程根目录内，禁止通过 `..` 或绝对路径逃逸。

## 参考项目结论

原项目的核心行为如下：

1. 从图片目录加载 PNG/BMP 模板。
2. 从图片文件名解析队列、匹配阈值、点击点、延迟、循环、等待、默认匹配和选择图片等参数。
3. 通过截图和 OpenCV 计算当前画面中的匹配位置。
4. 按队列优先级和匹配分数选择一个动作。
5. 通过 Windows 鼠标事件或 ADB 点击目标位置。
6. `record.txt` 可以记录已识别的图片名称，并按顺序回放。

原项目目前会把多个目录合并到同一个图片集合中，不能在运行过程中切换活动目录；新工程将目录建模为独立 Flow，只加载当前 Flow 的图片。

## 方案选择

### 方案一：兼容图片文件名规则并增加 `goto`（采用）

保留原有文件名参数，在解析器中增加 `goto@flowId`。运行时维护 `activeFlowId`，每次循环只扫描当前目录，匹配并执行动作后切换到目标目录。

优点是已有图片可以继续使用，流程迁移成本最低，图片仍然是唯一的流程描述来源。缺点是复杂分支仍然需要通过图片节点和文件名组合表达。

### 方案二：使用 JSON 描述完整流程

由 JSON 文件描述节点、条件和跳转，图片只作为节点资源。结构更清晰，但需要重新迁移原来的图片流程，也违背了当前“图片描述流程”的使用习惯，因此暂不采用。

### 方案三：每个游戏单独编写 JavaScript 流程

实现速度较快，但会把流程逻辑重新硬编码，无法复用图片规则，也无法达到原项目的通用自动化目标，因此不采用。

## 图片流程格式

流程根目录为 `flows/`，每个一级子目录是一个 Flow。Flow ID 使用目录名，不允许包含路径分隔符、空白路径、`.` 或 `..`。

```text
flows/
├── launch/
│   ├── close-popup@0.88.png
│   └── enter-game@0.90,clickpoint@0.5&0.5,goto@home.png
├── home/
│   ├── daily@0.90,goto@task.png
│   └── menu@0.86,delay@800.png
└── task/
    └── finish@0.86,goto@home.png
```

文件名去除扩展名后，按逗号分割参数。兼容的参数包括：

| 参数 | 示例 | 行为 |
|---|---|---|
| 队列和阈值 | `10@0.90` | 队列为 10，最低匹配阈值为 0.90 |
| 点击位置 | `clickpoint@0.6&0.5` | 在识别矩形内按归一化坐标点击 |
| 屏幕中心点击 | `clickpoint_ab@0&0` | 保留原项目语义，点击当前画面中心 |
| 延迟 | `delay@1000` | 当前动作后等待 1000 毫秒 |
| 循环 | `loop` | 允许上一动作在仍然匹配时重复执行 |
| 等待 | `wait` | 识别到图片但不发送点击 |
| 默认候选 | `default` | 当前 Flow 没有普通匹配时参与默认候选选择 |
| 选择图片 | `select@other` | 当前候选成立后，要求同一 Flow 的 `other` 图片也成立 |
| 目录切换 | `goto@home` | 动作处理完成后切换到 `home` Flow |
| 忽略候选 | `~10@0.90` | 保留原项目的负队列语义，不参与普通自动选择 |

新参数 `goto` 只接收 Flow ID，不接收任意文件系统路径。动作点击成功后才执行切换；如果节点包含 `wait`，则不点击也不执行跳转，避免未完成交互时提前切换流程。Flow 切换后清空上一节点状态并重新加载目标目录的图片缓存。

## 运行时架构

```text
CLI
 │
 ├── ADB Client
 │    ├── list devices
 │    ├── screencap -p
 │    └── input tap
 │
 ├── Flow Loader
 │    ├── validate flow id
 │    ├── load active directory
 │    └── resolve goto target
 │
 ├── Filename Parser
 │    └── ImageDescriptor
 │
 ├── OpenCV Matcher
 │    ├── template matching
 │    └── optional feature matching
 │
 └── Automation Loop
      ├── capture
      ├── match and rank
      ├── click or wait
      ├── delay
      └── goto flow
```

### ADB Client

ADB 命令通过 Node.js 子进程执行，设备使用显式序列号，避免多设备时误操作：

```text
adb -s <serial> exec-out screencap -p
adb -s <serial> shell input tap <x> <y>
```

截图以标准输入流读取，不依赖固定的临时截图文件。点击坐标使用截图原始像素坐标；如果云游戏画面与设备方向发生变化，使用截图尺寸和设备尺寸做明确的坐标转换，并在日志中记录转换结果。

### OpenCV Matcher

匹配器通过接口隔离，以便在 Linux 上先使用稳定的模板匹配，再根据实际图片质量启用 ORB 等跨平台特征匹配。匹配器返回匹配分数和识别矩形，不直接负责点击。

原 C# 项目默认使用 `SURF`，但 SURF 属于非自由特征实现且不同 Node.js OpenCV 绑定的可用性差；Node 版本不把 SURF 作为硬依赖，优先保证模板匹配和可用的跨平台特征匹配。

### Automation Loop

每次循环执行以下步骤：

```text
读取 activeFlowId
加载或取得 activeFlow 的图片缓存
通过 ADB 获取当前截图
对当前 Flow 的所有可选图片执行匹配
过滤低于阈值和负队列图片
按 queue 降序、匹配分数降序排序
验证 select 图片（如果存在）
计算点击坐标
如果是 wait：记录识别结果，不点击
否则发送 ADB tap
执行 delay
如果成功点击且存在 goto：切换 activeFlowId
等待 interval 后进入下一轮
```

为了避免 `goto@A` 和 `goto@B` 形成高速循环，运行时会记录最近一次跳转时间和目标，并使用最小切换间隔；连续跳转超过配置上限时安全停止。

## 图片流程生成

工程提供两类工具：

1. 截图工具：从指定设备获取当前画面，保存为 Flow 目录中的 PNG 模板，可选取矩形区域。
2. 运行录制工具：运行自动识别循环时记录实际命中的图片名称和 Flow ID，生成可回放的动作序列。

建议的使用方式：

```bash
npm run capture -- --device 192.168.1.6:5555 --flow launch --name close-popup@0.88
npm run record -- --device 192.168.1.6:5555 --flow launch
npm run start -- --device 192.168.1.6:5555 --flow launch
```

截图工具默认保存完整画面；通过 `--region x,y,width,height` 生成更稳定、更小的模板。模板生成不会自动猜测点击点或 `goto` 目标，避免根据单张截图误生成不可逆的点击动作；这些参数由文件名补充。

## 命令行接口

第一版提供以下入口：

```text
autohelper-node start    --device <serial> --flow <flowId> [options]
autohelper-node capture  --device <serial> --flow <flowId> --name <stem> [options]
autohelper-node record   --device <serial> --flow <flowId> [options]
autohelper-node inspect   --device <serial> --flow <flowId> [options]
```

运行选项包括：

- `--interval <ms>`：两次识别之间的间隔，默认 500 毫秒。
- `--matcher <template|orb>`：选择匹配方式，默认 template。
- `--dry-run`：只识别和输出点击坐标，不发送 ADB 点击。
- `--once`：只执行一轮后退出。
- `--max-transitions <n>`：限制单次运行的目录跳转次数。
- `--log-level <level>`：控制日志详细程度。

## 错误处理和安全边界

- ADB 设备不存在或离线时启动失败，不进入点击循环。
- 截图失败、PNG 解码失败或 OpenCV 初始化失败时记录错误并退出当前运行。
- 图片文件名解析失败时跳过该图片并给出文件名和原因。
- `goto` 目标不存在时停止流程，不保留旧 Flow 继续盲点。
- 任何点击前都检查坐标在当前截图范围内。
- 默认支持 `--dry-run`，端到端测试优先使用该模式。
- 不实现绕过游戏校验、注入游戏进程、读取私有游戏数据或付费操作。

## 测试设计

采用 Vitest 或等价的 Node.js 测试工具，先测试再实现。测试分为：

1. 文件名解析：旧参数、组合参数、非法参数、`goto` 和路径逃逸。
2. Flow 加载：目录扫描、图片过滤、缓存切换、目标不存在。
3. 匹配选择：阈值、队列优先级、分数排序、`select` 和 `default`。
4. 点击坐标：归一化点击点、中心点击、边界检查和方向尺寸转换。
5. ADB Client：命令参数、设备序列号、截图二进制流错误。
6. 自动循环：动作顺序、延迟、`wait`、`goto`、循环保护和 dry-run。
7. 真实设备冒烟：连接当前 ADB 设备执行截图和 `--dry-run --once`，不发送点击。

## 完成标准

- 可在 Linux 上安装依赖并启动 Node.js CLI。
- 可以从 ADB 设备读取截图并完成至少一种 OpenCV 图片匹配。
- 原有图片文件名参数可以被解析。
- `goto@目录` 可以切换活动 Flow，且只识别当前 Flow。
- 可以从设备截图生成图片模板。
- `--dry-run` 和 `--once` 可用于安全验证。
- 单元测试通过，真实设备截图冒烟测试通过。
- 使用说明、伪代码 spec、任务文档和变更日志与实现同步。

## 暂不实现

- 图形化流程编辑器。
- 云端任务调度和多设备并行控制。
- 游戏内部 API、内存读取或反作弊规避。
- 复杂的视觉规划、OCR 任务理解和自动生成全部任务步骤。
- 系统级开机自启动服务；第一版的“自动运行”指 CLI 启动后持续执行，后续再按需要增加 systemd 服务。
