# SQuadGen 肩甲 CPU 试验

本目录是本地测试适配，不是微软官方提供的 CPU 支持承诺。使用官方预训练网络与权重；没有训练、Qwen、目标面数控制或贴图烘焙。`res` 是 latent 数量，不是四边面数。

2026-11-24 首次试验已完成：输出 1280 四边面，但有形体明显缺失、2 个退化面和 12 个严格三角化失败面，候选拒绝。结果位于 `/mnt/AASC/subproject/retop/artifacts/squadgen-shoulder-2026-11-24/cpu-res512/`。两份权重的实际 SHA-256 校验记录在 `checkpoint-verification.json`。

环境记录在 `environment.json`，上游两处兼容修改保存在 `upstream-cpu.patch`。独立 `.venv` 复用本机 Python 3.14 的 CPU PyTorch，不修改 Blender 或 AASC 的依赖。

## 复现实验

在 `/mnt/SQuadGen` 执行以下命令；复跑时使用新的输出目录，避免覆盖此前试验：

```sh
.venv/bin/python -u local_cpu/run_shoulder.py \
  --input /mnt/AASC/subproject/retop/artifacts/squadgen-shoulder-2026-11-24/shoulder-input-tri.obj \
  --output /mnt/AASC/subproject/retop/artifacts/squadgen-shoulder-2026-11-24/cpu-res512-repeat \
  --res 512 --seed 0 --threads 2 --remesh-percent 0.4 \
  --solver euler --steps 17 --query-chunk 2048
```

`--steps 17` 对固定 Euler 积分表示 17 个时间点、16 次积分更新。官方默认是自适应 `dopri5`、50 个保存时间点（不等于 50 次网络评估）。本次简化采样用于有限 CPU 上的初步观察，不能代表官方默认质量。官方推理默认 `res=4096`，此处为 512；官方查询代理目标边长为对角线的 0.2%，此处为 0.4%。均匀表面采样仍为 50000 点；CPU FPS 从第 0 点开始，平局按索引顺序。

`--stage prepare|encode|sample|decode|extract` 可单独执行某一阶段；参数必须与该输出目录的上游阶段保持一致。中间张量仅信任本入口生成的本地文件。每阶段会写入 `*-status.json`，记录退出状态、时间、进程高水位 RSS 与原件指纹。

实际四边候选为 `extracted_quad.ply` 与 `extracted_quad.obj`，保留多边形连接，不是 CDF 着色预览。提取完成后检查：

```sh
.venv/bin/python local_cpu/inspect_result.py \
  --source /mnt/AASC/subproject/retop/artifacts/squadgen-shoulder-2026-11-24/shoulder-source.obj \
  --candidate /mnt/AASC/subproject/retop/artifacts/squadgen-shoulder-2026-11-24/cpu-res512/extracted_quad.obj \
  --engine-dir /mnt/AASC/subproject/retop/web/contour-lab-3d
```

检查产出 `comparison-report.json` 与 `comparison-five-views.png`：左侧原高模、右侧候选，相同相机与比例。双向距离各取 5000 个面积均匀表面样本，是抽样指标；现有穿插检测忽略共顶点与共面情况，不能代替完整鲁棒几何认证。没有骨架与贴图验收。

## CPU 适配边界

- `network/utils.py`：八叉树依赖可选；CUDA 渲染只在实际渲染函数中导入。
- `util/util.py`：CPU 贪心 FPS；GPU 原有扩展路径保留。
- `run_shoulder.py`：meta 网络构造、严格映射权重、进程隔离、官方条件逻辑与噪声平滑；缓存解码最后特征，并与原始 `decode_batch` 做数值检查。
- `inspect_result.py`：只读检查与五视图；不对候选进行修复或伪造四边面。

源码提交：SQuadGen `b00a83b6f2068b9e66cbf195978dbe9c084108ee`；QuadTools `79690defa830dbfe97f01a05945761ed057322aa`；DualMesh-UDF `0e0ace10fd91906b24b5f0b585323b4633a51558`。DualMesh-UDF 未参与此次已知源表面的重拓扑推理。

权重来自 `microsoft/SQuadGen` 的 Hugging Face 提交 `67f8b71358cc5817cd7e759bd0c7503168e89291`，存放 `checkpoints/ckpts/`。下载元数据中的 SHA-256：AE `794cf4cd61796104c6ea49ca83874540a353b1485350cbdc4df84996cac2eddc`；扩散 `8627f59fd1feed724a0da11d4d04f23903d1d543569848b1b17267a8ce05b2e3`。两份 YAML 与当前仓库配置字节一致。
