#include <jni.h>
#include <sched.h>
#include <unistd.h>

#include <algorithm>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct CpuInfo {
    int id;
    long value;
};

std::vector<int> allCpus() {
    const long count = sysconf(_SC_NPROCESSORS_CONF);
    std::vector<int> cpus;
    if (count <= 0) return cpus;
    for (int id = 0; id < count && id < CPU_SETSIZE; ++id) cpus.push_back(id);
    return cpus;
}

bool readLong(const std::string& path, long* value) {
    std::ifstream input(path);
    if (!input.is_open()) return false;
    input >> *value;
    return input.good() || input.eof();
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

bool setAffinity(const std::vector<int>& cpus) {
    cpu_set_t mask;
    CPU_ZERO(&mask);
    for (const int id : cpus) CPU_SET(id, &mask);
    return !cpus.empty() && sched_setaffinity(0, sizeof(mask), &mask) == 0;
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
    const std::vector<int> all = allCpus();
    if (all.empty()) return "自动回退，无法读取 CPU 核心";

    if (mode == 0) {
        if (setAffinity(all)) return "自动，系统调度（" + formatCpus(all) + "）";
        return "自动回退，CPU 绑定失败";
    }

    std::vector<CpuInfo> values;
    if (!readCpuValues(all, &values)) {
        setAffinity(all);
        return "自动回退，无法识别大小核";
    }

    const auto minValue = std::min_element(values.begin(), values.end(),
        [](const CpuInfo& left, const CpuInfo& right) { return left.value < right.value; });
    const auto maxValue = std::max_element(values.begin(), values.end(),
        [](const CpuInfo& left, const CpuInfo& right) { return left.value < right.value; });
    if (minValue == values.end() || minValue->value == maxValue->value) {
        setAffinity(all);
        return "自动回退，无法区分大小核";
    }

    const double threshold = (static_cast<double>(minValue->value) + maxValue->value) / 2.0;
    std::vector<int> target;
    for (const CpuInfo& cpu : values) {
        const bool isBig = static_cast<double>(cpu.value) >= threshold;
        if ((mode == 1 && isBig) || (mode == 2 && !isBig)) target.push_back(cpu.id);
    }
    if (target.empty() || !setAffinity(target)) {
        setAffinity(all);
        return "自动回退，目标核心绑定失败";
    }
    return std::string(mode == 1 ? "大核" : "小核") + "（" + formatCpus(target) + "）";
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_com_aasc_tts_CpuAffinity_nativeApply(JNIEnv* env, jclass, jint mode) {
    const std::string result = applyMode(static_cast<int>(mode));
    return env->NewStringUTF(result.c_str());
}
