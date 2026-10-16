package com.aasc.display

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** 独立、不导出的系统选择宿主，避免重选结果重新执行MainActivity首次启动流程。 */
class SafDirectoryPickerActivity : Activity() {
    companion object {
        const val EXTRA_REQUEST_ID = "saf_directory_request_id"
        private const val PICK_DIRECTORY = 1
    }

    private var selectionId = ""

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        selectionId = intent.getStringExtra(EXTRA_REQUEST_ID).orEmpty()
        if (!SafDirectorySelection.markOpened(selectionId)) { finish(); return }
        // 旋转/配置恢复时系统保留在途选择，不得重复弹出选择器。
        if (state != null) return
        try {
            startActivityForResult(SharedStorageAccess.createTreePickerIntent(), PICK_DIRECTORY)
        } catch (_: Exception) {
            SafDirectorySelection.complete(selectionId, "failed", "设备无法打开SAF目录选择器，原目录保持")
            finish()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != PICK_DIRECTORY) return
        if (!SafDirectorySelection.isPending(selectionId)) { finish(); return }
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) {
            SafDirectorySelection.complete(selectionId, "cancelled", "已取消选择，原目录保持")
            finish()
            return
        }
        val persisted = SharedStorageAccess.persistTreeUri(this, uri, data?.flags ?: 0)
        SafDirectorySelection.complete(selectionId, if (persisted) "succeeded" else "failed",
            if (persisted) "SAF媒体目录已更新" else "未获得完整持久读写授权，原目录保持")
        finish()
    }

    override fun onDestroy() {
        if (isFinishing && SafDirectorySelection.isPending(selectionId)) {
            SafDirectorySelection.complete(selectionId, "cancelled", "目录选择已结束，原目录保持")
        }
        super.onDestroy()
    }
}
