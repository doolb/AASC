# 桌面浏览器媒体服务伪代码

```text
已有声明：browserMedia.status、browserMedia.request、browserMedia.extract
新增定义：浏览器业务接口、独立 64 位令牌、Node 客户端
服务启动 → 读取环境令牌 → 未配置时关闭接口
请求到达 → 校验 Bearer 令牌 → 选择 status、request 或 extract → 校验请求字段 → 调用同进程 browserMedia
二进制响应 → base64 编码和响应元数据 → 返回客户端
挑战或任务未启动 → 返回稳定错误代码和对应 HTTP 状态 → 调用方处理后重试
客户端 → 校验服务器地址与令牌 → 本机 HTTP 或远程 HTTPS → 发送请求并解析结果
```

```text
已有声明：任务管理器、媒体来源注册、Vivaldi、puppeteer-core、AASC 媒体采集脚本
新增定义：BrowserMediaService { 来源、站点、代理、独立目录、浏览器、页面、状态、受限二进制请求 }
任务启动 → 检查 Linux 图形桌面或 Android Offline 本机端点 → 解析允许列表 → 空列表允许所有 HTTPS 站点，非空列表仅允许列出站点 → 注册内部浏览器接口
来源请求 → 校验来源与无凭据 HTTPS 地址 → 非空列表校验站点 → 读取来源代理 → 获取专属 profile 和浏览器 → 导航并识别挑战
主页面导航、页面请求及采集结果 → 始终限制在当前会话同源；空列表不改变同源规则
挑战未通过 → 状态待验证 → 用户查看专用页面并完成挑战 → 来源重新请求
页面准备成功 → 页面内发起同源 GET、可选 Range 或注入 AASC 脚本及有限 GM 接口 → 受限结果返回来源
用户点击扫描并保存 → 当前运行页面执行固定采集脚本 → 用户文件媒体源保存候选列表
任务停止 → 注销接口 → 取消请求 → 关闭本任务创建的页面和浏览器 → 保留专用 profile
Android Offline → 独立 WebView 服务与查看 Activity；Node 以仅本机、独立令牌的业务桥调用 open/request/extract/stop；不开放调试端口。
Android 新任务首次创建会话 → 清理旧 Node 异常退出时遗留的页面 → 创建当前会话。
会话上限 → 任务参数默认 1，限制 1 至 4；相同来源、站点和代理复用，超限拒绝并保留已有页面。
Android 平台不支持独立代理时 → 明确拒绝代理配置；不回退直连。
查看页面 → 前台 Activity 显示同一 WebView；退出查看不销毁会话，停止任务销毁会话。
```


```text
本机抖音探测 → 独立 Vivaldi 打开首页/精选 → 页面可能展示推荐与 video 元素 → 现有采集器候选按类型核验
静态域名 MP4 → Range 请求可返回数据 → 未核实与推荐内容对应，不判定推荐视频已可播放
Android Offline WebView 需要新版 APK → 真机验证前不推断能播放
```
