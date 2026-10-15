# 豆包Chat音色与显示端回复播放

本轮源码已支持，运行中的服务需加载新版后使用；Offline服务包尚未出包。

在正式显示端右下角点击灯光按钮上方的「音色」，先选择TTS方式，再选择该方式的音色。豆包网页朗读提供官网当时实际显示的94项音色，女声32项、男声62项，角色与口音已合并，可搜索名称、标签或style_id。目录来源及获取步骤见[官网音色获取](../ref/doubao-web-voice-fetch.md)。

选择修改的是「声纹 → 语音服务与音色」中同一份全局AI/Agent默认配置，控制端和显示端同步。每种方式记住自己的音色：例如豆包选桂乡甜妞，切到Qwen选择其它音色，再切回豆包会恢复桂乡甜妞。模板显式设置仍优先；继承默认的模板跟随快选。正在生成或播放的分句批次沿用开始时配置，新选择作用于下一批。

点击已完成AI/Agent回复或历史消息上的🔊可重播，优先使用回复的speech，否则正文，不朗读思考。点击⏹停止；原输入和模板上下文用于选择相应TTS，播放目标为当前显示端。失败时检查声纹页服务是否启用，以及Chat2API对应账号是否可用。选择音色不会自动启用服务或添加账号。

其它方式沿用其已有音色目录；千问网页当前只有已知单项，系统原生沿用原生音色。静态目录可读不代表账号可合成，94项逐一真实听感和Android实机播放仍待验收。

开发调用可使用只读接口`GET /v1/audio/voices?model=doubao-chat`，携带代理现有Bearer或X-API-Key。返回`{object:"list",model:"doubao-chat",data:[...]}`，每项包含`id`、`style_id`、`name`、`gender`、`tags`。生成时将`style_id`作为`POST /v1/audio/speech`的`voice`。独立JSON位于`src/apps/server/modules/chat2api/doubao-chat-voices.json`，只含female/male分组和name/style_id/tags。显示端使用主服务WebSocket查询目录及保存选择。
