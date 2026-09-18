# Chat2API 账号凭证导入导出与 Android 网页恢复

## 任务状态

- 日期：2026-09-18
- 状态：已实现，等待真实账号 Android 现场验收
- 预计工时：2～3 个工作日（服务端 1 天、控制端半天、Android 端半天、回归与发布半天）
- 当前执行结果：服务端、控制端和 Android 代码已完成；本轮未生成或发布 APK。

## 任务描述

在控制端 Chat2API 面板增加独立账号凭证 JSON 导入/导出，支持按 `accountId` 预览后合并；保留既有账号旧 ID，新账号优先用邮箱或手机号生成可读 ID。Android APK 为选中账号创建一次性网页会话，在隔离 WebView 中按 Provider profile 尝试恢复 Cookie/LocalStorage，失败时回退手动登录。

## Design 需求

- 设计文档：[android-chat2api-credential-transfer.md](../design/android-chat2api-credential-transfer.md)
- 明文 v1 账号包只包含账号身份、认证字段和启用状态。
- 不导出 Provider、全局 config、模型映射、API Key；不删除未出现在导入包中的本地账号。
- 邮箱优先、手机号次之生成新账号 ID；显式旧 ID 永远保留。
- Android 通过短 TTL、一次性服务端会话消费凭证；不经过控制端页面，不持久化到 WebView。

## Spec 设计

- 伪代码文档：[android-chat2api-credential-transfer.md](../spec/android-chat2api-credential-transfer.md)
- 需要实现的服务端能力：账号包字段白名单、导出、预览摘要、确认合并、账号网页会话创建与消费。
- 需要实现的控制端能力：账号工具栏、预览表格、确认合并、账号行“打开外部网页”。
- 需要实现的 Android 能力：原生会话消费、Cookie/LocalStorage 恢复、origin 白名单、手动登录回退和销毁清理。

## 受影响功能模块和代码

### 服务端

- `src/apps/server/modules/chat2api/chat2api-data-store.js`
- `src/apps/server/modules/chat2api/chat2api-manual-account-service.js`
- `src/apps/server/modules/chat2api/chat2api-oauth-service.js`
- `src/apps/server/modules/chat2api/chat2api-proxy-service.js`
- `src/apps/server/modules/chat2api/chat2api-login-profiles.js`

### 控制端

- `src/apps/web-mediacenter/ui/public/js/chat2api.js`
- 相关 Chat2API 静态契约测试

### Android

- `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiNativeBridge.kt`
- `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiLoginActivity.kt`
- `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiAuthWebView.kt`
- `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiCredentialCapture.kt`
- Android JVM 测试及必要的 manifest/资源契约

## 自测用例

1. 导出账号包可解析，且不包含 Provider、config、modelMappings、API Key。
2. 导入预览显示新增、更新、无效项；Token/Cookie 只显示存在标记。
3. 确认合并按 ID upsert，旧账号 ID 不变化，未导入账号仍存在。
4. 同一导入包重复 ID 被拒绝；确认摘要变化要求重新预览。
5. 新账号邮箱、手机号、无身份三类 ID 生成符合规则。
6. 创建、消费、重复消费、过期消费网页会话。
7. Android Cookie/LocalStorage 恢复、非法 origin 跳过恢复、Authorization-only 手动回退。
8. Activity 销毁清理临时 WebView 数据，凭证不进入日志或持久化。
9. 既有完整配置导入导出和普通 Android 登录捕获回归。

## 兼容性测试

- Node.js 现有 Chat2API 账号存储和旧随机 ID。
- 现有控制端完整配置导入导出接口。
- Android API 28 及当前 offline APK 的独立登录进程。
- 已有 Provider profile：Cookie、LocalStorage、Authorization-only 和未知 Provider。
- 控制端非 Android 环境点击“打开外部网页”时显示明确提示，不破坏普通网页登录。

## 性能测试

- 账号包 1、10、100、1000 条预览和合并耗时、内存。
- WebSession 创建/消费 P95 及过期清理。
- Android 页面首次加载、注入并重载一次的耗时；不产生长期缓存增长。

## 风险评估

- 明文导出文件含敏感凭证；通过下载警告、字段白名单、脱敏预览和 0600 权限降低风险。
- Provider 页面变化会导致映射失效；保持网页打开并回退手动登录。
- WebSession 重放可能泄露凭证；使用短 TTL、一次性消费、无缓存响应和原生内存清理。
- 旧账号缺少邮箱/手机号时无法转换为新 ID；按要求保留旧 ID。
- Android WebView origin 变化时可能无法恢复；必须以白名单阻止错误注入。

## 实施顺序

1. 用户审阅并确认本任务文档和 spec。
2. 按 spec 先更新测试契约，再实现数据存储与 ID 规则。
3. 增加服务端路由和一次性会话。
4. 增加控制端导入/导出和外部网页按钮。
5. 增加 Android 原生恢复流程与 JVM 测试。
6. 执行定向测试、Android 单元测试和全量回归；按发布流程生成 APK（如用户另行要求）。

## 未明确事项

- Provider profile 的具体恢复 key 需要以现有 profile 和真实测试账号逐项验收；不支持的字段保持手动登录回退。
- Android 真机需要使用真实账号确认 Cookie/LocalStorage 恢复和外部网页加载；失败时应验证手动登录回退。

## 实际改动与验证结果

- 服务端新增 `chat2api-account-identity.js`、`chat2api-account-web-session-service.js`，并修改账号数据存储、手动/OAuth 账号创建、管理服务、runtime 和 proxy 路由。
- 控制端 `chat2api.js` 与 `chat2api.css` 增加账号凭证独立导入/导出、脱敏预览和外部网页按钮。
- Android 新增 `Chat2ApiCredentialRestore.kt`，并修改 `Chat2ApiAuthWebView.kt`、`Chat2ApiLoginActivity.kt`、`Chat2ApiNativeBridge.kt`。
- 验证：`npm run check:chat2api` 91/91；Android `AASC_MNN_ROOT=/mnt/AASC/build/third_party/MNN AASC_MNN_REVISION=d407447ed56c4121a11ccbd266dc184ca1ead0c2 ./gradlew :app:testDebugUnitTest` 通过；`npm test` 848/848；`git diff --check` 通过。
