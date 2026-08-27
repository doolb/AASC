package com.aasc.asr

enum class StreamingCommand {
    END;

    companion object {
        fun parse(message: String): StreamingCommand? =
            if (message.replace(Regex("\\s"), "") == "{\"type\":\"end\"}") END else null
    }
}
