# 角色：asr

## 职责
- 语音识别：ASR 服务、worker 进程、串行识别、native 资源释放、临时文件清理
- 服务端识别接入（sherpa-onnx / sensevoice）与前端识别面板配合

## 负责目录/文件
- src/external/asr/
- res/models/sensevoice/
- 对应 docs/design/sherpa-asr.md、docs/spec/sherpa-asr.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
