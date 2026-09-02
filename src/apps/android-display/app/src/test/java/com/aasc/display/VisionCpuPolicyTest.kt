package com.aasc.display

import com.aasc.display.vision.VisionCpuPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VisionCpuPolicyTest {
    @Test
    fun defaultVisionPolicySelectsExactlyOneLittleCore() {
        val topology = CpuTopology(
            listOf(
                0 to 1000L,
                1 to 1000L,
                4 to 2000L,
                5 to 2000L
            )
        )

        val policy = VisionCpuPolicy.defaultFor(topology)

        assertEquals(listOf(0), policy.littleCpus)
        assertTrue(policy.bigCpus.isEmpty())
        assertEquals(listOf(0), policy.selectedCpus)
        assertEquals(1, policy.totalCoreCount)
    }
}
