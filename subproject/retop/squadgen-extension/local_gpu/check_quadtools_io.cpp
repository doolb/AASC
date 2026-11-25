// 只读验证提取器实际使用的网格面顺序和 NPZ 张量布局，不修改提取算法。
#include "MeshLoader.h"
#include "libnpy/npz.h"
#include <array>
#include <fstream>
#include <iostream>
#include <memory>

int main(int argc, char **argv) {
    try {
        if (argc != 4) throw std::runtime_error("usage: mesh.obj field.npz output.bin");
        std::unique_ptr<MeshLib::Mesh3D<double>> mesh(load_mesh<double>(argv[1]));
        if (!mesh) throw std::runtime_error("mesh load failed");
        npy::inpzstream input(argv[2]);
        auto cdf = input.read<float>("cdf.npy");
        auto dcdf = input.read<float>("dcdf.npy");
        auto offset = input.read<float>("offset.npy");
        auto offsetc = input.read<float>("offsetc.npy");
        const auto count = mesh->get_num_of_faces();
        if (cdf.shape()[0] != static_cast<size_t>(count)) throw std::runtime_error("face count mismatch");
        std::ofstream output(argv[3], std::ios::binary);
        output.exceptions(std::ios::badbit | std::ios::failbit);
        for (ptrdiff_t i = 0; i < count; ++i) {
            const auto center = mesh->get_face(i)->GetCentroid();
            // 每面固定11个double，依次为面中心、CDF/DCDF、两组offset。
            const std::array<double, 11> row = {center[0], center[1], center[2], cdf(i,0), dcdf(i,0),
                offset(i,0), offset(i,1), offset(i,2), offsetc(i,0), offsetc(i,1), offsetc(i,2)};
            output.write(reinterpret_cast<const char*>(row.data()), sizeof(row));
        }
        std::cout << count << " faces verified/exported by original loaders\n";
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
