#pragma once
#include <map>
#include <mutex>

namespace aasc_slam {
// 上游地图只移除坏点/帧而不释放内存；Android退出时统一释放残余对象。
// 会话在JNI层串行化，工作线程退出后才调用releaseOwned。
template<class T> struct Ownership {
    inline static std::mutex mutex;
    inline static std::map<T*, bool> objects;
};
template<class T> class AndroidOwned {
public:
    AndroidOwned() { record(); }
    AndroidOwned(const AndroidOwned&) { record(); }
    AndroidOwned& operator=(const AndroidOwned&) { return *this; }
    ~AndroidOwned() {
        std::lock_guard<std::mutex> lock(Ownership<T>::mutex);
        Ownership<T>::objects.erase(static_cast<T*>(this));
    }
private:
    void record() {
        std::lock_guard<std::mutex> lock(Ownership<T>::mutex);
        Ownership<T>::objects.emplace(static_cast<T*>(this), true);
    }
};
template<class T> void releaseOwned() {
    for (;;) {
        T* object;
        {
            std::lock_guard<std::mutex> lock(Ownership<T>::mutex);
            if (Ownership<T>::objects.empty()) break;
            object = Ownership<T>::objects.begin()->first;
        }
        delete object;
    }
}
}
