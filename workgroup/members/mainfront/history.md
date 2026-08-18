# 专长画像
{"workgroup":1,"任务系统":1,"review":1,"测试":1}

## 经验约定
- poll.js 的状态写入用对象展开（{ ...mine, status:'进行中' } / { ...cur, status:'已完成' }）天然保留任务全部字段，新增字段（kind/reviewOf）无需改 executeTask 写逻辑，只需补测试验证。
- workgroup 的 e2e 测试用假 claude（node -e 写结果文件）+ mkdtemp 临时根目录驱动 poll.js 全链路，无需真实 claude 进程。
- 任务文件新增可选字段需同步 design.md（任务文件格式 + 验收流程）与 spec.md（状态机 + main 验收伪代码），普通任务不设 kind，main 用 isReviewTask 区分 review 审查子任务与普通待验收任务。

## 最近记录
- {"id":"20260817-1840-001","title":"区分 review 子任务与普通任务（kind 字段 + main 验收呈现）","summary":"任务文件新增 kind/reviewOf 可选字段标识 review 审查子任务，poll.js 导出 isReviewTask 供 main 验收区分，design/spec/main 文档同步，e2e 测试验证字段在状态流转后保留。","tags":["workgroup","任务系统","review","测试"],"at":1786963532065}
