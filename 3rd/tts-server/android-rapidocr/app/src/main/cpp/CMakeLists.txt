cmake_minimum_required(VERSION 3.22.1)

project("rapidocr_cpu_affinity")

add_library(rapidocr_cpu_affinity SHARED cpu_affinity.cpp)
target_compile_features(rapidocr_cpu_affinity PRIVATE cxx_std_17)

find_library(log-lib log)
target_link_libraries(rapidocr_cpu_affinity ${log-lib})
