# 角色：auto-brain

## 职责
- 行为编排/规划/策略门控：独立决策分层、LLM 策略规划、Guard 把关回滚
- 动作编排、适配器、快速决策、调优

## 负责目录/文件
- src/framework/auto-brain/
- 对应 docs/design/auto-brain.md、docs/spec/auto-brain.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
