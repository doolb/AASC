- 修复90度和270度时，上下拖动裁剪框，显示端是左右方向的问题
 - 控制端移动裁剪框是正确的
 - 0度和180度正确的
- 拆分代码，分为核心代码，和业务代码
 - 核心代码负责处理显示端和控制端的通信
 - 业务代码负责处理业务逻辑，如裁剪、播放视频等

 
- 显示端支持通过
tts.js
生成语音功能，用于显示端播放语音
播放媒体时，显示端会自动播放语音，语音内容是当前媒体的名称

- ✅ 已完成~~合并播放和暂停按钮~~
  - upload.html:59-63 将两个按钮合并为一个切换按钮 `<button id="playPauseBtn" onclick="togglePlayPause()">`
  - controls.js `togglePlayPause()` 切换播放/暂停状态，自动更新按钮文字和背景颜色
  - controls.js `setPlayingState(playing)` 供外部设置播放状态
  - upload.css `.playing` 绿色渐变, `.paused` 橙红色渐变
  - server.js:43 `createDisplayState()` 添加 `isPlaying` 状态字段
  - server.js:415-417 处理 `play` action 时保存播放状态
  - websocket.js:57-59 收到 `displayState` 时更新播放按钮状态

- ✅ 已完成~~画面填充和旋转按钮选中状态背景颜色切换~~
  - upload.html 画面填充按钮添加 `data-fit` 属性，旋转按钮添加 `data-rotation` 属性
  - controls.js `sendFitMode()` 点击时更新按钮选中状态
  - controls.js `setFitMode()` 供外部设置填充模式状态
  - crop.js `applyRotation()` 点击时更新按钮选中状态
  - crop.js `setRotation()` 供外部设置旋转状态
  - websocket.js:50-52 收到 `displayState` 时更新填充模式按钮状态
  - upload.css `.active` 蓝色渐变背景
- 新加一个本地配置表，
 - 保存端口配置，保存语音服务地址，语音服务端口
 - 保存媒体库配置，保存媒体库文件夹路径，多个媒体库
- 现在控制端看不到预览图，点播放也没有显示到显示端,控制端媒体列表看不到预览图
- 控制端需要看到媒体列表，图片，gif，视频的预览图，有一部分显示端的画面没有正常显示

- ✅ 已完成~~控制端媒体列表标注当前播放的媒体~~
  - media-list.js:2 添加 `currentMediaUrl` 属性存储当前播放媒体
  - media-list.js:46-48 渲染时判断是否正在播放，添加 `.playing` 类和徽章
  - media-list.js:83-126 `setCurrentMedia(url)` 方法更新播放状态并滚动到当前播放项
  - websocket.js:69-71 收到 `displayState` 时同步更新媒体列表播放状态
  - upload.css:232-258 `.media-item.playing` 绿色边框，`.playing-badge` 徽章样式


- 新增保存显示端当前播放列表，画面填充设置，服务端重启后，可以恢复到上次播放的状态，
 - 需要区分不同的显示端，用ip地址区分
 - 音量状态也要保留，控制端的语音滑动框也需要同步恢复

# 控制端
- ✅ 已完成~~服务端重启按钮，点击后，会发送重启请求到服务端，服务端会重启，显示端会重新连接~~
  - server.js:303-336 `POST /api/restart` 接口
  - server.js:316-325 使用 `spawn` 启动新进程后退出，实现自重启
  - upload.html:118 添加重启服务器按钮
  - controls.js:83-117 `restartServer()` 发送重启请求，5秒后自动刷新页面

## 控制端查看显示端信息
- ✅ 已完成~~显示端navigator.userAgent，用于判断显示端的浏览器类型，然后可以在控制端查看内容,参考showinfo.html~~ 
- ✅ 已完成~~控制端显示列表新增详情按钮，点击可查看显示端的功能支持（Feature Support）~~ 
  - 上传 display.html:sendFeatureSupport

# 媒体库功能
- 新增媒体库功能，用户可以在控制端查看和管理已上传的媒体
 - 支持视频和图片上传
 - 支持删除已上传的媒体
 - 支持预览已上传的媒体
 - 支持配置媒体库文件夹路径，多个媒体库
 - 支持文件夹中的媒体管理
 - 支持上传文件夹
 - 支持删除文件夹
 - 支持http协议的媒体库
 - 使用smb2库 支持smb协议的媒体库 ，参考smb2.js


- 服务器重启后，状态恢复功能，需要从本地配置表中读取上次播放的状态，
 - 播放列表
 - 画面填充设置
 - 音量状态
 - 语音滑动框位置
 - bug：重启后，显示端先连接，再断开，会触发两次tts生成，实际语音只播了一次

- ✅ 已完成~~upload.html 拆分代码，每个文件负责一个功能模块~~
 - upload.html 负责上传文件
 - js
  - websocket.js 负责处理与服务端的websocket通信
  - media-list.js 负责处理媒体上传的业务逻辑 显示媒体列表
  - display-list.js 负责处理显示端的业务逻辑
  - crop.js 负责处理裁剪功能
  - tts.js 负责处理语音播报功能
  - controls.js 负责处理进度/音量控制
  - toast.js 负责处理提示消息
  - upload.js 负责处理文件上传
  - main.js 主入口和初始化
 - css
  - upload.css 负责上传文件的样式

## 辅助功能
- ✅ 已完成~~整点报时功能，每整点半个小时报一次，在服务端检查当前时间是否是整点，是则报时，生成语音播报，下发到显示端~~
  - core/timeAnnounce.js 整点报时模块
    - `init(config)` 初始化配置
    - `start(displayClients, sendToDisplay)` 启动定时器
    - `stop()` 停止定时器
    - `checkAndAnnounce()` 检查并执行报时
    - `generateTimeText()` 生成报时文本（如"现在时间是下午3点整"）
    - `shouldAnnounce()` 判断是否应该报时（支持15/30/60分钟间隔）
  - server.js 集成
    - 引入 timeAnnounce 模块
    - 服务器启动时调用 `timeAnnounce.start()`
    - 处理 `testTimeAnnounce` action，强制触发报时
  - 控制端测试按钮
    - upload.html 添加"测试整点报时"按钮
    - tts.js `testTimeAnnounce()` 发送测试请求
  - 播报逻辑
    - 整点报时：发送到所有显示端
    - 测试整点报时：发送到所有显示端
    - 自定义播报：需要选择显示端，只发送到选中的显示端
    - 停止播报：停止所有显示端的播报
  - 优化：服务端生成 TTS 后直接发送音频 URL，显示端直接播放，避免重复生成