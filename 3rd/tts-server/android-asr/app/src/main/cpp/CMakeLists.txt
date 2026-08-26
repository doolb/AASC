cmake_minimum_required(VERSION 3.22.1)
project("cpu-affinity")

add_library(cpu-affinity SHARED cpu_affinity.cpp)
target_compile_features(cpu-affinity PRIVATE cxx_std_17)
