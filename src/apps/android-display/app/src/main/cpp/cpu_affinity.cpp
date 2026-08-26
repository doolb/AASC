#include <jni.h>
#include <sched.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <android/log.h>
#include <cerrno>

namespace {

constexpr const char* kTag = "CpuAffinity";
constexpr int kMaxSupportedCpuExclusive = 63;

bool fillCpuSet(jlong cpuMask, cpu_set_t* cpuSet) {
    CPU_ZERO(cpuSet);
    bool hasCpu = false;
    const int maxCpu = CPU_SETSIZE < kMaxSupportedCpuExclusive ? CPU_SETSIZE : kMaxSupportedCpuExclusive;
    for (int cpu = 0; cpu < maxCpu; ++cpu) {
        const jlong bit = static_cast<jlong>(1) << cpu;
        if ((cpuMask & bit) != 0) {
            CPU_SET(cpu, cpuSet);
            hasCpu = true;
        }
    }
    return hasCpu;
}

pid_t currentThreadId() {
#if defined(__ANDROID__)
    return static_cast<pid_t>(syscall(__NR_gettid));
#else
    return 0;
#endif
}

}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_com_aasc_display_CpuAffinity_nativeApplyCurrentThread(
    JNIEnv*,
    jobject,
    jlong cpuMask
) {
    if (cpuMask <= 0) {
        __android_log_print(ANDROID_LOG_WARN, kTag, "empty cpu mask");
        return JNI_FALSE;
    }

    cpu_set_t cpuSet;
    if (!fillCpuSet(cpuMask, &cpuSet)) {
        __android_log_print(
            ANDROID_LOG_WARN,
            kTag,
            "cpu mask has no supported bits: %lld",
            static_cast<long long>(cpuMask)
        );
        return JNI_FALSE;
    }

    const pid_t tid = currentThreadId();
    if (tid <= 0) {
        __android_log_print(ANDROID_LOG_WARN, kTag, "cannot resolve current native thread id");
        return JNI_FALSE;
    }

    const int rc = sched_setaffinity(tid, sizeof(cpu_set_t), &cpuSet);
    if (rc != 0) {
        __android_log_print(ANDROID_LOG_WARN, kTag, "sched_setaffinity failed rc=%d errno=%d", rc, errno);
        return JNI_FALSE;
    }

    return JNI_TRUE;
}
