import type {
  GameGoal,
  NavigationInstruction,
  NavigationMode,
  NavigatorState,
} from './types.js';

export abstract class Navigator<TTarget extends GameGoal = GameGoal> {
  public readonly id: string;
  public readonly mode: NavigationMode;

  public constructor(id: string, mode: NavigationMode) {
    if (!id.trim()) {
      throw new Error('navigator id is required');
    }
    this.id = id.trim();
    this.mode = mode;
  }

  public abstract getCurrentState(frame: Buffer): Promise<NavigatorState>;

  public abstract generateInstruction(
    frame: Buffer,
    target: TTarget,
  ): Promise<NavigationInstruction>;
}
