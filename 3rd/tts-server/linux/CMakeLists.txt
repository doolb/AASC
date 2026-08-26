cmake_minimum_required(VERSION 3.16)
project(tts_linux CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 不把构建机上的 SDK 绝对路径写入可执行文件，便于将二进制和 SDK 一起迁移。
set(CMAKE_SKIP_BUILD_RPATH TRUE)
set(CMAKE_INSTALL_RPATH "$ORIGIN/../lib")
set(CMAKE_BUILD_WITH_INSTALL_RPATH TRUE)

# 通过 -DSPEECH_SDK_DIR 指向独立部署的 Linux Embedded Speech SDK。
set(SPEECH_SDK_DIR "" CACHE PATH "Linux Embedded Speech SDK root")
if(NOT SPEECH_SDK_DIR)
    message(FATAL_ERROR "请用 -DSPEECH_SDK_DIR=<SDK目录> 指定 Linux Embedded Speech SDK")
endif()

add_executable(tts_linux src/tts_linux.cpp)

target_include_directories(tts_linux PRIVATE
    "${SPEECH_SDK_DIR}/include"
    "${SPEECH_SDK_DIR}/include/cxx_api"
    "${SPEECH_SDK_DIR}/include/c_api"
)

target_link_directories(tts_linux PRIVATE "${SPEECH_SDK_DIR}/lib/x64")
target_link_libraries(tts_linux PRIVATE
    Microsoft.CognitiveServices.Speech.core
    pthread
    ${CMAKE_DL_LIBS}
)

# 生成可直接迁移的 linux/bin + linux/lib 布局；SDK 源目录仍由部署方管理，不写入安装包之外的绝对路径。
install(TARGETS tts_linux
    RUNTIME DESTINATION bin
)
install(DIRECTORY "${SPEECH_SDK_DIR}/lib/x64/"
    DESTINATION lib
    FILES_MATCHING
    PATTERN "*.so"
    PATTERN "*.so.*"
)
