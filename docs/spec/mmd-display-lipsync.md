# 正式显示端口型实现

## 实现前伪代码

```text
bridge.prepare(audio,text,src):
  不可变entry = {sequence,text,src}，WeakMap存当前entry
  audio派发mmd-tts-source-change，不调用play/pause，不访问模型
bridge.clear(audio,expectedEntry):
  可选比较entry，删除当前快照，派发source-change
  结束监听只清当前仍ended/error的来源，避免其他结束监听已切到下一句
三个实际播放入口:
  普通/聊天队列、文本媒体消费当前句、远程文本当前句
  设置src前prepare；显式停止/句末clear
  预取不调用prepare
controller:
  selected Map与transient Map共用restore->动画->物理前apply
  apply合并selected后transient；setTransient验证token/index/finite权重
  临时更新只startRendering，不清TAA；新mesh/dispose清临时层
sharedUI:
  兼容正式/独立panel，按当前模型索引自动/手动映射五元音
  单一generation与RAF拥有临时层，TTS优先中止无声预览
  读取音频entry，异步生成时间线，回包校验entry/generation/模型token
  手动预览<=400字符；TTS<=4000字符/16KiB，超限或字典失败只跳过口型
  TTS tick: source匹配、模型ready/token、页面可见且未编辑
    暂停/等待/seek/未就绪duration -> mapped索引全0
    播放 -> timelineTime=currentTime/duration*timeline.duration
    sample曲线、缺失元音回退、重复index取max
    不调用loadSelectedMotion/setMotionPlaybackEnabled/physics reset
  paused/waiting时取消RAF并闭嘴，playing/seeked后从currentTime恢复
  source-change/ended/error/停止/模型切换 -> 取消旧generation并释放
  新模型若语音仍在播放，重新读取映射后从当前位置接续
  后台释放；前台仍播放则接续；BFcache恢复监听和状态
assets:
  共用固定归档完整性校验和安全TAR读取
  stageVendor至正式或独立js/vendor/pinyin-pro/3.29.5
  正式代码包直接包含static JS/MJS/LICENSE/SOURCE，无新增生产依赖
  独立构建复用共享控制器和UI/timeline，所有引用带内容指纹
```

## 验收范围（未执行）

米娅映射与带空格Morph、多音字/标点/数字、缺失映射、VMD/MPL和手动表情同时播放、暂停/缓冲/seek/倍速、聊天句间衔接、中断/取消/远程文本/预取、后台与模型重载、异步字典失败和超限文本、Android/桌面。用户未要求测试，本轮不新增或运行测试。

## 实现结果

新增display-lipsync-audio桥接、mmd-lipsync-player/ui/timeline及共用prepare:mmd-lipsync资源脚本。三个实际消费入口prepare，结束/停止按entry清理；普通TTS生成回包增加当前item保护，取消后的旧错误不结束新句。网络stalled仅在缓冲不足时闭嘴，真实waiting/seeking/paused闭嘴。预览与TTS单一调度器，正式默认开启，关闭开关后语音切句不打断手动预览；停止当前句后抑制该entry，下一句继续自动同步。

拼音固定30文件及SOURCE共31项正式静态资源已准备，无新增npm生产依赖。独立web-lipsync构建改为复用正式模块并按timeline→player→UI→display指纹化，不再重复补临时控制层。servicePackage保持true，minApk/dependenciesPackage原状态保持。未构建发布正式包/APK，未新增或运行自动/浏览器测试。

资源准备与独立web-dist构建成功；13源文件、1段HTML经典脚本、6生成模块语法及口型指纹检查通过，正式/独立各30项拼音资源大小/SHA-256一致，git差异空白检查通过。仅静态检查，不等同实际音频/浏览器功能验收。

Git属性对固定pinyin-pro版本目录禁用文本换行转换，确保检出后的字节仍符合SOURCE.json；此规则只影响归档资源的存储，不改变口型逻辑。
