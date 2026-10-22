// 原BODY25标签与24连线原序：不交换左右，不用24FK顶替SMPL足趾/脚跟。
export const BODY25_NAMES = Object.freeze([
  'nose', 'neck', 'right_shoulder', 'right_elbow', 'right_wrist',
  'left_shoulder', 'left_elbow', 'left_wrist', 'mid_hip', 'right_hip',
  'right_knee', 'right_ankle', 'left_hip', 'left_knee', 'left_ankle',
  'right_eye', 'left_eye', 'right_ear', 'left_ear', 'left_big_toe',
  'left_small_toe', 'left_heel', 'right_big_toe', 'right_small_toe', 'right_heel',
]);
export const BODY25_EDGES = Object.freeze([
  [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7],
  [1, 8], [8, 9], [9, 10], [10, 11], [8, 12], [12, 13], [13, 14],
  [0, 1], [0, 15], [0, 16], [15, 17], [16, 18],
  [11, 22], [22, 23], [11, 24], [14, 19], [19, 20], [14, 21],
].map((edge) => Object.freeze(edge)));
export const NODE_SOURCE = 'official 4D-Humans checkpoint; complete ONNX graph with embedded SMPL LBS';
