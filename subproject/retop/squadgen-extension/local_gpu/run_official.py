"""运行未修改的官方 main；只加资源限额、日志与中间结果观测。"""
import argparse
import hashlib
from pathlib import Path
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import torch
import infer_sqdiffuse as official
from local_cpu.run_shoulder import save_json, log
from local_train.runtime import tree_to


def require_fresh_field(field, started_wall):
    # 原版会吞掉单样本异常，必须拒绝沿用上次产物冒充本次完成。
    if field is None or not field.is_file() or field.stat().st_mtime < started_wall:
        raise RuntimeError('官方入口未生成本次的新预测场；检查原始日志中的单样本异常')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report-dir', required=True, type=Path)
    args, forwarded = parser.parse_known_args()
    output = args.report_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = dict(status='running', argv=forwarded, native_attention=True,
        official_entry_sha256=hashlib.sha256((ROOT / 'infer_sqdiffuse.py').read_bytes()).hexdigest(),
        instrumentation='resource limits, forward timing, CPU copies of intermediate outputs; no value changes')
    save_json(output / 'status.json', report)
    started = time.monotonic()
    started_wall = time.time()
    evaluations = 0
    decode_calls = 0
    prepared_output = None
    original_prepare = official.prepare_mesh_inputs
    original_load = official.load_sqdiffuse
    original_decode = official.decode_in_chunks

    def capture_prepare(*values, **kwargs):
        nonlocal prepared_output
        result = original_prepare(*values, **kwargs)
        # 保存原版返回值供后续逐阶段比较，不回传副本、不改变原版张量布局。
        batch, queries, _, _ = result
        torch.save(tree_to(dict(batch=batch, queries=queries), 'cpu'), output / 'prepared-official.pt')
        prepared_output = Path(values[2])
        log('官方预处理完成并保存原始中间结果')
        return result

    def capture_load(*values, **kwargs):
        model = original_load(*values, **kwargs)
        original_condition = model.get_latent_and_condition
        original_forward = model.forward

        def capture_condition(*items, **options):
            result = original_condition(*items, **options)
            torch.save(tree_to(result['condition_params'], 'cpu'), output / 'condition-official.pt')
            return result

        def observe_forward(*inputs, **options):
            nonlocal evaluations
            # 官方采样器直接调用 model.forward，不能依赖只在 __call__ 触发的 Module hook。
            result = original_forward(*inputs, **options)
            torch.cuda.synchronize()
            evaluations += 1
            tick = float(inputs[1][0])
            log(f'官方扩散 NFE={evaluations} t={tick:.6f} elapsed={time.monotonic()-started:.1f}s')
            save_json(output / 'progress.json', dict(evaluations=evaluations, time=tick,
                elapsed_seconds=time.monotonic()-started))
            return result

        model.get_latent_and_condition = capture_condition
        model.forward = observe_forward
        return model

    def capture_decode(ae, latent, queries, n_max_query, mix_precision):
        nonlocal decode_calls
        decode_calls += 1
        if decode_calls == 1:
            torch.save(latent.detach().float().cpu(), output / 'latent-official.pt')
        log(f'官方解码调用 {decode_calls}，查询 {queries.shape[1]}，块 {n_max_query}')
        return original_decode(ae, latent, queries, n_max_query, mix_precision)

    try:
        torch.set_num_threads(4)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.cuda.set_per_process_memory_fraction(16 * 1024**3 / torch.cuda.get_device_properties(0).total_memory)
        official.prepare_mesh_inputs = capture_prepare
        official.load_sqdiffuse = capture_load
        official.decode_in_chunks = capture_decode
        sys.argv = [str(ROOT / 'infer_sqdiffuse.py'), *forwarded]
        official.main()
        field = None if prepared_output is None else prepared_output / 'gen_000/extract_mesh.npz'
        require_fresh_field(field, started_wall)
        report.update(status='completed-fields', field=str(field), geometry_quality='not-yet-audited')
    except Exception as error:
        report.update(status='failed', error=str(error), traceback=traceback.format_exc())
        raise
    finally:
        report.update(seconds=time.monotonic()-started, evaluations=evaluations, torch=str(torch.__version__),
            peak_allocated=torch.cuda.max_memory_allocated(), peak_reserved=torch.cuda.max_memory_reserved())
        save_json(output / 'status.json', report)


if __name__ == '__main__':
    main()
