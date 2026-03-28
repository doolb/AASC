# 项目规则

## 文档规范

| 文件 | 说明 |
|------|------|
| docs/design.md | 项目设计文档索引 |
| docs/design/*.md | 每个功能模块的设计文档 |
| docs/spec.md | 项目实现文档索引 |
| docs/spec/*.md | 每个功能模块的实现文档 |
| docs/todo.md | 项目未完成任务列表 |
| docs/usage.md | 项目使用说明 |
| docs/rules.md | 代码规范、文件结构、命名约定 |
| docs/ref.md | 外部资源参考（API文档、库文档等） |
| changelog.md | 项目变更日志（工具生成） |
| readme.md | 项目介绍、安装说明、使用说明 |

## 代码规范

1. 使用 `const/let`，不使用 `var`
2. 异步操作使用 `async/await`
3. 错误处理使用 `try-catch`
4. 避免全局变量污染
5. DOM 操作尽量批量处理

## 文档更新规则

1. 每次对话完成后更新 `todo.md` 和对应的 `design` 文档
2. 已完成的功能从 `todo.md` 删除，记录到 `docs/design/*.md`
3. 更新代码前，先更新 `docs/spec/*.md` 中的实现思路
4. `changelog.md` 通过工具根据desgin文档内的时间自动更新

## 任务记录格式

```
# 大模块
## 小模块
 - ✅已完成 [添加时间][完成时间] 任务描述
   - 改动的文件名，资源命名规则等
 - ✅已完成 [发现时间][修复时间] Bug 修复描述
```

## 对话注意事项

- 从 `docs/spec/*.md` 查看项目实现文档
- 用户问题记录到 `docs/design.md` 和 `docs/spec/*.md` 对应模块
- 已完成任务添加 ✅已完成 标记，记录改动文件
