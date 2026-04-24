# Framework Layer

框架层用于承载技术基础设施：

- AASC 消息总线与跨设备桥接
- HTTP / WebSocket 传输适配
- 存储与配置访问
- 日志、指标、追踪

约束：

- 不实现具体业务规则
- 对上提供稳定接口给 App / Service 使用
