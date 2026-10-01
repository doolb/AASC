package com.aasc.mmdartest

/** JNI句柄只由单线程定位执行器访问，网页无法直接调用原生指针。 */
internal object NativeSlamBindings {
    val loadError: String? = try {
        System.loadLibrary("aasc_mmd_slam")
        null
    } catch (error: LinkageError) {
        error.message ?: "原生定位库未安装"
    }

    external fun create(vocabulary: String, settings: String, target: String, quad: DoubleArray): Long
    external fun track(handle: Long, gray: ByteArray, width: Int, height: Int, timestamp: Double, imu: DoubleArray): FloatArray?
    external fun destroy(handle: Long)
}
