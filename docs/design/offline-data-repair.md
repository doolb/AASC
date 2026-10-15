# Offline 通用数据修复包

## Qwen API 旧默认配置迁移 v4（2026-10-15，源码完成待出包）

服务v102升级保留已保存的qwen3-tts-flash/Cherry，导致旧安装仍显示旧模型的音色目录；ADB修正仅作用于测试设备。拟新增独立签名修复v4，把已知旧默认组合迁移到qwen-audio-3.1-tts-flash/qiaoxiaojiao_v3.1，并修正aiReplyDefault、textMedia、systemBroadcast中属于同一Provider的已知旧音色。已有效使用3.1音色或其他自定义模型的配置保留；无法判定的自定义音色组合整体跳过并记录结果，避免改模型后留下不兼容音色。

现有修复config能力没有TTS Provider读写方法，不能仅发布repair.js完成迁移。拟在执行器白名单加入现有getPublicTtsProviderSettings/setTtsProviderSettings，复用业务校验及持久化，不向脚本提供凭证读取或文件访问。需要配套新服务包；沿用min58、依赖包及任务包。repair4兼容数据0/1/2/3，按历史阶段补齐v3既有迁移后执行新迁移，成功到基线4；不重复重置用户后来修改的旧阶段偏好。

同脚本用于隔离首装种子，构建器生成修复ZIP、配对种子ZIP和签名清单。种子worker的回滚快照需涵盖userconfig，运行时继续使用已有完整快照。目标版本按出包时发布基线递增。用户已确认实施和出包验证。源码及定向测试完成，配套服务拟v104（当前两端正式v103）、修复v4、数据基线4；尚未构建或发布。原TTS保存方法补回旧模型隐藏的已存Qwen语速作为规范化输入，显式新语速仍优先，避免切换3.1丢失偏好。

## 累计基线3与默认模型映射（2026-10-14）

现行release基线3由累计repair3真实执行后生成，新增公开chat2api/model-mappings.json十条，保留v1/v2配置效果及记录。历史同步v1/v2得到基线2的说明保留用于回溯；后续打包输入采用基线3。旧APK不会因release变化自动得到新状态。

累计脚本对0补两项历史配置、对1仅补状态栏、对2不重置原偏好，再读取原始自定义映射并只补精确/通配未覆盖的默认项。运行时内置默认列表是虚拟有效视图，因此修复明确使用includeDefaults=false，避免将虚拟默认误当作种子已有数据。隔离worker禁止私人旧账号恢复，ZIP不含accounts.json。最低code85/APK46，支持compatibleDataVersions=[0,1,2]；旧min先升级47，再按提示确认修复。

最终发布组合code85、四组deps9、min47、repair3及seeds85；先核验各不可变归档再组合并签名最终清单，dataRepair.releaseSeedVersion与nodeMinSeeds.version配对且种子dataVersion=3。初稿低版本服务/min清单不发布；不改写旧v1/v2 ZIP。本次未重建full，另一任务已发布full46仍包含code84/deps8/基线2。详见Chat2API默认映射任务。


## 修复包与 release 数据基线统一（2026-10-14，源码完成）

用户恢复处理此前新包数据修复验证不通过的问题，并要求新增数据修复包时同步修改 release 配置、递增数据版本，后续新包携带该版本。本段取代下方“暂缓处理”的当前状态；历史定位记录保留。用户已确认完整方案；源码与种子已实施，正式修复包/APK/服务包尚未构建或发布。

实施前证据：已发布修复v2要求数据版本1→2；缺少前序修复成功记录的首装环境按0初始化。构建器只生成repair.js归档和签名组件，不更新release/config、release/userconfig。完整APK与首装种子只携带业务配置，没有数据修复基线；Native仍以服务健康通知修复成功。缺少这些衔接会同时产生门控拒绝和重复提示。

### 已写入现有两项修复

`sync:offline-data-repair-seeds`默认验签两份已归档的公开发布清单，并校验原repair.js摘要。隔离执行v1/v2后，release/config/config.json中的声纹开关为true，release/userconfig/userconfig.json中的offline-display.showStatusBar为false；release/config/data-repair-state.json为dataVersion=2、latestRepairVersion=2，包含两项真实种子修复记录与配置文件大小/SHA-256。设备上的appliedRepairs不被伪造。

候选full46/min47高于旧min45，避免新版full启动后自动安装缺少新数据语义的旧min；full候选代码/依赖基线80/9（沿用已构建的平台依赖v9），出包前需重新核对发布最高版本与依赖基线。minApk/servicePackage需重新出包，依赖状态保持对应任务的当前值。

### 同源配置与版本

- 新增`release/config/data-repair-state.json`，记录独立数据版本、最新修复版本和确实已包含于种子的修复元数据；APK版本和代码版本保持各自职责。版本只能随实际修复成功提交，不能通过手工抬高数据版本伪造配置已修复。
- `build:offline-data-repair`在隔离临时项目中复制release/config与release/userconfig，用现有业务服务与同一repair.js执行修复；不操作开发机运行配置，不启动业务服务器，不触碰task/results、模型或证书。成功校验后统一提交修复归档、签名元数据、种子配置和基线；失败、门控不匹配或源配置并发变化时保持原配置与版本。
- 新完整APK、nodeMinSeeds与独立min首装携带同一份基线。数据基线仅在实际初始化新配置时恢复到私有data-repair状态；已有安装的配置和修复状态保留，不因换APK或收到较新种子抬升设备版本。初始化中断须可恢复，不能只补版本而漏掉用户配置。
- Native区分包内已包含的基线与设备实际执行记录，均需匹配真实修复身份/版本；有更高版本时不反复提示已被覆盖的旧迁移。历史安装无基线继续按0处理，不从最新代码包推断数据已升级。

### 当前旧环境的合法迁移

只修未来种子不能自动修好现有版本0设备。已新增待出包的累计迁移脚本`offline-config-baseline-v3/repair.js`：明确支持实际数据版本0/1/2，按缺失阶段补齐声纹开关与本机状态栏修复，完成后写入新的目标版本。签名组件保留requiredDataVersion，并可增加明确的compatibleDataVersions集合；未声明该字段的旧包继续使用严格单版本门控，未知版本拒绝。累计脚本必须复用业务方法并检查结果，已有版本2的用户后来修改的偏好不被重复重置。旧v2归档和签名不原地改写。

新兼容字段由更新器传入pending，Node执行器校验后使用；兼容包声明支持它的最低APK/代码版本，旧客户端先升级。包内基线/已被覆盖的旧修复与成功运行记录分别表达，不补造缺失v1成功记录。正式迁移包和新版min需要在出包机生成与发布，本次方案不等于已出包。

### 真实结果与验收

Node启动前写入有界修复结果，包含repairId/repairVersion、实际/要求/目标数据版本及status；Native健康提交只证明服务可用。只有匹配的成功记录或可信首装包含记录才表示修复满足；拒绝/回滚展示真实原因，相同失败指纹的自动提示去重，手动重试及状态变化重新检查。混合服务更新时，健康代码正常提交，修复失败独立报告。

已增加配置/版本/归档/签名与首装种子共同提交、异常回滚/中断撤销日志、并发变化拒绝、首次初始化恢复、未知及损坏状态拒绝、真实成功证明、失败去重和明确重试自测。真实设备与正式发布另验。

## 状态

已完成首版实现。当前版本已经落地基于原有业务类的 JS 修复脚本、签名发布、运行时自动保存、版本门控和失败回滚；暂未发布具体业务修复包。

## 目标

Offline APK 设备可以在不重新安装完整 APK、不替换模型和不覆盖日志的情况下，接收并应用一个签名的数据修复包。修复包支持所有持久化配置文件，并且同一套数据内容既可以由运行时控制流程修改，也可以在服务无法正常运行时由 Offline 更新流程在启动前应用。

该机制可以视为“只执行一次的配置热修复”：同一设备成功应用同一个 `repairId` 后不再重复执行；执行失败或回滚时不写入成功记录，后续仍可重试。它只修改运行时数据和配置，不替换服务代码、Node 依赖、APK 或模型，因此不等同于代码热更新。

配置修改优先通过服务端原有业务类完成：服务端校验配置、更新内存状态、自动持久化并广播权威值。离线修复包携带签名的 `repair.js`，脚本只能通过修复上下文调用已注册的业务服务对象，不能直接访问文件路径、`fs`、Shell 或网络。

## 非目标

- 不处理控制端并发写入的 `requiredDataVersion` 乐观锁；控制端继续沿用现有配置保存流程。
- 不允许数据修复包修改服务源码、Node 依赖、APK、模型、日志、results、证书或私钥。
- 不在本阶段实现 mini、flash、pro 的多 Provider 模型路由；后续通过本修复脚本调用 Chat2API 原有管理类完成配置。
- 不提供服务端依赖包单独更新，不改变完整 APK 与 min APK 的签名和安装规则。

## 配置范围

修复系统内部仍使用逻辑路径标识配置目标，但 `repair.js` 不接收也不操作主机路径。目标注册表把业务类、配置集合和逻辑目标绑定起来，脚本只调用业务类的公开方法。

| 逻辑根 | 运行时目录 | 说明 |
|---|---|---|
| `server-config/` | `config/` | 服务主配置和能力配置 |
| `user-config/` | `home/.config/aasc-user/` | 用户配置、Chat2API、AI 角色、媒体库、提醒和历史配置 |
| `task-config/` | `res/tasks/<task>/` | 任务自身的 `config.json` 等配置文件 |

允许目标包括：

- `server-config/config.json`
- `server-config/capabilities.json`
- `user-config/userconfig.json`
- `user-config/chat2api/config.json`
- `user-config/chat2api/providers.json`
- `user-config/chat2api/accounts.json`
- `user-config/chat2api/model-mappings.json`
- `user-config/ai-roles/**/role.json`
- `user-config/media-libraries.json`
- `user-config/reminders.json`
- `user-config/chat-templates.json`
- `task-config/<task>/config.json`

实际目标必须在修复包中逐项列出，不支持通配符自动覆盖整个目录。

禁止目标落入以下目录或文件类型：

```text
logs/ models/ results/ src/ node_modules/ updates/ certs/
*.apk *.so *.dex *.js *.mjs *.sh 私钥文件
```

数据修复不再使用 `repair.json`、JSON payload 或通用文件 merge/patch。具体修改由原有业务类的方法定义，例如 `config.set`、Chat2API management service 的 `saveConfig`、`saveProvider`、`updateAccount` 和 `saveModelMapping`。没有业务类入口的目标不得由脚本直接修改。

## 总体架构

```text
控制端或已签名修复包
        │
        ▼
repair.js 受控执行器
        │
        ▼
原有业务类/服务对象
        │
        ▼
运行时数据管理器 RuntimeDataManager
        │
        ├── 配置规范化与目标适配器
        ├── 内存状态更新
        ├── 原子持久化
        ├── 备份与回滚
        └── 权威配置广播
        │
        ▼
config/、home/.config/aasc-user/、res/tasks/*/config.json

Offline 启动兜底:
签名清单 → 下载 dataRepair → pending-repair → Node 启动前应用 → 健康检查
```

## 运行时自动保存

所有可修改配置都通过原有业务类进入，不允许修复脚本直接修改 JSON 文件后继续使用旧内存对象。当前首版由数据修复执行器复用业务类的保存方法，并对已注册配置文件执行快照、原子恢复和状态提交；控制端既有远程配置流程继续负责规范化、内存刷新和广播。后续如需扩展更多业务类，再将其注册到同一执行器的能力白名单。

运行时修改流程：

1. 接收已授权的配置修改命令。
2. 根据清单声明的能力选择原有业务类事务代理。
3. 读取当前值并规范化输入。
4. 在内存中生成候选值。
5. 执行字段、类型、范围和依赖校验。
6. 使用临时文件写入候选值并计算 SHA-256。
7. 原子替换目标文件。
8. 更新内存快照和运行时模块。
9. 广播规范化后的权威配置。
10. 返回保存结果和新文件 hash。

控制端请求不携带 `requiredDataVersion`，服务端不做旧版本冲突拒绝。仍然保留顺序化写入锁，防止同一进程内两个保存操作同时覆盖文件。

### 原有业务类与修复上下文

| 目标 | 适配方式 |
|---|---|
| AASC 主配置 | 向脚本暴露现有配置服务的 `get`、`set` 和专用规范化方法 |
| Chat2API 配置 | 暴露现有 management service 的 `getConfig`、`saveConfig` |
| Chat2API Provider | 暴露 `saveProvider`、`deleteProvider`，复用 Provider 校验 |
| Chat2API 账号 | 暴露 `updateAccount`、`deleteAccount`，复用账号和 Provider 关联校验 |
| Chat2API 模型映射 | 暴露 `saveModelMapping`、`deleteModelMapping` |
| 用户配置/任务配置 | 只有已有业务类提供公开保存方法时才暴露 |

修复上下文只提供以下能力：

- `ctx.services`：已注册的原有业务类实例或其事务代理。
- `ctx.readVersion()`：读取当前数据版本和代码版本。
- `ctx.assert(condition, message)`：中止当前修复事务。
- `ctx.log(event, details)`：记录不含敏感值的审计信息。

脚本不能使用 `require`、`import`、`process`、`fs`、`path`、`child_process`、网络客户端或动态加载其他脚本。

## 数据修复包格式

修复包文件名：

```text
data/data-repair-v<repairVersion>.zip
```

ZIP 内容：

```text
repair.js
```

修复包不携带 JSON 配置快照或 JSON payload。版本、依赖、下载地址、大小和 SHA-256 由现有签名 `manifest.json` 的 `dataRepair` 组件描述；包内只放 `repair.js`。内部 `state.json` 仍可使用现有 JSON 格式保存应用状态，不属于修复脚本输入。

`dataRepair` 清单组件至少包含：`repairId`、`repairVersion`、`requiredCodeVersion`、可选的 `requiredApkVersionCode`、`requiredDataVersion`、`targetDataVersion`、`relativeUrl`、`size`、`sha256`、`scriptSha256` 和 `capabilities`。其中 `capabilities` 决定修复上下文允许注入哪些原有业务类。

### repair.js 入口

脚本只接收受控上下文并调用原有业务类，不能自行解析配置文件：

```js
module.exports = async ({ services, assert }) => {
  const current = await services.chat2api.getConfig();
  assert(current.loadBalanceStrategy !== undefined, 'Chat2API 配置未初始化');

  await services.chat2api.saveConfig({
    ...current,
    loadBalanceStrategy: 'round-robin'
  });
};
```

脚本可以按业务 API 连续修改多个对象；提交、备份、回滚和重新加载由修复事务负责。脚本不声明 `replace`、`merge`、`patch`、`delete` 文件操作，具体修改语义由原有类的方法决定。

## 敏感配置

`user-config/chat2api/accounts.json` 可以作为合法目标，但 `dataRepair` 清单必须显式声明敏感能力，修复上下文才允许暴露账号业务类。

规则如下：

- 修复引擎允许脚本调用敏感配置业务类，但必须由修复包清单显式声明敏感能力。
- 构建工具默认不自动打包账号凭据，必须显式开启敏感目标。
- Android 更新卡片显示“包含敏感配置”。
- 日志只记录目标逻辑路径、版本和 hash，不记录 Token、Cookie、密码和文件内容。
- 签名只保证来源完整性，不代表包内容加密。

## 版本机制

数据修复包有独立版本，不与 APK 或服务代码版本混用。

| 版本 | 用途 |
|---|---|
| `repairVersion` | 修复包自身递增版本 |
| `requiredCodeVersion` | 执行所需的最低服务代码版本 |
| `requiredApkVersionCode` | 执行所需的最低 APK 版本，可选 |
| `requiredDataVersion` | 修复包要求的当前数据版本 |
| `targetDataVersion` | 修复成功后写入的数据版本 |
| `repairId` | 幂等执行标识 |

`requiredDataVersion` 只用于修复包应用门控，不用于控制端普通配置保存。

设备状态文件：

```text
data-repair/state.json
```

```json
{
  "dataVersion": 2,
  "latestRepairVersion": 2,
  "appliedRepairs": [
    {
      "repairId": "chat2api-model-config-20260920",
      "repairVersion": 2,
      "targetDataVersion": 2,
      "appliedAt": "2026-09-20T12:00:00.000Z",
      "services": ["chat2api"]
    }
  ]
}
```

执行规则：

- 已应用相同 `repairId` 时跳过。
- 当前服务代码低于 `requiredCodeVersion` 时等待服务代码更新。
- 当前 APK 低于 `requiredApkVersionCode` 时等待 APK 更新。
- 当前数据版本不等于 `requiredDataVersion` 时拒绝执行。
- 修复成功后将数据版本更新为 `targetDataVersion`。
- 失败或回滚时数据版本保持不变。
- 如果修复脚本基于当前配置结构运行，必须声明兼容的最低服务代码版本；需要不同数据基线时，使用 `requiredDataVersion` 门控。

## 冲突策略

修复脚本通过 `ctx.assert` 检查业务前置条件；服务类返回校验失败时，整个事务中止。数据修复包不实现控制端的并发版本拒绝，普通控制端配置保存继续沿用现有流程。

## 事务、备份和回滚

修复引擎使用进程级修复锁，保证同一时刻只有一个修复任务。首版采用“调用原有业务类 + 已注册文件快照回滚”的事务实现，避免脚本中途失败后留下半套配置；业务类继续负责自身的字段校验和原子保存。

备份目录：

```text
data-repair/backups/<repairId>/
```

应用流程：

1. 校验修复包签名、SHA-256、脚本格式和声明的服务能力。
2. 校验代码版本、APK 版本和数据版本。
3. 创建原有业务类的事务代理并执行脚本前置条件检查。
4. 为全部目标创建备份。
5. 由原有业务类生成全部候选状态并保存到事务暂存区。
6. 校验业务类返回值、版本和敏感数据策略。
7. 提交事务并原子持久化全部变更。
8. 写入 `state.json` 和应用记录。
9. 重新加载运行时模块并广播权威配置。
10. 通过本地健康检查后清理事务暂存区。

任一阶段失败都恢复所有已替换文件，删除临时状态，保留旧数据版本。

## 已落地实现

| 层次 | 实现位置 | 结果 |
|---|---|---|
| Node 执行器 | `src/apps/server/modules/data-repair/data-repair-js-runner.js` | 受限 VM 执行 `repair.js`，白名单注入 `config`、用户配置和 Chat2API 管理服务；校验版本、敏感能力、脚本 hash，成功按 `repairId` 记录，失败恢复快照 |
| 服务启动 | `src/apps/server/boot/server-app.js` | 在监听端口前读取 `data-repair/pending-repair.json`，复用现有配置服务和 Chat2API management service 执行修复 |
| 构建 | `scripts/ops/offline-update-package.js` | `--mode=data-repair` 生成只含 `repair.js` 的 `data/data-repair-v<N>.zip`，写入签名 `dataRepair` 组件 |
| 发布 | `scripts/ops/publish-offline-update.js` | 支持 dataRepair 独立发布、LAN/WAN 原子切换和严格版本文件清理 |
| Android 清单与下载 | `OfflineUpdateManifest.kt`、`OfflineUpdateManager.kt` | 识别版本门控、hash、敏感标记；支持仅数据修复包下载、校验和 pending marker |
| Android 启动参数 | `NodeServerService.kt` | 将当前 APK versionCode 传给 Node，供 `requiredApkVersionCode` 门控 |
| Android 提示 | `MainActivity.kt`、`strings.xml` | 数据修复作为独立更新类型显示确认文案 |

首版的能力白名单包括主配置、用户/显示配置、Chat2API 配置、Provider、账号和模型映射；账号能力必须声明 `sensitive=true`。修复包只允许根目录 `repair.js`，不提供文件路径、`require`、`process`、网络或命令执行能力。

## Offline 更新流程

现有签名清单保持 `schemaVersion: 1`，在 `components` 下增加可选 `dataRepair`。旧 APK 忽略未知组件，新 APK/服务代码识别并处理。

推荐发布顺序：

1. 发布支持数据修复引擎和更新提示的服务代码。
2. 设备完成 code-only 或 all 更新并通过健康检查。
3. 构建并签名 `dataRepair` 包。
4. 先上传 LAN/WAN 版本化修复包。
5. 校验大小、SHA-256、签名和 HTTP 响应。
6. 最后原子替换 LAN/WAN 的 `manifest.json`。
7. 设备读取清单并显示修复内容、版本、目标数量和敏感标记。
8. 用户确认后下载并应用修复包。

修复包的发布清理规则新增：

```text
data/data-repair-v<数字>.zip
```

只删除当前发布根目录下严格匹配该规则且不再被当前清单引用的普通文件，不触碰 logs、models、config、task、results、临时文件和符号链接。

## Android 与 Node 协作

 Android 负责：

- 读取并验签清单。
- 检查修复包版本和 APK/服务版本条件。
- 下载修复包并报告进度。
- 用户确认和状态展示。
- 在修复期间停止/启动 Node。

Node 负责：

- 解析修复包和 `repair.js`。
- 创建受控修复上下文并注入原有业务类。
- 通过原有业务类校验和保存，不让脚本直接访问逻辑路径。
- 创建备份、执行原子替换和回滚。
- 写入应用状态。
- 启动后重新加载配置并参与健康检查。

服务启动时如果存在 `pending-repair.json`，必须先完成修复或回滚，再对外提供业务端口。

## 未来模型路由配置

本设计不实现 mini、flash、pro 的路由逻辑，只保证修复脚本可以调用 Chat2API 原有管理类写入模型配置。后续代码支持多 Provider 路由后，可使用类似脚本：

```js
module.exports = async ({ services }) => {
  await services.chat2api.saveModelMapping({
    model: 'mini',
    actualModel: 'model-a',
    providerId: 'provider-a'
  });
};
```

## 安全限制

- 所有修复包必须通过现有 RSA 清单签名和 SHA-256 校验。
- ZIP 解压拒绝绝对路径、`..`、符号链接和特殊文件。
- 只执行来自已验签发布源的 `repair.js`，不允许脚本自行加载代码。
- 脚本只能调用白名单业务类方法，不能访问 Node 原生文件、进程、网络和命令执行能力。
- 脚本执行时间、调用次数和事务变更数量设置上限。
- 应用日志不记录敏感值。
- 修复锁和 `repairId` 防止重复或并发执行。
- 修复包不能覆盖当前服务代码、依赖和 APK。

## 验收标准

- 原有配置类和 Chat2API 管理类均能通过 `repair.js` 正确保存。
- 服务重启后配置仍然存在。
- 修复包可重复检查但不会重复执行。
- 代码/APK/数据版本不满足时不会修改任何目标。
- 任一业务类写入失败时全部事务回滚。
- 未注册业务类、路径访问、动态加载、网络和命令执行均被拒绝。
- LAN/WAN 发布后的清单和修复包大小、hash、签名一致。
- 旧 APK 仍能读取包含未知 `dataRepair` 字段的清单并继续使用原有服务更新流程。

## APK重复数据修复提示定位（2026-10-13，待方案确认）

用户反馈已应用仍反复提示。ADB/API28/min40/code73日志实测修复hide-offline-display-status-bar-v2在启动前返回rejected-data-version，签名元数据要求dataVersion=1、目标2。执行器只在applied成功后写state.appliedRepairs；版本拒绝保留pending且不写成功标记。Native健康检查只确认服务代码/路径正常，随后将“已准备数据修复”当成应用成功通知；下一次检查因缺少repairId成功记录再给出提示。没有证据证明此设备的v2实际成功执行；当前具体dataVersion未直接读取，不推定为0。

候选方案：Native通过同一私有projectRoot读取实际修复成功记录，只有目标repairId已应用才报数据修复成功；版本不兼容回报真实原因，对repairId/repairVersion/实际数据版本相同的失败提示去重，手动重试或状态/清单变化重新检查。服务代码健康提交与修复失败区分，不因数据拒绝回滚正常代码、不伪造应用记录、不跳过版本门控。修改OfflineUpdateManager、NodeServerService、MainActivity及对应自测，重出min APK；用户确认前不改代码。

### 拒绝条件与首装链路补充（2026-10-13，只读确认）

当前v2清单要求数据版本精确为1。旧v1清单定义enable-voice-input-during-tts-without-voiceprint-v1为0→1，脚本只修改voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint；v2只修改offline-display.showStatusBar=false，两者没有脚本业务依赖。full运行种子未包含data-repair/state.json，记录缺失按0处理；当前LAN data目录只有data-repair-v2.zip，最新单修复清单不会自动补执行v1。缺少v1记录的新安装路径因此会被v2门控拒绝。此结论说明首装兼容缺口，仍不宣称直接读取了设备当前数值。

后续修复范围应同时评估首装兼容及真实成功判断，不能只隐藏提示，也不能伪造v1成功记录。兼容方案需按已签名元数据声明支持的实际数据状态，保持成功记录/幂等/回滚契约；新增方案需在代码实施前明确并按AGENTS确认。目前仅记录原因。

## 用户暂缓决定（2026-10-13）

用户明确“暂时先不处理”。只读定位与候选方案保留为待办；当前停止此问题的实施，不修改修复执行逻辑、成功记录、包元数据或APK，不运行修复、不构建或发布相关产物。后续由用户明确恢复后继续。
