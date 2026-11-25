# SQuadGen 独立 LoRA 训练

冻结原 SQ-Diffuse 和 AE；只训练 `blocks.*.attn.qkv/proj` 的 LoRA。训练、推理适配器、断点恢复已提供入口。未进行人物领域训练，也未验证 2080 Ti 的 16GiB 显存预算或几何质量改善。

在 `/mnt/SQuadGen` 执行下列命令。复用已有 `.venv` 中的 torch、safetensors、omegaconf 与官方依赖，无需 Qwen 或 PEFT。CPU 请明确使用 `--device cpu --precision fp32`；缓存命令只有 `--device cpu`，不接受 precision。默认训练为 CUDA FP16 autocast，底模与 LoRA 参数仍以 FP32 存放。CUDA 路径尚待实机验证。

## 1. 准备官方监督数据与缓存

输入需要由官方 `data_tools`/CDFGen 产生的 **patchboard NPZ**，含优质四边布局监督。普通高模 OBJ/PLY 或 `local_cpu/condition.pt` 没有目标布局，不能当训练标签。首版复现原生布局监督；独立高模/低模配准条件扩展、面数条件、贴图训练尚未实现。

创建 `samples.json`，路径相对于清单目录；同一原资产的不同细分/增强版本必须留在同一 split：

```json
[
  {"asset_id": "character-a", "split": "train", "path": "data/character-a.npz"},
  {"asset_id": "character-b", "split": "val", "path": "data/character-b.npz"}
]
```

```sh
.venv/bin/python -m local_train.cache --samples samples.json --output results/lora-cache --res 1024 --device cuda
```

缓存使用官方数据读取函数、固定采样种子、首组已有 FPS 锚点和后验 mode；原文件缺少对应 FPS 级别时沿用官方随机取点回退，记录采样参数及 loader 指纹。默认 16384 表面点，不额外做噪声增强。缓存为原始未标准化 latent 与 condition_params，训练损失中只标准化一次。缓存与 AE/底模配置绑定；文件变化、错 res 或资产泄漏会失败。缓存与训练分阶段执行，训练进程不加载 AE。

## 2. 训练并保存独立 LoRA

```sh
.venv/bin/python -m local_train.train --cache results/lora-cache --output results/lora-character-v1 --res 1024 --steps 100 --save-every 25 --rank 8 --alpha 8 --accumulation 8 --device cuda --precision fp16
```

采用官方 Linear/velocity 损失、batch 1、常量学习率、AdamW、梯度裁剪和非重入 block 检查点。`--steps` 为目标总更新步数，不是 epoch；每步做 `--accumulation` 次前反向。非有限损失/梯度明确失败，保留此前完整检查点。需要关闭检查点时使用 `--no-checkpointing`。

`report.json` 保存状态、数据/底模指纹、参数数和 CUDA allocated/reserved 峰值；`metrics.jsonl` 保存每步损失/样本索引/耗时。固定留出缓存的速度损失不能代替实际四边网格质量验收；报告始终明确 `geometry_validated=false`。

每个 `step-000025/` 独立版本包含：

- `adapter_model.safetensors`：仅 FP32 LoRA A/B。
- `adapter_config.json`：完整目标层路径、形状、rank/alpha/dropout、标准 alpha/r 缩放。
- `manifest.json`：底模/AE/配置/源码指纹、训练配置、产物哈希和验证数据。
- `training_state.pt`：optimizer/scheduler/scaler、CPU/CUDA/Python 随机状态、采样顺序和游标、完整更新步数。只使用 `weights_only=True` 读取。

新版本通过同盘临时目录校验后重命名发布，已有目录拒绝覆盖。源底模只读，不复制进适配器。首版不支持新增条件模块，遇到声明立即拒绝，避免漏存权重。该包是项目格式，不声称可直接传给 PEFT 的 from_pretrained。

## 3. 恢复或开始下一阶段

```sh
.venv/bin/python -m local_train.train --cache results/lora-cache --output results/lora-character-resume --res 1024 --steps 200 --rank 8 --alpha 8 --accumulation 8 --device cuda --precision fp16 --resume results/lora-character-v1/step-000100
```

`--resume` 严格匹配数据指纹、模型、设备、精度、线程、优化器和采样配置，恢复下一步。可以调整目标总步数/保存间隔/输出目录；改变数据或学习率请使用 `--init-adapter <目录>`，明确开始新训练阶段，重置 optimizer 和游标。更换 GPU 型号或数值后端不保证逐位确定性；当前逐位续训测试限于本机 CPU。

## 4. 加载 LoRA 生成四边网格

```sh
.venv/bin/python local_cpu/run_shoulder.py --input /path/to/high.obj --output results/lora-inference --res 1024 --solver dopri5 --steps 50 --remesh-percent 0.2 --adapter results/lora-character-v1/step-000100
```

本入口为 CPU 分阶段生成，保持既有准备/编码/采样/解码/QuadExtraction 流程。`--adapter` 只影响扩散阶段，未提供时不加载适配器。推理允许改变 latent 数，实际质量需重新测量，`res` 不等于输出面数。输出 `adapter-info.json` 记录加载来源；生成结果仍须五视图和几何审计。

不同底模训练时显式设置 `--base-id`、`--base-weights`、`--ae-weights`、`--base-config`、`--ae-config`。CPU 推理用 `--base-id` 与 `--checkpoint-dir`；目录中统一为 `sqdiffuse.safetensors/.yaml`、`sqvae_geomae.safetensors/.yaml`。复制文件改名不影响内容指纹。首版仍要求 SQuadGen 架构，不能加载其他模型家族的 LoRA。

适配器必须对应同一底模/AE/配置与计算源码；版本不符明确失败。`load_adapter(model, path, identity)` 每次先验证再撤下旧包装并加载一个新适配器，绝不重复相加；切换后需重新创建训练优化器。`remove_adapter(model)` 恢复原底模；默认不做 merge，也不自动叠加多个 LoRA。

## 自测

```sh
.venv/bin/python -m unittest local_train.test_lora -v
```

测试缩小的真实 SiT、零增量一致、底模冻结、LoRA 梯度、保存重载/切换、错误权重/指纹/形状拒绝、检查点梯度等价、下一步精确续训、缓存泄漏/损坏，以及官方 NPZ 读取→小型 AE 缓存→训练入口→断点恢复。小模型和合成验证张量只验证代码，不是官方预训练质量或人物泛化实验。
