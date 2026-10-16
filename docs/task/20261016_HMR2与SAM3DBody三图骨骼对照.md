# HMR2.0b 与 SAM 3D Body 三图骨骼对照

日期：2026-10-16。状态：进行中。

## 任务描述与设计

按用户确认，在本机以官方Python模型测试真人坐姿、二次元和交叉腿人体示意图，浏览器只展示结果。固定同一原图、人工人物框及模型各自原始骨架和相机输出；优先比较真实抬高腿归属、遮挡关系及足部，不提前应用到VAM。设计见`docs/design/mmd-human-interface.md`。

## 实现伪代码与文件

伪代码见`docs/spec/mmd-human-interface.md`。本机临时脚本、官方源码、权重和报告放`tmp/mmd-pose/depth-eval/hmr2-sam3d/`，忽略Git。同步`docs/usage/mmd-pose-model-testing.md`、`docs/spec/self-test.md`、`docs/todo.md`和`changelog.md`。正式Worker、UI、骨骼和发布配置不变。

## 自测、兼容和性能

校验官方代码版本、权重/人体模型来源和SHA-256，三图像素及人工框不变；每模型保存原始3D、相机、重投影叠图并人工核对左右腿。测试模型依赖缺失、推理失败、无CUDA/显存不足时应保留真实错误状态，不能显示伪造姿态。检查浏览器390px布局及本机静态读取；分别记录模型加载、单图推理耗时和峰值显存/内存。手机本地推理不在本轮承诺范围内。

## 风险与预计工时

HMR2.0b需要单独取得SMPL中性模型；SAM官方ViT-H权重需要Hugging Face准入并配套MHR，当前匿名请求返回401 GatedRepo。SAM官方建议Python3.11，本机仅有Python3.10，须另备环境。本机GTX1660显存6GB，可能需要CPU回退且耗时较长。未经资源授权无法得出识别质量结论，不能把仅下载源码或生成报告当成模型运行。预计数小时，取决于资源准入和本机依赖兼容。

## 当前进度

官方4D-Humans提交`efe18deff163b29dff87ddbd575fa29b716a356c`与SAM提交`b5c765a0d89d789985e186d396315e7590887b94`已固定。HMR2.0b归档及checkpoint SHA-256、长度已核对，原图三张审计通过；归档不含SMPL中性模型。HMR独立Python3.10 CPU依赖安装完成，Windows仅修改缓存目录HOME缺失回退和OpenGL平台选择，两处补丁保存在`windows-compat.patch`，模块可导入。SAM官方checkpoint/MHR尚未取得，本机Python3.11也未安装。两原版推理脚本语法通过、缺资源时明确失败；浏览器三图、手机宽度、本机GET及临时内存JSON绘制链通过。当前只有对照工具资格，没有任何HMR/SAM姿态输出。
