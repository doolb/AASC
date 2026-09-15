package com.aasc.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ApkBuildProfileTest {

    @Test
    fun noserverDoesNotStartEmbeddedNode() {
        assertFalse(NodeServerService.shouldStartNode(false))
        assertTrue(NodeServerService.shouldStartNode(true))
    }
}
