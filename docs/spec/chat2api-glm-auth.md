# GLM认证签名

```text
输入 := 当前毫秒时间戳字符串，随机nonce（UUID去掉连字符）
校验位 := 所有十进制位之和减去倒数第二位，再对10取余
签名时间戳 := 替换原时间戳倒数第二位为校验位
签名 := MD5(签名时间戳 + "-" + nonce + "-" + 官网固定盐)
输出 := X-Timestamp、X-Nonce、X-Sign
认证头 := App-Name=chatglm、X-App-Platform=pc、X-App-Version=0.0.1、X-App-fr=default、X-Lang=zh-CN、空设备型号/品牌、32位X-Request-Id
刷新令牌授权 := Bearer + refresh_token；官网getter本身负责加Bearer，不删除前缀
登录校验、聊天refresh与聊天发送 := 使用同一个签名函数；原消息与凭据不写日志
失败 := 保留失败状态，不跳过官网校验，不自动保存无效凭据
```
证据：2026-10-22当前Vivaldi官网main.0e91501b.js认证函数；不是网上第三方实现。

现场补充：仅修正签名仍40001；补齐官网PC应用标识/平台/版本等认证头后Node返回HTTP200/status0，最终正式验证器直接调用也valid=true。未发送聊天消息；实际控制端WS保存已验证成功。

```text
现场验收 := 正式/control WS open(glm) → frame有画面 → complete(success=true,saved=true)
回读账号列表 := 保存账号存在且providerId=glm，账号数1；全流程不发送聊天
```
