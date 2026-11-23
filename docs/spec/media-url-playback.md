# URL 媒体识别

```text
控制端提交 URL：
  若为 B 站作品页：沿用 B 站现有播放流程
  解析 HTTP(S) URL；若路径为 /api/proxy 或 /api/proxy/media.<扩展名> 且包含 url 参数：
    使用该参数中合法的 HTTP(S) 上游 URL 仅作媒体类型判断
  若上游含 filename 查询参数且文件名带已知扩展名：优先按该文件名判断
  否则按媒体 URL 路径扩展名判断（忽略查询参数与片段）
  图片扩展名 → image，GIF → gif，视频扩展名 → video，音频扩展名 → audio
  其他 URL → html
  保持原始输入 URL 不变，将判定类型和地址交给现有发送流程
  图片或视频的宽高比由现有媒体元素读取元数据；加载失败维持既有回退行为
```

支持的图片扩展名包括 jpg、jpeg、png、webp、bmp、avif；视频包括 mp4、webm、mov、avi、mkv、m3u8；音频包括 wav、ogg、mp3、m4a。未知地址仍按网页处理，扩展名只用于选择播放器，不保证上游内容或 HLS 在目标设备可播放。
