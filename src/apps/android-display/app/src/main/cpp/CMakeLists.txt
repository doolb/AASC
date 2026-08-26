cmake_minimum_required(VERSION 3.22.1)

project(aasc_cpu_affinity)

add_library(cpu_affinity SHARED cpu_affinity.cpp)

target_link_libraries(cpu_affinity log)
