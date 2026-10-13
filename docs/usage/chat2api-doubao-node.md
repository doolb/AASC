# 豆包纯 Node 普通 LLM

2026-10-13已用当前授权账号验证：在取得一次账号资料并断开Chrome调试连接后，正式Chat2API Provider工厂和CoreAdapter完全通过Node发起新会话，流式与非流式均实际回复`OK`并正常结束。不使用页面fetch、浏览器签名或`a_bogus`。这次没有保存真实凭据或修改正在运行的主服务。

普通LLM使用已部署Chat2API的`/v1/chat/completions`地址、代理API Key和模型`doubao`。`doubao-chat`是语音模型。`doubao-think`和`doubao-expert`保留模式映射，但本轮真实验收只覆盖普通模式。

在现有“导入账号凭证”流程中，给对应`doubaochat`账号添加`credentials.nodeProfile`。导入会先预览并要求明确确认；它只校验格式，不能据此宣称登录成功。以下所有值都是虚构示例，需要替换为同一账号资料：

```json
{
  "format": "aasc-chat2api-accounts",
  "version": 1,
  "accounts": [{
    "accountId": "doubao-node-example",
    "providerId": "doubaochat",
    "label": "豆包Node账号",
    "enabled": true,
    "credentials": {
      "cookie": "sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; s_v_web_id=verify_mock_123456789",
      "nodeProfile": {
        "deviceId": "1234567890123456789",
        "webId": "9876543210123456789",
        "fp": "verify_mock_123456789",
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/148.0.0.0",
        "pcVersion": "3.41.0"
      }
    }
  }]
}
```

`deviceId`来自该登录上下文的localStorage `samantha_web_web_id`对象的`web_id`；`webId`来自`__tea_cache_tokens_497858`对象的`web_id`；`fp`必须与该账号Cookie中的`s_v_web_id`相同，`userAgent`使用同一浏览器的值。不要复制参考项目作者的设备ID。`pcVersion`缺省为本轮验证的`3.41.0`。真实`msToken`可选，优先使用Cookie中的当前值，未提供时不生成假token。资料初始化后，聊天不再需要Chrome或9222；登录凭据过期仍需由用户重新取得有效资料。

允许Cookie名称仍仅为`sessionid`、`passport_csrf_token`、`passport_csrf_token_default`、`msToken`、`ttwid`和`s_v_web_id`。未知profile字段、换行头部、无效设备ID或fp不匹配会拒绝。完整profile从账号列表、导入结果和非秘密配置导出中剔除；只有明确的账号凭证导出包含它。

带profile的账号显式选择Node模式，Cookie-only旧账号继续受控网页模式。未指定账号时优先调度启用的Node账号池；明确模型映射到某个账号时，该账号不可用就报错，不退选其他账号。Node失败不回退浏览器，也不自动重发或处理验证码。

每轮新建上游会话，重放调用方提供的文字历史；只支持纯文字。请求256KiB、SSE 8MiB、正文2MiB和总时限120秒，HTTP断连取消上游。不承诺原生工具、多模态、长期令牌自动刷新、多账号或Android/Linux真实兼容性。

旧网页模式仍默认关闭并要求严格账号/target绑定。本轮没有修改其query实现；官网原标签成功不能代替项目网页bridge的独立验收。WAV语音和缓存行为保持原有实现。
