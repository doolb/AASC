# 豆包纯 Node 普通 LLM

2026-10-13已用当前授权账号验证：在取得一次账号资料并断开Chrome调试连接后，正式Chat2API Provider工厂和CoreAdapter完全通过Node发起新会话，流式与非流式均实际回复`OK`并正常结束。不使用页面fetch、浏览器签名或`a_bogus`。这次没有保存真实凭据或修改正在运行的主服务。

豆包文字统一使用Node直连，网页兼容分支及“旧版Chrome兼容模式”设置已删除。有完整nodeProfile即可请求；旧Cookie-only账号会明确提示重新登录补全资料，不连接Chrome或回退页面。

Android新版登录会一起保存同账号的Node资料，登录完成后文字请求直接由Node发送，无需保持网页打开。旧账号只保存Cookie时，普通LLM会提示“缺少Node直连资料，请重新登录豆包并完成账号保存”；重新使用Android登录入口完成登录即可补齐新账号资料，或按下文导入完整资料。原有账号不会被静默改写，也不会自动生成设备ID。此采集流程需更新到包含修复的min56及配套服务包。

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

带profile的账号使用Node模式，Cookie-only旧账号需补全资料才能文字聊天。未指定账号时优先调度启用的Node账号池；明确模型映射到某个账号时，该账号不可用就报错，不退选其他账号。Node失败不回退浏览器，也不自动重发或处理验证码。

普通Node模式已支持与Qwen相同的Responses会话复用。项目普通LLM选择已有`openai-responses`协议后，会自动保存响应引用；首轮建立豆包会话，后续仅发送新增输入。普通模式两轮真实协议验证已准确回忆随机标记，正式实现的存储恢复及流式生命周期由模拟测试验证，本轮未重启主服务加载。

直接调用时使用`POST /v1/responses`，保留现有代理API Key。首轮：

```json
{"model":"doubao","input":"请记住这条信息"}
```

取得首轮返回的`id`，下一轮：

```json
{"model":"doubao","previous_response_id":"这里替换为首轮响应id","input":"刚才的信息是什么？"}
```

也可使用返回的AASC `conversation.id`作为`conversation`，两种引用不能同时提交。上游原生ID由服务私有保存；恢复同一账号/登录身份后可继续，不需要把Cookie或上游ID放进每次聊天请求。更换模板、系统提示或模型时，项目已有LLM指纹流程建立新外层会话。

同一会话生成与保存串行，不同会话可并行。续接发出后取消、超时或协议失败可能改变上游位置，服务标记`uncertain`并提示新建；不自动重发或偷偷换账号。发送前身份/模式冲突也要求新会话；动态CSRF/msToken更新不自动认作换身份。Pi snapshot显式重建，delta复用。旧observed状态和缺有效ACK的首轮不会被当成可复用状态。

请求256KiB、SSE 8MiB、正文2MiB和总时限120秒（含排队），单会话最多16/总256租约；HTTP断连和未消费流均有清理。无会话引用的`/v1/chat/completions`保持无状态、逐轮历史重放；think/expert原生复用尚未验收。不承诺原生工具、多模态、长期令牌自动刷新、多进程共享存储或Android/Linux真实兼容性。

豆包TTS选择doubao-chat时自动识别doubaochat并选择当前可用账号，与qwen-chat一致，无需手动映射。自定义映射及显式账号仍优先；指定账号不可用就报错，不退选。TTS使用Cookie即可，不要求文字Node资料。

账号导入会清除来源中的远端验证标记，仍需在账号列表点击“验证登录”复验。网页登录和手动添加已接一次只读列表请求，失败仍保存；只有已知成功响应结构显示“会话列表已验证”，不等于普通LLM/TTS验收成功。详情见[统一账号与应用](chat2api-unified-applications.md)。
