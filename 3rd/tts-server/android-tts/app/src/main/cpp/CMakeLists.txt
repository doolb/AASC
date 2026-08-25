cmake_minimum_required(VERSION 3.22.1)

project("cpu-affinity")

add_library(cpu-affinity SHARED cpu_affinity.cpp)

find_library(log-lib log)
target_link_libraries(cpu-affinity ${log-lib})
