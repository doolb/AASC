"""用官方HMR2.0b权重内的网络与SMPL张量输出三图BODY25。"""
import json
import argparse
import os
import sys
import time
from pathlib import Path
from audit import main as audit_resources

BASE = Path(__file__).resolve().parent
ASSETS = BASE / "hmr2-assets"
REPO = BASE / "vendor" / "4D-Humans"
CHECKPOINT = Path(os.environ.get("HMR2_CHECKPOINT_PATH", ASSETS / "logs/train/multiruns/hmr2/0/checkpoints/epoch=35-step=1000000.ckpt"))
SMPL_KEYS = {
    "smpl.shapedirs": (6890, 3, 10),
    "smpl.v_template": (6890, 3),
    "smpl.J_regressor": (24, 6890),
    "smpl.posedirs": (207, 20670),
    "smpl.parents": (24,),
    "smpl.lbs_weights": (6890, 24),
    "smpl.joint_map": (25,),
    "smpl.vertex_joint_selector.extra_joints_idxs": (21,),
}

# 官方SMPL层的前25点是OpenPose BODY_25序，不能按SMPL原关节序标左右。
NAMES = [
    "nose", "neck", "right_shoulder", "right_elbow", "right_wrist",
    "left_shoulder", "left_elbow", "left_wrist", "mid_hip", "right_hip",
    "right_knee", "right_ankle", "left_hip", "left_knee", "left_ankle",
    "right_eye", "left_eye", "right_ear", "left_ear", "left_big_toe",
    "left_small_toe", "left_heel", "right_big_toe", "right_small_toe", "right_heel",
]
EDGES = [
    [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7],
    [1, 8], [8, 9], [9, 10], [10, 11], [8, 12], [12, 13], [13, 14],
    [0, 1], [0, 15], [0, 16], [15, 17], [16, 18],
    [11, 22], [22, 23], [11, 24], [14, 19], [19, 20], [14, 21],
]

# BODY25左右交换表：镜像输入映回原图时必须同步恢复人物语义。
MIRROR_JOINTS = [0, 1, 5, 6, 7, 2, 3, 4, 8, 12, 13, 14, 9, 10, 11,
                 16, 15, 18, 17, 22, 23, 24, 19, 20, 21]


def foot_trial_samples(sample):
    x, y, width, height = sample["box"]
    variants = [
        ("wide", [max(0, x - 22), max(0, y - 8), width + 44, height + 24], False),
        ("shift-left", [x - 18, y, width, height], False),
        ("shift-right", [x + 18, y, width, height], False),
        ("mirror", sample["box"], True),
    ]
    return [{**sample, "variant": name, "box": box, "flip": flip}
            for name, box, flip in variants]


def require_resources():
    resources = [
        ("HMR2.0b官方checkpoint", CHECKPOINT),
        ("官方配置", CHECKPOINT.parent.parent / "model_config.yaml"),
        ("姿态均值参数", ASSETS / "data/smpl_mean_params.npz"),
    ]
    missing = [name for name, path in resources if not path.is_file()]
    if missing:
        raise FileNotFoundError("缺少" + "、".join(missing) + "；不能生成HMR2.0b骨骼结果")


def select_state(state, prefix):
    return {key[len(prefix):]: value for key, value in state.items() if key.startswith(prefix)}


def check_smpl_state(state):
    # checkpoint实际包含原版SMPL层缓冲区；逐个确认尺寸，避免悄悄用默认人体代替。
    for key, shape in SMPL_KEYS.items():
        tensor = state.get(key)
        if tensor is None or tuple(tensor.shape) != shape:
            raise ValueError(f"HMR2.0b checkpoint缺少完整SMPL张量：{key}，期望{shape}")
    expected_body25 = [24, 12, 17, 19, 21, 16, 18, 20, 0, 2, 5, 8, 1, 4, 7,
                       25, 26, 27, 28, 29, 30, 31, 32, 33, 34]
    if state["smpl.joint_map"].tolist() != expected_body25:
        raise ValueError("checkpoint BODY25关节顺序不同，不能沿用当前左右标签")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--anime-foot-trials", action="store_true")
    parser.add_argument("--custom-image", type=Path)
    parser.add_argument("--custom-box", nargs=4, type=int)
    parser.add_argument("--custom-output", type=Path)
    args = parser.parse_args()
    if args.custom_image:
        if args.anime_foot_trials or not args.custom_box or not args.custom_output:
            parser.error("自选图片必须同时给出人物框和输出文件，不能与脚掌试验混用")
    elif args.custom_box or args.custom_output:
        parser.error("人物框和输出文件只能用于自选图片")
    else:
        audit_resources()
    require_resources()
    audit_status = json.loads((BASE / "status.json").read_text(encoding="utf-8"))
    sys.path.insert(0, str(REPO))
    import cv2
    import numpy as np
    import psutil
    import torch
    import hmr2.configs as configs
    from hmr2.models.backbones import create_backbone
    from hmr2.models.heads import build_smpl_head
    from hmr2.datasets.vitdet_dataset import ViTDetDataset
    from hmr2.utils.renderer import cam_crop_to_full
    from smplx.lbs import lbs

    # 官方配置的缓存根重定向到忽略目录，不修改HOME或用户全局模型缓存。
    configs.CACHE_DIR_4DHUMANS = str(ASSETS)
    config = configs.get_config(str(CHECKPOINT.parent.parent / "model_config.yaml"), update_cachedir=True)
    if config.MODEL.BACKBONE.TYPE == "vit" and "BBOX_SHAPE" not in config.MODEL:
        config.defrost()
        config.MODEL.BBOX_SHAPE = [192, 256]
        config.freeze()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    torch.set_num_threads(4)
    started = time.perf_counter()
    checkpoint = torch.load(CHECKPOINT, map_location="cpu", mmap=True, weights_only=False)
    state = checkpoint["state_dict"]
    check_smpl_state(state)
    backbone = create_backbone(config)
    head = build_smpl_head(config)
    backbone.load_state_dict(select_state(state, "backbone."), strict=True)
    head.load_state_dict(select_state(state, "smpl_head."), strict=True)
    # 上游ViT.train()没有返回self，因此不能把eval()与to()串接。
    backbone.train(False)
    backbone = backbone.to(device)
    head = head.eval().to(device)
    smpl = {key.removeprefix("smpl."): state[key].to(device) for key in SMPL_KEYS}
    load_ms = (time.perf_counter() - started) * 1000
    samples = ([{"name": "custom", "image": str(args.custom_image), "box": args.custom_box}]
               if args.custom_image else json.loads((BASE / "sample-config.json").read_text(encoding="utf-8"))["samples"])
    if args.anime_foot_trials:
        anime = next(sample for sample in samples if sample["name"] == "anime")
        samples = foot_trial_samples(anime)
    results_dir = BASE / "results"
    results_dir.mkdir(exist_ok=True)
    for sample in samples:
        image = cv2.imread(sample["image"])
        if image is None:
            raise FileNotFoundError("原图无法解码：" + sample["name"])
        height, width = image.shape[:2]
        box_values = sample["box"]
        if args.custom_image:
            x, y, box_width, box_height = box_values
            if x < 0 or y < 0 or box_width < 1 or box_height < 1 or x + box_width > width or y + box_height > height:
                raise ValueError("人物框超出图片")
        if sample.get("flip"):
            image = cv2.flip(image, 1)
            box_values = [width - box_values[0] - box_values[2], box_values[1], box_values[2], box_values[3]]
        box = np.asarray([box_values], dtype=np.float32)
        dataset = ViTDetDataset(config, image, box)
        batch = next(iter(torch.utils.data.DataLoader(dataset, batch_size=1, num_workers=0)))
        batch = {key: value.to(device) if torch.is_tensor(value) else value for key, value in batch.items()}
        with torch.inference_mode():
            began = time.perf_counter()
            features = backbone(batch["img"][:, :, :, 32:-32])
            params, pred_cam, _ = head(features)
            full_pose = torch.cat([params["global_orient"], params["body_pose"]], dim=1)
            vertices, joints = lbs(
                params["betas"].float(), full_pose.float(), smpl["v_template"],
                smpl["shapedirs"], smpl["posedirs"], smpl["J_regressor"],
                smpl["parents"], smpl["lbs_weights"], pose2rot=False,
            )
            # 与官方SMPLLayer相同：追加由顶点取得的21点，再按BODY25索引排序。
            extra = vertices.index_select(1, smpl["vertex_joint_selector.extra_joints_idxs"].long())
            body25 = torch.cat([joints, extra], dim=1).index_select(1, smpl["joint_map"].long())
            infer_ms = (time.perf_counter() - began) * 1000
            focal = config.EXTRA.FOCAL_LENGTH / config.MODEL.IMAGE_SIZE * max(width, height)
            camera = cam_crop_to_full(
                pred_cam, batch["box_center"].float(),
                batch["box_size"].float(), batch["img_size"].float(), focal,
            )[0]
            xyz = body25[0].float()
            camera_xyz = xyz + camera[None]
            xy = torch.stack([
                focal * camera_xyz[:, 0] / camera_xyz[:, 2] + width / 2,
                focal * camera_xyz[:, 1] / camera_xyz[:, 2] + height / 2,
            ], dim=-1)
            if sample.get("flip"):
                indices = torch.tensor(MIRROR_JOINTS, device=device)
                # 投影与XYZ采用相同交换，翻回X后仍可由相机投影复算。
                xy = xy.index_select(0, indices)
                xy[:, 0] = width - xy[:, 0]
                xyz = xyz.index_select(0, indices)
                xyz[:, 0] = -xyz[:, 0]
                camera = camera.clone()
                camera[0] = -camera[0]
        if not torch.isfinite(xy).all() or not torch.isfinite(xyz).all() or not torch.all(camera_xyz[:, 2] > 0):
            raise ValueError("HMR2.0b返回非有限坐标：" + sample["name"])
        result = {
            "model": "HMR2.0b", "sample": sample["name"], "source": "official 4D-Humans checkpoint; embedded SMPL buffers via smplx.lbs",
            "provenance": {"sourceCommit": audit_status["source"]["hmr2"], "localPatch": audit_status["sourcePatches"]["hmr2"], "checkpointSha256": audit_status["resources"]["hmr2Checkpoint"].get("sha256"), "smplSource": "same checkpoint state_dict"},
            "names": NAMES, "edges": EDGES,
            "xyz": xyz.cpu().tolist(), "xy": xy.cpu().tolist(),
            "camera": {"translation": camera.cpu().tolist(), "focalLengthPx": float(focal), "principalPoint": [width / 2, height / 2]},
            "box": sample["box"], "imageSize": [width, height], "device": str(device),
            "variant": sample.get("variant", "original"), "mirroredInput": bool(sample.get("flip")),
            "modelLoadMs": load_ms, "inferenceMs": infer_ms,
            "peakWorkingSetMiB": psutil.Process().memory_info().peak_wset / 1048576,
            "peakGpuAllocatedMiB": torch.cuda.max_memory_allocated() / 1048576 if device.type == "cuda" else None,
        }
        suffix = f"-{sample['variant']}" if sample.get("variant") else ""
        destination = args.custom_output if args.custom_image else results_dir / f"hmr2-{sample['name']}{suffix}.json"
        destination.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(sample["name"] + suffix, "inference ms", round(infer_ms), flush=True)


if __name__ == "__main__":
    main()
