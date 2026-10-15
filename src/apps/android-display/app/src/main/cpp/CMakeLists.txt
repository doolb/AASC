cmake_minimum_required(VERSION 3.22.1)

project(aasc_android_native)

add_library(cpu_affinity SHARED cpu_affinity.cpp)
target_link_libraries(cpu_affinity log)

# 默认使用 Git 内置、固定 revision 的 MNN 自包含预编译包。
# 显式源码构建时仍可通过 AASC_MNN_ROOT 指向官方 MNN checkout。
# 缺少库、头文件或 bridge 源文件时直接失败，禁止生成没有本地 LLM 能力的 APK。
set(AASC_MNN_ROOT "" CACHE PATH "Alibaba MNN checkout root")
set(AASC_MNN_REVISION "" CACHE STRING "Alibaba MNN revision")
set(AASC_MNN_APP_ROOT "${AASC_MNN_ROOT}/apps/Android/MnnLlmChat/app/src/main/cpp")
set(AASC_MNN_INSTALL_ROOT "${AASC_MNN_ROOT}/project/android/build_64")
set(AASC_MNN_LIBRARY "${AASC_MNN_INSTALL_ROOT}/lib/libMNN.so")
set(AASC_MNN_PACKAGE_MANIFEST "${AASC_MNN_ROOT}/manifest.json")

if(NOT AASC_MNN_ROOT)
    message(FATAL_ERROR "AASC_MNN_ROOT 未配置；请先设置 AASC_MNN_REVISION 并运行 npm run prepare:mnnllm-android")
endif()

if(EXISTS "${AASC_MNN_PACKAGE_MANIFEST}")
    if(NOT AASC_MNN_REVISION)
        message(FATAL_ERROR "AASC_MNN_REVISION 未配置，无法验证预编译包 revision")
    endif()
    file(READ "${AASC_MNN_PACKAGE_MANIFEST}" AASC_MNN_PACKAGE_JSON)
    string(JSON AASC_MNN_PACKAGE_SCHEMA ERROR_VARIABLE AASC_MNN_SCHEMA_ERROR GET "${AASC_MNN_PACKAGE_JSON}" schemaVersion)
    if(AASC_MNN_SCHEMA_ERROR OR NOT AASC_MNN_PACKAGE_SCHEMA EQUAL 1)
        message(FATAL_ERROR "MNN 预编译包清单 schemaVersion 不受支持")
    endif()
    string(JSON AASC_MNN_PACKAGE_REVISION ERROR_VARIABLE AASC_MNN_JSON_ERROR GET "${AASC_MNN_PACKAGE_JSON}" revision)
    if(AASC_MNN_JSON_ERROR OR NOT "${AASC_MNN_PACKAGE_REVISION}" STREQUAL "${AASC_MNN_REVISION}")
        message(FATAL_ERROR "MNN 预编译包 revision 不匹配: 期望 ${AASC_MNN_REVISION}，实际 ${AASC_MNN_PACKAGE_REVISION}")
    endif()
    string(JSON AASC_MNN_PACKAGE_ABI ERROR_VARIABLE AASC_MNN_ABI_ERROR GET "${AASC_MNN_PACKAGE_JSON}" abi)
    if(AASC_MNN_ABI_ERROR OR NOT "${AASC_MNN_PACKAGE_ABI}" STREQUAL "arm64-v8a")
        message(FATAL_ERROR "MNN 预编译包 ABI 不匹配: 期望 arm64-v8a，实际 ${AASC_MNN_PACKAGE_ABI}")
    endif()
    string(JSON AASC_MNN_PACKAGE_LIBRARY_PATH ERROR_VARIABLE AASC_MNN_LIBRARY_PATH_ERROR GET "${AASC_MNN_PACKAGE_JSON}" library path)
    string(JSON AASC_MNN_PACKAGE_LIBRARY_SIZE ERROR_VARIABLE AASC_MNN_LIBRARY_SIZE_ERROR GET "${AASC_MNN_PACKAGE_JSON}" library size)
    string(JSON AASC_MNN_PACKAGE_LIBRARY_SHA256 ERROR_VARIABLE AASC_MNN_LIBRARY_SHA_ERROR GET "${AASC_MNN_PACKAGE_JSON}" library sha256)
    if(AASC_MNN_LIBRARY_PATH_ERROR OR AASC_MNN_LIBRARY_SIZE_ERROR OR AASC_MNN_LIBRARY_SHA_ERROR)
        message(FATAL_ERROR "MNN 预编译包清单缺少库路径、大小或 SHA-256")
    endif()
    if(NOT "${AASC_MNN_PACKAGE_LIBRARY_PATH}" STREQUAL "project/android/build_64/lib/libMNN.so")
        message(FATAL_ERROR "MNN 预编译包清单指定了不支持的库路径: ${AASC_MNN_PACKAGE_LIBRARY_PATH}")
    endif()
    if(NOT EXISTS "${AASC_MNN_LIBRARY}")
        message(FATAL_ERROR "MNN 预编译包缺少 libMNN.so: ${AASC_MNN_LIBRARY}")
    endif()
    file(SIZE "${AASC_MNN_LIBRARY}" AASC_MNN_ACTUAL_LIBRARY_SIZE)
    file(SHA256 "${AASC_MNN_LIBRARY}" AASC_MNN_ACTUAL_LIBRARY_SHA256)
    if(NOT "${AASC_MNN_PACKAGE_LIBRARY_SIZE}" STREQUAL "${AASC_MNN_ACTUAL_LIBRARY_SIZE}"
       OR NOT "${AASC_MNN_PACKAGE_LIBRARY_SHA256}" STREQUAL "${AASC_MNN_ACTUAL_LIBRARY_SHA256}")
        message(FATAL_ERROR "libMNN.so 与预编译包清单大小或 SHA-256 不一致")
    endif()
endif()

foreach(required_path
    "${AASC_MNN_LIBRARY}"
    "${AASC_MNN_APP_ROOT}/llm_session.cpp"
    "${AASC_MNN_APP_ROOT}/processor.cpp"
    "${AASC_MNN_APP_ROOT}/video/video_decoder.cpp"
    "${AASC_MNN_APP_ROOT}/video/byte_buffer_decoder.cpp"
    "${AASC_MNN_APP_ROOT}/video/image_utils.cpp"
    "${AASC_MNN_APP_ROOT}/video/video_processor.cpp"
    "${AASC_MNN_ROOT}/include"
    "${AASC_MNN_ROOT}/transformers/llm/engine/include"
    "${AASC_MNN_ROOT}/tools/audio/include"
    "${AASC_MNN_ROOT}/tools/cv/include"
    "${AASC_MNN_ROOT}/3rd_party"
    "${AASC_MNN_APP_ROOT}/third_party")
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
