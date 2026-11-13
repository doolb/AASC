import { describe, expect, it } from 'vitest';
import { HttpRouter } from '../../src/server/http-router.js';

describe('HttpRouter', () => {
  it('matches method and parameterized path and parses JSON bodies', async () => {
    const router = new HttpRouter();
    router.post('/api/items/:id', async (_request, params, body) => ({ status: 201, body: { id: params.id, body } }));
    const response = await router.dispatch({ method: 'POST', url: '/api/items/a%2Db', headers: { 'content-type': 'application/json' } }, '{"ok":true}');

    expect(response).toEqual({ status: 201, body: { id: 'a-b', body: { ok: true } } });
  });
});
