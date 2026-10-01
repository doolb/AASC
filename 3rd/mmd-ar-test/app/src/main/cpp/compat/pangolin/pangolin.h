#pragma once
// APK关闭桌面Viewer，保留上游头文件所需的类型，不创建OpenGL窗口。
namespace pangolin { struct OpenGlMatrix { double m[16]{}; }; }

using GLubyte = unsigned char;
