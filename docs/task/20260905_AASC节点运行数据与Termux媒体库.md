# AASC 节点运行数据与 Termux 媒体库

## 任务描述

主服务器节点列表需要展示主服务器和 Termux 子服务器真实的显示端、控制端和媒体库数量。当前 AASC 节点快照没有运行数据，页面使用旧字段默认值显示 `0 / 未限制` 和优先级 `0`。同时，Termux 没有媒体库时前端提前结束渲染，导致“+ 添加”按钮消失。

本任务增加节点注册/心跳运行数据上报，并修复空媒体库的添加入口。主服务器不代理子服务器的媒体库写操作，权限控制暂不实现。

## Design 需求

- 节点注册和心跳携带 `runtime`。
- `runtime.displayCount` 表示当前 WebSocket 显示端连接数。
- `runtime.controlCount` 表示当前控制端连接数。
- `runtime.libraryCount` 表示当前已经初始化的媒体库数量。
- 主服务器节点目录快照返回最近一次运行数据。
- 空媒体库列表仍显示“+ 添加”按钮。
- 主服务器控制端仍只展示共享索引；管理 Termux 媒体库时打开 Termux 自己的 `/control`。

## Spec 设计（伪代码）

```text
采集当前节点运行数据
    → displayCount = 当前 displayClients 数量
    → controlCount = 当前 controlClients 数量
    → libraryCount = MediaLibraryManager.listLibraries() 数量
    → 返回 runtime

节点注册或心跳
    → 规范化 runtime 的三个非负整数
    → 保存到 AascServerRegistry 节点记录
    → 快照返回 runtime

控制端加载媒体库
    → 获取当前服务器 /api/media-libraries
    → libraries 为空
        → 显示“暂无媒体库”
        → 仍显示“+ 添加”按钮
    → libraries 非空
        → 显示媒体库列表和“+ 添加”按钮
```

## 受影响功能模块和代码

- AASC 节点协议、连接器和节点注册表。
- 主服务器运行时节点注册和 Termux 子服务器主动心跳。
- 控制端媒体库列表空状态。
- AASC 节点状态卡片的真实显示端数量展示。

## 自测用例

1. 节点注册携带合法 `runtime` 后，注册表快照保留三个计数。
2. 节点心跳更新 `runtime` 后，节点目录返回最新计数。
3. 子服务器连接器注册和心跳都从运行数据回调取值。
4. 主服务器节点目录显示实际 `displayClients.size`。
5. 空媒体库页面包含“+ 添加”按钮。
6. 有媒体库页面继续展示切换、编辑和“+ 添加”按钮。

## 兼容性测试

- 没有 `runtime` 的旧注册请求仍可登记，页面显示“未上报”。
- Termux 现有 `/api/media-libraries`、上传、文件夹和媒体索引接口保持不变。
- `/control`、`/display` 和 `/server` 路由保持不变。

## 性能测试

- 运行数据只读取 Map/Set 大小和媒体库 Map 大小，不扫描文件系统。
- 心跳仍按现有 30 秒间隔发送，不新增定时器。

## 风险评估

- 主服务器重启后运行数据重新从 0 开始，等待新连接和心跳恢复。
- 共享媒体索引仍是只读聚合，主服务器不能远程创建子服务器媒体库。
- 当前没有权限认证，局域网客户端仍受现有 API 暴露范围影响。

## 预计工时

约 1 小时。
