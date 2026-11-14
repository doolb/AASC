#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通用滑动猪求解器 v11 = v10 评分/搜索 + v3 候选生成。

合并点：
- 保留 v10 的 BestFirstSolver、total_ray_length、direct_exit_gain、caged_boost。
- 用 v3 的 generate_candidates_v3 替换 v10 的 generate_candidates。
- blocking_graph 返回 (graph, edges)，供 SCC cage 阻挡边使用。
- run_auto 不再外部排序；候选顺序由 generate_candidates_v3 决定。
- 闭包仍为启发式；超限只写 partial_or_timeout，不写无解。
"""

import argparse
import heapq
import json
import sys
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

sys.setrecursionlimit(1000000)

DIR2V = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}


@dataclass(frozen=True)
class Pig:
    id: int
    direction: str
    length: int
    width: int
    unlock: int
    anchor: Tuple[int, int]


@dataclass(frozen=True)
class Move:
    pid: int
    kind: str
    t: int
    old_anchor: Tuple[int, int]
    new_anchor: Optional[Tuple[int, int]]


class Layout:
    def __init__(self, W, H, pigs, cages, total):
        self.W = W
        self.H = H
        self.pigs = pigs
        self.cages = cages
        self.total = total

    def state_dict(self, state):
        return {pid: (c, r) for pid, c, r in state}

    def exited(self, state):
        return self.total - len(state)

    def cells_of(self, pid, anchor):
        p = self.pigs[pid]
        c, r = anchor
        if p.direction in ("east", "west"):
            return tuple((c + i, r) for i in range(p.length))
        return tuple((c, r + i) for i in range(p.length))

    def locked_cage_cells(self, exited):
        out = set()
        for unlock, cells in self.cages:
            if exited < unlock:
                out |= set(cells)
        return out

    def gen_moves(self, state):
        pos = self.state_dict(state)
        exited = self.exited(state)
        cell_owner = {}
        for pid, anchor in pos.items():
            for cell in self.cells_of(pid, anchor):
                cell_owner[cell] = pid
        locked = self.locked_cage_cells(exited)
        moves = []
        for pid, anchor in pos.items():
            pig = self.pigs[pid]
            if exited < pig.unlock:
                continue
            dx, dy = DIR2V[pig.direction]
            cells = self.cells_of(pid, anchor)
            lead = max(cells, key=lambda x: x[0] * dx + x[1] * dy)
            empties = 0
            hit = None
            for k in range(1, max(self.W, self.H) + 3):
                nc, nr = lead[0] + dx * k, lead[1] + dy * k
                if not (0 <= nc < self.W and 0 <= nr < self.H):
                    hit = "boundary"
                    break
                if (nc, nr) in locked:
                    hit = "blocked"
                    break
                owner = cell_owner.get((nc, nr))
                if owner is not None and owner != pid:
                    hit = "blocked"
                    break
                empties += 1
            if hit == "boundary":
                moves.append(Move(pid, "exit", 0, anchor, None))
            elif hit == "blocked" and empties > 0:
                na = (anchor[0] + dx * empties, anchor[1] + dy * empties)
                moves.append(Move(pid, "slide", empties, anchor, na))
        return moves

    def apply_move(self, state, move):
        d = self.state_dict(state)
        if move.kind == "exit":
            d.pop(move.pid, None)
        else:
            d[move.pid] = move.new_anchor
        return tuple(sorted((pid, c, r) for pid, (c, r) in d.items()))


def adapt_gemini_json(src_path, dst_path):
    src = json.load(open(src_path, encoding="utf-8"))
    W, H = src["grid"][3], src["grid"][4]
    locks = src.get("locks", {})
    pigs = [{
        "id": p["id"], "direction": p["direction"],
        "length": p["length"], "width": p["width"],
        "col": p["grid"]["col"], "row": p["grid"]["row"],
        "cells": p["grid"]["cells"],
        "unlock_after_exits": locks.get(str(p["id"]), 0),
    } for p in src["pigs"]]
    out = {"grid_columns": W, "grid_rows": H,
           "dynamic_cages": src.get("dynamic_cages", []), "pigs": pigs}
    json.dump(out, open(dst_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"adapted {src_path} -> {dst_path} pigs={len(pigs)}")


def load_layout(path):
    data = json.load(open(path, encoding="utf-8"))
    if "grid_columns" in data:
        W, H = int(data["grid_columns"]), int(data["grid_rows"])
        pigs_raw, cages_raw = data["pigs"], data.get("dynamic_cages", [])
        get_cells = lambda p: p["cells"]
        get_unlock = lambda p: int(p.get("unlock_after_exits", 0))
    elif "grid" in data:
        W, H = int(data["grid"][3]), int(data["grid"][4])
        pigs_raw, cages_raw = data["pigs"], data.get("dynamic_cages", [])
        locks = data.get("locks", {})
        get_cells = lambda p: p["grid"]["cells"]
        get_unlock = lambda p: int(locks.get(str(p["id"]), 0))
    else:
        raise ValueError("unrecognized layout")
    pigs = {}
    for p in pigs_raw:
        cells = [tuple(x) for x in get_cells(p)]
        anchor = (min(c for c, _ in cells), min(r for _, r in cells))
        pid = int(p["id"])
        pigs[pid] = Pig(pid, p["direction"], int(p["length"]), int(p["width"]),
                        get_unlock(p), anchor)
    cages = [(int(cg["unlock_exits"]),
              frozenset((int(c), int(r)) for c, r in cg["cells"]))
             for cg in cages_raw]
    total = len(pigs)
    init = tuple(sorted((pid, p.anchor[0], p.anchor[1]) for pid, p in pigs.items()))
    return Layout(W, H, pigs, cages, total), init


def violates(layout, state, forbids):
    if not forbids:
        return False
    pos = layout.state_dict(state)
    exited = layout.exited(state)
    for f in forbids:
        if exited >= f["until"]:
            continue
        pid = f["pid"]
        if pid in pos and f["cell"] in layout.cells_of(pid, pos[pid]):
            return True
    return False


def tarjan_scc(graph, nodes):
    index = 0
    indices, low, stack, on_stack, comps = {}, {}, [], set(), []

    def strong(v):
        nonlocal index
        indices[v] = low[v] = index
        index += 1
        stack.append(v)
        on_stack.add(v)
        for w in graph.get(v, []):
            if w not in indices:
                strong(w)
                low[v] = min(low[v], low[w])
            elif w in on_stack:
                low[v] = min(low[v], indices[w])
        if low[v] == indices[v]:
            comp = []
            while True:
                w = stack.pop()
                on_stack.remove(w)
                comp.append(w)
                if w == v:
                    break
            comps.append(sorted(comp))

    for v in nodes:
        if v not in indices:
            strong(v)
    return comps


def blocking_graph(layout, state):
    """返回 (graph, edges)；edges 含 pig / cage / boundary / locked_pig。"""
    pos = layout.state_dict(state)
    exited = layout.exited(state)
    cell_owner = {}
    for pid, anchor in pos.items():
        for cell in layout.cells_of(pid, anchor):
            cell_owner[cell] = pid
    locked_map = {}
    for idx, (unlock, cells) in enumerate(layout.cages):
        if exited < unlock:
            for cell in cells:
                locked_map[cell] = idx
    graph = defaultdict(list)
    edges = []
    for pid, anchor in pos.items():
        pig = layout.pigs[pid]
        if exited < pig.unlock:
            edges.append({"from": pid, "type": "locked_pig", "unlock": pig.unlock})
            continue
        dx, dy = DIR2V[pig.direction]
        cells = layout.cells_of(pid, anchor)
        lead = max(cells, key=lambda x: x[0] * dx + x[1] * dy)
        for k in range(1, max(layout.W, layout.H) + 3):
            nc, nr = lead[0] + dx * k, lead[1] + dy * k
            if not (0 <= nc < layout.W and 0 <= nr < layout.H):
                edges.append({"from": pid, "type": "boundary", "at": [nc, nr]})
                break
            cell = (nc, nr)
            if cell in locked_map:
                idx = locked_map[cell]
                edges.append({"from": pid, "type": "cage", "cage": idx, "at": list(cell)})
                break
            owner = cell_owner.get(cell)
            if owner is not None and owner != pid:
                graph[pid].append(owner)
                edges.append({"from": pid, "type": "pig", "to": owner, "at": list(cell)})
                break
    return graph, edges


def total_ray_length(layout, state):
    pos = layout.state_dict(state)
    exited = layout.exited(state)
    cell_owner = {}
    for pid, anchor in pos.items():
        for cell in layout.cells_of(pid, anchor):
            cell_owner[cell] = pid
    locked = layout.locked_cage_cells(exited)
    total = 0
    for pid, anchor in pos.items():
        pig = layout.pigs[pid]
        if exited < pig.unlock:
            continue
        dx, dy = DIR2V[pig.direction]
        cells = layout.cells_of(pid, anchor)
        lead = max(cells, key=lambda x: x[0] * dx + x[1] * dy)
        for k in range(1, max(layout.W, layout.H) + 1):
            nc, nr = lead[0] + dx * k, lead[1] + dy * k
            if not (0 <= nc < layout.W and 0 <= nr < layout.H):
                break
            if (nc, nr) in locked:
                break
            owner = cell_owner.get((nc, nr))
            if owner is not None and owner != pid:
                break
            total += 1
    return total


def ray_gain(layout, before, after):
    return total_ray_length(layout, after) - total_ray_length(layout, before)


def caged_ids(layout):
    out = set()
    for _, cells in layout.cages:
        for pid, pig in layout.pigs.items():
            if set(layout.cells_of(pid, pig.anchor)) <= cells:
                out.add(pid)
    return out


def all_cages_opened(layout, state):
    exited = layout.exited(state)
    return all(exited >= unlock for unlock, _ in layout.cages)


class Timeout(Exception):
    pass


class Solver:
    def __init__(self, layout, init, time_limit=300.0, max_nodes=0,
                 closure_mode="heuristic", deadlock_prune="off",
                 deadlock_max_nodes=2000, forbids=None, verbose=False,
                 beam_width=0):
        self.layout = layout
        self.init = init
        self.time_limit = time_limit
        self.max_nodes = max_nodes
        self.closure_mode = closure_mode
        self.deadlock_prune = deadlock_prune
        self.deadlock_max_nodes = deadlock_max_nodes
        self.forbids = forbids or []
        self.verbose = verbose
        self.beam_width = beam_width
        self.start = time.time()
        self.deadline = self.start + time_limit if time_limit > 0 else None
        self.nodes = 0
        self.visited = set()
        self.best_state = init
        self.best_path = []
        self.best_removed = layout.exited(init)
        self.exhausted = False
        self.deadlock_certificates = []
        self._caged = caged_ids(layout)

    def time_ok(self):
        if self.deadline is not None and time.time() > self.deadline:
            raise Timeout("time limit")
        if self.max_nodes and self.nodes > self.max_nodes:
            raise Timeout("max nodes")

    def closure(self, state):
        cur = state
        path = []
        while True:
            exits = [m for m in self.layout.gen_moves(cur) if m.kind == "exit"]
            if not exits:
                break
            m = min(exits, key=lambda x: x.pid)
            path.append(m)
            cur = self.layout.apply_move(cur, m)
        return cur, tuple(path)

    def update_best(self, state, path):
        removed = self.layout.exited(state)
        if removed > self.best_removed or (
            removed == self.best_removed and len(path) < len(self.best_path)
        ):
            self.best_state = state
            self.best_path = list(path)
            self.best_removed = removed

    def deadlock_check(self, state):
        if self.deadlock_prune != "strict":
            return False
        graph, _ = blocking_graph(self.layout, state)
        pos = self.layout.state_dict(state)
        comps = tarjan_scc(graph, sorted(pos.keys()))
        legal_ids = {m.pid for m in self.layout.gen_moves(state)}
        for comp in comps:
            if len(comp) < 2 and not (comp and comp[0] in graph.get(comp[0], [])):
                continue
            if any(pid not in pos for pid in comp):
                continue
            if any(pid in legal_ids for pid in comp):
                continue
            q = deque([state])
            seen = {state}
            nodes = 0
            escaped = False
            while q:
                st = q.popleft()
                nodes += 1
                if nodes > self.deadlock_max_nodes:
                    escaped = True
                    break
                st_pos = self.layout.state_dict(st)
                if any(pid not in st_pos for pid in comp):
                    escaped = True
                    break
                for m in self.layout.gen_moves(st):
                    ns = self.layout.apply_move(st, m)
                    if ns not in seen:
                        seen.add(ns)
                        q.append(ns)
            if not escaped:
                self.deadlock_certificates.append({
                    "type": "proven_deadlock", "scc": comp,
                    "bfs_nodes": nodes, "reachable_states": len(seen),
                })
                return True
        return False

    def _slide_key(self, state, m, moves):
        layout = self.layout
        ns = layout.apply_move(state, m)
        if self.closure_mode == "heuristic":
            ns2, cl = self.closure(ns)
            exit_gain = len(cl)
        else:
            ns2, cl = ns, ()
            exit_gain = 0
        rg = ray_gain(layout, state, ns2)
        direct_exit = sum(1 for mm in layout.gen_moves(ns) if mm.kind == "exit")
        uncaged_exit = any(mm.kind == "exit" and mm.pid not in self._caged for mm in moves)
        boost = 1 if (all_cages_opened(layout, state)
                      and m.pid in self._caged
                      and not uncaged_exit) else 0
        return (boost, exit_gain, direct_exit, rg, m.t)


class BestFirstSolver(Solver):
    def run(self):
        try:
            return self._run()
        except Timeout as e:
            return None, "partial_or_timeout", str(e)

    def _run(self):
        layout = self.layout
        if self.closure_mode == "heuristic":
            init_state, init_moves = self.closure(self.init)
        else:
            init_state, init_moves = self.init, ()
        if violates(layout, init_state, self.forbids):
            return None, "constraint_violation", None
        self.update_best(init_state, list(init_moves))

        heap = []
        counter = 1
        heapq.heappush(heap, (-layout.exited(init_state),
                              -len(layout.gen_moves(init_state)),
                              len(init_moves), counter, init_state, init_moves))

        while heap:
            self.time_ok()
            _, _, steps, _, state, path = heapq.heappop(heap)
            if state in self.visited:
                continue
            self.visited.add(state)
            self.nodes += 1

            if self.verbose and self.nodes % 2000 == 0:
                print(f"[bf] nodes={self.nodes} best={self.best_removed}/{layout.total} heap={len(heap)}",
                      file=sys.stderr)

            if len(state) == 0:
                return list(path), "solved", None
            if self.deadlock_check(state):
                continue

            moves = layout.gen_moves(state)
            slides = [m for m in moves if m.kind == "slide"]
            slides.sort(key=lambda m: self._slide_key(state, m, moves), reverse=True)
            if self.beam_width and len(slides) > self.beam_width:
                slides = slides[:self.beam_width]

            candidates = slides if self.closure_mode == "heuristic" else \
                ([m for m in moves if m.kind == "exit"] + slides)

            for m in candidates:
                if m.kind == "slide" and self.beam_width and m not in slides:
                    continue
                ns = layout.apply_move(state, m)
                if self.closure_mode == "heuristic":
                    ns2, cl = self.closure(ns)
                else:
                    ns2, cl = ns, ()
                if ns2 in self.visited:
                    continue
                if violates(layout, ns2, self.forbids):
                    continue
                if self.deadlock_check(ns2):
                    continue
                npath = tuple(path) + (m,) + tuple(cl)
                self.update_best(ns2, list(npath))
                counter += 1
                heapq.heappush(heap, (-layout.exited(ns2),
                                      -len(layout.gen_moves(ns2)),
                                      len(npath), counter, ns2, npath))

        self.exhausted = True
        return None, "exhausted_no_solution", None


class DFSSolver(Solver):
    def run(self):
        try:
            path = self._dfs(self.init, [])
            if path is not None:
                return path, "solved", None
            self.exhausted = True
            return None, "exhausted_no_solution", None
        except Timeout as e:
            return None, "partial_or_timeout", str(e)

    def _dfs(self, state, path):
        self.time_ok()
        if self.closure_mode == "heuristic":
            s2, cl = self.closure(state)
            p2 = path + list(cl)
        else:
            s2, p2 = state, path
        if violates(self.layout, s2, self.forbids):
            return None
        if self.deadlock_check(s2):
            return None
        self.update_best(s2, p2)
        if len(s2) == 0:
            return p2
        if s2 in self.visited:
            return None
        self.visited.add(s2)
        self.nodes += 1

        moves = self.layout.gen_moves(s2)
        slides = [m for m in moves if m.kind == "slide"]
        slides.sort(key=lambda m: self._slide_key(s2, m, moves), reverse=True)
        if self.beam_width and len(slides) > self.beam_width:
            slides = slides[:self.beam_width]

        candidates = slides if self.closure_mode == "heuristic" else \
            ([m for m in moves if m.kind == "exit"] + slides)

        for m in candidates:
            if m.kind == "slide" and self.beam_width and m not in slides:
                continue
            ns = self.layout.apply_move(s2, m)
            res = self._dfs(ns, p2 + [m])
            if res is not None:
                return res
        return None


def steps_json(layout, init, path):
    cur = init
    out = []
    for i, m in enumerate(path, 1):
        before = layout.exited(cur)
        after = layout.apply_move(cur, m)
        after_exited = layout.exited(after)
        newly = [idx for idx, (unlock, _) in enumerate(layout.cages)
                 if before < unlock <= after_exited]
        to = "exit" if m.kind == "exit" else \
            [list(x) for x in layout.cells_of(m.pid, m.new_anchor)]
        out.append({
            "n": i, "id": m.pid, "kind": m.kind, "slide_cells": m.t,
            "from": [list(x) for x in layout.cells_of(m.pid, m.old_anchor)],
            "to": to, "exited_after": after_exited,
            "remaining_after": len(after), "newly_unlocked_cages": newly,
        })
        cur = after
    return out


def state_json(layout, state):
    pos = layout.state_dict(state)
    return [{"id": pid, "direction": layout.pigs[pid].direction,
             "anchor": list(anchor),
             "cells": [list(x) for x in layout.cells_of(pid, anchor)]}
            for pid, anchor in sorted(pos.items())]


def verify_steps(layout, init, steps):
    cur = init
    errors = []
    for st in steps:
        pid, kind = st["id"], st["kind"]
        pos = layout.state_dict(cur)
        if pid not in pos:
            errors.append(f"step {st['n']}: pid {pid} not on board")
            break
        matched = None
        for m in layout.gen_moves(cur):
            if m.pid != pid or m.kind != kind:
                continue
            if kind == "slide":
                if m.t != st.get("slide_cells"):
                    continue
                if [list(x) for x in layout.cells_of(pid, m.new_anchor)] != st.get("to"):
                    continue
            matched = m
            break
        if matched is None:
            errors.append(f"step {st['n']}: no matching move pid={pid} kind={kind}")
            break
        cur = layout.apply_move(cur, matched)
        if layout.exited(cur) != st.get("exited_after"):
            errors.append(f"step {st['n']}: exited_after mismatch")
            break
        if len(cur) != st.get("remaining_after"):
            errors.append(f"step {st['n']}: remaining_after mismatch")
            break
    return {"ok": not errors, "errors": errors,
            "steps_checked": len(steps) if not errors else None,
            "final_remaining": len(cur), "final_exited": layout.exited(cur)}


def build_result(layout, init, solver, path, status, error):
    if path is not None:
        final_state = init
        for m in path:
            final_state = layout.apply_move(final_state, m)
        effective_path = path
        complete = True
    else:
        effective_path = solver.best_path
        final_state = solver.best_state
        complete = False
    steps = steps_json(layout, init, effective_path)
    return {
        "status": status, "complete": complete, "error": error,
        "total_pigs": layout.total,
        "best_removed": layout.exited(final_state),
        "best_remaining": len(final_state),
        "step_count": len(effective_path),
        "nodes": solver.nodes,
        "seconds": round(time.time() - solver.start, 3),
        "closure_mode": solver.closure_mode,
        "closure_is_heuristic": solver.closure_mode == "heuristic",
        "deadlock_prune": solver.deadlock_prune,
        "exhausted": solver.exhausted,
        "steps": steps,
        "final_state": state_json(layout, final_state),
        "replay_verification": verify_steps(layout, init, steps),
        "deadlock_certificates": solver.deadlock_certificates[:20],
        "deadlock_certificate_count": len(solver.deadlock_certificates),
    }


def _better(a, b):
    if b is None:
        return True
    if a["complete"] != b["complete"]:
        return a["complete"]
    if a["complete"] and b["complete"]:
        return a["step_count"] < b["step_count"]
    if a["best_removed"] != b["best_removed"]:
        return a["best_removed"] > b["best_removed"]
    return a["step_count"] < b["step_count"]


# ---------------------------------------------------------------------------
# v3 候选生成（合并点）
# ---------------------------------------------------------------------------

def replay_slide_rows(layout, init, best_path):
    cur = init
    rows = []
    for m in best_path:
        before = layout.exited(cur)
        after = layout.apply_move(cur, m)
        rows.append({"move": m, "before": before,
                     "after": layout.exited(after), "state": after})
        cur = after
    return rows


def generate_candidates_v3(layout, init, best_path, max_candidates=100,
                           max_until_per_pid_cell=2):
    """
    与 v3 一致的候选生成：
      source 0: SCC cage 阻挡边 / 相关笼阈值
      source 1: best_path slide 进入格邻接笼子
      source 2: 静态方向射线首次邻接笼子
      source 3: best_path slide 的 exited_after+1（无笼阈值时）
      source 4: total fallback
    排序：source, until_priority(笼阈值0/total1), until, pid, col
    每个 (pid, cell) 最多 max_until_per_pid_cell 个 until。
    """
    rows = replay_slide_rows(layout, init, best_path) if best_path else []
    cage_unlocks = sorted({u for u, _ in layout.cages})
    total = layout.total

    scc_cage_unlocks = set()
    if rows:
        final_state = rows[-1]["state"]
        _, edges = blocking_graph(layout, final_state)
        for edge in edges:
            if edge.get("type") == "cage":
                idx = edge.get("cage")
                if idx is not None and 0 <= idx < len(layout.cages):
                    scc_cage_unlocks.add(layout.cages[idx][0])

    cand_map = {}

    def add(pid, cell, until, source, reason):
        if until <= 0:
            return
        key = (pid, cell)
        info = cand_map.setdefault(key, {"untils": set(), "source": 99, "reasons": set()})
        info["untils"].add(until)
        info["source"] = min(info["source"], source)
        info["reasons"].add(reason)

    def adjacent_unlocks(cell):
        out = set()
        for dx, dy in DIR2V.values():
            neigh = (cell[0] + dx, cell[1] + dy)
            for u, cage_cells in layout.cages:
                if neigh in cage_cells:
                    out.add(u)
        return out

    def containing_unlocks(cell):
        return {u for u, cage_cells in layout.cages if cell in cage_cells}

    # 静态射线
    init_pos = layout.state_dict(init)
    for pid, pig in layout.pigs.items():
        if pid not in init_pos:
            continue
        anchor = init_pos[pid]
        dx, dy = DIR2V[pig.direction]
        lead = max(layout.cells_of(pid, anchor),
                   key=lambda x: x[0] * dx + x[1] * dy)
        for k in range(1, max(layout.W, layout.H) + 1):
            cell = (lead[0] + dx * k, lead[1] + dy * k)
            if not (0 <= cell[0] < layout.W and 0 <= cell[1] < layout.H):
                break
            if containing_unlocks(cell):
                break
            for u in adjacent_unlocks(cell):
                src = 0 if u in scc_cage_unlocks else 2
                add(pid, cell, u, src, f"static_adj_cage_{u}")

    # best_path slide 进入格
    for row in rows:
        m = row["move"]
        if m.kind != "slide":
            continue
        old_cells = set(layout.cells_of(m.pid, m.old_anchor))
        new_cells = set(layout.cells_of(m.pid, m.new_anchor))
        entered = new_cells - old_cells or new_cells
        base_until = row["after"] + 1
        for cell in entered:
            unlocks = adjacent_unlocks(cell) | containing_unlocks(cell)
            for u in unlocks:
                src = 0 if u in scc_cage_unlocks else 1
                add(m.pid, cell, u, src, f"path_adj_cage_{u}")
            if unlocks:
                add(m.pid, cell, total, 4, "path_total_fallback")
            else:
                add(m.pid, cell, base_until, 3, "path_exited_after_plus_1")
                add(m.pid, cell, total, 4, "path_total_fallback")

    # SCC cage 阻挡边
    if rows:
        final_state = rows[-1]["state"]
        _, edges = blocking_graph(layout, final_state)
        pos_final = layout.state_dict(final_state)
        for edge in edges:
            if edge.get("type") != "cage":
                continue
            pid = edge["from"]
            if pid not in pos_final:
                continue
            anchor = pos_final[pid]
            pig = layout.pigs[pid]
            dx, dy = DIR2V[pig.direction]
            lead = max(layout.cells_of(pid, anchor),
                       key=lambda x: x[0] * dx + x[1] * dy)
            fc, fr = lead[0] + dx, lead[1] + dy
            idx = edge.get("cage")
            if idx is not None and 0 <= idx < len(layout.cages):
                u = layout.cages[idx][0]
                if 0 <= fc < layout.W and 0 <= fr < layout.H:
                    add(pid, (fc, fr), u, 0, f"scc_cage_block_{idx}")
            at = edge.get("at")
            if at and idx is not None and 0 <= idx < len(layout.cages):
                u = layout.cages[idx][0]
                add(pid, tuple(at), u, 0, f"scc_cage_block_at_{idx}")

    # 构建候选
    out = []
    for (pid, cell), info in cand_map.items():
        untils = sorted(info["untils"])
        cage_untils = sorted(u for u in untils if u in cage_unlocks)
        other_untils = sorted(u for u in untils if u not in cage_unlocks)
        chosen = []
        if cage_untils:
            chosen.extend(cage_untils)
            if total not in chosen and len(chosen) < max_until_per_pid_cell:
                chosen.append(total)
        else:
            chosen.extend(other_untils)
            if total not in chosen and len(chosen) < max_until_per_pid_cell:
                chosen.append(total)
        final_untils = []
        for u in chosen:
            if u not in final_untils:
                final_untils.append(u)
            if len(final_untils) >= max_until_per_pid_cell:
                break
        for u in final_untils:
            up = 0 if u in cage_unlocks else 1
            out.append({
                "pid": pid, "cell": cell, "until": u,
                "_source": info["source"], "_up": up,
                "_reasons": sorted(info["reasons"]),
            })

    out.sort(key=lambda c: (c["_up"], c["_source"], c["until"],
                            c["pid"], c["cell"]))
    return out[:max_candidates]


def run_single(layout, init, args):
    cls = BestFirstSolver if args.mode == "bestfirst" else DFSSolver
    solver = cls(layout, init, time_limit=args.time, max_nodes=args.max_nodes,
                 closure_mode=args.closure, deadlock_prune=args.deadlock_prune,
                 deadlock_max_nodes=args.deadlock_max_nodes,
                 verbose=args.verbose, beam_width=args.beam_width)
    path, status, err = solver.run()
    result = build_result(layout, init, solver, path, status, err)
    out = args.out or "out.json"
    json.dump(result, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in result.items()
                      if k not in ("steps", "final_state", "replay_verification")},
                     ensure_ascii=False, indent=2))
    print(f"wrote {out}")


def run_auto(layout, init, args):
    # 修复：global_start 必须在基线之前
    global_start = time.time()
    global_deadline = global_start + args.time if args.time > 0 else None

    def remaining():
        if global_deadline is None:
            return float("inf")
        return max(0.0, global_deadline - time.time())

    overall = {
        "mode": "auto",
        "global_time": args.time,
        "baseline_ratio": args.baseline_ratio,
        "dfs_phase_ratio": args.dfs_phase_ratio,
        "candidate_search": args.candidate_search,
        "baseline": None,
        "dfs_phase": None,
        "generated_candidates": [],
        "candidate_execution_log": [],
        "candidates": [],
        "best": None,
        "overall_status": "partial_or_timeout",
    }

    def save_and_return():
        overall["total_seconds"] = round(time.time() - global_start, 3)
        out = args.out or "auto_out.json"
        json.dump(overall, open(out, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        print(json.dumps(
            {k: v for k, v in overall.items()
             if k not in ("baseline", "candidates", "best",
                          "generated_candidates",
                          "candidate_execution_log", "dfs_phase")},
            ensure_ascii=False, indent=2))
        print(f"wrote {out}")
        return overall

    # === 阶段 1：基线 BestFirst ===
    base_budget = max(1.0, args.time * args.baseline_ratio) if args.time > 0 else 0.0
    if global_deadline is not None:
        base_budget = min(base_budget, remaining())
    base = BestFirstSolver(
        layout, init, time_limit=base_budget, max_nodes=args.max_nodes,
        closure_mode=args.closure, deadlock_prune=args.deadlock_prune,
        deadlock_max_nodes=args.deadlock_max_nodes,
        verbose=args.verbose, beam_width=args.beam_width,
    )
    bpath, bstatus, berr = base.run()
    brec = build_result(layout, init, base, bpath, bstatus, berr)
    overall["baseline"] = brec
    best_rec = brec

    if bpath is not None:
        overall["best"] = brec
        overall["best"]["source"] = "baseline"
        overall["overall_status"] = "solved"
        return save_and_return()

    # === 阶段 2：DFS 长搜索（复现 v7） ===
    if args.dfs_phase_ratio > 0:
        r = remaining()
        if r > args.min_candidate_budget:
            dfs_budget = min(r * args.dfs_phase_ratio, r)
            dfs = DFSSolver(
                layout, init, time_limit=dfs_budget, max_nodes=args.max_nodes,
                closure_mode=args.closure,
                deadlock_prune=args.deadlock_prune,
                deadlock_max_nodes=args.deadlock_max_nodes,
                verbose=args.verbose, beam_width=args.beam_width,
            )
            dpath, dstatus, derr = dfs.run()
            drec = build_result(layout, init, dfs, dpath, dstatus, derr)
            overall["dfs_phase"] = {
                "budget_seconds": round(dfs_budget, 3),
                "status": dstatus,
                "error": derr,
                "nodes": drec["nodes"],
                "seconds": drec["seconds"],
                "best_removed": drec["best_removed"],
                "step_count": drec["step_count"],
                "complete": drec["complete"],
                "replay_ok": drec["replay_verification"]["ok"],
            }
            if dpath is not None:
                best_rec = drec
                best_rec["source"] = "dfs_phase"
                overall["best"] = best_rec
                overall["overall_status"] = "solved"
                return save_and_return()
            if _better(drec, best_rec):
                best_rec = drec

    # === 阶段 3：候选 ===
    if base.best_path and remaining() > args.min_candidate_budget:
        cands = generate_candidates_v3(
            layout, init, base.best_path, args.max_candidates,
            max_until_per_pid_cell=2,
        )
        overall["generated_candidates"] = [
            {"index": i, "pid": c["pid"], "cell": list(c["cell"]),
             "until_exits": c["until"], "source": c["_source"],
             "until_priority": c["_up"], "reasons": c["_reasons"]}
            for i, c in enumerate(cands)
        ]
        total_cands = len(cands)
        for i, cand in enumerate(cands):
            r = remaining()
            if r <= 0:
                overall["candidate_execution_log"].append({
                    "index": i,
                    "candidate": overall["generated_candidates"][i],
                    "strategy": None,
                    "budget_seconds": 0.0,
                    "actual_seconds": 0.0,
                    "status": "skipped_global_deadline",
                    "best_removed": None,
                    "step_count": None,
                    "complete": False,
                    "replay_ok": False,
                })
                continue
            per = r / max(1, total_cands - i)
            per = max(per, args.min_candidate_budget)
            per = min(per, r)
            if args.auto_time > 0:
                per = min(per, args.auto_time)

            forb = {"pid": cand["pid"], "cell": cand["cell"],
                    "until": cand["until"]}

            if args.candidate_search == "alternate":
                cls = DFSSolver if i % 2 == 0 else BestFirstSolver
                strategy = "dfs" if i % 2 == 0 else "bestfirst"
            else:
                cls = DFSSolver if args.candidate_search == "dfs" else BestFirstSolver
                strategy = args.candidate_search

            s = cls(
                layout, init, time_limit=per, max_nodes=args.max_nodes,
                closure_mode=args.closure,
                deadlock_prune=args.deadlock_prune,
                deadlock_max_nodes=args.deadlock_max_nodes,
                forbids=[forb], verbose=args.verbose,
                beam_width=args.beam_width,
            )
            path, status, err = s.run()
            rec = build_result(layout, init, s, path, status, err)
            rec["candidate"] = overall["generated_candidates"][i]
            rec["strategy"] = strategy
            overall["candidates"].append({"index": i, **rec})
            overall["candidate_execution_log"].append({
                "index": i,
                "candidate": overall["generated_candidates"][i],
                "strategy": strategy,
                "budget_seconds": round(per, 3),
                "actual_seconds": rec["seconds"],
                "status": status,
                "error": err,
                "best_removed": rec["best_removed"],
                "step_count": rec["step_count"],
                "complete": rec["complete"],
                "replay_ok": rec["replay_verification"]["ok"],
            })
            if _better(rec, best_rec):
                best_rec = rec
                best_rec["source"] = f"candidate_{i}"
            if path is not None:
                break

    overall["best"] = best_rec
    overall["overall_status"] = "solved" if best_rec["complete"] else "partial_or_timeout"
    return save_and_return()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", default="")
    ap.add_argument("--mode", choices=["dfs", "bestfirst", "auto"], default="bestfirst")
    ap.add_argument("--closure", choices=["off", "heuristic"], default="heuristic")
    ap.add_argument("--deadlock-prune", choices=["off", "strict"], default="off")
    ap.add_argument("--time", type=float, default=300.0)
    ap.add_argument("--max-nodes", type=int, default=0)
    ap.add_argument("--deadlock-max-nodes", type=int, default=2000)
    ap.add_argument("--baseline-ratio", type=float, default=0.4)
    ap.add_argument("--dfs-phase-ratio", type=float, default=0.5)
    ap.add_argument("--candidate-search", choices=["bestfirst", "dfs", "alternate"], default="dfs")
    ap.add_argument("--auto-time", type=float, default=0.0)
    ap.add_argument("--min-candidate-budget", type=float, default=2.0)
    ap.add_argument("--max-candidates", type=int, default=100)
    ap.add_argument("--beam-width", type=int, default=0)
    ap.add_argument("--out", default="")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--adapt-gemini", default="")
    ap.add_argument("--adapt-out", default="")
    args = ap.parse_args()

    if args.adapt_gemini:
        adapt_gemini_json(args.adapt_gemini, args.adapt_out or "adapted.json")
        return
    if not args.layout:
        raise SystemExit("--layout required unless --adapt-gemini")

    layout, init = load_layout(args.layout)
    if args.mode == "auto":
        run_auto(layout, init, args)
    else:
        run_single(layout, init, args)


if __name__ == "__main__":
    main()