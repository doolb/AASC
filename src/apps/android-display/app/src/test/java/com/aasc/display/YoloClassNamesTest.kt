package com.aasc.display

import com.aasc.display.vision.yolo.YoloClassNames
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class YoloClassNamesTest {
    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun readsNamesArrayAndReturnsNameByClassId() {
        val file = tmp.newFile("yolo11n.classes.json")
        file.writeText("""{"model":"yolo11n","names":["person","car","sports ball"]}""")

        val names = YoloClassNames.read(file)

        assertEquals("sports ball", names.nameFor(2))
        assertNull(names.nameFor(9))
    }

    @Test
    fun malformedOrMissingLabelsRemainUnknown() {
        val file = tmp.newFile("broken.classes.json")
        file.writeText("not-json")

        assertNull(YoloClassNames.read(file).nameFor(0))
        assertNull(YoloClassNames.read(tmp.root.resolve("missing.json")).nameFor(0))
    }
}
