# Chat2API远程登录伪代码

状态：与2026-10-22共享豆包浏览器实现同步。

```text
已有声明 := Provider登录声明 + OAuth/账号存储 + doubao-browser-port/bridge/launcher + AASC控制端WS
登录槽位 := {拥有者连接,实例,Provider,账号,OAuth状态,会话ID,输入序号,到期时间}
登录宿主 := 同rootDir共享平台桥租约；沿用豆包任务浏览器名称/本机端口/固定账号profile

打开 := 校验Provider声明、拥有者及运行实例 → OAuth.startLogin → 原账号凭据恢复包
     → bridge.openLogin → 当前运行账号或launcher.lastAccount匹配实际profile → 新建隔离Context及登录tab
同会话重复打开 := 复用；其他控制端 := 忙；同拥有者切换 := 确认后关闭原登录再打开
loginOpening期间 := 拒绝新运行请求；打开完成loginPins期间 := 拒绝切换宿主账号，同账号可正常请求
运行页整理 := 仅默认Context官网旧页/空白页；登录Context不被复用/导航/关闭
登录popup := 仅匹配登录页opener → 允许来源转入唯一登录页

固定profile := rootDir/browser-profiles/doubao/SHA256(accountId)[0:24]
active-browser.json := {accountId,debugPort,browserExecutable}，私有权限，无消息或Cookie
宿主查找 := 当前ownerAccount → 对比实际profile与上次记录/任务配置/已有账号 → 固定external-login兜底
端口已存在 := 连接CDP → Browser.getBrowserCommandLine取user-data-dir
           → 旧实例不支持时读取chrome://version profile路径
           → 匹配受管目录才接管；不匹配只disconnect，不关闭未知浏览器
端口不存在 := 写专用Preferences关闭退出/关窗确认 → 启动本机debugPort → 记录成功账号
已运行Vivaldi := 校验归属后在内置extension目标调用prefs.set，仅固定两项退出确认设置

输入 := 校验会话/严格递增序号/坐标/键白名单 → 登录页bringToFront → CDP/鼠标分发
帧 := 1024×720 JPEG65，最多2MiB，250ms缓存；客户端解码后300ms再拉帧；命令队列最多64项
完成 := 按声明采集Cookie/localStorage/Authorization及特有资料
     → OAuth.completeLogin → saveAccount锁内比对打开时通用账号快照 → 保存结果，不返回凭据
豆包完成 := 必须观察手动发出的一条消息收到完整成功回复
关闭/完成/断线/到期 := 停止观察 → 关闭登录Context → release pin → 释放OAuth槽位
关闭登录 := 不调用browser.close，不创建空白页；最后页签退出则下次重启浏览器
正常服务退出 := remoteLogin.stop → stopDoubaoBrowserPorts → browser.close/自有进程退出 → 固定profile保留
强制结束后重启 := 重新连接存活且profile匹配的浏览器；原WS登录会话不恢复，用户重新打开登录

WS请求 := chat2apiRemoteLogin{requestId,action,instanceId,providerId,accountId,sessionId,sequence,payload}
action := open/frame/input/complete/close
WS回执 := chat2apiRemoteLoginResult{requestId,success,sessionId,...安全结果}；通用WS日志之前处理
运行实例解析 := instanceId → 任务运行端口 → runningRuntime，登录绑定该runtime
发布 := servicePackage=true；Android不改，不构建APK
```

```text
孤立登录页回收 := rootDir/browser-profiles/remote-login-context.json记录{browserWebSocketEndpoint,contextId}
新登录 := 验证当前受管浏览器 → 仅回收记录中端点与Context同时匹配的旧登录环境 → 新建Context → 原子记录
关闭 := 删除匹配本Context的记录；不清理其他未登记Context
```
