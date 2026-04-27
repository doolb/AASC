# 资源目录说明

统一资源目录：`res/`

- `res/models/`：模型资源（ASR/LLM 相关）
- `res/uploads/`：上传文件与生成音频
- `res/temp/`：临时文件
  - `res/temp/asr/`
  - `res/temp/uploads/`
- `res/certs/`：证书文件（`key.pem` / `cert.pem`）

说明：

1. 运行时统一使用 `res/` 下的目录。
2. 模型与证书资源请放在 `res/models/` 与 `res/certs/`。
