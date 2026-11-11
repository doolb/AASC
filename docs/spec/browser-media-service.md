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
任务启动 → 检查 Linux 桌面与目标站点白名单 → 注册内部浏览器接口 → 等待来源请求
来源请求 → 校验来源与目标 HTTPS 同源白名单 → 读取来源代理 → 获取专属 profile 和浏览器 → 导航并识别挑战
挑战未通过 → 状态待验证 → 用户查看专用页面并完成挑战 → 来源重新请求
页面准备成功 → 页面内发起同源 GET、可选 Range 或注入 AASC 脚本及有限 GM 接口 → 受限结果返回来源
用户点击扫描并保存 → 当前运行页面执行固定采集脚本 → 用户文件媒体源保存候选列表
任务停止 → 注销接口 → 取消请求 → 关闭本任务创建的页面和浏览器 → 保留专用 profile
未来 Android → 同一请求契约映射原生 WebView 适配器；桌面实现不启用 APK 调试端口
```
