#include "Viewer.h"
#include "MapDrawer.h"
#include "MLPnPsolver.h"
// 保留跟踪器所需的相机姿态存储，桌面绘图入口在APK中不启用。
namespace ORB_SLAM3 {
// 上游声明了析构函数却未定义；候选求解器改为RAII后需释放其标准容器成员。
MLPnPsolver::~MLPnPsolver() = default;
MapDrawer::MapDrawer(Atlas* atlas, const std::string&, Settings*) : mpAtlas(atlas) {}
void MapDrawer::SetCurrentCameraPose(const Sophus::SE3f& pose) {
    std::lock_guard<std::mutex> lock(mMutexCamera); mCameraPose = pose;
}
void MapDrawer::SetReferenceKeyFrame(KeyFrame*) {}
Viewer::Viewer(System*, FrameDrawer*, MapDrawer*, Tracking*, const std::string&, Settings*) {}
void Viewer::Run() {}
void Viewer::RequestFinish() {}
void Viewer::RequestStop() {}
bool Viewer::isFinished() { return true; }
bool Viewer::isStopped() { return true; }
bool Viewer::isStepByStep() { return false; }
void Viewer::Release() {}
}
