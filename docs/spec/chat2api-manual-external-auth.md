# Chat2API 普通网页手动外部认证实现伪代码

## Cookie 解析与凭据提取

```text
function parseCookieHeader(cookieHeader):
    if cookieHeader 不是非空字符串:
        throw 输入错误("Cookie 不能为空")

    cookies = 空对象
    for segment in cookieHeader 按分号拆分:
        name, value = segment 在第一个等号处分割
        name = trim(name)
        value = trim(value)
        if name 为空 或 value 为空:
            continue
        if name 是 Path/Domain/Expires/Max-Age/SameSite/Secure/HttpOnly 等属性:
            continue
        cookies[name] = value

    if cookies 为空:
        throw 输入错误("Cookie 格式无效")
    return cookies

function extractManualCredentials(providerId, input):
    credentials = 复制 input.credentials
    cookieHeader = trim(input.cookie)

    if cookieHeader 不为空:
        cookies = parseCookieHeader(cookieHeader)
        for mapping in MANUAL_COOKIE_MAPPINGS[providerId]:
            value = cookies[mapping.cookieName]
            if value 非空:
                credentials[mapping.credentialName] = value

    return credentials
```

## 手动账号添加

```text
async function addManualAccount(input):
    provider = providerRegistry.get(input.providerId)
    if provider 不存在:
        throw 业务错误("Provider 不存在")
    authMethod = input.authMethod 非空 ? input.authMethod : (input.cookie 非空 ? "cookie" : "manual")
    if authMethod == "external":
        throw 业务错误("外部登录必须由 Android 隔离 WebView 完成")
    if authMethod == "cookie" 且 provider 不声明 cookie 认证:
        throw 业务错误("该 Provider 不支持 Cookie 认证")

    credentials = extractManualCredentials(provider.id, { ...input, authMethod })
    validateRequiredCredentialFields(provider, credentials)
    await credentialValidator(provider.id, credentials)
    account = dataStore.saveAccount({
        providerId: provider.id,
        credentials,
        label: input.label,
        email: input.email
    })
    return 脱敏账号(account)
```

## HTTP 路由

```text
POST /api/chat2api/accounts/manual
    body = 解析 JSON
    result = managementService.addManualAccount(body)
    按现有 Chat2API 管理路由统一返回 200 { account: result }

    输入错误、Provider 不存在或校验失败:
        返回对应 400/404/422
        不保存账号
```

## 控制端页面

```text
加载 Chat2API 状态和 Provider 列表
    渲染 Provider 选择器
    在同一个认证表单中渲染当前 Provider 的 Token/字段输入框
    如果 Provider 支持完整 Cookie，追加完整 Cookie 粘贴框和字段说明
    Android 且存在 NativeControl 时在同一表单额外渲染“打开 Android 登录页”

提交统一认证表单:
    用户填写 Provider 字段，或粘贴完整 Cookie，或两者同时填写
    服务端根据是否存在 Cookie 自动选择 cookie/manual 校验路径
    已知 Cookie 映射结果覆盖同名手动字段

打开 Android 登录页:
    仅 Android 显示
    使用已选择的 Provider 调用隔离 WebView 登录流程

点击“添加外部认证”:
    收集 providerId、cookie 和手动字段
    POST /api/chat2api/accounts/manual
    成功: 刷新账号列表并清理敏感输入
    失败: 显示错误，不清理输入，方便修正
```

## 兼容约束

- Android WebView 继续调用 OAuth start/complete，不改用手动接口。
- 普通网页手动接口不创建 OAuth state，不打开外部页面。
- 响应中只返回脱敏账号和错误摘要，不返回完整凭据。
