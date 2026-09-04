export class Navigator {
    id;
    mode;
    constructor(id, mode) {
        if (!id.trim()) {
            throw new Error('navigator id is required');
        }
        this.id = id.trim();
        this.mode = mode;
    }
}
