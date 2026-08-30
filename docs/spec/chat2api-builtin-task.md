# Chat2API 核心内置任务实现规范

## 任务注册与生命周期

```text
registry.tasks 增加 chat2api.proxy
task.mode = service
task.target = server
task.run(context):
    读取 chat2api 用户配置
    创建 Chat2APIProxyService
    启动独立 HTTP Server(host, port)
    注册代理路由、鉴权中间件和管理回调
    返回 { type: 'service', stop() }

stop():
    停止 OAuth 临时回调
    关闭 SSE 和活动连接
    关闭 HTTP Server
    清理 Provider、账号和 API Key 的内存缓存
```

## 上游核心装配

```text
loadChat2ApiCore():
    加载 3rd/chat2api-core 的 Provider、OAuth、Store、Forwarder 和路由模块
    不加载 Electron、IPC、Tray、Window、Renderer、Updater
    将上游 Store 适配为 AASC UserConfig 存储
    将上游日志适配为 AASC 结构化日志
    返回 core
```

## 代理请求

```text
POST /v1/chat/completions(request):
    校验代理已运行
    校验 Authorization Bearer API Key（启用鉴权时）
    校验 model 和 messages
    通过 modelMapper 解析 Provider 和模型
    通过 loadBalancer 选择启用且健康的账号
    将请求交给 Provider adapter
    stream=true -> 转发标准 SSE 并在结束时记录统计
    stream=false -> 转换为标准 OpenAI response 并记录统计
    Provider 失败 -> 按故障转移策略选择下一账号
    全部失败 -> 返回不泄露凭据的错误摘要
```

```text
GET /v1/models:
    汇总启用 Provider 和模型映射
    返回 OpenAI models 数组
```

## 管理接口

```text
GET/PUT /api/chat2api/config:
    读取或校验代理配置
    保存 host、port、timeout、loadBalanceStrategy、enableApiKey

GET/POST/PUT/DELETE /api/chat2api/providers:
    列出、创建、修改、删除 Provider
    删除前检查关联账号和模型映射

GET/POST/PUT/DELETE /api/chat2api/accounts:
    列出脱敏账号、导入凭据、启用/禁用、删除和健康检查

POST /api/chat2api/oauth/start:
    生成一次性 state 和过期时间
    打开或返回 Provider 登录地址
    等待绑定 Provider 的回调
    校验 state 后保存凭据并删除临时状态

GET/POST/PUT/DELETE /api/chat2api/api-keys:
    管理访问密钥
    列表只返回脱敏值，创建时完整值只返回一次
```

## 数据安全

```text
saveSecret(data):
    创建 chat2api 目录
    以用户私有权限写入凭据文件
    写临时文件并原子替换正式文件
    日志只记录账号 ID、Provider ID 和操作结果

importChat2ApiData(file):
    读取并校验版本和字段
    预览 Provider、账号和模型映射
    用户确认后合并，不覆盖未出现在导入文件中的数据
    删除或隔离导入临时文件
```

## 本地数据存储实现

```text
createChat2ApiDataStore(options):
    rootDir = options.rootDir 或 ~/.config/aasc-user/chat2api
    创建 rootDir，权限设为 0700
    为 config/providers/accounts/api-keys 建立 JSON 文件入口
    为 oauth-sessions 建立临时会话目录

readCollection(name, fallback):
    读取对应 JSON 文件
    文件不存在 -> 返回 fallback 的深拷贝
    JSON 格式错误 -> 抛出可定位错误，不覆盖原文件

writeCollection(name, value):
    序列化为 UTF-8 JSON
    在同一目录创建私有临时文件，权限设为 0600
    flush 临时文件后原子 rename 为正式文件
    正式文件权限保持为 0600

saveAccount(account):
    校验 providerId、accountId 和账号结构
    合并同 accountId 记录
    保存完整凭据到 accounts.json
    返回脱敏账号，不返回 token、cookie、refreshToken、accessToken 或 apiKey

listAccounts():
    读取 accounts.json
    只返回账号公开字段和 secretConfigured
    对可能存在的兼容字段统一脱敏

createApiKey(input):
    生成不可预测的完整 key
    只在创建结果中返回一次完整 key
    持久化 key 的哈希和脱敏预览

validateApiKey(value):
    读取启用的 key 哈希
    使用恒定时间比较逐项校验
    只返回匹配的 key 元数据或 null，不返回持久化密钥

previewImport(data):
    校验版本、集合类型和字段上限
    统计待新增/合并的 Provider、账号和模型映射
    返回脱敏预览，不写入正式文件

mergeImport(data, confirmed):
    confirmed 不是 true -> 拒绝写入
    先在内存中合并并校验全部集合
    依次原子写入，任一失败则保留原文件并返回错误
    成功后返回新增/更新统计和脱敏摘要
```

## 上游同步

```text
syncUpstream(version):
    记录上游仓库地址、版本和许可证
    更新 3rd/chat2api-core 快照
    检查 AASC 排除清单仍未引入 Electron/Renderer 文件
    运行核心协议、Provider、OAuth、鉴权和流式测试
    运行 AASC 内置任务启动/停止/重启测试
    失败 -> 不更新当前可运行版本
    成功 -> 更新 UPSTREAM.md 和版本记录
```

## 兼容与验收测试

```text
测试旧 AASC LLM profile:
    不启动 chat2api.proxy
    原有 LLM 请求和 Pi Agent 行为不变

测试内置任务:
    启动成功 -> health、models、chat completions 可访问
    重复启动 -> 拒绝或复用同一实例，不重复占用端口
    停止 -> 端口释放、SSE 关闭、OAuth state 清理
    服务器重启 -> 不残留子服务和旧路由

测试管理:
    Provider/账号/API Key 增删改查
    OAuth state 过期、错误 Provider 和重复回调
    账号轮询、失败切换、全部失败
    敏感字段脱敏和日志安全
```
