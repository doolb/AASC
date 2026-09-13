#include <atomic>
#include <jni.h>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>
#include "llm_session.h"

using json = nlohmann::json;
using PromptItem = mls::PromptItem;

// 官方 MnnLlmChat 的 LlmSession 保留了 Firebase 配置埋点依赖；AASC 不接入
// Firebase，因此提供同签名的无副作用适配实现，避免把官方 App 的外部埋点
// 依赖带入本地 LLM APK。实际 LLM 配置和错误仍由 AASC WebSocket/日志链路处理。
void ReportLlmSetConfigToFirebase(const std::string&, const std::string&) {
}

namespace {

std::mutex gBaselineConfigMutex;
std::unordered_map<mls::LlmSession*, json> gBaselineConfigs;
std::unordered_map<mls::LlmSession*, std::shared_ptr<std::atomic_bool>> gCancelFlags;

std::string toString(JNIEnv* env, jstring value) {
    if (value == nullptr) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    const std::string result = chars ? chars : "";
    if (chars) env->ReleaseStringUTFChars(value, chars);
    return result;
}

void throwIllegalState(JNIEnv* env, const std::string& message) {
    jclass exceptionClass = env->FindClass("java/lang/IllegalStateException");
    if (exceptionClass != nullptr) env->ThrowNew(exceptionClass, message.c_str());
}

std::string contentToText(const json& content) {
    if (content.is_string()) return content.get<std::string>();
    if (!content.is_array()) return content.dump();
    std::string text;
    for (const auto& part : content) {
        if (part.is_string()) {
            text += part.get<std::string>();
        } else if (part.is_object() && part.contains("text") && part["text"].is_string()) {
            text += part["text"].get<std::string>();
        }
    }
    return text;
}

std::vector<PromptItem> parseMessages(const std::string& messagesJson) {
    const json messages = json::parse(messagesJson);
    std::vector<PromptItem> history;
    if (!messages.is_array()) return history;
    for (const auto& message : messages) {
        if (!message.is_object()) continue;
        const std::string role = message.value("role", "user");
        const auto content = message.contains("content") ? message["content"] : json("");
        history.emplace_back(role, contentToText(content));
    }
    return history;
}

// Qwen3.5 的部分导出模板会无条件把 <think> 写入 generation prompt，
// 仅设置 jinja.context.enable_thinking 不能关闭这种模板的思考前缀。
// 这里只替换模板最后一次出现的 generation prompt，保留历史消息中的
// 思考内容和其它模型的原始模板结构；每次请求都从加载时的基线配置重建，
// 因此 true/false/缺省请求之间不会互相污染。
json createThinkingConfig(const json& baselineConfig, bool enableThinking) {
    json config = baselineConfig;
    if (!config.contains("jinja") || !config["jinja"].is_object()) {
        return config;
    }

    config["jinja"]["context"]["enable_thinking"] = enableThinking;
    if (!config["jinja"].contains("chat_template")
            || !config["jinja"]["chat_template"].is_string()) {
        return config;
    }

    const std::string thinkingPrompt = "{{- '<|im_start|>assistant\n<think>\n' }}";
    const std::string noThinkingPrompt = "{{- '<|im_start|>assistant\n' }}";
    std::string chatTemplate = config["jinja"]["chat_template"].get<std::string>();
    const std::string& source = enableThinking ? noThinkingPrompt : thinkingPrompt;
    const std::string& replacement = enableThinking ? thinkingPrompt : noThinkingPrompt;
    const std::size_t position = chatTemplate.rfind(source);
    if (position != std::string::npos) {
        chatTemplate.replace(position, source.size(), replacement);
        config["jinja"]["chat_template"] = chatTemplate;
    }
    return config;
}

json getBaselineConfig(mls::LlmSession* session) {
    std::lock_guard<std::mutex> lock(gBaselineConfigMutex);
    const auto it = gBaselineConfigs.find(session);
    return it == gBaselineConfigs.end() ? json::object() : it->second;
}

std::shared_ptr<std::atomic_bool> getCancelFlag(mls::LlmSession* session) {
    std::lock_guard<std::mutex> lock(gBaselineConfigMutex);
    const auto it = gCancelFlags.find(session);
    return it == gCancelFlags.end() ? nullptr : it->second;
}

}

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_aasc_display_MnnLlmEngine_nativeIsAvailable(JNIEnv*, jclass) {
    return JNI_TRUE;
}

JNIEXPORT jlong JNICALL
Java_com_aasc_display_MnnLlmEngine_nativeLoad(
        JNIEnv* env, jobject, jstring configPath, jstring optionsJson) {
    try {
        const auto options = json::parse(toString(env, optionsJson));
        const int threadNum = options.value("thread_num", 0);
        if (threadNum <= 0) {
            throw std::invalid_argument("MNN-LLM options 缺少有效 thread_num");
        }
        auto* session = new mls::LlmSession(toString(env, configPath), json::object(), options, {});
        if (!session->Load() || !session->isModelReady()) {
            const std::string message = session->getLastLoadError().empty()
                    ? "MNN-LLM 模型加载失败"
                    : session->getLastLoadError();
            delete session;
            throwIllegalState(env, message);
            return 0;
        }
        const json baselineConfig = json::parse(session->getLlm()->dump_config(), nullptr, false);
        {
            std::lock_guard<std::mutex> lock(gBaselineConfigMutex);
            if (!baselineConfig.is_discarded()) {
                gBaselineConfigs[session] = baselineConfig;
            }
            gCancelFlags[session] = std::make_shared<std::atomic_bool>(false);
        }
        return reinterpret_cast<jlong>(session);
    } catch (const std::exception& error) {
        throwIllegalState(env, error.what());
        return 0;
    }
}

JNIEXPORT jstring JNICALL
Java_com_aasc_display_MnnLlmEngine_nativeGenerate(
        JNIEnv* env, jobject, jlong pointer, jstring messagesJson, jint maxTokens,
        jstring generationOptionsJson, jobject listener) {
    auto* session = reinterpret_cast<mls::LlmSession*>(pointer);
    if (session == nullptr) {
        throwIllegalState(env, "MNN-LLM 会话为空");
        return nullptr;
    }
    try {
        const auto cancelFlag = getCancelFlag(session);
        const json generation_options = json::parse(toString(env, generationOptionsJson), nullptr, false);
        if (session->getLlm() == nullptr) {
            throw std::runtime_error("MNN-LLM 引擎为空");
        }
        json baselineConfig = getBaselineConfig(session);
        if (baselineConfig.empty()) {
            baselineConfig = json::parse(session->getLlm()->dump_config(), nullptr, false);
        }
        if (!baselineConfig.is_discarded() && !baselineConfig.empty()) {
            const bool hasThinkingOption = !generation_options.is_discarded()
                    && generation_options.contains("enable_thinking")
                    && generation_options["enable_thinking"].is_boolean();
            const json config = hasThinkingOption
                    ? createThinkingConfig(
                            baselineConfig,
                            generation_options["enable_thinking"].get<bool>())
                    : baselineConfig;
            if (!session->getLlm()->set_config(config.dump())) {
                throw std::runtime_error("MNN-LLM 思考配置应用失败");
            }
        }
        session->SetMaxNewTokens(maxTokens);
        const std::vector<PromptItem> history = parseMessages(toString(env, messagesJson));
        const jclass listenerClass = listener ? env->GetObjectClass(listener) : nullptr;
        const jmethodID progressMethod = listenerClass
                ? env->GetMethodID(listenerClass, "onProgress", "(Ljava/lang/String;Z)Z")
                : nullptr;
        std::string completeText;
        session->ResponseWithHistory(history, [&](const std::string& chunk, bool isEop) {
            if (cancelFlag && cancelFlag->load(std::memory_order_acquire)) return true;
            if (!isEop) completeText += chunk;
            if (listener && progressMethod) {
                jstring chunkString = isEop ? nullptr : env->NewStringUTF(chunk.c_str());
                const jboolean stop = env->CallBooleanMethod(listener, progressMethod, chunkString, isEop);
                if (chunkString) env->DeleteLocalRef(chunkString);
                if (env->ExceptionCheck()) {
                    env->ExceptionClear();
                    return true;
                }
                if (cancelFlag && cancelFlag->load(std::memory_order_acquire)) return true;
                return stop == JNI_TRUE;
            }
            return false;
        });
        return env->NewStringUTF(completeText.c_str());
    } catch (const std::exception& error) {
        throwIllegalState(env, error.what());
        return nullptr;
    }
}

JNIEXPORT void JNICALL
Java_com_aasc_display_MnnLlmEngine_nativeRelease(JNIEnv*, jobject, jlong pointer) {
    auto* session = reinterpret_cast<mls::LlmSession*>(pointer);
    {
        std::lock_guard<std::mutex> lock(gBaselineConfigMutex);
        gBaselineConfigs.erase(session);
        gCancelFlags.erase(session);
    }
    delete session;
}

JNIEXPORT void JNICALL
Java_com_aasc_display_MnnLlmEngine_nativeResetCancel(JNIEnv*, jobject, jlong pointer) {
    auto* session = reinterpret_cast<mls::LlmSession*>(pointer);
    const auto cancelFlag = getCancelFlag(session);
    if (cancelFlag) cancelFlag->store(false, std::memory_order_release);
}

JNIEXPORT void JNICALL
Java_com_aasc_display_MnnLlmEngine_nativeCancel(JNIEnv*, jobject, jlong pointer) {
    auto* session = reinterpret_cast<mls::LlmSession*>(pointer);
    const auto cancelFlag = getCancelFlag(session);
    if (cancelFlag) cancelFlag->store(true, std::memory_order_release);
}

}
