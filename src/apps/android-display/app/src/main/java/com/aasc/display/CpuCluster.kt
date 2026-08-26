package com.aasc.display

import java.io.File

data class CpuInfo(val cpuId: Int, val maxFreq: Long)

data class CpuPolicy(
    val bigCpus: List<Int>,
    val littleCpus: List<Int>,
    val cpuMask: Long,
    val effectiveBigCoreCount: Int,
    val effectiveLittleCoreCount: Int,
    val fallback: Boolean,
    val fallbackReason: String?
) {
    val selectedCpus: List<Int> = (bigCpus + littleCpus).distinct().sorted()
    val totalCoreCount: Int = selectedCpus.size
}

class CpuTopology(
    cpuFrequencies: List<Pair<Int, Long>>,
    detectionFallback: Boolean = false,
    detectionFallbackReason: String? = null
) {
    companion object {
        // Long 作为有符号类型传给 JNI；bit 63 会变成负数，统一只支持 0..62。
        const val MAX_SUPPORTED_CPU_ID = 62
    }

    val cpus: List<CpuInfo> = cpuFrequencies
        .filter { (cpuId, _) -> cpuId >= 0 }
        .groupBy { (cpuId, _) -> cpuId }
        .map { (cpuId, entries) ->
            CpuInfo(cpuId = cpuId, maxFreq = entries.first().second.coerceAtLeast(0L))
        }
        .sortedBy { it.cpuId }

    private val frequencyGroups: List<List<CpuInfo>> = cpus
        .groupBy { it.maxFreq }
        .toSortedMap()
        .values
        .map { group -> group.sortedBy { it.cpuId } }

    private val hasMultipleFrequencyGroups: Boolean = frequencyGroups.size > 1

    val fallback: Boolean = detectionFallback || !hasMultipleFrequencyGroups

    val fallbackReason: String? = when {
        detectionFallbackReason != null -> detectionFallbackReason
        cpus.isEmpty() -> "no_cpu"
        !hasMultipleFrequencyGroups -> "single_cluster"
        else -> null
    }

    val bigCpus: List<Int> = if (hasMultipleFrequencyGroups) {
        frequencyGroups.last().map { it.cpuId }
    } else {
        emptyList()
    }

    val littleCpus: List<Int> = if (hasMultipleFrequencyGroups) {
        frequencyGroups.dropLast(1).flatten().map { it.cpuId }.sorted()
    } else {
        cpus.map { it.cpuId }
    }

    fun policy(bigCoreCount: Int, littleCoreCount: Int, preferBigCores: Boolean = false): CpuPolicy {
        val requestedBig = bigCoreCount.coerceAtLeast(0)
        val requestedLittle = littleCoreCount.coerceAtLeast(0)
        val supportedBigCpus = bigCpus.filter(::isSupportedCpuId)
        val supportedLittleCpus = littleCpus.filter(::isSupportedCpuId)
        val requestedTotal = requestedBig + requestedLittle
        val selectedBig: List<Int>
        val selectedLittle: MutableList<Int>
        if (preferBigCores) {
            selectedBig = supportedBigCpus.take(requestedTotal)
            selectedLittle = supportedLittleCpus
                .take((requestedTotal - selectedBig.size).coerceAtLeast(0))
                .toMutableList()
        } else {
            selectedBig = supportedBigCpus.take(requestedBig)
            selectedLittle = supportedLittleCpus.take(requestedLittle).toMutableList()
        }
        val selectedBeforeFallback = selectedBig + selectedLittle
        val bigClamped = !preferBigCores && selectedBig.size < requestedBig
        val littleClamped = !preferBigCores && selectedLittle.size < requestedLittle

        // 合法配置至少请求一个槽位；当设备只有单频集群或大核不足时，从可用 CPU 中补一个确定性的回退槽。
        if (requestedTotal > 0 && selectedBeforeFallback.isEmpty()) {
            selectedLittle += fallbackCandidates()
                .filterNot { it in selectedBig || it in selectedLittle }
                .take(1)
        }

        val selectedCpus = (selectedBig + selectedLittle).distinct().sorted()
        val clamped = selectedCpus.size < requestedTotal || bigClamped || littleClamped
        val policyFallback = fallback || clamped
        val policyFallbackReason = when {
            fallbackReason != null -> fallbackReason
            clamped -> "clamped"
            policyFallback -> "fallback"
            else -> null
        }

        return CpuPolicy(
            bigCpus = selectedBig.sorted(),
            littleCpus = selectedLittle.distinct().sorted(),
            cpuMask = cpuMaskOf(selectedCpus),
            effectiveBigCoreCount = selectedBig.distinct().size,
            effectiveLittleCoreCount = selectedLittle.distinct().size,
            fallback = policyFallback,
            fallbackReason = policyFallbackReason
        )
    }

    private fun fallbackCandidates(): List<Int> {
        return cpus
            .filter { isSupportedCpuId(it.cpuId) }
            .sortedWith(compareByDescending<CpuInfo> { it.maxFreq }.thenBy { it.cpuId })
            .map { it.cpuId }
    }

    private fun cpuMaskOf(cpuIds: List<Int>): Long {
        var mask = 0L
        for (cpuId in cpuIds) {
            if (isSupportedCpuId(cpuId)) {
                mask = mask or (1L shl cpuId)
            }
        }
        return mask
    }

    private fun isSupportedCpuId(cpuId: Int): Boolean = cpuId in 0..MAX_SUPPORTED_CPU_ID
}

object CpuCluster {
    private const val CPU_SYSFS_ROOT = "/sys/devices/system/cpu"

    fun detect(reader: (String) -> String? = ::readTextFile): CpuTopology {
        val possibleCpuIds = parseCpuRangeList(reader("$CPU_SYSFS_ROOT/possible"))
        val onlineCpuIds = parseCpuRangeList(reader("$CPU_SYSFS_ROOT/online"))
        val candidateCpuIds = (onlineCpuIds.ifEmpty { possibleCpuIds }).sorted()
        val cpuFrequencies = candidateCpuIds.mapNotNull { cpuId ->
            val maxFreq = reader("$CPU_SYSFS_ROOT/cpu$cpuId/cpufreq/cpuinfo_max_freq")
                ?.trim()
                ?.toLongOrNull()
                ?.takeIf { it > 0L }
            maxFreq?.let { cpuId to it }
        }

        if (cpuFrequencies.isNotEmpty()) {
            return CpuTopology(cpuFrequencies)
        }

        // 旧设备或受限系统可能没有 cpufreq；保留在线 CPU 作为回退池，后续 affinity 失败也只降级调度。
        val fallbackFrequencies = candidateCpuIds.map { cpuId -> cpuId to 0L }
        return CpuTopology(
            cpuFrequencies = fallbackFrequencies,
            detectionFallback = true,
            detectionFallbackReason = if (candidateCpuIds.isEmpty()) "no_cpu" else "no_freq"
        )
    }

    private fun readTextFile(path: String): String? {
        return try {
            File(path).readText().trim()
        } catch (_: Exception) {
            null
        }
    }

    private fun parseCpuRangeList(text: String?): List<Int> {
        return text
            ?.trim()
            ?.split(",")
            ?.flatMap(::parseCpuRangePart)
            ?.distinct()
            ?.sorted()
            ?: emptyList()
    }

    private fun parseCpuRangePart(part: String): List<Int> {
        val normalized = part.trim()
        if (normalized.isEmpty()) return emptyList()
        val bounds = normalized.split("-", limit = 2).map { it.toIntOrNull() }
        val start = bounds.getOrNull(0) ?: return emptyList()
        val end = bounds.getOrNull(1) ?: start
        if (start < 0 || end < start) return emptyList()
        return (start..end).toList()
    }
}
