# 独立 MMD-AR：MPL 编译播放实现

## 伪代码（实现前同步）

```text
prepareCompiler:
  读取固定提交与各文件大小/SHA256
  缓存通过校验 -> 复用
  否则下载固定提交文件 -> 验证 -> 原子写入构建缓存
stage(webMode):
  非网页 -> 返回
  将编译器/许可证/来源清单复制到版本目录
  给 Worker、UI 和共享本地资源注册表添加内容指纹
  在生成 display-mmd 模块末尾导入 MPL UI
  动作面板按同一 webMode 新增 MPL 分类
compileWorker(source):
  去除包裹整段输入的 Markdown fence，检查非空与 UTF8 大小 <=64KiB
  按需初始化 WasmMPLCompiler -> compile(source) -> finally free()
  提取MPL表情、校验当前模型支持与真实名称、展开同一绝对时间线
  骨骼文本交给WASM；生成Morph帧合并VMD，保留后续区段
  验证 VMD 头、骨骼及Morph帧数量/长度、有限变换/权重与最长一小时
  所有帧都为0 -> 复制骨骼及Morph帧到第30帧并保留其他VMD区段，形成1秒静态保持
  重新验证补帧后的大小/帧数；避免Three循环零时长除零
  返回独立 ArrayBuffer、骨骼/Morph名、两类帧数、时长（VMD 30fps）
compileAndPlay:
  要求 PMX 就绪且不是编辑/Blender模式
  捕获 mesh/modelUrl/当前动作，保存当前播放开关
  创建 Worker，30秒超时后 terminate；停止可取消尚在编译的 Worker
  编译结果返回 -> 再验证模型/动作未变化
  检查实际PMX骨骼或Morph匹配；两类均零匹配拒绝，缺失骨骼提示
  生成 File(.vmd) -> createLocalMotionSelection -> loadSelectedMotion
  加载失败 -> 释放新资源，沿用播放器回滚；不改变旧动作/开关
  加载成功 -> 保留第一份原动作；启用播放；替换旧 MPL 引用
restore:
  只有同一模型且当前 motionUrl 为本会话 MPL 才加载原 motionUrl/id
  成功后恢复原播放开关并释放不再使用的 MPL File/URL
  原动作若是换模型时继承的另一份 MPL，也保留其注册上下文直到恢复/放弃
  当前选择已改变 -> 清除会话，不修改新选择
download:
  最近成功生成的 VMD 字节 -> Blob -> 临时URL -> 触发下载 -> 回收URL
pagehide:
  BFCache保留资源；真正离开 -> 取消 Worker、清理定时器、释放全部会话
```

## 文件

- `3rd/mmd-ar-test/web-mpl-build.js`：固定上游来源、缓存校验、构建注入及可单独准备编译器。
- `3rd/mmd-ar-test/web-mpl-morphs.mjs`：逐行语法预处理、模型Morph校验、时间线展开和Shift-JIS精确编码。
- `3rd/mmd-ar-test/web-mpl-worker.mjs`：WASM骨骼编译、VMD Morph区段合并、两类元数据校验和零时长保持。
- `3rd/mmd-ar-test/web-mpl-ui.mjs`：输入、取消、资源注册、播放恢复、下载和错误状态。
- `build.js`、`web-panel-groups.js`：仅 WEB_MODE 创建分组与加载 UI。
- `package.json`：新增准备命令，不增加正式生产依赖。

## 状态与限制

固定上游编译器仍只输出骨骼帧，独立网页新增预处理器提取MPL Morph并注入VMD。当前米娅PMX有29个type=1（顶点）Morph，panel=3/2/1数量分别12/11/6；支持真实模型名称、纯表情及骨骼/表情混合。

输入64KiB，VMD输出8MiB，骨骼帧最多70,000条，30秒编译超时；部分骨骼匹配也可播放。按原模型方式播放，不增加新的物理参数。长时间线不能把 `main` 中多个动画理解为自动串行，上游使用各动画的绝对时间。构建校验可执行，自动/浏览器测试未在本轮执行。

## 表情扩展伪代码（2026-10-10已实施）

```text
UI编译请求:
  从当前PMX共享metadata取得Morph白名单(name/type/supported)
  随MPL文本传给Worker，异步模型/动作token保护沿用原逻辑
Worker:
  严格解析原pose/animation/main结构与quoted morph语句，不使用eval
  取出pose表情权重，校验真实名称/支持类型/重名歧义/有限0–1值
  删除表情语句 -> 原WASM骨骼编译
  按main的绝对时间线展开pose & pose组合
  同帧同名冲突不同值明确报错；按时间排序
  0秒默认零权重；每个关键帧补齐沿用值
  编码原名称为Shift-JIS（不能编码或超过15字节报错）
  生成Morph记录{name[15],frameUint32=floor(seconds*30),weightFloat32}
  写入骨骼帧之后的Morph计数/区段，保留相机/灯光/IK等其他区段
  允许无骨骼但有Morph的VMD；校验两类帧/权重与总体大小/时长
  零时长骨骼或表情姿势均补1秒保持，返回两类名称/帧数/总时长
UI加载:
  骨骼/Morph至少一类与当前模型匹配即可播放
  复用现有VMD加载、下载及原动作恢复
  手动表情覆盖继续优先，不自动清空用户手动选择
```

涉及新MPL解析/Morph二进制模块、现有worker/UI/build及提示；不需要新LLM服务，原骨骼语法继续兼容。用户已确认，代码及本地web-dist已完成。

### 实施细节伪代码

```text
解析保持逐行声明/单独大括号（兼容声明下一行开括号）:
  允许pose骨骼语句、quoted JSON名称morph语句、animation time: pose & pose、main引用
  校验声明顺序、重复声明、闭合、分号、main非空、时间有限且0–3600秒
  表情行替换为空行保留原编译错误行号，空骨骼pose仍交给WASM
  时间按原WASM的f32乘30再截断量化；同量化帧不同权重报冲突
名称编码:
  复用现有Three MMDParser CharsetEncoder的Shift-JIS解码表反向建表
  不引入新依赖；与实际VMD读取使用完全一致的映射
  原名精确往返、字节数1–15、禁NUL/控制字符/现有加载器保留名称
VMD处理:
  inspect允许骨骼0，逐条检查骨骼+Morph数量/范围/有限值
  修改区段前检查骨骼尾/Morph尾与8MiB上限
  替换Morph区段时保留后续原字节；两类帧均空才拒绝
  零时长时复制骨骼和Morph到30帧，同时保留后续字节
界面:
  Worker请求仅包含名称/支持状态/类型白名单，无PMX顶点数据
  骨骼匹配或Morph匹配非空；显示两类数量与手动覆盖提示
  默认示例和原点头按钮生成动态动作＋表情，另保留按当前模型生成的纯表情示例
构建:
  先复制Three vendor，再按新表情模块、依赖解析器、worker、UI及display入口依次内容指纹连接
```

2026-10-10表情扩展：构建成功，源码/生成模块语法及差异空白检查通过。当前Worker与UI通过同一个Morph模块指纹连接；实际浏览器播放和VMD重载尚未验收，未运行自动/浏览器测试；随后默认示例更新一并发布外网（见下节），尚未提交。

## 默认动作带表情示例（2026-10-10，实现前伪代码）

```text
构造示例(names, withBones):
  normal写所有Morph权重0，nod写0.7；时间线0/0.5/1.5秒
  withBones时同时加入head reset / head bend forward 20
默认打开:
  输入暂为空，placeholder提示模型就绪后自动填入
  模型为PMX且加载完成、用户未编辑或选择示例 -> 仅自动填入一次混合示例
  异步导入期间校验模型、输入值及示例请求序号；输入编辑增加序号，旧请求不得覆盖
示例按钮:
  原点头按钮改为「填入动作＋表情示例」，复用动态Morph筛选
  原纯表情按钮保留；动态筛选逻辑共用
  无可用Morph时混合示例退为点头并明确提示，纯表情示例报错
发布:
  构建web-dist -> 计算本地/远端文件差异 -> 快照/manifest/SHA256
  备份变化文件 -> 上传并原子替换（依赖先、入口最后）
  HTTPS状态/大小/SHA256校验全部变化文件及目录入口
```

默认混合示例已实现并构建/发布：5个变化文件230,060 bytes，全部HTTPS及目录入口大小/SHA-256校验通过，checksum差异为空。发布仅含独立网页，未提交/推送，实际播放待浏览器验收。

## 循环物理行为（修复前，只读确认）

```text
创建helper(sync=false, pmxAnimation=true):
  不传resetPhysicsOnLoop，库默认true
mixer loop事件:
  首条track不是.bones -> 返回（纯Morph不会标记）
  否则objects.looped=true
后续helper更新:
  读取先前looped；更新骨骼
  looped且physics开启 -> configuration.resetPhysicsOnLoop为true时physics.reset()
  清除looped，再继续physics.update(delta)
Ammo reset:
  刚体变换恢复到当前骨骼，重置锚点插值；没有调用新增速度清理
XPBD reset:
  归位、同步锚点，并resetMotion清速度/角速度/力/约束状态
```

本轮只读确认与说明，没有修改源代码、运行测试、构建或发布。

## 循环保持物理连续（2026-10-10，已实施）

```text
独立网页构建PMX helper:
  复用共享源的频率/求解器适配后、计算helper指纹之前
  将唯一MMDAnimationHelper构造替换为:
    sync=false, pmxAnimation=true, resetPhysicsOnLoop=false
  独立APK/正式源不修改；无新增面板参数
模型默认动作 / 本地VMD / MPL加载 / 物理重载:
  均通过此helper创建路径，继承false
循环边界:
  mixer推进回到开头，清除looped标记
  不调用physics.reset或resetMotion；继续物理update
显式生命周期:
  保留换模型/换动作/初始化/旋转门控等现有恢复流程
构建与发布:
  helper -> runtime -> display -> index内容指纹连续更新
  重建web-dist，按前次已授权外网发布流程备份上传并HTTP校验
```

核对当前默认VMD与MPL共用同一helper，均继承库默认true；原默认动作未做运行验证，不能认定此前完全没有调用reset。本次按用户要求关闭独立网页循环reset，不运行自动或浏览器测试。

已实施并发布：web-physics-lifecycle新增addContinuousMotionHelper，build在helper指纹前调用且限定WEB_MODE。web-dist构建/语法检查通过，4文件273,783 bytes及目录入口HTTPS大小/SHA-256校验通过，checksum差异为空。默认/本地VMD与MPL运行时共用此helper；未运行自动或浏览器测试，未提交/推送。

提交范围：MPL build/morphs/worker/UI、独立构建及物理生命周期适配、design/spec/task/todo/usage/changelog；不包含产物、模型、日志或其他正在进行的功能。本轮仅提交整理，不运行测试/构建/发布，未推送。

## 当前正式/独立共用构建（2026-10-10，替代首版仅独立注入）

```text
资源准备 -> 共用scripts/ops/mmd-mpl-assets.js，固定来源/校验保持原样
正式mmd-mpl-{ui,worker,morphs}.mjs -> 使用实际相对URL可直接部署
独立源码web-mpl-{ui,worker,morphs}.mjs -> 仅转发正式实现
build复制正式模块后stage(webMode):
  复制固定vendor资源
  parser hash -> morphs hash -> worker hash -> UI hash -> display入口
  UI本地资源导入改为web-local-assets带指纹，匹配runtime的同一个注册表
  验证每处唯一锚点；不另追加MPL UI
UI模型数据 -> getMplModelState快照，不依赖getEditorBridge.context.mesh
共用mmd-pmx-helper已含resetPhysicsOnLoop=false与共享标记 -> 独立适配直接复用
```

正式端迁移伪代码与状态见 `mmd-display-mpl.md`；源码/生成语法、依赖指纹和固定资源静态校验、web-dist构建通过。未执行编译器或浏览器测试，本轮未发布。
