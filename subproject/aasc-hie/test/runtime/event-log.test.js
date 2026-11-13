import { describe, expect, it } from 'vitest';
import { EventLog } from '../../src/runtime/event-log.js';

describe('EventLog', () => {
  it('appends immutable event copies in order', async () => {
    const log = new EventLog({ limit: 2 });
    const event = { type: 'tick', state: { value: 1 } };
    await log.append(event);
    event.state.value = 9;
    await log.append({ type: 'second' });
    await log.append({ type: 'third' });

    expect(log.snapshot()).toEqual([{ type: 'second' }, { type: 'third' }]);
  });
});
