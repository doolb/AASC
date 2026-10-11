#skill: ai-code-translation

# framework/qwen-chat-restore-and-model

## 已有声明
- normalizeSettings、config权威配置、TTS模型输入与只读SelfTest // 防止配置接受API模型而生成时才拒绝
- Chat2API网页登录profile与一次性会话、getQwenCredential // 凭证仍由已有账号体系解析
- Chat2ApiCredentialCapture、Chat2ApiCredentialRestore、Chat2ApiAuthWebView // 沿用原生隔离网页与来源边界

## 新增定义
- QwenChatModels { QUARK_VOICE, MINI_MAX } // 沿用现有语音服务接受模型，不引入百炼模型
- StoredModelRecovery { recoverLegacyModel } // 兼容此前已经保存错误模型的配置
- CookieRestoreMapping { name, field, origins } // 只覆盖明确允许的正式来源
- RestorePageStatus { sourceLabel, allowed, hasMappings } // 原生无地址栏时可看到脱敏来源

## 操作流程
- 对qwen-chat新保存模型规范化别名，再比对QwenChatModels，不符合时拒绝保存并回传权威值 // 生成前发现接口不匹配
- 对历史配置读取使用兼容模式，把不支持模型改为QUARK_VOICE；下次保存落盘 // 不因历史错误模型导致启动失败
- 控制端仅提供网页模型下拉，明确Qwen API模型属于另一服务 // 不改变其他Provider配置
- 对qwen恢复凭证复用现有ticket/Cookie解析，缺失时保留手动登录 // 不复制或发明新账号配置
- 对Cookie恢复来源逐项与允许列表精确匹配；qwen覆盖www、chat2、chat2-api // host-only Cookie不能覆盖另一个子域
- 对Android来源规范化scheme、host与默认端口，拒绝userinfo、非HTTP和非法端口 // 不用模糊后缀匹配凭证来源
- 对页面完成状态只显示scheme、host和非默认端口，不显示路径或查询片段 // 用户可定位来源而不暴露凭证
- 对Cookie和LocalStorage仅恢复当前等效origin；离开允许来源时显示跳过状态 // 不扩大任意网页注入
- 对异步Storage回调确认仍在同一来源再重载 // 页面跳转后不能给出旧来源成功提示

## 目标与测试映射
- src/apps/server/modules/tts/tts-provider-settings.js、modules/config/config-app-service.js -> 模型新保存拒绝与历史恢复
- src/apps/web-mediacenter/ui/public/js/tts-provider-settings.js、self-test.js -> 网页模型下拉、说明及只读校验
- src/apps/server/modules/chat2api/chat2api-login-profiles.js、chat2api-account-web-session-service.js -> 三个正式来源与凭证解析
- src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiCredentialCapture.kt、Chat2ApiCredentialRestore.kt、Chat2ApiAuthWebView.kt -> 等效来源与脱敏提示
- tests/tts-provider-settings.test.js、tts-provider-ws.test.js、tts-provider-ui-browser.test.js -> 错误模型不落盘、权威值回传、UI下拉、API模型兼容
- src/apps/server/modules/chat2api/chat2api-account-web-session-service.test.js、chat2api-login-profiles.test.js -> Cookie/ticket更新与严格来源映射、一次性会话兼容
- src/apps/android-display/app/src/test/java/com/aasc/display/Chat2ApiCredentialCaptureTest.kt -> 默认端口、大小写、恶意来源、脱敏提示与字段白名单

## 自测流程
- 构造已保存qwen3-tts-flash，读取得到QUARK_VOICE且服务可用；新保存错误模型拒绝且旧值不变 // 区分历史恢复与新输入约束
- 创建及消费qwen网页会话，三个来源均收到当前ticket，其他来源不收到 // 不回传到控制端DOM
- 用合法及恶意来源、userinfo、查询片段验证Android匹配与提示 // 不泄露凭证
- 执行已有npm Chat2API脚本、TTS回归、Android JVM测试与Kotlin编译 // 不把源码修改当作APK已发布
