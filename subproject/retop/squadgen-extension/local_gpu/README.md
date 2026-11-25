# Windows CUDA 官方示例测试

此入口复用可信的 CPU 表面采样/PCA/查询缓存，在 CUDA 上重新运行几何编码、扩散和布局场解码。保持 FP32、res 8192、Dopri5、50 保存时间点、seed 0 和官方噪声平滑；50 不是网络评估次数。CPU/GPU 随机后端不同，不能要求与此前 CPU 运行逐位一致。

部署目录：`I:/ai/SQuadGen`。独立 Python 3.11 环境在 `.venv`，不修改其他 AI 工具的环境。完整依赖记录随实际安装保存。

```powershell
Set-Location I:/ai/SQuadGen
.venv/Scripts/python.exe -u local_gpu/run_example.py --input examples/test_data/3_holes.ply --output results/official-3holes-gpu --res 8192 --solver dopri5 --steps 50 --memory-gib 16
```

入口需要 output 中已有 `prepared.pt`、`gt_mesh_subdiv.obj`、`sampled_points.npz` 和 `cache-manifest.json`。清单检查源模型、缓存、模型权重和配置的 SHA-256。prepared.pt 含原脚本保存的 NumPy 变换，只加载自行生成且指纹匹配的可信缓存，不用于任意第三方上传文件。

`--stage all` 按独立进程依次执行 encode/sample/decode；也可单独重跑某阶段。采样不会恢复未保存的 ODE 中间状态。该入口不加载 LoRA，作为官方底模基线。

注意力显式保留 batch/head 维度，沿 query 分块但保留全部 key/value，默认 attention chunk 512。只支持 no_grad/eval；每阶段启动时对官方 AE cross-attention 和 SiT self-attention 做 FP32 数值对照，rtol=1e-5、atol=1e-6。decoder 查询块为 2048，查询转为与官方 decode_batch 内部 cat 相同的连续布局，另与原 decode_batch 对照。没有改变采样分辨率或模型权重。

`--memory-gib 16` 为 PyTorch CUDA 分配器额度，驱动/其他应用内存不包括在内。实际 allocated/reserved 峰值记录在各阶段 `gpu-*-status.json`，出错保留 traceback。`gpu-all-status.json=completed` 仅表示场解码完成，还需 QuadExtraction 和独立几何审计。

Windows 没有可用 QuadTools 时，把 `extract_mesh.npz` 回传 Linux；用已构建的 QuadExtraction、QuadQuality 和 `local_cpu/inspect_result.py` 完成提取/检查，再把 OBJ/PLY、质量报告、五视图同步回上述结果目录。保留官方提取参数与原始输出，不额外修复后冒充官方结果。

## 本次运行记录（2026-11-25）

RTX 2080 Ti 22GB 完成 8192 / FP32 / Dopri5 采样：182 次网络评估，采样核心耗时 1346.44 秒，PyTorch allocated/reserved 峰值分别约 3.54/4.11GiB；这不是训练显存结论。编码 14.11 秒，成功的解码阶段 17.69 秒（包含启动与模型加载）。

第一次 all 运行在解码探针检查失败：缓存查询的列主序内存布局与官方 cat 不同，offset3 最大差约 2.80e-6。统一连续布局后，各输出分量对照最大差均为 0；没有降低容差、修改权重或重新采样，仅复用 latent.pt 重跑 decode。原 gpu-all-status.json 及首次失败日志保留；最终恢复、提取和质量结论见结果目录 final-report.json。需要重试解码时在上述命令添加 `--stage decode`，不要重新执行 all。

## 原版流程对照

`compare_official.py` 在固定缓存和相同Windows环境下直接调用官方模型加载器/模型函数，不对参考模型安装注意力补丁。分别运行 `--stage encode`、`--stage forward`、`--stage decode`，公共参数为 `--baseline results/official-3holes-gpu --output results/official-comparison`；解码默认官方100000查询块。报告列出每个字段的最大绝对差、RMS、相对L2和严格容差结果，完成阶段不代表通过容差。

`run_official.py` 的 `--report-dir` 指定中间值与资源记录目录，其余参数原样交给官方 `infer_sqdiffuse.main`。它不替换模型计算或注意力，使用官方CUDA FPS、PLY重网格、UV可视化和采样/解码。入口本身和模型源文件与Git版本相符，但仍使用当前Windows/torch2.8环境，不能称为官方推荐Linux环境的逐位复现。Windows没有QuadTools可执行文件时继续回传Linux提取。

```powershell
.venv/Scripts/python.exe -u local_gpu/run_official.py --report-dir results/official-native/trace --input_filelist examples/test_data/filelist.json --results_dir results/official-native --ae_config squadgen/network/config/sqvae_geomae.yaml --ae_pth checkpoints/ckpts/sqvae_geomae.safetensors --model_config squadgen/network/config/sqdiffuse.yaml --model_pth checkpoints/ckpts/sqdiffuse.safetensors --name test_8192 --n_gen 1 --debug 0 --res 8192 --start 0 --end 1 --is_skip 0 --use_latent_smoothing 1
```

原版main会捕获单样本异常后继续，包装层必须核对场文件存在；日志出现Error不能仅凭退出码0认定成功。第一次运行的观测代码使用Module hook，而官方sampler直接调用forward，故该次raw evaluations=0表示未观测，不是实际零次；当前脚本已改为透传forward包装，运行中的原采样没有为补日志而重启。

`check_quadtools_io.cpp` 是只读契约检查器，使用同一QuadTools库逐面导出面中心和CDF/offset值。诊断目录中的IO报告用于确认C++解析与NumPy/Trimesh索引一致，不修改提取器。鸭子真值场对照由官方 `CDFGen -q` 产生，输出为归一化坐标，比较原件前必须用保存的invT还原；还原不是几何修复。

## 3_holes 提取参数诊断

同一预测场在默认 `--div=0 -s 3 -r 15` 下严重压缩；单独改threshold或ringsize均未恢复外形。只改div=1可恢复三孔形状，但8192面版本仍检测到25处自交。保留div1与r15、将s设为2，得到2048面，当前单样本审计无自交、无无效面，双向5000点抽样P95约0.82%/0.81%原模对角线。

```sh
QuadTools/build/QuadExtraction -i results/official-3holes-gpu/gt_mesh_subdiv.obj -f results/official-3holes-gpu/extract_mesh.npz -o results/div1-s2-candidate.ply --ringsize=8 --verbose=true -a 150 --div=1 -t 0.1 -s 2 -r 15
```

这不是通用默认值或任意目标面数功能。div改变布局场提取，s为后续细分次数；更多细分不一定减少自交。保留原失败结果，通过检查的本次候选在 `results/official-comparison/div-subdivision2`。具体矩阵见 `results/official-comparison/extraction-matrix.json`；不得用鸭子真值场重建成功替代扩散生成验收。
