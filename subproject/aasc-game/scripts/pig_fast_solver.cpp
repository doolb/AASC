// 离线状态遍历后备程序：只处理调用者提供的候选布局，不访问游戏进程或窗口。
// 输出仅为候选步骤，必须由 Python 实现独立重放验证后才能用于实际操作。
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <unordered_set>
#include <vector>
using namespace std;
struct Pig {
  int dx, dy, len, width, id;
};
struct Move {
  int index, dest, dist;
  bool exited;
  uint64_t rank;
};
int n, w, h, seed;
vector<Pig> pigs;
vector<int> pos, duckpos, fixedpos;
vector<Move> path;
unordered_set<string> seen;
long long states = 0;
chrono::steady_clock::time_point deadline;
bool limit = false;
uint64_t close_ducks(uint64_t mask, const bool *pigcells) {
  bool visited[300] = {};
  int queue[300], head = 0, tail = 0;
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++)
      if (x == 0 || y == 0 || x == w - 1 || y == h - 1) {
        int at = y * w + x;
        if (!pigcells[at] && !visited[at]) {
          visited[at] = true;
          queue[tail++] = at;
        }
      }
  while (head < tail) {
    int at = queue[head++], x = at % w, y = at / w;
    int dx[] = {1, -1, 0, 0}, dy[] = {0, 0, -1, 1};
    for (int k = 0; k < 4; k++) {
      int nx = x + dx[k], ny = y + dy[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h)
        continue;
      int next = ny * w + nx;
      if (!pigcells[next] && !visited[next]) {
        visited[next] = true;
        queue[tail++] = next;
      }
    }
  }
  for (size_t i = 0; i < duckpos.size(); i++)
    if (visited[duckpos[i]])
      mask &= ~(1ULL << i);
  return mask;
}
bool dfs(int depth, uint64_t mask) {
  if (depth > 600 || chrono::steady_clock::now() > deadline ||
      states > 900000) {
    limit = true;
    return false;
  }
  bool pigcells[300] = {};
  for (int at : fixedpos)
    pigcells[at] = true;
  int remain = 0;
  for (int i = 0; i < n; i++)
    if (pos[i] >= 0) {
      remain++;
      int x = pos[i] % w, y = pos[i] / w;
      for (int k = 0; k < pigs[i].len; k++)
        for (int j = 0; j < pigs[i].width; j++)
          pigcells[(y + (pigs[i].dy != 0 ? k : j)) * w + x +
                   (pigs[i].dx != 0 ? k : j)] = true;
    }
  mask = close_ducks(mask, pigcells);
  if (!remain && !mask)
    return true;
  string key;
  key.resize(n + 8);
  for (int i = 0; i < n; i++)
    key[i] = char(pos[i] + 1);
  for (int j = 0; j < 8; j++)
    key[n + j] = char((mask >> (j * 8)) & 255);
  if (!seen.insert(key).second)
    return false;
  states++;
  bool occupied[300] = {};
  for (int i = 0; i < w * h; i++)
    occupied[i] = pigcells[i];
  for (size_t i = 0; i < duckpos.size(); i++)
    if (mask & (1ULL << i))
      occupied[duckpos[i]] = true;
  vector<Move> moves;
  for (int i = 0; i < n; i++)
    if (pos[i] >= 0) {
      auto p = pigs[i];
      int x = pos[i] % w, y = pos[i] / w;
      if (p.dx > 0)
        x += p.len - 1;
      if (p.dy > 0)
        y += p.len - 1;
      int d = 0;
      while (true) {
        x += p.dx;
        y += p.dy;
        if (x < 0 || x >= w || y < 0 || y >= h) {
          moves.push_back({i, -1, d, true, 0});
          break;
        }
        bool blocked = false;
        for (int j = 0; j < p.width; j++) {
          int test_x = x + (p.dy != 0 ? j : 0);
          int test_y = y + (p.dx != 0 ? j : 0);
          if (occupied[test_y * w + test_x])
            blocked = true;
        }
        if (blocked) {
          if (d)
            moves.push_back({i, pos[i] + d * (p.dx + p.dy * w), d, false, 0});
          break;
        }
        d++;
      }
    }
  for (auto &m : moves) {
    uint64_t z = (uint64_t)(m.index + 1) * 0x9e3779b97f4a7c15ULL +
                 (uint64_t)seed * 0x94d049bb133111ebULL;
    z ^= z >> 30;
    z *= 0xbf58476d1ce4e5b9ULL;
    z ^= z >> 27;
    m.rank = z;
  }
  sort(moves.begin(), moves.end(), [](const auto &a, const auto &b) {
    if (a.exited != b.exited)
      return a.exited > b.exited;
    return a.rank < b.rank;
  });
  for (auto m : moves) {
    int old = pos[m.index];
    pos[m.index] = m.dest;
    path.push_back(m);
    if (dfs(depth + 1, mask))
      return true;
    path.pop_back();
    pos[m.index] = old;
    if (limit)
      return false;
  }
  return false;
}
int main(int argc, char **argv) {
  seed = argc > 1 ? atoi(argv[1]) : 1;
  int count, fixed_count;
  cin >> n >> w >> h >> count >> fixed_count;
  if (w * h > 300 || count > 63)
    return 2;
  string dir;
  for (int i = 0; i < n; i++) {
    int x, y, len, width, id;
    cin >> x >> y >> dir >> len >> width >> id;
    pigs.push_back({(dir == "east") - (dir == "west"),
                    (dir == "south") - (dir == "north"), len, width, id});
    pos.push_back(y * w + x);
  }
  for (int i = 0; i < count; i++) {
    int x, y;
    cin >> x >> y;
    duckpos.push_back(y * w + x);
  }
  for (int i = 0; i < fixed_count; i++) {
    int x, y;
    cin >> x >> y;
    fixedpos.push_back(y * w + x);
  }
  uint64_t mask = (1ULL << count) - 1;
  seen.reserve(900000);
  deadline = chrono::steady_clock::now() + chrono::seconds(50);
  bool ok = dfs(0, mask);
  cerr << "seed=" << seed << " states=" << states << " found=" << ok
       << " limit=" << limit << "\n";
  if (ok)
    for (auto m : path)
      cout << m.index << " " << m.dest << " " << m.dist << " " << m.exited
           << "\n";
  return ok ? 0 : 1;
}
