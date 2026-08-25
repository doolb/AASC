// Resident Embedded TTS worker for Wine.
//
// Protocol (line-delimited, tab-separated; binary/Unicode fields are base64):
//   L\t<id>
//   S\t<id>\t<base64 text>\t<base64 voice>\t<speed>
//   L\t<id>\t<ok>\t<base64 newline-joined voices>\t<base64 error>
//   S\t<id>\t<ok>\t<base64 wav>\t<base64 error>

#include <speechapi_c.h>

#include <windows.h>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#ifndef ResultReason_VoicesListRetrieved
#define ResultReason_VoicesListRetrieved 23
#endif

#define SpeechServiceResponse_RequestSentenceBoundary 4202
#define SpeechServiceResponse_RequestPunctuationBoundary 4201
#define CancellationDetails_ReasonText 6001
#define CancellationDetails_ReasonDetailedText 6002

static std::string g_license = "Key:";

static std::vector<std::string> split_tabs(const std::string& line)
{
    std::vector<std::string> parts;
    std::size_t start = 0;
    while (true)
    {
        std::size_t end = line.find('\t', start);
        if (end == std::string::npos)
        {
            parts.push_back(line.substr(start));
            break;
        }
        parts.push_back(line.substr(start, end - start));
        start = end + 1;
    }
    return parts;
}

static std::string to_lower(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return value;
}

static const char k_base64_chars[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string base64_encode(const std::vector<uint8_t>& data)
{
    std::string out;
    out.reserve(((data.size() + 2) / 3) * 4);
    for (std::size_t i = 0; i < data.size(); i += 3)
    {
        uint32_t n = static_cast<uint32_t>(data[i]) << 16;
        if (i + 1 < data.size()) n |= static_cast<uint32_t>(data[i + 1]) << 8;
        if (i + 2 < data.size()) n |= static_cast<uint32_t>(data[i + 2]);
        out.push_back(k_base64_chars[(n >> 18) & 63]);
        out.push_back(k_base64_chars[(n >> 12) & 63]);
        out.push_back(i + 1 < data.size() ? k_base64_chars[(n >> 6) & 63] : '=');
        out.push_back(i + 2 < data.size() ? k_base64_chars[n & 63] : '=');
    }
    return out;
}

static int base64_value(char c)
{
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

static bool base64_decode(const std::string& input, std::vector<uint8_t>& output)
{
    output.clear();
    uint32_t buffer = 0;
    int bits = 0;
    for (char c : input)
    {
        if (c == '\r' || c == '\n') continue;
        if (c == '=') break;
        int value = base64_value(c);
        if (value < 0) return false;
        buffer = (buffer << 6) | static_cast<uint32_t>(value);
        bits += 6;
        if (bits >= 8)
        {
            bits -= 8;
            output.push_back(static_cast<uint8_t>((buffer >> bits) & 0xff));
        }
    }
    return true;
}

static std::string escape_xml(const std::string& value)
{
    std::string out;
    out.reserve(value.size());
    for (char c : value)
    {
        switch (c)
        {
        case '&': out += "&amp;"; break;
        case '<': out += "&lt;"; break;
        case '>': out += "&gt;"; break;
        case '"': out += "&quot;"; break;
        case '\'': out += "&apos;"; break;
        default: out.push_back(c); break;
        }
    }
    return out;
}

static std::string build_ssml(const std::string& text, const std::string& voice, int speed)
{
    char rate[64];
    std::snprintf(rate, sizeof(rate), "%+.2f%%", static_cast<double>(speed) * 10.0);
    std::ostringstream ssml;
    ssml << "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"zh-CN\">"
         << "<voice name=\"" << escape_xml(voice) << "\">"
         << "<prosody rate=\"" << rate << "\">"
         << escape_xml(text)
         << "</prosody></voice></speak>";
    return ssml.str();
}

static std::string property_text(SPXPROPERTYBAGHANDLE bag, int id)
{
    const char* value = property_bag_get_string(bag, id, NULL, "");
    std::string out = value ? value : "";
    if (value) property_bag_free_string(value);
    return out;
}

static std::string synth_error(SPXRESULTHANDLE hresult)
{
    SPXPROPERTYBAGHANDLE bag = NULL;
    std::string out;
    if (AZAC_SUCCEEDED(synth_result_get_property_bag(hresult, &bag)) && bag)
    {
        out = property_text(bag, CancellationDetails_ReasonText);
        std::string details = property_text(bag, CancellationDetails_ReasonDetailedText);
        if (!details.empty())
        {
            if (!out.empty()) out += ": ";
            out += details;
        }
        property_bag_release(bag);
    }
    return out.empty() ? "synthesis failed" : out;
}

static std::string voices_error(SPXRESULTHANDLE hresult)
{
    SPXPROPERTYBAGHANDLE bag = NULL;
    std::string out;
    if (AZAC_SUCCEEDED(synthesis_voices_result_get_property_bag(hresult, &bag)) && bag)
    {
        out = property_text(bag, CancellationDetails_ReasonText);
        std::string details = property_text(bag, CancellationDetails_ReasonDetailedText);
        if (!details.empty())
        {
            if (!out.empty()) out += ": ";
            out += details;
        }
        property_bag_release(bag);
    }
    return out.empty() ? "voices list failed" : out;
}

static std::string pick_voice(const std::vector<std::string>& voices, const std::string& requested)
{
    if (requested.empty()) return voices.empty() ? "" : voices.front();
    for (const std::string& voice : voices)
        if (voice == requested) return voice;
    std::string lower_requested = to_lower(requested);
    for (const std::string& voice : voices)
        if (to_lower(voice).find(lower_requested) != std::string::npos) return voice;
    return requested;
}

static void respond(const std::string& kind, const std::string& id, bool ok,
                    const std::string& data, const std::string& error)
{
    std::cout << kind << '\t' << id << '\t' << (ok ? '1' : '0')
              << '\t' << data << '\t' << error << '\n';
    std::cout.flush();
}

static bool synthesize(SPXSPEECHCONFIGHANDLE hconfig,
                       const std::vector<std::string>& voices,
                       const std::string& text,
                       const std::string& requested_voice,
                       int speed,
                       std::vector<uint8_t>& audio,
                       std::string& error)
{
    std::string voice = pick_voice(voices, requested_voice);
    if (voice.empty())
    {
        error = "no embedded voices available";
        return false;
    }

    AZACHR hr = embedded_speech_config_set_speech_synthesis_voice(
        hconfig, voice.c_str(), g_license.c_str());
    if (AZAC_FAILED(hr))
    {
        char buf[160];
        std::snprintf(buf, sizeof(buf), "set voice failed (hr=0x%llx)", (unsigned long long)hr);
        error = buf;
        return false;
    }

    SPXSYNTHHANDLE hsynth = NULL;
    hr = synthesizer_create_speech_synthesizer_from_config(&hsynth, hconfig, NULL);
    if (AZAC_FAILED(hr))
    {
        char buf[160];
        std::snprintf(buf, sizeof(buf), "create synthesizer failed (hr=0x%llx)", (unsigned long long)hr);
        error = buf;
        return false;
    }

    std::string ssml = build_ssml(text, voice, speed);
    SPXRESULTHANDLE hresult = NULL;
    hr = synthesizer_speak_ssml(hsynth, ssml.c_str(), (uint32_t)ssml.size(), &hresult);
    if (AZAC_FAILED(hr))
    {
        char buf[160];
        std::snprintf(buf, sizeof(buf), "speak failed (hr=0x%llx)", (unsigned long long)hr);
        error = buf;
        synthesizer_handle_release(hsynth);
        return false;
    }

    Result_Reason reason = ResultReason_NoMatch;
    hr = synth_result_get_reason(hresult, &reason);
    if (AZAC_FAILED(hr) || reason != ResultReason_SynthesizingAudioComplete)
    {
        error = synth_error(hresult);
        synthesizer_result_handle_release(hresult);
        synthesizer_handle_release(hsynth);
        return false;
    }

    uint32_t audio_length = 0;
    uint64_t audio_duration = 0;
    hr = synth_result_get_audio_length_duration(hresult, &audio_length, &audio_duration);
    if (AZAC_SUCCEEDED(hr) && audio_length > 0)
    {
        audio.resize(audio_length);
        uint32_t filled = 0;
        hr = synth_result_get_audio_data(hresult, audio.data(), audio_length, &filled);
        if (AZAC_FAILED(hr))
        {
            audio.clear();
            char buf[160];
            std::snprintf(buf, sizeof(buf), "get audio failed (hr=0x%llx)", (unsigned long long)hr);
            error = buf;
            synthesizer_result_handle_release(hresult);
            synthesizer_handle_release(hsynth);
            return false;
        }
        audio.resize(filled);
    }

    synthesizer_result_handle_release(hresult);
    synthesizer_handle_release(hsynth);
    return true;
}

static bool load_voices(SPXSPEECHCONFIGHANDLE hconfig, std::vector<std::string>& voices,
                        std::string& error)
{
    SPXSYNTHHANDLE hsynth = NULL;
    AZACHR hr = synthesizer_create_speech_synthesizer_from_config(&hsynth, hconfig, NULL);
    if (AZAC_FAILED(hr))
    {
        char buf[160];
        std::snprintf(buf, sizeof(buf), "create synthesizer failed (hr=0x%llx)", (unsigned long long)hr);
        error = buf;
        return false;
    }

    SPXRESULTHANDLE hvoices = NULL;
    hr = synthesizer_get_voices_list(hsynth, "", &hvoices);
    if (AZAC_FAILED(hr))
    {
        char buf[160];
        std::snprintf(buf, sizeof(buf), "voices list failed (hr=0x%llx)", (unsigned long long)hr);
        error = buf;
        synthesizer_handle_release(hsynth);
        return false;
    }

    Result_Reason reason = ResultReason_NoMatch;
    hr = synthesis_voices_result_get_reason(hvoices, &reason);
    if (AZAC_FAILED(hr) || reason != ResultReason_VoicesListRetrieved)
    {
        error = voices_error(hvoices);
        synthesizer_result_handle_release(hvoices);
        synthesizer_handle_release(hsynth);
        return false;
    }

    uint32_t count = 0;
    hr = synthesis_voices_result_get_voice_num(hvoices, &count);
    if (AZAC_FAILED(hr) || count == 0)
    {
        error = "no embedded voices found";
        synthesizer_result_handle_release(hvoices);
        synthesizer_handle_release(hsynth);
        return false;
    }

    voices.clear();
    voices.reserve(count);
    for (uint32_t i = 0; i < count; ++i)
    {
        SPXRESULTHANDLE hvoice = NULL;
        hr = synthesis_voices_result_get_voice_info(hvoices, i, &hvoice);
        if (AZAC_FAILED(hr) || !hvoice) continue;
        const char* name = voice_info_get_name(hvoice);
        if (name && *name) voices.push_back(name);
        voice_info_handle_release(hvoice);
    }

    synthesizer_result_handle_release(hvoices);
    synthesizer_handle_release(hsynth);

    if (voices.empty())
    {
        error = "no embedded voice names found";
        return false;
    }
    return true;
}

static void fail_init(const char* what, AZACHR hr)
{
    std::cerr << what << " failed (hr=0x" << std::hex << (unsigned long long)hr
              << std::dec << ")\n";
}

int main(int argc, char* argv[])
{
    std::string model_path;
    for (int i = 1; i < argc; ++i)
    {
        std::string key = argv[i];
        std::string value = (i + 1 < argc) ? argv[++i] : "";
        if (key == "--model") model_path = value;
        else if (key == "--license") g_license = value;
        else
        {
            std::cerr << "unknown argument: " << key << "\n";
            return 2;
        }
    }

    if (model_path.empty())
    {
        std::cerr << "--model is required\n";
        return 2;
    }

    HRESULT co = CoInitializeEx(NULL, COINIT_MULTITHREADED);
    if (co != S_OK && co != S_FALSE && co != RPC_E_CHANGED_MODE)
    {
        std::cerr << "CoInitializeEx failed: 0x" << std::hex << (unsigned long)co << "\n";
        return 1;
    }

    SPXSPEECHCONFIGHANDLE hconfig = NULL;
    AZACHR hr = embedded_speech_config_create(&hconfig);
    if (AZAC_FAILED(hr))
    {
        fail_init("embedded_speech_config_create", hr);
        CoUninitialize();
        return 1;
    }

    hr = embedded_speech_config_add_path(hconfig, model_path.c_str());
    if (AZAC_FAILED(hr))
    {
        std::cerr << "model: " << model_path << "\n";
        fail_init("embedded_speech_config_add_path", hr);
        speech_config_release(hconfig);
        CoUninitialize();
        return 1;
    }

    hr = speech_config_set_audio_output_format(
        hconfig, SpeechSynthesisOutputFormat_Riff24Khz16BitMonoPcm);
    if (AZAC_FAILED(hr))
    {
        fail_init("speech_config_set_audio_output_format", hr);
        speech_config_release(hconfig);
        CoUninitialize();
        return 1;
    }

    SPXPROPERTYBAGHANDLE hbag = NULL;
    hr = speech_config_get_property_bag(hconfig, &hbag);
    if (AZAC_FAILED(hr))
    {
        fail_init("speech_config_get_property_bag", hr);
        speech_config_release(hconfig);
        CoUninitialize();
        return 1;
    }
    property_bag_set_string(hbag, SpeechServiceResponse_RequestSentenceBoundary, NULL, "true");
    property_bag_set_string(hbag, SpeechServiceResponse_RequestPunctuationBoundary, NULL, "false");
    property_bag_release(hbag);

    std::vector<std::string> voices;
    std::string init_error;
    if (!load_voices(hconfig, voices, init_error))
    {
        std::cerr << init_error << "\n";
        speech_config_release(hconfig);
        CoUninitialize();
        return 1;
    }

    std::cout << "READY\n";
    std::cout.flush();

    std::string line;
    while (std::getline(std::cin, line))
    {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue;

        std::vector<std::string> parts = split_tabs(line);
        if (parts.size() < 2)
        {
            std::cerr << "malformed request\n";
            continue;
        }

        std::string id = parts[1];
        if (parts[0] == "L")
        {
            std::string joined;
            for (std::size_t i = 0; i < voices.size(); ++i)
            {
                if (i) joined.push_back('\n');
                joined += voices[i];
            }
            std::vector<uint8_t> bytes(joined.begin(), joined.end());
            respond("L", id, true, base64_encode(bytes), "");
            continue;
        }

        if (parts[0] == "S")
        {
            if (parts.size() < 5)
            {
                std::string error = "malformed synthesize request";
                respond("S", id, false, "", base64_encode(
                    std::vector<uint8_t>(error.begin(), error.end())));
                continue;
            }

            std::vector<uint8_t> text_bytes;
            std::vector<uint8_t> voice_bytes;
            if (!base64_decode(parts[2], text_bytes) ||
                !base64_decode(parts[3], voice_bytes))
            {
                std::string error = "invalid base64 field";
                respond("S", id, false, "", base64_encode(
                    std::vector<uint8_t>(error.begin(), error.end())));
                continue;
            }

            std::string text(text_bytes.begin(), text_bytes.end());
            std::string voice(voice_bytes.begin(), voice_bytes.end());
            int speed = 0;
            try
            {
                speed = std::stoi(parts[4]);
            }
            catch (...)
            {
                speed = 0;
            }
            speed = std::max(-10, std::min(10, speed));

            std::vector<uint8_t> audio;
            std::string error;
            if (synthesize(hconfig, voices, text, voice, speed, audio, error))
            {
                respond("S", id, true, base64_encode(audio), "");
            }
            else
            {
                respond("S", id, false, "", base64_encode(
                    std::vector<uint8_t>(error.begin(), error.end())));
            }
            continue;
        }

        std::cerr << "unknown request: " << parts[0] << "\n";
    }

    speech_config_release(hconfig);
    CoUninitialize();
    return 0;
}
