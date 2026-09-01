cmake_minimum_required(VERSION 3.22.1)

project("yolo_cpu_affinity")

add_library(yolo_cpu_affinity SHARED cpu_affinity.cpp)
target_compile_features(yolo_cpu_affinity PRIVATE cxx_std_17)

find_library(log-lib log)
target_link_libraries(yolo_cpu_affinity ${log-lib})
