# 资源目录设计

## 目标

将历史分散在 `uploads/`、`temp/`、`models/`、`ssl/` 的资源统一收敛到 `res/`，降低路径分散带来的维护成本。

## 目录结构

```text
res/
  models/
    sensevoice/
  uploads/
  temp/
    asr/
    uploads/
  certs/
```

## 资源边界

1. `models/`：运行时模型资源。
2. `uploads/`：业务上传和生成文件（例如 TTS 音频）。
3. `temp/`：短生命周期中间文件。
4. `certs/`：HTTPS 证书资源。

## 落地策略

1. 运行时统一读取 `res/` 路径。
2. 原历史目录资源迁移到 `res/` 后，旧目录不再作为运行路径。
