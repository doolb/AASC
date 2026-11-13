# Model registry

Model binaries are kept outside navigation packages, but the runtime copies
used by the current roles are provisioned inside this project:

- yolo11/ contains the YOLO detection and segmentation ONNX files plus labels.
- anydepth/ contains the AnyDepth FP16 and FP32 ONNX files.
- legacy/ contains the migrated model registration JSON files.

Package configuration may refer to a registered model ID; the recognition layer
owns loading and lifecycle. Do not commit credentials or unrelated model
artifacts here.
