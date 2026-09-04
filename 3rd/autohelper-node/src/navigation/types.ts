import type { Point, Rect } from '../types.js';

export type NavigationMode = 'ui' | 'spatial-3d' | 'combat';

export type GoalKind = 'ui' | 'spatial-3d' | 'combat' | 'interaction' | 'compound';

export type GameGoal = {
  id: string;
  kind: GoalKind;
  title?: string;
  navigationMode?: NavigationMode;
  actionName?: string;
  flowId?: string;
  success?: string;
  priority?: number;
  required?: boolean;
  parent?: string;
  delegate?: string;
  metadata?: Record<string, string>;
  steps?: GameGoal[];
};

export type NavigatorStateStatus = 'confirmed' | 'unknown' | 'ambiguous' | 'error';

export type NavigatorState = {
  navigatorId: string;
  mode: NavigationMode;
  id?: string;
  status: NavigatorStateStatus;
  confidence: number;
  observedAt: string;
  data: Record<string, unknown>;
};

export type NavigationInstruction =
  | {
      mode: 'ui';
      action: 'tap';
      point: Point;
      confidence: number;
      stateId?: string;
      actionName?: string;
      gotoFlow?: string;
    }
  | {
      mode: 'ui';
      action: 'switch-flow';
      flowId: string;
      confidence: number;
      reason: string;
    }
  | {
      mode: 'ui';
      action: 'wait';
      durationMs: number;
      confidence: number;
      reason: string;
    }
  | {
      mode: 'spatial-3d';
      action: 'move' | 'turn';
      vector: Point;
      durationMs: number;
      confidence: number;
      reason: string;
    }
  | {
      mode: 'spatial-3d';
      action: 'jump' | 'stop';
      confidence: number;
      reason: string;
    }
  | {
      mode: 'none';
      confidence: number;
      reason: string;
      state?: NavigatorState;
    };

export type SpatialRegion = 'unknown' | 'walkable' | 'water' | 'obstacle' | 'jumpable';

export type SpatialInteractable = {
  id: string;
  kind: string;
  confidence: number;
  distance?: number;
  bounds?: Rect;
  position?: { x: number; y: number; z?: number };
};

export type SpatialObservation = {
  region: SpatialRegion;
  confidence: number;
  distance?: number;
  interactables: SpatialInteractable[];
  heading?: number;
  data?: Record<string, unknown>;
};

export type SpatialPerception = {
  analyze(frame: Buffer): Promise<SpatialObservation>;
};

export type SpatialMapSnapshot = {
  revision: number;
  interactables: SpatialInteractable[];
};

export type UiNavigatorTarget = GameGoal & {
  actionName?: string;
  flowId?: string;
};

export type Spatial3dNavigatorTarget = GameGoal & {
  preferredDirection?: 'left' | 'right' | 'forward' | 'backward';
  moveDurationMs?: number;
  jumpDistance?: number;
};
