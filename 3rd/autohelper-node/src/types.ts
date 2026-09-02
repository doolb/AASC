export type Point = {
  x: number;
  y: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FrameSize = {
  width: number;
  height: number;
};

export type MatchMethod = 'template' | 'orb';

export type ImageDescriptor = {
  name: string;
  flowId: string;
  filePath: string;
  queue: number;
  threshold: number;
  clickPoint: Point;
  centerClick: boolean;
  delayMs: number;
  loop: boolean;
  wait: boolean;
  defaultCandidate: boolean;
  selectImage?: string;
  gotoFlow?: string;
};

export type LoadedTemplate = {
  descriptor: ImageDescriptor;
  buffer: Buffer;
};

export type MatchResult = {
  score: number;
  rect: Rect | null;
  matched: boolean;
  method: MatchMethod;
};

export type MatchCandidate = {
  descriptor: ImageDescriptor;
  match: MatchResult;
};

export type SelectedAction = {
  descriptor: ImageDescriptor;
  match: MatchResult;
};

export type FlowContext = {
  id: string;
  directory: string;
  descriptors: ImageDescriptor[];
  templates: LoadedTemplate[];
};

export type AdbCommandResult = {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
};

export type AdbRunnerOptions = {
  cwd?: string;
  timeoutMs?: number;
};

export type AdbRunner = (
  file: string,
  args: string[],
  options?: AdbRunnerOptions,
) => Promise<AdbCommandResult>;

export type AdbClientLike = {
  assertConnected(): Promise<void>;
  screenshot(): Promise<Buffer>;
  tap(x: number, y: number): Promise<void>;
};

export type AutomationOptions = {
  intervalMs: number;
  matcher: MatchMethod;
  dryRun: boolean;
  once: boolean;
  maxTransitions: number;
  signal?: AbortSignal;
};
