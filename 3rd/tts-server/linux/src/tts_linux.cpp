// Linux Embedded Speech TTS 独立命令行程序。
// 该程序只依赖 Linux Speech SDK、模型目录和命令行参数，不依赖 Windows API 或旧适配器。
#include <chrono>
#include <fstream>
#include <iostream>
#include <string>

#include <speechapi_cxx.h>

using namespace Microsoft::CognitiveServices::Speech;
using namespace Microsoft::CognitiveServices::Speech::Audio;

struct Args {
    std::string model;
    std::string text;
    std::string out;
    std::string voice;
    std::string license;
    int speed = 0;
};

static std::string nextArgument(int argc, char* argv[], int& index) {
    if (index + 1 >= argc) return {};
    return argv[++index];
}

static bool parseArgs(int argc, char* argv[], Args& args) {
    for (int index = 1; index < argc; ++index) {
        const std::string key = argv[index];
        if (key == "--model") {
            args.model = nextArgument(argc, argv, index);
        } else if (key == "--text") {
            args.text = nextArgument(argc, argv, index);
        } else if (key == "--out") {
            args.out = nextArgument(argc, argv, index);
        } else if (key == "--voice") {
            args.voice = nextArgument(argc, argv, index);
        } else if (key == "--license") {
            args.license = nextArgument(argc, argv, index);
        } else if (key == "--speed") {
            try {
                args.speed = std::stoi(nextArgument(argc, argv, index));
            } catch (const std::exception&) {
                return false;
            }
        } else if (key == "--help") {
            return false;
        } else {
            std::cerr << "未知参数: " << key << "\n";
            return false;
        }
    }
    return !args.model.empty() && !args.text.empty() && !args.out.empty();
}

static std::string escapeXml(const std::string& text) {
    std::string escaped;
    escaped.reserve(text.size());
    for (const char character : text) {
        switch (character) {
            case '&': escaped += "&amp;"; break;
            case '<': escaped += "&lt;"; break;
            case '>': escaped += "&gt;"; break;
            case '"': escaped += "&quot;"; break;
            case '\'': escaped += "&apos;"; break;
            default: escaped += character; break;
        }
    }
    return escaped;
}

static std::string buildSsml(const std::string& text, int speed) {
    const int rate = speed * 10;
    const std::string rateText = rate >= 0
        ? "+" + std::to_string(rate) + "%"
        : std::to_string(rate) + "%";
    return "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\">"
           "<prosody rate=\"" + rateText + "\">" + escapeXml(text) +
           "</prosody></speak>";
}

static std::shared_ptr<SpeechSynthesisResult> synthesize(
    const std::shared_ptr<SpeechSynthesizer>& synthesizer,
    const Args& args) {
    if (args.speed == 0) return synthesizer->SpeakTextAsync(args.text).get();
    return synthesizer->SpeakSsmlAsync(buildSsml(args.text, args.speed)).get();
}

int main(int argc, char* argv[]) {
    Args args;
    if (!parseArgs(argc, argv, args)) {
        std::cerr << "用法: tts_linux --model <目录> --text <文本> --out <wav> "
                     "[--voice <语音>] [--license <授权串>] [--speed -10..10]\n";
        return 2;
    }

    try {
        // Xiaoxiao 模型只接受 24kHz 单声道 PCM，不能使用 SDK 默认格式。
        auto config = EmbeddedSpeechConfig::FromPath(args.model);
        config->SetSpeechSynthesisOutputFormat(SpeechSynthesisOutputFormat::Riff24Khz16BitMonoPcm);

        std::string voice = args.voice;
        if (voice.empty()) {
            auto probe = SpeechSynthesizer::FromConfig(config, nullptr);
            auto voices = probe->GetVoicesAsync().get();
            if (voices->Reason == ResultReason::VoicesListRetrieved && !voices->Voices.empty()) {
                voice = voices->Voices[0]->Name;
            }
        }
        if (!voice.empty()) config->SetSpeechSynthesisVoice(voice, args.license);

        auto synthesizer = SpeechSynthesizer::FromConfig(config, nullptr);
        auto result = synthesize(synthesizer, args);
        if (result->Reason != ResultReason::SynthesizingAudioCompleted) {
            std::cerr << "合成失败: Reason=" << static_cast<int>(result->Reason) << "\n";
            auto cancellation = SpeechSynthesisCancellationDetails::FromResult(result);
            if (cancellation) {
                std::cerr << "错误码=" << static_cast<int>(cancellation->Reason)
                          << " 详情=" << cancellation->ErrorDetails << "\n";
            }
            return 1;
        }

        const auto audio = result->GetAudioData();
        std::ofstream output(args.out, std::ios::binary | std::ios::trunc);
        if (!output) {
            std::cerr << "无法写入输出文件: " << args.out << "\n";
            return 1;
        }
        output.write(reinterpret_cast<const char*>(audio->data()),
                     static_cast<std::streamsize>(audio->size()));
        if (!output) {
            std::cerr << "输出文件写入失败: " << args.out << "\n";
            return 1;
        }
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Linux TTS 异常: " << error.what() << "\n";
        return 1;
    }
}
