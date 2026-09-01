#include <jni.h>
#include <sched.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <android/log.h>
#include <cerrno>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

constexpr const char* kTag = "RapidOcrCpuAffinity";

struct CpuInfo {
    int id;
    long value;
};

thread_local cpu_set_t originalMask;
thread_local bool originalMaskReady = false;

bool readLong(const std::string& path, long* value) {
    std::ifstream input(path);
    if (!input.is_open()) return false;
    input >> *value;
    return input.good() || input.eof();
}

bool captureOriginalMask() {
    if (originalMaskReady) return true;
    CPU_ZERO(&originalMask);
    if (sched_getaffinity(0, sizeof(cpu_set_t), &originalMask) != 0) return false;
    originalMaskReady = true;
    return true;
}

std::vector<int> maskToCpus(const cpu_set_t& mask) {
    std::vector<int> cpus;
    for (int id = 0; id < CPU_SETSIZE; ++id) {
        if (CPU_ISSET(id, &mask)) cpus.push_back(id);
    }
    return cpus;
}

bool setAffinity(const cpu_set_t& mask) {
    return sched_setaffinity(0, sizeof(cpu_set_t), &mask) == 0;
}

bool readCpuValues(const std::vector<int>& cpus, std::vector<CpuInfo>* result) {
    result->clear();
    for (const int id : cpus) {
        const std::string prefix = "/sys/devices/system/cpu/cpu" + std::to_string(id);
        long value = 0;
        if (!readLong(prefix + "/cpu_capacity", &value) &&
            !readLong(prefix + "/cpufreq/cpuinfo_max_freq", &value)) {
            result->clear();
            return false;
        }
        result->push_back({id, value});
    }
    return !result->empty();
}

std::string formatCpus(const std::vector<int>& cpus) {
    std::ostringstream output;
    output << "核心 ";
    for (size_t index = 0; index < cpus.size(); ++index) {
        if (index != 0) output << ",";
        output << cpus[index];
    }
    return output.str();
}

std::string applyMode(int mode) {
    if (!captureOriginalMask()) return "自动回退，无法读取当前 CPU 集合";
    const std::vector<int> all = maskToCpus(originalMask);
    if (all.empty()) return "自动回退，无法读取 CPU 核心";

    if (mode == 0) {
        if (setAffinity(originalMask)) return "自动，系统调度（" + formatCpus(all) + "）";
        return "自动回退，CPU 绑定失败";
    }

    std::vector<CpuInfo> values;
    if (!readCpuValues(all, &values)) {
        setAffinity(originalMask);
        return "自动回退，无法识别大小核";
    }

    long minValue = values.front().value;
    long maxValue = values.front().value;
    for (const CpuInfo& cpu : values) {
        if (cpu.value < minValue) minValue = cpu.value;
        if (cpu.value > maxValue) maxValue = cpu.value;
    }
    if (minValue == maxValue) {
        setAffinity(originalMask);
        return "自动回退，无法区分大小核";
    }

    const double threshold = (static_cast<double>(minValue) + maxValue) / 2.0;
    cpu_set_t targetMask;
    CPU_ZERO(&targetMask);
    std::vector<int> target;
    for (const CpuInfo& cpu : values) {
        const bool isBig = static_cast<double>(cpu.value) >= threshold;
        const bool selected = (mode == 1 && isBig) || (mode == 2 && !isBig);
        if (selected) {
            CPU_SET(cpu.id, &targetMask);
            target.push_back(cpu.id);
        }
    }

    if (target.empty() || !setAffinity(targetMask)) {
        setAffinity(originalMask);
        return "自动回退，目标核心绑定失败";
    }
    return std::string(mode == 1 ? "大核" : "小核") + "（" + formatCpus(target) + "）";
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_com_aasc_rapidocr_CpuAffinity_nativeApply(JNIEnv* env, jclass, jint mode) {
    const std::string result = applyMode(static_cast<int>(mode));
    return env->NewStringUTF(result.c_str());
}
