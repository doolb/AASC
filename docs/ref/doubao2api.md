# doubao2api 参考实现

- 来源：[SeiShonagon520/doubao2api](https://github.com/SeiShonagon520/doubao2api)，核对提交 `d575d5817d8029a17a04854eb2595b4523daa0a6`。
- 许可：原仓库 `LICENSE` 为 Apache License 2.0；代码移植时遵守原许可和版权要求。
- 对照范围：浏览器持久 profile、官网页面内 `fetch()`、聊天和媒体请求结构、文件 Prepare/Apply/TOS/Commit 流程、文件问答消息块及兼容 API 路径。AASC 用现有账号、任务、流解析和 Android 隔离进程重新实现。
- 用户确认的边界：验证码手动完成；不迁移自动滑块求解、自动删除官网会话或失败后自动切换账号。
