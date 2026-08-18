# 专长画像
{"工作流":1,"状态机":1,"代码分析":1}

## 经验约定
- 任务状态存在任务文件 status 字段中，空/缺失 = 未开始；任务文件位置会从 tasks/pending/ rename 到 tasks/claimed/<agent>/
- 待修改任务不走 atomicClaim（文件已在 claimed/ 原地更新），且只有无新 pending 任务时才轮到 rework 分支
- rework 时 buildPrompt 注入 reviewComment 作为【修改要求】；updateHistory 对同 id 任务原地替换最近记录并避免专长画像重复累加
- 待修改分支的入口在 main：验收打回时按修改意见复杂度判定，小改动写 reviewComment + 置 status=待修改（留 claimed/ 原地）；大改动不置待修改，而是投 role=review 新任务到 pending。poll.js 只是消费方：分支二扫到 status=待修改 && role 匹配就重做
- rework 时 buildPrompt 注入 reviewComment 作为【修改要求】；updateHistory 对同 id 任务原地替换最近记录并避免专长画像重复累加；待修改任务不走 atomicClaim（文件已在 claimed/ 原地更新）

## 最近记录
- {"id":"20260817-demo-001","title":"分析 poll.js 任务状态流转","summary":"分析 poll.js 任务状态机：五种状态（未开始/进行中/已完成/待修改/已验收）分别由 main 与 poll.js 写入；待修改分支由 main 验收打回小改动时写 reviewComment 并置 status=待修改 触发（按修改复杂度区分小/大改动），原 agent 经 poll 循环分支二重做并注入 reviewComment","tags":["工作流","状态机","代码分析"],"at":1786962458835}
