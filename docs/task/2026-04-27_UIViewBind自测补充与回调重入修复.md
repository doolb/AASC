# 任务：UIViewBind 自测补充与回调重入修复

## 任务描述

为 `ViewBind` / `ViewBindList` 增加回调重入场景相关自测，覆盖回调中解绑、回调中绑定、回调中改数据补帧、回调替换、列表 old/new 长度、按 data 定位刷新、排序后索引重建等关键行为，并修复实现中与预期语义不一致的问题。

## Design 需求

### 回调重入一致性
- 回调执行过程中触发 `unbind` 时应立即生效，本轮后续不再触发被解绑回调
- 回调执行过程中新增 `bind` 时应在当前帧末尾补发一次，避免漏帧
- 回调执行过程中修改 `data` 时应追加一帧通知，保证状态最终一致
- 回调替换（旧回调解绑 + 新回调绑定）时应在当前帧得到正确触发顺序

### 列表绑定一致性
- 列表长度回调中的 `oldCount/newCount` 应与 `oldList/newList` 长度一致
- `setList()` 在排序/重排后应按 data 引用重建 `_binds`，避免按旧索引复用导致绑定错位

## Spec 设计

### ViewBind 通知流程伪代码
```text
函数 notifyAll():
    如果 isNotifying 为 true:
        pendingNotifyAll = true
        返回

    isNotifying = true

    callbacksSnapshot = 当前 callbacks 的浅拷贝
    遍历 callbacksSnapshot:
        如果 callback 仍在当前绑定集合中:
            执行 callback

    isNotifying = false

    遍历 pendingBinds:
        如果 callback 仍在当前绑定集合中:
            执行一次补发
    清空 pendingBinds

    如果 pendingNotifyAll 为 true:
        pendingNotifyAll = false
        再执行一次 notifyAll
```

### ViewBindList setList 重建伪代码
```text
函数 rebuildBindsByData(newList):
    bindQueues = Map<dataRef, Queue<ViewBind>>()
    遍历 oldBinds:
        bindQueues[bind.data].enqueue(bind)

    nextBinds = []
    遍历 newList 的 item:
        如果 bindQueues[item] 非空:
            nextBinds.push(bindQueues[item].dequeue())
        否则:
            nextBinds.push(new ViewBind(item))

    返回 nextBinds
```

## 受影响的功能模块和代码

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `core/viewbind/ViewBind.js` | 修复 | 回调重入语义：解绑立即生效、绑定补发、改数据补帧 |
| `core/viewbind/ViewBindList.js` | 修复 | `setList()` 按 data 引用重建绑定索引 |
| `core/viewbind/ViewBind.test.js` | 新增测试 | 增加 7 个回调重入与列表一致性自测 |
| `docs/spec/viewbind.md` | 文档同步 | 更新伪代码与测试清单 |
| `docs/design/viewbind.md` | 文档同步 | 补充回调重入与列表重排一致性要求 |

## 自测用例

1. `[PASS]` 回调中解绑立即生效
2. `[PASS]` 回调中绑定会补发
3. `[PASS]` 回调中改Data补帧刷新
4. `[PASS]` 回调中替换回调函数
5. `[PASS]` List长度回调old/new正确
6. `[PASS]` List按data定位刷新正确
7. `[PASS]` List排序后索引重建正确

## 兼容性测试

- Linux Node.js 环境（当前开发环境）
- 纯 JavaScript `Map/Set` 语义，无平台专有依赖

## 性能测试

- 回调补发/补帧仅在重入场景触发，常规路径无额外复杂度变化
- `setList()` 重建索引为 O(n)，与原有 `map` 级别一致

## 风险评估

- 中风险：回调重入策略调整可能影响依赖旧行为的调用方，需要通过新增测试锁定行为
- 低风险：`setList()` 引用级匹配在存在重复引用时按队列顺序复用，行为可预测

## 预计工时

- 需求确认与行为梳理：0.5 小时
- 代码修复：1 小时
- 自测补充：0.5 小时
- 文档同步：0.5 小时
- 总计：2.5 小时
