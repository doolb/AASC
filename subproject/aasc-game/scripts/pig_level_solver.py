#!/usr/bin/env python3
"""在假设的两格滑动规则下搜索完整关卡计划，不直接访问游戏。"""
import time
from collections import deque

VECTORS = {'east': (1, 0), 'west': (-1, 0), 'north': (0, -1), 'south': (0, 1)}


def cells(position, direction, length=2, width=1):
    if position is None:
        return ()
    x, y = position
    return tuple((x + offset, y + cross) if VECTORS[direction][0] else (x + cross, y + offset)
                 for offset in range(length) for cross in range(width))


def prepare(pigs, columns, rows):
    """严格校验候选数据；未知朝向、缺格或重叠不能构造计划。"""
    if not (1 <= columns <= 500 and 1 <= rows <= 500):
        raise ValueError('网格尺寸无效')
    ids, seen = set(), set()
    state = []
    directions = []
    for pig in pigs:
        direction = pig.get('direction')
        grid = pig.get('grid')
        if direction not in VECTORS or not grid:
            raise ValueError('存在方向未知或缺少网格位置的小猪')
        if pig.get('id') in ids:
            raise ValueError('小猪编号重复')
        ids.add(pig['id'])
        position = (grid['col'], grid['row'])
        length = pig.get('length', 2)
        if length not in (2, 3):
            raise ValueError('小猪长度必须为二格或三格')
        width = pig.get('width', 1)
        if type(width) is not int or width not in (1, 2, 3):
            raise ValueError('物件宽度无效')
        expected = cells(position, direction, length, width)
        actual = tuple(tuple(cell) for cell in grid['cells'])
        if set(actual) != set(expected):
            raise ValueError('小猪占格与方向不一致')
        for cell in expected:
            if not (0 <= cell[0] < columns and 0 <= cell[1] < rows):
                raise ValueError('小猪占格超出网格')
            if cell in seen:
                raise ValueError('小猪占格互相重叠')
            seen.add(cell)
        state.append(position)
        directions.append(direction)
    if not state:
        raise ValueError('没有小猪候选')
    return tuple(state), tuple(directions)


def actions(state, directions, columns, rows, blockers=(), lengths=None, widths=None):
    """假设点击后沿原方向滑到障碍前或离开；真实游戏规则仍须逐步核对。"""
    lengths = lengths if lengths is not None else [2] * len(state)
    widths = widths if widths is not None else [1] * len(state)
    occupied = {tuple(cell): -1 for cell in blockers}
    for index, position in enumerate(state):
        for cell in cells(position, directions[index], lengths[index], widths[index]):
            occupied[cell] = index
    result = []
    for index, position in enumerate(state):
        if position is None:
            continue
        dx, dy = VECTORS[directions[index]]
        head = max(cells(position, directions[index], lengths[index], widths[index]), key=lambda cell: cell[0] * dx + cell[1] * dy)
        x, y = head
        distance = 0
        while True:
            nx, ny = x + dx, y + dy
            if not (0 <= nx < columns and 0 <= ny < rows):
                result.append((True, index, None, distance))
                break
            front = [(nx + (j if dy else 0), ny + (j if dx else 0)) for j in range(widths[index])]
            if any(occupied.get(cell) is not None and occupied[cell] != index for cell in front):
                if distance:
                    result.append((False, index, (position[0] + dx * distance, position[1] + dy * distance), distance))
                break
            distance += 1
            x, y = nx, ny
    return sorted(result, key=lambda item: (not item[0], -item[3], item[1]))


def validate_blockers(blockers, state, directions, lengths, columns, rows, ducks=(), widths=None):
    """校验未知物件的暂定阻挡格，不能与其他对象重叠。"""
    try:
        points = [tuple(cell) for cell in blockers]
        if any(len(cell) != 2 or any(type(value) is not int for value in cell) for cell in points):
            raise ValueError('阻挡格坐标无效')
        widths = widths if widths is not None else [1] * len(state)
        occupied = {cell for i, position in enumerate(state) for cell in cells(position, directions[i], lengths[i], widths[i])}
        if len(set(points)) != len(points) or any(not (0 <= x < columns and 0 <= y < rows) or (x, y) in occupied or (x, y) in ducks for x, y in points):
            raise ValueError('阻挡格重复、越界或与猪鸭重叠')
        return tuple(points)
    except TypeError as error:
        raise ValueError('阻挡格坐标无效') from error


def settle_ducks(state, directions, ducks, columns, rows, lengths=None, blockers=(), widths=None):
    """边界搜索可穿过可依次离开的鸭格，与逐只连锁搜索等价。"""
    occupied = set(blockers)
    lengths = lengths if lengths is not None else [2] * len(state)
    widths = widths if widths is not None else [1] * len(state)
    for index, position in enumerate(state):
        occupied.update(cells(position, directions[index], lengths[index], widths[index]))
    boundary = {(x, y) for x in range(columns) for y in (0, rows - 1)}
    boundary.update((x, y) for y in range(rows) for x in (0, columns - 1))
    visited = boundary - occupied
    queue = deque(visited)
    while queue:
        x, y = queue.popleft()
        for dx, dy in VECTORS.values():
            point = (x + dx, y + dy)
            if (0 <= point[0] < columns and 0 <= point[1] < rows
                    and point not in occupied and point not in visited):
                visited.add(point)
                queue.append(point)
    all_ducks = set(ducks)
    return tuple(sorted(all_ducks - visited)), tuple(sorted(all_ducks & visited))


def validate_candidate_plan(pigs, ducks, columns, rows, candidate, blockers=(), require_complete=True):
    """独立重放外部候选，逐步验证完整猪鸭状态，不访问或操作游戏。"""
    state, directions = prepare(pigs, columns, rows)
    initial = state
    lengths = [pig.get('length', 2) for pig in pigs]
    widths = [pig.get('width', 1) for pig in pigs]
    try:
        duck_cells = tuple(tuple(cell) for cell in ducks)
        if any(len(cell) != 2 or any(type(value) is not int for value in cell) for cell in duck_cells):
            raise ValueError('鸭子坐标无效')
        occupied = {cell for i, position in enumerate(state) for cell in cells(position, directions[i], lengths[i], widths[i])}
        if len(set(duck_cells)) != len(duck_cells) or any(
                not (0 <= x < columns and 0 <= y < rows) or (x, y) in occupied for x, y in duck_cells):
            raise ValueError('鸭子坐标重复、越界或与猪重叠')
        fixed = validate_blockers(blockers, state, directions, lengths, columns, rows, duck_cells, widths)
        remaining, departed = settle_ducks(state, directions, duck_cells, columns, rows, lengths, fixed, widths)
        if departed:
            raise ValueError('初始鸭子模型与画面不一致')
        verified = []
        for action in candidate:
            index = action['index']
            if type(index) is not int or not 0 <= index < len(pigs) or state[index] is None:
                raise ValueError('目标编号无效或已经离场')
            if type(action['exited']) is not bool or type(action['travel_cells']) is not int or action['travel_cells'] < 0:
                raise ValueError('离场标志或移动距离无效')
            destination = tuple(action['to']) if action['to'] is not None else None
            proposed = (action['exited'], index, destination, action['travel_cells'])
            if (action['pig_id'] != pigs[index]['id'] or action['direction'] != directions[index]
                    or tuple(action['from']) != state[index]
                    or proposed not in actions(state, directions, columns, rows, remaining + fixed, lengths, widths)):
                raise ValueError('候选动作与当前状态或合法移动不一致')
            following = list(state)
            following[index] = destination
            following = tuple(following)
            next_ducks, departed = settle_ducks(following, directions, remaining, columns, rows, lengths, fixed, widths)
            if 'ducks_after' in action and {tuple(cell) for cell in action['ducks_after']} != set(next_ducks):
                raise ValueError('候选鸭子后状态不一致')
            if 'duck_departures' in action and {tuple(cell) for cell in action['duck_departures']} != set(departed):
                raise ValueError('候选鸭子离开集合不一致')
            verified.append({'index': index, 'pig_id': pigs[index]['id'], 'direction': directions[index],
                             'from': state[index], 'to': destination, 'exited': bool(action['exited']),
                             'travel_cells': action['travel_cells'], 'duck_departures': departed, 'ducks_after': next_ducks})
            state, remaining = following, next_ducks
        if require_complete and (any(position is not None for position in state) or remaining):
            raise ValueError('候选计划未使猪和鸭全部离开')
        status = 'partial' if any(position is not None for position in state) or remaining else ('solved_with_fixed_blockers' if fixed else ('solved_hypothesis' if duck_cells else 'solved'))
        return {'status': status, 'states': 0,
                'initial': initial, 'initial_duck_departures': (), 'actions': verified}
    except (TypeError, KeyError, ValueError) as error:
        raise ValueError('外部候选计划校验失败：' + str(error)) from error


def solve_duck_hypothesis(pigs, ducks, columns, rows, max_states=100000, timeout=15.0, blockers=()):
    """仅离线搜索明确标注的鸭子假设，不证明实际游戏规则或触发自动点击。"""
    if max_states < 1 or timeout <= 0:
        raise ValueError('搜索上限必须大于 0')
    initial, directions = prepare(pigs, columns, rows)
    lengths = [pig.get('length', 2) for pig in pigs]
    widths = [pig.get('width', 1) for pig in pigs]
    try:
        duck_cells = tuple(tuple(cell) for cell in ducks)
        if any(len(cell) != 2 or any(type(value) is not int for value in cell) for cell in duck_cells):
            raise ValueError('鸭子坐标无效')
        if len(set(duck_cells)) != len(duck_cells):
            raise ValueError('鸭子坐标重复')
        occupied = {cell for i, position in enumerate(initial) for cell in cells(position, directions[i], lengths[i], widths[i])}
        if any(not (0 <= x < columns and 0 <= y < rows) or (x, y) in occupied for x, y in duck_cells):
            raise ValueError('鸭子坐标越界或与小猪重叠')
    except (TypeError, ValueError) as error:
        raise ValueError('鸭子坐标无效：' + str(error)) from error
    fixed = validate_blockers(blockers, initial, directions, lengths, columns, rows, duck_cells, widths)
    remaining, initially_departed = settle_ducks(initial, directions, duck_cells, columns, rows, lengths, fixed, widths)
    def duck_actions(state, current_ducks):
        # 优先离场，再固定打散编号；避免长距离优先反复落入同一类死胡同。
        candidates = actions(state, directions, columns, rows, current_ducks + fixed, lengths, widths)
        return sorted(candidates, key=lambda item: (not item[0], (item[1] * 1103515245 + 12345) & 0xffffffff))
    started = time.monotonic()
    first = (initial, remaining)
    seen = {first}
    stack = [(first, iter(duck_actions(initial, remaining)), [])]
    while stack:
        if len(seen) > max_states or time.monotonic() - started >= timeout:
            return {'status': 'search_limit', 'states': len(seen), 'actions': [], 'initial_duck_departures': initially_departed}
        (state, current_ducks), choices, path = stack[-1]
        if all(position is None for position in state) and not current_ducks:
            return {'status': 'solved_with_fixed_blockers' if fixed else 'solved_hypothesis', 'states': len(seen), 'actions': path,
                    'initial': initial, 'initial_duck_departures': initially_departed}
        try:
            exited, index, destination, distance = next(choices)
        except StopIteration:
            stack.pop()
            continue
        following = list(state)
        following[index] = destination
        following = tuple(following)
        ducks_after, departed = settle_ducks(following, directions, current_ducks, columns, rows, lengths, fixed, widths)
        next_state = (following, ducks_after)
        if next_state in seen:
            continue
        seen.add(next_state)
        action = {'index': index, 'pig_id': pigs[index]['id'], 'direction': directions[index],
                  'from': state[index], 'to': destination, 'exited': exited, 'travel_cells': distance,
                  'duck_departures': departed, 'ducks_after': ducks_after}
        stack.append((next_state, iter(duck_actions(following, ducks_after)), path + [action]))
    return {'status': 'no_solution_in_hypothesis', 'states': len(seen), 'actions': [],
            'initial_duck_departures': initially_departed}


def solve(pigs, columns, rows, max_states=100000, timeout=15.0, order_seed=None, blockers=()):
    """遍历状态并缓存失败分支；超过上限标记未完成，而非伪称无解。"""
    if max_states < 1 or timeout <= 0:
        raise ValueError('搜索上限必须大于 0')
    initial, directions = prepare(pigs, columns, rows)
    lengths = [pig.get('length', 2) for pig in pigs]
    widths = [pig.get('width', 1) for pig in pigs]
    fixed = validate_blockers(blockers, initial, directions, lengths, columns, rows, widths=widths)
    def ordered_actions(state):
        choices = actions(state, directions, columns, rows, blockers=fixed, lengths=lengths, widths=widths)
        if order_seed is None:
            return choices
        def rank(item):
            mask = (1 << 64) - 1
            value = ((item[1] + 1) * 0x9e3779b97f4a7c15 + order_seed * 0x94d049bb133111eb) & mask
            value ^= value >> 30
            value = (value * 0xbf58476d1ce4e5b9) & mask
            value ^= value >> 27
            return not item[0], value
        return sorted(choices, key=rank)
    started = time.monotonic()
    seen = {initial}
    # 显式栈避免大型关卡因递归深度而失败。
    stack = [(initial, iter(ordered_actions(initial)), [])]
    while stack:
        if len(seen) > max_states or time.monotonic() - started >= timeout:
            return {'status': 'search_limit', 'states': len(seen), 'actions': []}
        state, choices, path = stack[-1]
        if all(position is None for position in state):
            return {'status': 'solved_with_fixed_blockers' if fixed else 'solved', 'states': len(seen), 'actions': path, 'initial': initial}
        try:
            exited, index, destination, distance = next(choices)
        except StopIteration:
            stack.pop()
            continue
        next_state = list(state)
        next_state[index] = destination
        next_state = tuple(next_state)
        if next_state in seen:
            continue
        seen.add(next_state)
        action = {'index': index, 'pig_id': pigs[index]['id'], 'direction': directions[index],
                  'from': state[index], 'to': destination, 'exited': exited, 'travel_cells': distance}
        stack.append((next_state, iter(ordered_actions(next_state)), path + [action]))
    return {'status': 'no_solution_in_model', 'states': len(seen), 'actions': []}
