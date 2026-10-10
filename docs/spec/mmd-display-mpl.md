# 正式显示端 MPL 实现

## 实现前伪代码

```text
prepareCompiler:
  复用固定提交2d3b1c7e3429b508443500801e94c41fd47c9f31缓存
  校验JS/WASM/LICENSE大小和SHA256，缺失时下载固定地址并原子写入
  复制到正式public/js/vendor/mmd-mpl/0.3.6-2d3b1c7e3429
  写来源/许可证/版本/各文件大小与hash清单
getMplModelState:
  PMX就绪 -> token=mesh.uuid，bones=骨骼原名数组
  morphs=模型简表；supported同时检查原始索引和morphTargetDictionary一致
  未就绪/其他格式 -> ready=false，返回空数组
UI.readCurrent:
  验证PMX就绪、非编辑/Blender模式、非模型/物理加载
  获取profile、MPL模型快照与当前播放开关
  不再依赖getEditorBridge.context.mesh
UI.defaultSample:
  首次PMX就绪后按快照panel分类筛选唯一、可写入VMD的Morph
  动作＋表情示例或纯表情示例；异步token/输入序号保护
compileAndPlay:
  捕获token、modelUrl/resourceId、motionUrl/id、原播放开关
  按需创建module Worker，编译超时30秒终止，可取消
  Worker提取Morph时间线，调用本地固定WASM编译骨骼，合并同一VMD
  返回后再次验证token和model/动作未变化
  校验骨骼或Morph至少一类匹配当前快照
  注册内存VMD -> loadSelectedMotion -> 保留首次原动作 -> 启用播放
  清理未引用的生成资源；失败不替换新选择
restore/download/pagehide:
  沿用原会话所有权与注册表生命周期，保留BFCache
buildStandalone:
  从正式源码复制共享MPL三模块；替换本地注册表为独立共享实例
  parser -> morphs -> worker -> UI -> display入口顺序添加内容指纹
  检查正式入口存在且不重复注入
PMXHelper:
  resetPhysicsOnLoop=false
  独立构建看到共享标记时直接复用，不再次替换锚点
```

编译校验细节、Morph精确编码和VMD限制继续采用 `mmd-ar-mpl.md`：输入64KiB，VMD8MiB，骨骼/Morph各70000帧，时长1小时，纯零时长姿势补1秒。

## 待验收

正式桌面/Android的Worker和WASM、混合/纯表情、停止恢复、下载、错误与取消、模型/动作异步切换、物理循环连续性；独立mmd-ar回归。本轮不新增或运行测试。

## 实施结果

正式mmd-mpl-ui/morphs/worker已使用实际相对URL，无构建占位符；getMplModelState只返回token、骨骼原名与Morph简表，UI不再依赖编辑器mesh。mmd-pmx-helper的共享标记使独立构建复用resetPhysicsOnLoop=false，不重复注入。

新增 `npm run prepare:mmd-mpl`，固定资源准备逻辑位于 `scripts/ops/mmd-mpl-assets.js`，共用原校验缓存；正式public的JS/WASM/LICENSE/SOURCE.json作为同源运行资源进入服务代码包，不新增生产依赖。独立MPL构建在stage中将正式mmd-local-assets导入改为带指纹的web-local-assets，确保与runtime同一个资源注册表；默认复制本身只重写资源URL，不转换模块名。

prepare及web-dist重建成功；12源文件语法、正式与生成各7模块语法、MPL相对依赖/指纹和两端各3固定资源校验、git差异空白检查通过。未运行MPL编译器、自动或浏览器测试；正式服务包未构建发布，servicePackage=true。
