package com.aasc.display

import java.io.File
import java.nio.file.Files

/** 恢复模型目录切换中断；只处理指定模型本模块生成的普通暂存目录。 */
internal object OfflineModelRecovery {
    fun recover(target: File, modelId: String) {
        require(Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$").matches(modelId))
        val parent = target.parentFile ?: error("模型目录缺少父目录")
        check(!Files.isSymbolicLink(parent.toPath()) && (parent.isDirectory || parent.mkdirs())) { "模型缓存父目录不可用" }
        val escapedId = Regex.escape(modelId)
        val stages = Regex("^\\.model-$escapedId--?[0-9]+$")
        val backups = Regex("^\\.model-backup-$escapedId--?[0-9]+$")
        val owned = parent.listFiles().orEmpty().filter { directory ->
            directory.isDirectory && !Files.isSymbolicLink(directory.toPath())
                && directory.canonicalFile.parentFile == parent.canonicalFile
                && (stages.matches(directory.name) || backups.matches(directory.name))
                && directory.walkTopDown().none { Files.isSymbolicLink(it.toPath()) }
        }
        if (!target.exists()) owned.filter { backups.matches(it.name) }.maxByOrNull { it.lastModified() }?.let {
            check(it.renameTo(target)) { "恢复旧模型缓存失败" }
        }
        // 未完成目录不宣称可用；完整已提交缓存与未使用的备份始终保留。
        owned.filter { stages.matches(it.name) }.forEach { check(it.deleteRecursively()) { "清理中断模型暂存失败" } }
    }
}
