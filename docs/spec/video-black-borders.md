# 视频黑边处理实现规格

```text
已有 := display.applyCrop/applyFit/showMedia/restoreState、Controls、WebSocketManager
已有Node := MpvPlayer 当前媒体/代次/串行IPC/几何/动态，NodeMediaController
已有存储 := config.updateDisplayStateById → config.set持久化显示端状态
新增 := autoBlackBorders默认true；blackBorderTransition默认true；contentRect默认完整；检测代次/候选/稳定计数

控制端切换 → type=control, action=autoBlackBorders, value=布尔
过渡切换 → type=control, action=blackBorderTransition, value=布尔，独立于检测开关
服务端独立处理器校验 → 持久化目标状态 → 广播type=autoBlackBordersConfig权威值 → 下发目标
初始化/重连 → 补默认值 → restoreState → 两端恢复权威开关

当前视频播放且开关开启 → 每个新播放帧触发 → 等比缩至最长边192像素 → RGB最大值亮度
全黑/过暗/有效内部太小 → 无效样本 → 清候选，保留已确认矩形
四边连续近黑行列 → 有效矩形 → 内部亮度校验 → 补一采样像素安全边距
连续两个不同播放位置样本 → 边界在容差内 → 保守外包矩形 → 下一新帧确认并应用
稳定完整矩形 → 取消旧自动裁边；暗场不得确认新裁剪或清除已确认结果
网页 := 视频帧回调 → 消费上一帧已完成结果 → 小canvas → getImageData → 单任务Worker共享检测器
Node := 专属lavfi cropdetect+blackframe逐帧产生边界/暗像素比例 → Lua播放PTS变化读取元数据 → 消费上次结果 → 单任务Worker验证候选
原生滤镜不可用 → Lua screenshot-raw video → 小亮度样本；截图较慢时沿用最近结果，不堆积
结果核对媒体代次/开关/当前视频 → 过期丢弃；取样失败停当前源检测而不停止播放

布局输入 := 原视频尺寸、有效矩形、旋转、视口、填充模式
手动crop := 原视频裁剪框与有效矩形交集；无交集保持人工选择
按旋转映射有效宽高 → contain取较小比例；cover取较大比例；height/width沿用当前轴
求完整视频缩放尺寸及旋转后有效中心偏移 → 居中有效画面
网页 := 尺寸/位置/clip-path；Node := video-zoom/pan，不叠加panscan
dynamic := 网页原宽高过渡；Node在有效画面的contain/cover几何之间插值
换源/清空/关闭/实例失效 → 撤销采样 → 清候选与确认矩形
关闭开关 → 恢复完整画面填充 → 新视频不取样
重新开启当前跨域视频 → 重试相同直连源CORS → 成功/普通直连降级后恢复位置与暂停状态
发布 := servicePackage=true，voiceDisplayNodePackage=true，其他状态原值
Node独立包 := RUNTIME_SUPPORT_FILES显式包含共享video-black-borders.js，Lua与Node模块随应用目录进入包
```

## 逐帧流程（2026-10-24，已确认实施，两帧确认）

```text
帧来源 := 网页视频帧回调，兼容模式按动画帧与已呈现帧编号去重；Node播放位置变化并按PTS去重
第N个新视频帧 → 提交上一帧最近完成的候选 → 按连续两帧/暗场规则更新有效矩形
当前无计算在途 → 采集第N帧候选/小图并计算 → 保存结果，等待后续帧消费
计算仍在途 → 保留最近确认布局，不排队积压，也不等待计算阻塞视频
布局仅在确认矩形变化时提交 → 按当前填充方式处理；Node合并几何任务，取消黑边更新的额外50ms等待
过渡开启 → 已确认矩形变化时约200ms平滑缩放/平移；网页还插值裁剪边界；关闭立即应用最新目标
网页动态填充已有过渡时长优先；Node黑边过渡结束后恢复动态调度，防止两个几何写入器抢写
人工切换填充/旋转、换源、清空或关闭 → 取消旧过渡；新检测目标可从当前插值位置重新开始
Worker不可用 → 后续帧异步计算共享检测器，仍按下一新帧消费，不积压
Node取样 → 至多一包等待JS计算完成ACK；未ACK不继续截图；停止/换源清掉旧等待
原生元数据 := 读取自身带标签滤镜，不移除用户其他滤镜；停止只移除自身；亮区不足8%拒绝候选
原生坐标 := 按滤镜输出宽高归一化、映射文件固有旋转；用户旋转仍交给布局；与截图路径同样保留边界余量
暂停/睡眠 → 取消帧回调或停止取样，不提交新布局；完成结果在恢复后的新帧再消费
换源/关闭 → 清理并隔离迟到计算；关闭回收Worker和帧监听
边界 := 正常负载目标为上一帧结果；过载沿用最近完成结果，不承诺任意设备都严格逐源帧检测或下一帧提交
验证 := 上一帧顺序、两帧稳定、慢计算单在途、去重/取消、真实浏览器和mpv的30/60fps采样与延迟
```
