package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CpuClusterTest {

    @Test
    fun policy按频率选择一大核两小核() {
        val topology = CpuTopology(
            listOf(
                0 to 1900800L,
                1 to 1900800L,
                2 to 2361600L,
                3 to 2361600L
            )
        )

        assertEquals(listOf(2), topology.policy(1, 0).bigCpus)
        assertEquals(listOf(0, 1), topology.policy(0, 2).littleCpus)
    }

    @Test
    fun policy数量超过可用核心时裁剪并标记回退() {
        val topology = CpuTopology(
            listOf(
                0 to 1000L,
                1 to 1000L,
                2 to 2000L
            )
        )
        val policy = topology.policy(4, 4)

        assertEquals(listOf(2), policy.bigCpus)
        assertEquals(listOf(0, 1), policy.littleCpus)
        assertEquals(1, policy.effectiveBigCoreCount)
        assertEquals(2, policy.effectiveLittleCoreCount)
        assertTrue(policy.fallback)
        assertEquals(0b111L, policy.cpuMask)
    }

    @Test
    fun policy有效配置不会返回空策略() {
        val topology = CpuTopology(listOf(0 to 1500L, 1 to 1500L))
        val policy = topology.policy(1, 0)

        assertTrue(policy.fallback)
        assertEquals(listOf(0), policy.littleCpus)
        assertEquals(1, policy.totalCoreCount)
        assertEquals(1L, policy.cpuMask)
    }

    @Test
    fun detect使用注入reader读取在线CPU和频率() {
        val files = mapOf(
            "/sys/devices/system/cpu/possible" to "0-5",
            "/sys/devices/system/cpu/online" to "0-1,4-5",
            "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq" to "1200000",
            "/sys/devices/system/cpu/cpu1/cpufreq/cpuinfo_max_freq" to "1200000",
            "/sys/devices/system/cpu/cpu4/cpufreq/cpuinfo_max_freq" to "2400000",
            "/sys/devices/system/cpu/cpu5/cpufreq/cpuinfo_max_freq" to "2400000"
        )

        val topology = CpuCluster.detect { path -> files[path] }

        assertFalse(topology.fallback)
        assertEquals(listOf(4, 5), topology.bigCpus)
        assertEquals(listOf(0, 1), topology.littleCpus)
    }

    @Test
    fun policy保留CPU62作为最大可支持mask位() {
        val topology = CpuTopology(listOf(62 to 2400000L))
        val policy = topology.policy(0, 1)

        assertEquals(listOf(62), policy.littleCpus)
        assertEquals(1, policy.totalCoreCount)
        assertEquals(1L shl 62, policy.cpuMask)
        assertTrue(policy.cpuMask > 0L)
    }

    @Test
    fun policy排除CPU63并回退到可支持CPU() {
        val topology = CpuTopology(
            listOf(
                62 to 1900800L,
                63 to 2361600L
            )
        )
        val policy = topology.policy(1, 0)

        assertEquals(emptyList<Int>(), policy.bigCpus)
        assertEquals(listOf(62), policy.littleCpus)
        assertEquals(1, policy.totalCoreCount)
        assertEquals(1L shl 62, policy.cpuMask)
        assertTrue(policy.fallback)
    }

    @Test
    fun policy只有不支持CPU时不返回不可应用的非空策略() {
        val topology = CpuTopology(
            listOf(
                63 to 1900800L,
                128 to 2361600L,
                1300 to 2600000L
            )
        )
        val policy = topology.policy(2, 2)

        assertEquals(emptyList<Int>(), policy.bigCpus)
        assertEquals(emptyList<Int>(), policy.littleCpus)
        assertEquals(emptyList<Int>(), policy.selectedCpus)
        assertEquals(0, policy.totalCoreCount)
        assertEquals(0L, policy.cpuMask)
        assertTrue(policy.fallback)
    }
}
