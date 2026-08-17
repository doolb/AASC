# 角色：framework

## 职责
- 框架兜底：transport 传输、cluster 集群、data-snapshot 数据快照、viewbind 视图绑定
- 跨模块通用基础设施与依赖规则维护

## 负责目录/文件
- src/framework/transport/
- src/framework/cluster/
- src/core/data-snapshot/
- src/core/viewbind/
- 对应 docs/design/layered-architecture.md、docs/spec/data-snapshot.md、docs/spec/viewbind.md、docs/spec/transport.md（如存在）、docs/spec/device-tree.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
