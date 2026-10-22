# Chat2API远程登录伪代码

状态：已实现；以下伪代码与当前模块同步。

```text
已有声明 := Provider登录声明、OAuth/账号刷新、浏览器启动/CDP基础能力、独立豆包运行bridge、AASC控制端连接
新增定义 := 唯一登录槽位{拥有者连接,Provider,账号或state,隔离上下文,页面,视口,帧序号,输入序号,到期时间,关闭代次}
新增定义 := 登录浏览器角色；与豆包运行角色分离资料/页面集合/生命周期
打开外部登录 → 查询Provider登录声明 → 校验拥有者/账号/来源 → 申请唯一登录槽位
同会话重复打开 → 复用当前登录页面
同拥有者切换Provider或账号 → 确认未保存状态 → 停止旧采集/输入 → 关闭旧登录页/上下文 → 新建隔离登录上下文及唯一页面
其他控制端占用 → 返回忙状态，不接管、不打开第二页
网页登录 → 按声明恢复当前账号凭据或使用空登录上下文 → 回传页面 → 用户点击/输入/滚动/拖动
画面 → 帧大小/频率/背压限制 → 定向传回拥有者 → 按视口显示与确认
输入 → 校验会话代次/序号/视口 → 映射坐标 → CDP分发；保持按下/拖动/松开顺序
完成 → 按Provider声明采集Cookie/localStorage/Authorization及特有资料 → 原账号保存/校验 → 返回结果 → 释放登录槽位
仅APIKey或无登录声明 → 保留手工配置入口，不启动任意官网采集
取消/断线/超时 → 作废代次 → 关闭登录页/释放监听；不操作豆包运行页面
豆包运行页 := 原doubao.web/browser-port继续管理，登录页不纳入运行旧标签清理或签名后关闭范围
验证 := 各声明Provider契约/全服务最多一登录页/两页面角色隔离/跨账号与控制端/输入/背压/取消/保存
发布 := 仅服务代码；Android暂不接入，无APK需求；servicePackage标记待构建
```

## 实施协议

```text
控制端WS := chat2apiRemoteLogin{requestId,action,instanceId,providerId,accountId,sessionId,sequence,payload}
action := open / frame / input / complete / close；回包带requestId、success、sessionId，不含凭据
main控制端入口 := 在通用日志记录前截获此协议，避免输入文字进入日志；连接关闭释放拥有者会话
runtime选择 := 控制端现有Chat2API任务instanceId → 任务端口 → 当前运行runtime；会话固定该runtime
独立登录浏览器 := 复用既有浏览器可执行文件配置与CDP技术，临时私有profile/动态本机调试通道，始终最多一页
帧 := 客户端完成上帧解码后请求下一帧，服务端限频/限制消息队列，JPEG有界大小；关闭后作废代次
账号保存 := 已有OAuth校验 + saveAccount锁内比较打开时的通用账号版本（全部Provider原始账号字段）；冲突不覆盖
会话有效期 := 取本地上限和OAuth过期时间的较小值
凭据捕获 := 提取既有CLI浏览器捕获为共享模块，多Provider按声明捕获；豆包必须观察完整成功聊天样本
```
