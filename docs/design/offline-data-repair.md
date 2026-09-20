# Offline 通用数据修复包

## 状态

设计阶段。当前不修改运行时代码、不发布数据修复包；本设计先确定基于原有业务类的 JS 修复脚本、签名发布、运行时自动保存、版本门控和失败回滚契约。

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

所有可修改配置都通过原有业务类进入，不允许修复脚本直接修改 JSON 文件后继续使用旧内存对象。业务类的保存动作由 `RuntimeDataManager` 统一包裹，负责校验、事务、内存刷新和广播。

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

修复引擎使用进程级修复锁，保证同一时刻只有一个修复任务。原有业务类的单项保存接口由事务代理包裹，避免脚本中途失败后留下半套配置。

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
