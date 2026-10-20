#skill: ai-code-translation

# app/豆包网页内置任务

## 已有声明

- 内置任务注册表提供任务元数据与执行入口 // 新任务沿用 AASC 管理能力
- 常驻任务返回停止句柄并更新任务卡片 // 控制端可观察服务状态

## 新增定义

- DoubaoWebTaskConfig { host, port, browserExecutable, debugPort, accountId }

## 操作流程

- 注册 doubao.web 为服务端常驻任务并声明配置项 // 不在启动代码硬编码任务实例
- 读取权威任务配置并启动豆包网页运行时 // 重启后恢复配置而不复制秘密
- 在任务卡片显示运行、停止、账号与兼容 API 地址 // 登录及验证错误由请求端反馈
- 停止任务时关闭监听并释放本任务启动的浏览器 // 不删除账号 profile 与官网历史
- 用定向测试覆盖启动停止、配置、账号隔离和结果映射 // 防止影响 chat2api.proxy
