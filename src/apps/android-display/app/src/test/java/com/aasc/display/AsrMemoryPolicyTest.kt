package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class AsrMemoryPolicyTest {

    @Test
    fun 内存充足时保留请求的核心数slot() {
        assertEquals(
            3,
            AsrMemoryPolicy.chooseSlots(
                availableBytes = 1400L * 1024 * 1024,
                requestedSlots = 3,
                perRecognizerBudgetBytes = 400L * 1024 * 1024
            )
        )
    }

    @Test
    fun 不能承载多slot但能承载单slot时回退一个() {
        assertEquals(
            1,
            AsrMemoryPolicy.chooseSlots(
                availableBytes = 700L * 1024 * 1024,
                requestedSlots = 3,
                perRecognizerBudgetBytes = 400L * 1024 * 1024
            )
        )
    }

    @Test
    fun 连单slot也不能承载时返回零() {
        assertEquals(
            0,
            AsrMemoryPolicy.chooseSlots(
                availableBytes = 399L * 1024 * 1024,
                requestedSlots = 3,
                perRecognizerBudgetBytes = 400L * 1024 * 1024
            )
        )
    }
}
