#!/usr/bin/env python3
"""通过 X11 截图和鼠标输入自动尝试当前关，绝不切换关卡。"""
import argparse
import ctypes
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pig_level_extract', ROOT / 'scripts/extract-pig-level.py')
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)
solver_spec = importlib.util.spec_from_file_location('pig_level_solver', ROOT / 'scripts/pig_level_solver.py')
solver = importlib.util.module_from_spec(solver_spec)
solver_spec.loader.exec_module(solver)
VECTORS = {'east': (1, 0), 'south_east': (1, 1), 'south': (0, 1),
           'south_west': (-1, 1), 'west': (-1, 0), 'north_west': (-1, -1),
           'north': (0, -1), 'north_east': (1, -1)}


def victory_visible(image):
    """只匹配已观察到的通关文字；没有匹配时不能把空棋盘当成胜利。"""
    template = cv2.imread(str(ROOT / 'docs/references/pig-game/victory-template.png'), cv2.IMREAD_GRAYSCALE)
    if template is None:
        raise ValueError('缺少通关画面模板')
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    header = gray[:round(gray.shape[0] * 0.4), :]
    scale = math.sqrt((image.shape[1] / extract.BASE_WIDTH) * (image.shape[0] / extract.BASE_HEIGHT))
    for factor in np.linspace(0.9, 1.1, 5):
        size = (max(1, round(template.shape[1] * scale * factor)), max(1, round(template.shape[0] * scale * factor)))
        if size[0] > header.shape[1] or size[1] > header.shape[0]:
            continue
        sample = cv2.resize(template, size, interpolation=cv2.INTER_LINEAR)
        if cv2.matchTemplate(header, sample, cv2.TM_CCOEFF_NORMED).max() >= 0.88:
            return True
    return False


def use_recorded_manual_direction(level, image, pigs):
    """仅当首关全部候选的位置和其余方向均匹配已保存布局时使用人工值。"""
    if level != 1 or image.shape[:2] != (941, 529) or len(pigs) != 6:
        return
    path = ROOT / 'docs/references/pig-game/extractions/level-01-manual-direction/level.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    unmatched = list(pigs)
    matched = []
    for ref in data['pigs']:
        if not unmatched:
            return
        pig = min(unmatched, key=lambda item: math.dist(item['center'], ref['center']))
        if math.dist(pig['center'], ref['center']) > 3:
            return
        if ref.get('direction_source') == 'manual_visual_review':
            if pig['direction'] != 'unknown' or not pig.get('gesture_occluded'):
                return
        elif pig['direction'] != ref['direction']:
            return
        matched.append((pig, ref))
        unmatched.remove(pig)
    for pig, ref in matched:
        if ref.get('direction_source') == 'manual_visual_review':
            pig['automatic_direction'] = pig['direction']
            pig['direction'] = ref['direction']
            pig['direction_degrees'] = ref['direction_degrees']
            pig['direction_source'] = 'matched_manual_reference'


def intersects_ray(origin, vector, box, margin):
    """射线与扩张矩形相交说明前方可能有猪；宁可保守误判。"""
    x, y, w, h = box
    lower, upper = 0.0, float('inf')
    for coord, delta, minimum, maximum in zip(origin, vector, (x - margin, y - margin), (x + w + margin, y + h + margin)):
        if delta == 0:
            if not minimum <= coord <= maximum:
                return False
            continue
        a, b = (minimum - coord) / delta, (maximum - coord) / delta
        lower, upper = max(lower, min(a, b)), min(upper, max(a, b))
        if lower > upper:
            return False
    return upper >= 0


def choose_pig(pigs, attempted):
    """只选择前方无遮挡、且未在当前棋盘上尝试过的已知方向目标。"""
    options = []
    for pig in pigs:
        direction = pig['direction']
        # 角色动画会产生几像素的中心漂移，不能用精确取整坐标判重。
        tolerance = max(5.0, min(pig['bbox'][2:]) * 0.35)
        if direction not in VECTORS or any(math.dist(pig['center'], center) <= tolerance for center in attempted):
            continue
        margin = min(pig['bbox'][2:]) * 0.25
        blocked = any(intersects_ray(pig['center'], VECTORS[direction], other['bbox'], margin)
                      for other in pigs if other is not pig)
        if not blocked:
            options.append(pig)
    return min(options, key=lambda item: item['id']) if options else None


def reconcile_layout(first, second):
    """对齐两帧候选；未知与已知方向波动时保守标为未知并保留障碍。"""
    if len(first) != len(second):
        return None
    remaining = list(second)
    resolved = []
    for pig in first:
        if not remaining:
            return None
        match = min(remaining, key=lambda candidate: math.dist(pig['center'], candidate['center']))
        tolerance = max(5.0, min(pig['bbox'][2:]) * 0.35)
        if math.dist(pig['center'], match['center']) > tolerance:
            return None
        if pig['direction'] != match['direction'] and 'unknown' not in (pig['direction'], match['direction']):
            return None
        merged = dict(match)
        if pig['direction'] != match['direction']:
            merged.update({'direction': 'unknown', 'direction_degrees': None, 'confidence': 'low',
                           'direction_source': 'unstable_between_frames'})
        resolved.append(merged)
        remaining.remove(match)
    return resolved


def same_layout(first, second):
    return reconcile_layout(first, second) is not None


def save_png(path, image):
    if path.exists():
        raise FileExistsError(f'拒绝覆盖截图: {path}')
    if not cv2.imwrite(str(path), image):
        raise OSError(f'无法保存截图: {path}')


def write_json(path, data):
    # 每个步骤使用新的文件名，写入成功后才允许触发下一次点击。
    with path.open('x', encoding='utf-8') as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write('\n')
        file.flush()
        os.fsync(file.fileno())


def run_session(adapter, output, level, max_steps=200, wait_seconds=1.5, save_steps=False):
    """每步重新识别并计算可移动目标，默认只保存开始和结束画面。"""
    output.mkdir(parents=True, exist_ok=False)
    attempted = []
    previous_count = None
    last_action = None
    last_image = None
    step = 0

    def finish(status, image, clicks):
        name = 'result.png'
        path = output / name
        if not path.exists():
            save_png(path, image)
        write_json(output / 'result.json', {'status': status, 'level': level, 'screenshot': name, 'clicks': clicks})
        return status

    try:
        for step in range(max_steps + 1):
            image = adapter.capture()
            last_image = image
            screenshot = output / f'step-{step:03d}.png'
            if step == 0 or save_steps:
                save_png(screenshot, image)
            if victory_visible(image):
                return finish('victory', image, step)
            board = extract.valid_board(image, None)
            pigs, _, warnings = extract.identify(image, board)
            use_recorded_manual_direction(level, image, pigs)
            if previous_count is not None and len(pigs) < previous_count and last_action:
                # 只有数量下降且被点中的猪确实消失，才认为棋盘发生有效变化。
                if not any(math.dist(pig['center'], last_action['center']) <= 8 for pig in pigs):
                    attempted.clear()
            if step >= max_steps or not pigs:
                status = 'step_limit' if step >= max_steps else 'unrecognized_or_empty'
                return finish(status, image, step)

            # 二次截图既用于检查动画，也以最新检测结果重建阻挡关系。
            latest = adapter.capture()
            last_image = latest
            if victory_visible(latest):
                return finish('victory', latest, step)
            latest_board = extract.valid_board(latest, None)
            current, _, current_warnings = extract.identify(latest, latest_board)
            use_recorded_manual_direction(level, latest, current)
            x, y, w, h = board
            stable_pixels = latest.shape == image.shape and float(np.mean(cv2.absdiff(image[y:y + h, x:x + w], latest[y:y + h, x:x + w]))) <= 8.0
            resolved = reconcile_layout(pigs, current)
            if not stable_pixels or resolved is None:
                return finish('screen_changed', latest, step)
            current = resolved
            choice = choose_pig(current, attempted)
            record = {'step': step, 'level': level,
                      'screenshot': screenshot.name if screenshot.exists() else None,
                      'state_kind': 'observed_at_start' if step == 0 else 'observed_after_click',
                      'previous_action': last_action, 'count': len(current), 'pigs': current,
                      'warnings': current_warnings, 'next_pig_id': choice['id'] if choice else None}
            write_json(output / f'state-{step:03d}.json', record)
            if choice is None:
                return finish('stuck', latest, step)
            # X11 实现继续检查活动窗口、窗口尺寸和鼠标位置。
            adapter.click(choice['center'], latest.shape[1::-1])
            attempted.append(tuple(choice['center']))
            previous_count = len(current)
            last_action = {'pig_id': choice['id'], 'center': choice['center'], 'direction': choice['direction']}
            time.sleep(wait_seconds)
        raise AssertionError('不可到达')
    except (Exception, KeyboardInterrupt) as error:
        # 报错或中断时保留最后画面和原因；不覆盖已有结果或截图。
        if last_image is not None and not (output / 'result.json').exists():
            path = output / f'interrupted-{step:03d}.png'
            if not path.exists():
                save_png(path, last_image)
            write_json(output / 'result.json', {'status': 'interrupted', 'level': level,
                       'screenshot': path.name, 'clicks': step, 'reason': str(error)})
        raise


def with_grid(pigs, grid):
    """为视觉候选计算格子；未知方向仅依据外形判断横竖，不推测前进方向。"""
    converted = []
    for source in pigs:
        pig = dict(source)
        # 腐蚀后的身体比实际占格略短，按格距估算二格或三格，仍需逐帧复核。
        extent = max(pig['bbox'][2:])
        length = round((extent + grid[2] * 0.5) / grid[2])
        if length not in (2, 3):
            raise ValueError('小猪身体长度不能可靠映射到二格或三格')
        pig['length'] = length
        if pig['direction'] == 'unknown':
            _, _, width, height = pig['bbox']
            if width > height * 1.25:
                pig['direction'] = 'east'
            elif height > width * 1.25:
                pig['direction'] = 'south'
            else:
                raise ValueError('小猪方向和横竖形态不明确')
        converted.append(pig)
    warnings = []
    extract.apply_grid(converted, grid, warnings)
    if warnings or any(pig.get('grid') is None for pig in converted):
        raise ValueError('网格位置重叠、越界或不明确：' + '；'.join(warnings))
    for pig, source in zip(converted, pigs):
        pig['direction'] = source['direction']
    return converted


def fill_initial_reference(pigs, level):
    """只有整张第 2 关布局逐一匹配且无方向冲突，才补全未知方向。"""
    if level != 2 or len(pigs) != 61:
        return False
    path = ROOT / 'docs/references/pig-game/extractions/level-02-original/level.json'
    refs = json.loads(path.read_text(encoding='utf-8'))['pigs']
    if len(refs) != len(pigs):
        return False
    remaining = list(refs)
    matches = []
    for pig in pigs:
        ref = min(remaining, key=lambda item: math.dist(pig['center'], item['center']))
        if math.dist(pig['center'], ref['center']) > 10.5:
            return False
        if pig['direction'] != 'unknown' and pig['direction'] != ref['direction']:
            return False
        matches.append((pig, ref))
        remaining.remove(ref)
    for pig, ref in matches:
        if pig['direction'] == 'unknown':
            pig['direction'] = ref['direction']
            pig['direction_source'] = 'matched_complete_initial_reference'
    return True


def stable_initial(adapter, level, first, samples=4):
    """多帧匹配同一只猪，已知方向至少出现两次且不能互相矛盾。"""
    board = extract.valid_board(first, None)
    pigs, _, _ = extract.identify(first, board)
    use_recorded_manual_direction(level, first, pigs)
    votes = [{pig['direction']: 1} if pig['direction'] != 'unknown' else {} for pig in pigs]
    for _ in range(samples - 1):
        frame = adapter.capture()
        if frame.shape != first.shape:
            raise ValueError('窗口尺寸在识别期间变化')
        others, _, _ = extract.identify(frame, board)
        use_recorded_manual_direction(level, frame, others)
        if len(others) != len(pigs):
            raise ValueError('多帧识别数量不一致，可能有漏检或动画')
        remaining = list(others)
        for index, pig in enumerate(pigs):
            match = min(remaining, key=lambda item: math.dist(item['center'], pig['center']))
            # 已观察到高亮动画让同一猪的视觉中心漂移 9 像素；该容差仍小于半格。
            if math.dist(pig['center'], match['center']) > max(10.5, min(pig['bbox'][2:]) * 0.35):
                raise ValueError('多帧位置不一致，棋盘可能正在变化')
            if match['direction'] != 'unknown':
                direction = match['direction']
                votes[index][direction] = votes[index].get(direction, 0) + 1
            remaining.remove(match)
    result = []
    for pig, counts in zip(pigs, votes):
        if len(counts) > 1:
            raise ValueError(f"小猪 {pig['id']} 的方向在画面中发生冲突")
        item = dict(pig)
        item['direction'] = next(iter(counts)) if max(counts.values(), default=0) >= 2 else 'unknown'
        result.append(item)
    if any(pig['direction'] == 'unknown' for pig in result):
        fill_initial_reference(result, level)
    if any(pig['direction'] == 'unknown' for pig in result):
        raise ValueError('存在无法稳定确认方向的小猪')
    return result


def match_expected(observed, expected, directions, grid, lengths=None):
    """按网格匹配整幅棋盘，未知朝向只在位置及横竖形态匹配时沿用计划身份。"""
    converted = with_grid(observed, grid)
    lengths = lengths if lengths is not None else [2] * len(expected)
    wanted = {tuple(position): (directions[index], lengths[index]) for index, position in enumerate(expected) if position is not None}
    if len(converted) != len(wanted):
        return None
    matches = {}
    for pig in converted:
        position = (pig['grid']['col'], pig['grid']['row'])
        target = wanted.get(position)
        if target is None or position in matches:
            return None
        direction, length = target
        if pig['length'] != length:
            return None
        if pig['direction'] != 'unknown' and pig['direction'] != direction:
            return None
        horizontal = pig['bbox'][2] > pig['bbox'][3]
        if horizontal != (direction in ('east', 'west')):
            return None
        matches[position] = pig
    return matches if len(matches) == len(wanted) else None


def run_planned_session(adapter, output, level, grid=None, max_states=100000, timeout=15.0, wait_seconds=1.5, max_steps=200):
    """先求整关完整计划；仅在每次实际状态与计划一致时执行下一步。"""
    output.mkdir(parents=True, exist_ok=False)
    last_image = None
    clicks = 0

    def finish(status, image, **details):
        save_png(output / 'result.png', image)
        write_json(output / 'result.json', {'status': status, 'level': level, 'clicks': clicks,
                   'screenshot': 'result.png', **details})
        return status

    try:
        image = adapter.capture()
        last_image = image
        save_png(output / 'initial.png', image)
        if victory_visible(image):
            return finish('victory', image)
        if grid is None:
            if level != 2:
                return finish('grid_required', image)
            # 第 2 关参数只来自已存原图；其他关不得沿用猜测。
            sx, sy = image.shape[1] / extract.BASE_WIDTH, image.shape[0] / extract.BASE_HEIGHT
            grid = (104 * sx, 299 * sy, 29.85 * (sx + sy) / 2, 12, 15)
        pigs = with_grid(stable_initial(adapter, level, image), grid)
        write_json(output / 'initial-layout.json', {'level': level, 'grid': list(grid), 'pigs': pigs,
                   'note': '候选识别布局；视觉外框不等于游戏碰撞范围'})
        solution = solver.solve(pigs, grid[3], grid[4], max_states=max_states, timeout=timeout)
        write_json(output / 'plan.json', {'status': solution['status'], 'states': solution['states'],
                   'actions': solution['actions'], 'model': 'assumed_slide_to_obstacle_or_exit'})
        if solution['status'] != 'solved':
            return finish(solution['status'], image)
        if len(solution['actions']) > max_steps:
            return finish('plan_step_limit', image, planned_steps=len(solution['actions']))
        expected = list(solution['initial'])
        directions = [pig['direction'] for pig in pigs]
        actions = solution['actions']
        for index, action in enumerate(actions):
            current_image = adapter.capture()
            last_image = current_image
            if victory_visible(current_image):
                return finish('unexpected_victory', current_image)
            current, _, _ = extract.identify(current_image)
            matched = match_expected(current, expected, directions, grid, [pig.get('length', 2) for pig in pigs])
            if matched is None:
                return finish('plan_mismatch', current_image, failed_action=index + 1)
            pos = tuple(action['from'])
            target = matched.get(pos)
            if target is None or expected[action['index']] != pos:
                return finish('plan_target_missing', current_image, failed_action=index + 1)
            write_json(output / f'action-{index + 1:03d}.json', {'action': action,
                       'observed_center': target['center'], 'planned_actions': len(actions)})
            adapter.click(target['center'], current_image.shape[1::-1])
            clicks += 1
            expected[action['index']] = tuple(action['to']) if action['to'] is not None else None
            time.sleep(wait_seconds)
        # 只在计划全部执行后等待成功画面；不会点击下一关。
        for _ in range(5):
            image = adapter.capture()
            last_image = image
            if victory_visible(image):
                return finish('victory', image)
            time.sleep(0.8)
        return finish('victory_not_detected', last_image)
    except (Exception, KeyboardInterrupt) as error:
        if last_image is not None and not (output / 'result.json').exists():
            save_png(output / 'interrupted.png', last_image)
            write_json(output / 'result.json', {'status': 'interrupted', 'level': level, 'clicks': clicks,
                       'screenshot': 'interrupted.png', 'reason': str(error)})
        raise


class XImageHeader(ctypes.Structure):
    """XImage 的公开头部字段；不访问显示服务器内部数据。"""
    _fields_ = [('width', ctypes.c_int), ('height', ctypes.c_int), ('xoffset', ctypes.c_int),
                ('format', ctypes.c_int), ('data', ctypes.c_void_p), ('byte_order', ctypes.c_int),
                ('bitmap_unit', ctypes.c_int), ('bitmap_bit_order', ctypes.c_int), ('bitmap_pad', ctypes.c_int),
                ('depth', ctypes.c_int), ('bytes_per_line', ctypes.c_int), ('bits_per_pixel', ctypes.c_int),
                ('red_mask', ctypes.c_ulong), ('green_mask', ctypes.c_ulong), ('blue_mask', ctypes.c_ulong)]


def decode_ximage(header):
    """仅解码已确认的小端 BGRX 像素格式，返回独立内存。"""
    if (header.width < 1 or header.height < 1 or header.xoffset != 0 or header.format != 2
            or header.byte_order != 0 or header.depth != 24 or header.bits_per_pixel != 32
            or (header.red_mask, header.green_mask, header.blue_mask) != (0xff0000, 0xff00, 0xff)
            or header.bytes_per_line < header.width * 4 or not header.data):
        raise ValueError('X11 图片格式不兼容')
    data = ctypes.string_at(header.data, header.bytes_per_line * header.height)
    rows = np.frombuffer(data, dtype=np.uint8).reshape(header.height, header.bytes_per_line)
    return rows[:, :header.width * 4].reshape(header.height, header.width, 4)[:, :, :3].copy()


class X11Adapter:
    """仅向指定且当前激活的游戏窗口发送 XTest 鼠标输入。"""
    def __init__(self, display, window):
        self.display_name = display
        self.window = window
        self.x = ctypes.CDLL('libX11.so.6')
        self.xtest = ctypes.CDLL('libXtst.so.6')
        ptr, ulong, integer = ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int
        self.x.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.x.XOpenDisplay.restype = ptr
        self.x.XCloseDisplay.argtypes = [ptr]
        self.x.XDefaultRootWindow.argtypes = [ptr]
        self.x.XDefaultRootWindow.restype = ulong
        self.x.XGetGeometry.argtypes = [ptr, ulong, ctypes.POINTER(ulong), ctypes.POINTER(integer), ctypes.POINTER(integer), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
        self.x.XTranslateCoordinates.argtypes = [ptr, ulong, ulong, integer, integer, ctypes.POINTER(integer), ctypes.POINTER(integer), ctypes.POINTER(ulong)]
        self.x.XQueryTree.argtypes = [ptr, ulong, ctypes.POINTER(ulong), ctypes.POINTER(ulong), ctypes.POINTER(ctypes.POINTER(ulong)), ctypes.POINTER(ctypes.c_uint)]
        self.x.XFree.argtypes = [ptr]
        self.x.XQueryPointer.argtypes = [ptr, ulong, ctypes.POINTER(ulong), ctypes.POINTER(ulong), ctypes.POINTER(integer), ctypes.POINTER(integer), ctypes.POINTER(integer), ctypes.POINTER(integer), ctypes.POINTER(ctypes.c_uint)]
        self.x.XSync.argtypes = [ptr, integer]
        self.x.XGetImage.argtypes = [ptr, ulong, integer, integer, ctypes.c_uint, ctypes.c_uint, ulong, integer]
        self.x.XGetImage.restype = ctypes.POINTER(XImageHeader)
        self.x.XDestroyImage.argtypes = [ctypes.POINTER(XImageHeader)]
        self.xtest.XTestFakeMotionEvent.argtypes = [ptr, integer, integer, integer, ulong]
        self.xtest.XTestFakeButtonEvent.argtypes = [ptr, ctypes.c_uint, integer, ulong]
        self.connection = self.x.XOpenDisplay(display.encode())
        if not self.connection:
            raise RuntimeError('无法连接 X11 显示器')
        self.root = self.x.XDefaultRootWindow(self.connection)
        if window == self.root:
            self.close()
            raise ValueError('不能向根窗口发送操作')

    def close(self):
        if self.connection:
            self.x.XCloseDisplay(self.connection)
            self.connection = None

    def ensure_active(self):
        try:
            result = subprocess.run(['xprop', '-display', self.display_name, '-root', '_NET_ACTIVE_WINDOW'], check=True, capture_output=True, text=True, timeout=5)
        except (OSError, subprocess.SubprocessError) as error:
            raise RuntimeError('无法验证活动窗口') from error
        ids = re.findall(r'0x[0-9a-fA-F]+', result.stdout)
        if not ids or int(ids[-1], 16) != self.window:
            raise RuntimeError('游戏窗口不是活动窗口，已停止')

    def capture(self):
        self.ensure_active()
        root, x, y = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_int()
        width, height, border, depth = (ctypes.c_uint() for _ in range(4))
        if not self.x.XGetGeometry(self.connection, self.window, ctypes.byref(root), ctypes.byref(x), ctypes.byref(y),
                                   ctypes.byref(width), ctypes.byref(height), ctypes.byref(border), ctypes.byref(depth)):
            raise RuntimeError('无法获取窗口尺寸')
        pointer = self.x.XGetImage(self.connection, self.window, 0, 0, width.value, height.value, ctypes.c_ulong(-1).value, 2)
        if pointer:
            try:
                try:
                    image = decode_ximage(pointer.contents)
                except ValueError:
                    image = None
            finally:
                self.x.XDestroyImage(pointer)
            if image is not None:
                extract.verify_game_window(image)
                return image
        image, _ = extract.read_image(None, self.display_name, None, self.window)
        return image

    def top_window(self):
        current = self.window
        for _ in range(32):
            root, parent = ctypes.c_ulong(), ctypes.c_ulong()
            children = ctypes.POINTER(ctypes.c_ulong)()
            count = ctypes.c_uint()
            if not self.x.XQueryTree(self.connection, current, ctypes.byref(root), ctypes.byref(parent), ctypes.byref(children), ctypes.byref(count)):
                raise RuntimeError('无法验证窗口层级')
            if children:
                self.x.XFree(children)
            if parent.value == self.root:
                return current
            if not parent.value or current == parent.value:
                break
            current = parent.value
        raise RuntimeError('无法定位目标窗口的顶层窗口')

    def click(self, center, image_size):
        self.ensure_active()
        root = ctypes.c_ulong()
        x, y = ctypes.c_int(), ctypes.c_int()
        width, height, border, depth = (ctypes.c_uint() for _ in range(4))
        if not self.x.XGetGeometry(self.connection, self.window, ctypes.byref(root), ctypes.byref(x), ctypes.byref(y), ctypes.byref(width), ctypes.byref(height), ctypes.byref(border), ctypes.byref(depth)):
            raise RuntimeError('无法获取窗口尺寸')
        if (width.value, height.value) != tuple(image_size):
            raise RuntimeError('窗口尺寸已变化，停止点击')
        ox, oy, child = ctypes.c_int(), ctypes.c_int(), ctypes.c_ulong()
        if not self.x.XTranslateCoordinates(self.connection, self.window, self.root, 0, 0, ctypes.byref(ox), ctypes.byref(oy), ctypes.byref(child)):
            raise RuntimeError('无法转换窗口坐标')
        cx, cy = (round(value) for value in center)
        if not (0 <= cx < width.value and 0 <= cy < height.value):
            raise ValueError('目标坐标不在游戏窗口内')
        if not self.xtest.XTestFakeMotionEvent(self.connection, -1, ox.value + cx, oy.value + cy, 0):
            raise RuntimeError('XTest 鼠标移动失败')
        self.x.XSync(self.connection, 0)
        self.ensure_active()
        root_ret, child_ret = ctypes.c_ulong(), ctypes.c_ulong()
        rx, ry, wx, wy = (ctypes.c_int() for _ in range(4))
        mask = ctypes.c_uint()
        if not self.x.XQueryPointer(self.connection, self.root, ctypes.byref(root_ret), ctypes.byref(child_ret), ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(mask)) or child_ret.value != self.top_window():
            raise RuntimeError('目标位置被其他窗口遮挡，停止点击')
        pressed = self.xtest.XTestFakeButtonEvent(self.connection, 1, 1, 0)
        released = self.xtest.XTestFakeButtonEvent(self.connection, 1, 0, 0)
        self.x.XSync(self.connection, 0)
        if not pressed or not released:
            raise RuntimeError('XTest 鼠标点击失败')


def main(argv=None):
    parser = argparse.ArgumentParser(description='自动尝试当前猪关卡；保存状态与通关画面，不切换关卡。')
    parser.add_argument('--level', required=True, type=int, help='当前关卡编号')
    parser.add_argument('--window-id', required=True, type=extract.parse_window_id, help='游戏的 X11 窗口 ID')
    parser.add_argument('--display', default=':1')
    parser.add_argument('--output', type=Path, required=True, help='新建的证据目录，不覆盖现有目录')
    parser.add_argument('--max-steps', type=int, default=200)
    parser.add_argument('--wait', type=float, default=1.5, help='点击后等待动画的秒数，最小 1 秒')
    parser.add_argument('--grid', type=extract.parse_grid, help='网格首格中心 x,y,格距,列数,行数；第 2 关可自动使用参考参数')
    parser.add_argument('--search-states', type=int, default=100000, help='搜索状态数上限')
    parser.add_argument('--search-timeout', type=float, default=15.0, help='搜索时限（秒）')
    args = parser.parse_args(argv)
    if args.level < 1 or args.max_steps < 1 or args.search_states < 1 or not math.isfinite(args.search_timeout) or args.search_timeout <= 0 or not math.isfinite(args.wait) or args.wait < 1:
        parser.error('关卡和最大步骤应为正整数，等待时间至少 1 秒')
    adapter = None
    try:
        adapter = X11Adapter(args.display, args.window_id)
        status = run_planned_session(adapter, args.output, args.level, args.grid, args.search_states, args.search_timeout, args.wait, args.max_steps)
        print(f'状态：{status}；证据保存在 {args.output}；脚本不会切换关卡')
        return 0 if status == 'victory' else 2
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'自动游玩停止：{error}；已有证据保存在 {args.output}', file=sys.stderr)
        return 1
    finally:
        if adapter:
            adapter.close()


if __name__ == '__main__':
    raise SystemExit(main())
