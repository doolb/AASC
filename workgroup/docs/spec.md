# 文件驱动多 Agent 工作组（Workgroup）实现文档

## 概述

纯文件系统协议的多 Agent 协作工具：main 收需求并分发，子 agent 自治轮询认领、干活、写结果。文件即协议，可审计、无 server 依赖。

## 目录约定

```
workgroup/
├── roles/<name>.md        # 角色定义
├── members/<name>/        # 每个 claude 一个命名目录
│   ├── role.md            # 内容 = 角色名
│   ├── history.md         # 历史画像：专长画像 + 经验约定 + 最近记录
│   ├── lock               # 在线信号：内容 = PID + 启动时间
│   ├── busy               # 忙碌信号：认领时创建
│   └── current-task       # 内容 = 任务 id
├── tasks/
│   ├── pending/<id>.json  # 待认领
│   └── claimed/<agent>/<id>.json   # 已认领
└── results/<id>.json      # 完成结果
```

## 状态机（poll.js 主循环）

```
idle ──认领成功──▶ busy ──任务完成──▶ idle
  │                    │
  │ 扫描 pending        │ 结果写 results/<id>.json
  │                    │
  └──────（无匹配任务，继续扫描）
```

- 认领：`fs.rename(pending/<id>.json → claimed/<name>/<id>.json)`，ENOENT = 被抢走，跳过
- 认领成功：写 busy + current-task
- 完成后：删 busy + current-task，结果写 results/<id>.json（status: completed/failed）

## 状态判定表

| 信号 | 文件 | 判定 |
|------|------|------|
| 在线 | members/<name>/lock | 存在 = 在线 |
| 空闲 | members/<name>/busy | 不存在 = 空闲 |
| 忙碌 | members/<name>/busy | 存在 = 忙碌 |

## 任务状态机

任务状态存于任务文件内（`status` 字段，空/缺失 = 未开始）：

| status | 含义 | 设置者 |
|--------|------|--------|
| （空） | 未开始 | main 投递 |
| 进行中 | 已认领干活 | poll.js 认领后 |
| 已完成 | 干完、结果已写 | poll.js 完成后 |
| 待修改 | 验收打回需改 | main 打回时 |
| 已验收 | 用户确认通过 | main 验收时 |

## poll.js 伪代码

```
function main() {
    args = parseArgv()
    if (args.role && args.name) {
        // 方式一：带参数启动，直接进入
        启动流程(args.role, args.name)
    } else {
        // 方式二：无命令启动 → 交互向导
        role = 选择角色()   // 编号菜单列出 roles/*.md；或输入新名 → 生成模板
        name = 选择成员名() // 编号菜单列出 members/；有则选择复用，或输入新名
        启动流程(role, name)
    }
}

function 启动流程(role, name) {
    memberDir = workgroup/members/<name>
    ensureDir(memberDir)           // 存在则保留现有文件
    write(role.md, role)           // 覆盖
    // history.md 存在则原样保留，绝不覆盖（重启保留历史）

    // 崩溃残留检查
    if (lock 存在) {
        pid = 读 lock
        if (pid 存活) { 打印「已有同名 agent 在线」; exit }
        else 覆盖 lock
    }
    write(lock, PID + 启动时间)

    while (true) {
        // 1) 新任务：pending 里 role 匹配（status 空）
        任务 = 扫描 pending/*.json 中 role 匹配且 status 空
        // 2) 待修改：自己 claimed/<name>/ 里 status=待修改（打回小改动）
        if (无任务) 任务 = 扫描 claimed/<name>/*.json 中 status=待修改
        if (无任务) { sleep(5s); continue }
        try {
            if (来自 pending) rename(pending/<id>.json → claimed/<name>/<id>.json)
        } catch (ENOENT) { continue }  // 被其他 agent 抢走
        write(busy)
        write(current-task, id)
        任务文件 status = 进行中
        // prompt 注入总结；若是待修改任务，附 reviewComment 作为修改要求
        执行 claude --print（读任务文件，结果写 results/<id>.json）
        任务文件 status = 已完成
        读 results/<id>.json 的 summary/tags/learnings，更新 history.md
        删除 busy, current-task
    }
}

// 正常退出：删除 lock
```

## main 验收伪代码

```
function accept(任务) {
    扫描 claimed/*/ 找 status=已完成 → 读 results/<id>.json 呈现给用户
    if 用户选「通过」:
        任务文件 status = 已验收
    if 用户提修改:
        写 reviewComment = 修改意见
        if 小改动: 任务文件 status = 待修改   // 留在 claimed/<原agent>/
        if 大改动: 写 role=review 子任务到 pending → review 角色审查
                  review pass → 原任务 status=已验收
                  review fail → 继续打回
}
```

## 交互向导细节

- **选角色**：扫描 roles/*.md 生成编号菜单；非法输入重试；输入新名字 → 生成 roles/<name>.md 模板后选中
- **新角色模板**：职责/负责目录/工作规范三个骨架段，占位符文本，用户后续可完善
- **选成员名**：扫描 members/ 生成编号菜单；有已存在成员则选择复用；或输入新名创建；非法（含路径分隔符/空）重试

## 启动上下文总结注入

子 agent 每次 `claude --print` 是全新进程，无历史上下文；逐条旧记录注入会误导。因此在 spawn 前生成总结注入 prompt：

```
总结 = history.md 的「专长画像」+「经验约定」段
（不含「最近记录」，避免旧任务解法带偏新任务）
```

子 agent 干活时提示：按经验约定工作，结果中写 learnings（1-3 条项目约定）。

## main 分发伪代码

```
function dispatch(需求) {
    读 roles/*.md 了解角色能力
    读 members/*/ 计算状态：在线（lock存在）、空闲（无busy）
    拆解需求 → 任务列表
    for 每个任务:
        候选 = 角色匹配且空闲的成员
        if 候选 > 1:
            对每个候选读 history.md，按任务标签匹配度打分
            选得分最高者；平分选最近完成时间更早者
        写 tasks/pending/<id>.json
    等待 → 回收 results/ 汇总
}
```

## 历史画像追加（poll.js 任务完成后）

```
完成 → 读 results/<id>.json 的 summary/tags/learnings
→ tags 累加进 history.md「专长画像」段（聚合摘要，覆盖全部历史）
→ learnings append 到「经验约定」段（超过 M 条删最旧，M 默认 30）
→ 详细记录 append 到「最近记录」段（超过 N 条删最旧，N 默认 100）
```

**文件大小有界**：聚合摘要固定小 + 经验约定 M 条 + 最近 N 条详细记录；删旧细节不影响专长信号。

## 重启历史保留

- history.md 仅追加、启动不覆盖 → 同机同名重启历史完整保留
- history.md 提交进 git → 换机器 / clone 后保留（与角色文件同为资产）

## 测试

自测用例见 workgroup/docs/design.md「自测用例」。
