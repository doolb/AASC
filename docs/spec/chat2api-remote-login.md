# Chat2API远程登录伪代码

状态：与2026-10-22共享豆包浏览器实现同步。

```text
已有声明 := Provider登录声明 + OAuth/账号存储 + doubao-browser-port/bridge/launcher + AASC控制端WS
登录槽位 := {拥有者连接,实例,Provider,账号,OAuth状态,会话ID,输入序号,到期时间}
登录宿主 := 同rootDir共享平台桥租约；沿用豆包任务浏览器名称/本机端口/统一profile

打开 := 校验Provider声明、拥有者及运行实例 → OAuth.startLogin → 原账号凭据恢复包
     → bridge.openLogin → 当前运行账号或launcher.lastAccount匹配实际profile → 新建默认Context登录tab
同会话重复打开 := 复用；其他控制端 := 忙；同拥有者切换 := 确认后关闭原登录再打开
loginOpening期间 := 拒绝新运行请求；打开完成loginPins期间 := 拒绝切换宿主账号，豆包登录期间暂停运行请求
运行页整理 := 仅默认Context官网旧页/空白页；登记登录tab不被复用/导航/关闭
登录popup := 仅匹配登录页opener → 允许来源转入唯一登录页

固定profile := shared-browser-profile.json登记目录，默认rootDir/browser-profiles/shared
active-browser.json := {accountId,debugPort,browserExecutable}，私有权限，无消息或Cookie
宿主查找 := 当前ownerAccount → 对比实际profile与上次记录/任务配置/已有账号 → 固定external-login兜底
端口已存在 := 连接CDP → Browser.getBrowserCommandLine取user-data-dir
           → 旧实例不支持时读取chrome://version profile路径
           → 匹配受管目录才接管；不匹配只disconnect，不关闭未知浏览器
端口不存在 := 写专用Preferences关闭退出/关窗确认 → 启动本机debugPort → 记录成功账号
已运行Vivaldi := 校验归属后在内置extension目标调用prefs.set，仅固定两项退出确认设置

输入 := 校验会话/严格递增序号/坐标/键白名单 → 登录页bringToFront → CDP/鼠标分发
帧 := 1024×720 JPEG65，最多2MiB，动态fps缓存；客户端解码后扣除耗时再调度；命令队列最多64项
完成 := 按声明采集Cookie/localStorage/Authorization及特有资料
     → OAuth.completeLogin → saveAccount锁内比对打开时通用账号快照 → 保存结果，不返回凭据
豆包完成 := 必须观察手动发出的一条消息收到完整成功回复
关闭/完成/断线/到期 := 停止观察 → 关闭登录tab → release pin → 释放OAuth槽位
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
孤立登录页回收 := remote-login-page.json记录{endpoint,targetId}
新登录 := 只关闭同端点同targetId的登记页 → 默认Context创建新tab → 原子登记
关闭 := 只删除仍匹配本页的登记，不清理其他tab和站点数据
```

## 登录画面帧率

```text
配置 := chat2api.remoteLogin{fps}，默认10，整数1..30
get/setChat2ApiRemoteLoginConfig → 控制端身份校验 → 规范化 → config.set → 广播chat2apiRemoteLoginConfig权威值
连接初始化 := 推送当前配置；客户端未收到/断线 := 使用默认10
客户端 := 窗口数字输入框 → WS保存；收到权威值才应用
拉帧 := 开始时记录单调时钟 → 等待截图回包和解码 → 按1000/fps减已耗时再调度；始终只有一帧在途
配置热更 := 重算待执行定时器；在途帧结束后按新配置调度
服务端 := 动态读取fps → 根据上次截图开始时间缓存限频；慢截图不再额外等待一个完整周期
失败 := 返回原权威配置；截图失败至少500ms后再试；关闭/代次变化停止旧轮询
```

## 登录共享网站环境（用户补充，替代独立Context）

```text
登录页 := browser.newPage，使用豆包默认Context，同一Cookie/localStorage/profile；不创建incognito Context
页面保护 := WeakSet标记当前登录页；remote-login-page.json原子记录{endpoint,targetId}
服务重启 := 按端点和CDP targetId找回唯一登记登录页，运行整理跳过它；重新登录时关闭旧登记页再创建新页
关闭登录 := 只page.close及删除本页标记，不删除Cookie/storage/profile；未点保存的网页登录态也保留在浏览器
豆包登录 := 已有运行请求busy时拒绝打开；登录期间拒绝新运行请求，避免共享认证数据变化影响流
其他Provider登录 := 同一默认Context按站点共享，仍固定宿主账号，运行页继续按账号核验Cookie
帧率设置 := 继续按已确认WS权威配置方案实施
```

## 统一固定profile（用户最终澄清）

```text
profile目录 := rootDir/browser-profiles/shared，不按Provider或账号区分
兼容现有实例 := 首次启动检测本机浏览器真实目录，若为原受管doubao/24位hash目录，记录为统一profile继续使用，不搬动运行中的目录
shared-browser-profile.json := {directory}，只允许shared目录或本root内原受管doubao/hash目录；以后固定复用
launcher连接复用key := 程序+调试端口，不含账号；账号切换不重启浏览器、不切换profile
各站点 := 同一默认Context，自然按网站域名隔离Cookie/localStorage；不把豆包Cookie用于其他Provider
运行页账号校验 := 保留原Cookie身份核验；统一profile不代表同一站点可同时保持多个不同登录身份
```

## 登录画面适应与铺满

```text
默认显示模式 = 适应
模式选择变化 → 更新图像 object-fit（适应 contain / 铺满 cover）
登录面板限制在视口内，图像区域允许收缩且不滚动溢出
指针坐标 → 按截图原始尺寸与区域尺寸计算等比缩放及居中偏移
适应留白区域按下 → 忽略；拖动移出后释放 → 坐标限制到截图边界
铺满裁剪区域 → 扣除负偏移再换算，保证点击对应可见位置
```

```text
帧率消息 := 必须注册到AASC controlTypes，并由配置handler处理
保存中 := 保留待保存值且禁用输入；其他初始化广播不覆盖输入
匹配requestId回执 := 解除保存状态，显示权威值；10秒超时 := 明确提示并回退
```
