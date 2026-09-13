cmake_minimum_required(VERSION 3.22.1)

project(aasc_android_native)

add_library(cpu_affinity SHARED cpu_affinity.cpp)
target_link_libraries(cpu_affinity log)

# MNN 官方源码由 npm run prepare:mnnllm-android 生成到构建机缓存，不提交到 AASC。
# 设置 AASC_MNN_ROOT 后复用官方 MnnLlmChat 的 LlmSession/processor 实现。
# 缺少官方依赖时直接失败，禁止生成没有本地 LLM 能力的 APK。
set(AASC_MNN_ROOT "" CACHE PATH "Alibaba MNN checkout root")
set(AASC_MNN_APP_ROOT "${AASC_MNN_ROOT}/apps/Android/MnnLlmChat/app/src/main/cpp")
set(AASC_MNN_INSTALL_ROOT "${AASC_MNN_ROOT}/project/android/build_64")
set(AASC_MNN_LIBRARY "${AASC_MNN_INSTALL_ROOT}/lib/libMNN.so")

if(NOT AASC_MNN_ROOT)
    message(FATAL_ERROR "AASC_MNN_ROOT 未配置；请先设置 AASC_MNN_REVISION 并运行 npm run prepare:mnnllm-android")
endif()

foreach(required_path
    "${AASC_MNN_LIBRARY}"
    "${AASC_MNN_APP_ROOT}/llm_session.cpp"
    "${AASC_MNN_APP_ROOT}/processor.cpp")
    if(NOT EXISTS "${required_path}")
        message(FATAL_ERROR "官方 MNN-LLM 构建产物缺失: ${required_path}")
    endif()
endforeach()

add_library(mnn_llm_bridge SHARED
        aasc_mnn_jni.cpp
        "${AASC_MNN_APP_ROOT}/llm_session.cpp"
        "${AASC_MNN_APP_ROOT}/processor.cpp"
        "${AASC_MNN_APP_ROOT}/video/video_decoder.cpp"
        "${AASC_MNN_APP_ROOT}/video/byte_buffer_decoder.cpp"
        "${AASC_MNN_APP_ROOT}/video/image_utils.cpp"
    "${AASC_MNN_APP_ROOT}/video/video_processor.cpp"
)
add_library(mnn_runtime SHARED IMPORTED GLOBAL)
set_target_properties(mnn_runtime PROPERTIES
    IMPORTED_LOCATION "${AASC_MNN_LIBRARY}"
)
    target_include_directories(mnn_llm_bridge PRIVATE
        "${AASC_MNN_ROOT}/include"
        "${AASC_MNN_ROOT}/transformers/llm/engine/include"
        "${AASC_MNN_ROOT}/tools/audio/include"
        "${AASC_MNN_ROOT}/tools/cv/include"
        "${AASC_MNN_ROOT}/3rd_party"
        "${AASC_MNN_APP_ROOT}"
        "${AASC_MNN_APP_ROOT}/third_party"
        "${AASC_MNN_APP_ROOT}/video"
    )
    target_compile_definitions(mnn_llm_bridge PRIVATE
        AASC_MNN_OFFICIAL=1
        LLM_SUPPORT_VISION=1
        MNN_BUILD_OPENCV=1
        MNN_IMGCODECS=1
    )
    target_link_libraries(mnn_llm_bridge
        android
        log
        mnn_runtime
        mediandk
    )

target_link_options(mnn_llm_bridge PRIVATE "-Wl,-z,max-page-size=16384")
