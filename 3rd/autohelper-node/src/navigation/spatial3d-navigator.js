import { Navigator } from './navigator.js';
const directionVector = (direction) => {
    switch (direction) {
        case 'left':
            return { x: -1, y: 0 };
        case 'right':
            return { x: 1, y: 0 };
        case 'backward':
            return { x: 0, y: 1 };
        case 'forward':
        default:
            return { x: 0, y: -1 };
    }
};
const noInstruction = (confidence, reason, state) => ({
    mode: 'none',
    confidence,
    reason,
    state,
});
export class Spatial3dNavigator extends Navigator {
    perception;
    confidenceThreshold;
    jumpDistance;
    now;
    revision = 0;
    interactables = new Map();
    constructor(options) {
        super(options.id ?? 'spatial-3d', 'spatial-3d');
        this.perception = options.perception;
        this.confidenceThreshold = options.confidenceThreshold ?? 0.6;
        this.jumpDistance = options.jumpDistance ?? 1;
        this.now = options.now ?? (() => new Date().toISOString());
        if (!Number.isFinite(this.confidenceThreshold)
            || this.confidenceThreshold < 0 || this.confidenceThreshold > 1) {
            throw new Error('spatial confidence threshold must be between 0 and 1');
        }
        if (!Number.isFinite(this.jumpDistance) || this.jumpDistance <= 0) {
            throw new Error('spatial jump distance must be positive');
        }
    }
    async getCurrentState(frame) {
        try {
            const observation = await this.observe(frame);
            const confirmed = observation.region !== 'unknown'
                && observation.confidence >= this.confidenceThreshold;
            return {
                navigatorId: this.id,
                mode: this.mode,
                id: confirmed ? observation.region : undefined,
                status: confirmed ? 'confirmed' : 'unknown',
                confidence: observation.confidence,
                observedAt: this.now(),
                data: {
                    region: observation.region,
                    distance: observation.distance,
                    interactables: observation.interactables,
                },
            };
        }
        catch (error) {
            return {
                navigatorId: this.id,
                mode: this.mode,
                status: 'error',
                confidence: 0,
                observedAt: this.now(),
                data: {
                    error: error instanceof Error ? error.message : String(error),
                },
            };
        }
    }
    async generateInstruction(frame, target) {
        let observation;
        try {
            observation = await this.observe(frame);
        }
        catch (error) {
            return noInstruction(0, 'spatial-perception-failed');
        }
        const state = {
            navigatorId: this.id,
            mode: this.mode,
            id: observation.region === 'unknown' ? undefined : observation.region,
            status: observation.region !== 'unknown'
                && observation.confidence >= this.confidenceThreshold
                ? 'confirmed'
                : 'unknown',
            confidence: observation.confidence,
            observedAt: this.now(),
            data: { region: observation.region, distance: observation.distance },
        };
        if (state.status !== 'confirmed') {
            return noInstruction(state.confidence, 'spatial-state-not-confirmed', state);
        }
        const closeObstacle = (observation.region === 'jumpable'
            || observation.region === 'obstacle')
            && observation.distance !== undefined
            && observation.distance <= this.jumpDistance;
        if (closeObstacle) {
            return {
                mode: 'spatial-3d',
                action: 'jump',
                confidence: observation.confidence,
                reason: 'close-jumpable-obstacle',
            };
        }
        if (observation.region === 'water') {
            return {
                mode: 'spatial-3d',
                action: 'stop',
                confidence: observation.confidence,
                reason: 'water-ahead',
            };
        }
        const vector = directionVector(target.preferredDirection);
        return {
            mode: 'spatial-3d',
            action: 'move',
            vector,
            durationMs: target.moveDurationMs ?? 300,
            confidence: observation.confidence,
            reason: observation.region === 'walkable' ? 'clear-road' : 'continue-spatial-navigation',
        };
    }
    getMapSnapshot() {
        return {
            revision: this.revision,
            interactables: [...this.interactables.values()].map((item) => ({
                ...item,
                bounds: item.bounds ? { ...item.bounds } : undefined,
                position: item.position ? { ...item.position } : undefined,
            })),
        };
    }
    async observe(frame) {
        const observation = await this.perception.analyze(frame);
        this.revision += 1;
        for (const interactable of observation.interactables) {
            this.interactables.set(interactable.id, {
                ...interactable,
                bounds: interactable.bounds ? { ...interactable.bounds } : undefined,
                position: interactable.position ? { ...interactable.position } : undefined,
            });
        }
        return observation;
    }
}
