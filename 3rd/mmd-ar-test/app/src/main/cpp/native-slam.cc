#include "System.h"
#include "Map.h"
#include "KeyFrame.h"
#include "MapPoint.h"
#include <jni.h>
#include <opencv2/calib3d.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <Eigen/SVD>
#include <array>
#include <algorithm>
#include <memory>
#include <thread>
#include "CameraModels/Pinhole.h"
#include "CameraModels/KannalaBrandt8.h"
#include "android-ownership.h"

namespace ORB_SLAM3 {
// 上游System没有析构回收入口，所有跟踪/优化线程停止后才释放共享地图。
void DestroyAndroidSystem(System* system) {
    if (!system) return;
    system->Shutdown();
    if (system->mptLocalMapping->joinable()) system->mptLocalMapping->join();
    if (system->mptLoopClosing->joinable()) system->mptLoopClosing->join();
    {
        std::lock_guard<std::mutex> lock(system->mpLoopCloser->mMutexGBA);
        system->mpLoopCloser->mbStopGBA = true;
    }
    if (system->mpLoopCloser->mpThreadGBA) {
        if (system->mpLoopCloser->mpThreadGBA->joinable()) system->mpLoopCloser->mpThreadGBA->join();
        delete system->mpLoopCloser->mpThreadGBA;
    }
    delete system->mptLocalMapping;
    delete system->mptLoopClosing;
    delete system->mpTracker;
    delete system->mpLocalMapper;
    delete system->mpLoopCloser;
    delete system->mpFrameDrawer;
    delete system->mpMapDrawer;
    delete system->mpKeyFrameDatabase;
    aasc_slam::releaseOwned<KeyFrame>();
    aasc_slam::releaseOwned<MapPoint>();
    delete system->mpAtlas;
    aasc_slam::releaseOwned<Map>();
    aasc_slam::releaseOwned<IMU::Preintegrated>();
    aasc_slam::releaseOwned<Pinhole>();
    aasc_slam::releaseOwned<KannalaBrandt8>();
    delete system->mpVocabulary;
    delete system->settings_;
    delete system;
}
}

namespace {
std::string stringValue(JNIEnv* env, jstring value) {
    if (!value) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string result(chars); env->ReleaseStringUTFChars(value, chars); return result;
}
void fail(JNIEnv* env, const std::exception& error) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error.what());
}
struct Observation { Eigen::Vector3f slam, target; Eigen::Matrix3f rotation; };
std::mutex sessionMutex;
struct Session {
    // 多个Activity重建时也必须等待前一会话回收，登记表不混用。
    std::unique_lock<std::mutex> ownershipLock{sessionMutex};
    ORB_SLAM3::System* system = nullptr;
    cv::Mat intrinsics, distortion, referenceDescriptors;
    std::vector<cv::KeyPoint> referencePoints;
    cv::Ptr<cv::ORB> detector = cv::ORB::create(1600);
    std::vector<Observation> observations;
    std::vector<std::pair<ORB_SLAM3::MapPoint*, float>> scalePoints;
    ORB_SLAM3::KeyFrame* referenceKeyFrame = nullptr;
    ORB_SLAM3::Map* observedMap = nullptr;
    Eigen::Matrix4f targetToKeyFrame = Eigen::Matrix4f::Identity();
    float scale = 1, referenceWidth = 1, referenceHeight = 1;
    int imageMatches = 0;
    bool anchored = false, inertial = false;
    double lastTimestamp = -1;
    ~Session() { ORB_SLAM3::DestroyAndroidSystem(system); }

    void clearAnchor() { anchored = false; referenceKeyFrame = nullptr; observations.clear(); scalePoints.clear(); }

    bool findTarget(const cv::Mat& frame, Eigen::Matrix4f& targetToCamera) {
        std::vector<cv::KeyPoint> points;
        cv::Mat descriptors;
        detector->detectAndCompute(frame, cv::noArray(), points, descriptors);
        imageMatches = 0;
        if (descriptors.empty()) return false;
        std::vector<std::vector<cv::DMatch>> matches;
        cv::BFMatcher(cv::NORM_HAMMING).knnMatch(referenceDescriptors, descriptors, matches, 2);
        std::vector<cv::Point2f> source, destination;
        for (auto& pair : matches) {
            if (pair.size() != 2 || pair[0].distance >= .72f * pair[1].distance) continue;
            source.push_back(referencePoints[pair[0].queryIdx].pt);
            destination.push_back(points[pair[0].trainIdx].pt);
        }
        if (source.size() < 18) return false;
        cv::Mat mask;
        cv::Mat homography = cv::findHomography(source, destination, cv::RANSAC, 3, mask);
        if (homography.empty()) return false;
        std::vector<cv::Point3f> object;
        std::vector<cv::Point2f> image;
        for (size_t i = 0; i < source.size(); ++i) {
            if (!mask.at<uchar>(static_cast<int>(i))) continue;
            object.emplace_back(source[i].x / referenceWidth - .5f,
                (source[i].y / referenceHeight - .5f) * referenceHeight / referenceWidth, 0);
            image.push_back(destination[i]);
        }
        imageMatches = static_cast<int>(image.size());
        if (imageMatches < 16 || imageMatches < static_cast<int>(source.size() * .5)) return false;
        cv::Mat rvec, tvec, inliers;
        if (!cv::solvePnPRansac(object, image, intrinsics, distortion, rvec, tvec, false,
                100, 3, .99, inliers, cv::SOLVEPNP_ITERATIVE) || inliers.rows < 14) return false;
        cv::Mat rotation;
        cv::Rodrigues(rvec, rotation);
        if (!cv::checkRange(rotation) || !cv::checkRange(tvec) || tvec.at<double>(2) <= 0) return false;
        targetToCamera.setIdentity();
        for (int row = 0; row < 3; ++row) {
            targetToCamera(row, 3) = static_cast<float>(tvec.at<double>(row));
            for (int column = 0; column < 3; ++column)
                targetToCamera(row, column) = static_cast<float>(rotation.at<double>(row, column));
        }
        return true;
    }

    float currentScale() const {
        if (!referenceKeyFrame) return scale;
        std::vector<float> ratios;
        const Sophus::SE3f pose = referenceKeyFrame->GetPose();
        for (auto& [point, initialDistance] : scalePoints) {
            if (point->isBad() || point->GetMap() != observedMap) continue;
            float distance = (pose * point->GetWorldPos()).norm();
            if (std::isfinite(distance) && distance > 1e-6f) ratios.push_back(initialDistance / distance);
        }
        if (ratios.size() < 10) return scale;
        auto middle = ratios.begin() + ratios.size()/2;
        std::nth_element(ratios.begin(), middle, ratios.end());
        return scale * *middle;
    }

    bool align(const Eigen::Matrix4f& cameraToSlam, const Eigen::Matrix4f& targetToCamera,
               ORB_SLAM3::Map* map) {
        Eigen::Matrix4f cameraToTarget = targetToCamera.inverse();
        Observation observation {cameraToSlam.block<3, 1>(0, 3), cameraToTarget.block<3, 1>(0, 3),
            cameraToTarget.block<3, 3>(0, 0) * cameraToSlam.block<3, 3>(0, 0).transpose()};
        if (!observations.empty() && (observation.target - observations.back().target).norm() < .01f) return false;
        observations.push_back(observation);
        if (observations.size() > 40) observations.erase(observations.begin());
        if (observations.size() < 5) return false;
        Eigen::Vector3f meanS = Eigen::Vector3f::Zero(), meanT = meanS;
        Eigen::Matrix3f rotationSum = Eigen::Matrix3f::Zero();
        for (auto& item : observations) { meanS += item.slam; meanT += item.target; rotationSum += item.rotation; }
        meanS /= observations.size(); meanT /= observations.size();
        Eigen::JacobiSVD<Eigen::Matrix3f> svd(rotationSum, Eigen::ComputeFullU | Eigen::ComputeFullV);
        Eigen::Matrix3f correction = Eigen::Matrix3f::Identity();
        correction(2, 2) = (svd.matrixU() * svd.matrixV().transpose()).determinant();
        Eigen::Matrix3f rotation = svd.matrixU() * correction * svd.matrixV().transpose();
        float numerator = 0, denominator = 0, targetSpread = 0;
        for (auto& item : observations) {
            Eigen::Vector3f x = item.slam - meanS, y = item.target - meanT;
            numerator += (rotation * x).dot(y); denominator += x.squaredNorm(); targetSpread += y.squaredNorm();
        }
        if (denominator < 1e-8f || targetSpread / observations.size() < .0025f) return false;
        float fittedScale = numerator / denominator;
        if (!std::isfinite(fittedScale) || fittedScale <= 0) return false;
        Eigen::Vector3f translation = meanT - fittedScale * rotation * meanS;
        float error = 0;
        for (auto& item : observations)
            error += (fittedScale * rotation * item.slam + translation - item.target).squaredNorm();
        if (std::sqrt(error / observations.size()) > .04f) { observations.erase(observations.begin()); return false; }
        ORB_SLAM3::KeyFrame* closest = nullptr;
        float distance = std::numeric_limits<float>::max();
        for (auto* keyframe : map->GetAllKeyFrames()) {
            if (keyframe->isBad()) continue;
            // 地图首帧不会被常规冗余关键帧剔除，锚定后无需因剔除近帧再次看图。
            if (keyframe->mnId == map->GetInitKFid()) { closest = keyframe; break; }
            float candidate = (keyframe->GetCameraCenter() - cameraToSlam.block<3, 1>(0, 3)).squaredNorm();
            if (candidate < distance) { distance = candidate; closest = keyframe; }
        }
        if (!closest) return false;
        Eigen::Matrix4f keyToSlam = closest->GetPoseInverse().matrix();
        Eigen::Matrix4f keyToTarget = Eigen::Matrix4f::Identity();
        keyToTarget.block<3, 3>(0, 0) = rotation * keyToSlam.block<3, 3>(0, 0);
        keyToTarget.block<3, 1>(0, 3) = fittedScale * rotation * keyToSlam.block<3, 1>(0, 3) + translation;
        targetToKeyFrame = keyToTarget.inverse();
        referenceKeyFrame = closest; scale = fittedScale; anchored = true;
        const Sophus::SE3f keyPose = closest->GetPose();
        for (auto* point : closest->GetMapPointMatches()) {
            if (!point || point->isBad()) continue;
            float distance = (keyPose * point->GetWorldPos()).norm();
            if (std::isfinite(distance) && distance > 1e-6f) scalePoints.emplace_back(point, distance);
        }
        return true;
    }
};
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_aasc_mmdartest_NativeSlamBindings_create(JNIEnv* env, jobject, jstring vocabulary,
        jstring settings, jstring target, jdoubleArray quad) {
    try {
        auto session = std::make_unique<Session>();
        cv::FileStorage config(stringValue(env, settings), cv::FileStorage::READ);
        if (!config.isOpened()) throw std::runtime_error("无法读取相机标定参数");
        session->intrinsics = (cv::Mat_<double>(3, 3) << double(config["Camera1.fx"]), 0, double(config["Camera1.cx"]),
            0, double(config["Camera1.fy"]), double(config["Camera1.cy"]), 0, 0, 1);
        session->distortion = (cv::Mat_<double>(1, 4) << double(config["Camera1.k1"]), double(config["Camera1.k2"]),
            double(config["Camera1.p1"]), double(config["Camera1.p2"]));
        session->inertial = int(config["AASC.inertial"]) == 1;
        cv::Mat image = cv::imread(stringValue(env, target), cv::IMREAD_GRAYSCALE);
        if (image.empty() || image.total() > 16000000) throw std::runtime_error("定位图无法读取或尺寸过大");
        if (quad && env->GetArrayLength(quad) == 8) {
            std::array<double, 8> values{};
            env->GetDoubleArrayRegion(quad, 0, 8, values.data());
            std::array<cv::Point2f, 4> corners;
            for (int i = 0; i < 4; ++i)
                corners[i] = {static_cast<float>(values[i*2] * image.cols), static_cast<float>(values[i*2+1] * image.rows)};
            float width = (cv::norm(corners[0]-corners[1]) + cv::norm(corners[2]-corners[3])) * .5f;
            float height = (cv::norm(corners[0]-corners[3]) + cv::norm(corners[1]-corners[2])) * .5f;
            if (width < 16 || height < 16) throw std::runtime_error("定位图框选区域过小");
            int w = std::min(960, static_cast<int>(width)), h = std::max(16, static_cast<int>(height*w/width));
            if (h > 1600) { w = std::max(16, w * 1600 / h); h = 1600; }
            std::array<cv::Point2f, 4> output{{{0,0}, {float(w),0}, {float(w),float(h)}, {0,float(h)}}};
            cv::Mat cropped;
            cv::warpPerspective(image, cropped, cv::getPerspectiveTransform(corners.data(), output.data()), {w,h});
            image = cropped;
        }
        session->referenceWidth = image.cols; session->referenceHeight = image.rows;
        session->detector->detectAndCompute(image, cv::noArray(), session->referencePoints, session->referenceDescriptors);
        if (session->referencePoints.size() < 24) throw std::runtime_error("定位图特征太少，请选细节丰富的图片");
        session->system = new ORB_SLAM3::System(stringValue(env, vocabulary), stringValue(env, settings),
            session->inertial ? ORB_SLAM3::System::IMU_MONOCULAR : ORB_SLAM3::System::MONOCULAR, false);
        return reinterpret_cast<jlong>(session.release());
    } catch (const std::exception& error) { fail(env, error); return 0; }
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_aasc_mmdartest_NativeSlamBindings_track(JNIEnv* env, jobject, jlong handle, jbyteArray bytes,
        jint width, jint height, jdouble timestamp, jdoubleArray imu) {
    try {
        auto* session = reinterpret_cast<Session*>(handle);
        if (!session || width <= 0 || height <= 0 || env->GetArrayLength(bytes) != width * height)
            throw std::runtime_error("相机帧或原生会话无效");
        if (timestamp <= session->lastTimestamp) return nullptr;
        session->lastTimestamp = timestamp;
        std::vector<uchar> pixels(width * height);
        env->GetByteArrayRegion(bytes, 0, pixels.size(), reinterpret_cast<jbyte*>(pixels.data()));
        cv::Mat image(height, width, CV_8UC1, pixels.data());
        std::vector<ORB_SLAM3::IMU::Point> measurements;
        if (session->inertial && imu) {
            std::vector<double> values(env->GetArrayLength(imu));
            env->GetDoubleArrayRegion(imu, 0, values.size(), values.data());
            for (size_t i = 0; i + 6 < values.size(); i += 7)
                measurements.emplace_back(values[i+1], values[i+2], values[i+3], values[i+4], values[i+5], values[i+6], values[i]);
        }
        Sophus::SE3f pose = session->system->TrackMonocular(image, timestamp, measurements);
        int state = session->system->GetTrackingState();
        ORB_SLAM3::Map* map = nullptr;
        int points = 0;
        for (auto* point : session->system->GetTrackedMapPoints()) {
            if (point && !point->isBad()) { ++points; if (!map) map = point->GetMap(); }
        }
        if (map && map != session->observedMap) { session->clearAnchor(); session->observedMap = map; }
        std::array<float, 23> output{};
        output[0] = state; output[1] = map ? map->GetId() : -1; output[3] = points;
        output[5] = session->inertial && map && map->isImuInitialized() ? 1 : 0;
        Eigen::Matrix4f cameraToSlam = pose.inverse().matrix(), targetToCamera = Eigen::Matrix4f::Identity();
        bool valid = false;
        if (state == 2 && cameraToSlam.allFinite() && map) {
            std::unique_lock<std::mutex> lock(map->mMutexMapUpdate);
            if (session->referenceKeyFrame && (session->referenceKeyFrame->isBad()
                    || session->referenceKeyFrame->GetMap() != map)) session->clearAnchor();
            if (!session->anchored && session->findTarget(image, targetToCamera)) {
                valid = true;
                if (!session->inertial || map->isImuInitialized())
                    session->align(cameraToSlam, targetToCamera, map);
            }
            if (session->anchored) {
                Eigen::Matrix4f currentFromKey = pose.matrix() * session->referenceKeyFrame->GetPoseInverse().matrix();
                currentFromKey.block<3, 1>(0, 3) *= session->currentScale();
                targetToCamera = currentFromKey * session->targetToKeyFrame;
                valid = true;
            }
        }
        output[2] = session->anchored ? 1 : 0; output[4] = session->imageMatches;
        output[6] = valid ? 1 : 0;
        if (valid) {
            // OpenCV相机/图面y向下、z向前，转换为Three相机/图面y向上、z向后。
            Eigen::Matrix4f flip = Eigen::Matrix4f::Identity(); flip(1,1) = -1; flip(2,2) = -1;
            Eigen::Matrix4f matrix = flip * targetToCamera * flip;
            for (int column = 0; column < 4; ++column)
                for (int row = 0; row < 4; ++row) output[7 + column*4 + row] = matrix(row,column);
        }
        jfloatArray result = env->NewFloatArray(output.size());
        env->SetFloatArrayRegion(result, 0, output.size(), output.data()); return result;
    } catch (const std::exception& error) { fail(env, error); return nullptr; }
}

extern "C" JNIEXPORT void JNICALL
Java_com_aasc_mmdartest_NativeSlamBindings_destroy(JNIEnv*, jobject, jlong handle) {
    delete reinterpret_cast<Session*>(handle);
}
