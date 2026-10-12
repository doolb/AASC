'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const loadTimer = () => import('../src/apps/web-mediacenter/ui/public/js/mmd-gpu-timer.mjs');

// 两套 mock 只提供各自版本的计时查询接口，不借助浏览器或 WebGL 构造器判断版本。
// 所有驱动调用都留痕；未就绪读取、重复删除和丢失上下文上的查询操作会主动报错。
function createMockGl(version, { supported = true } = {}) {
    const constants = {
        timeElapsed: 0x88bf,
        disjoint: 0x8fbb,
        current: 0x8865,
        available: 0x8867,
        result: 0x8866
    };
    const state = {
        supported,
        lost: false,
        disjoint: false,
        active: null,
        created: [],
        deleted: [],
        calls: [],
        failures: new Map(),
        afterResult: null,
        nullQuery: false
    };
    const invoke = (operation, args, action) => {
        state.calls.push({ operation, args });
        const remaining = state.failures.get(operation) || 0;
        if (remaining > 0) {
            state.failures.set(operation, remaining - 1);
            throw new Error(`模拟驱动异常：${operation}`);
        }
        if (state.lost && operation !== 'isContextLost') {
            throw new Error(`上下文丢失后禁止调用：${operation}`);
        }
        return action();
    };
    const create = () => invoke('create', [], () => {
        if (state.nullQuery) return null;
        const query = { id: state.created.length + 1, available: false, ns: 0, ended: false };
        state.created.push(query);
        return query;
    });
    const current = (target, parameter) => invoke('current', [target, parameter], () => {
        assert.equal(target, constants.timeElapsed);
        assert.equal(parameter, constants.current);
        return state.active;
    });
    const begin = (target, query) => invoke('begin', [target, query], () => {
        assert.equal(target, constants.timeElapsed);
        assert.equal(state.active, null, '禁止嵌套已有时间查询');
        assert.ok(state.created.includes(query), '只允许开始本 mock 创建的查询');
        state.active = query;
    });
    const end = target => invoke('end', [target], () => {
        assert.equal(target, constants.timeElapsed);
        assert.ok(state.active, '没有活动查询时不能结束');
        state.active.ended = true;
        state.active = null;
    });
    const remove = query => invoke('delete', [query], () => {
        assert.ok(state.created.includes(query), '不得删除外部查询');
        assert.ok(!state.deleted.includes(query), '同一查询只能删除一次');
        state.deleted.push(query);
    });
    const readQuery = (query, parameter) => {
        const operation = parameter === constants.available ? 'available' : 'result';
        return invoke(operation, [query, parameter], () => {
            assert.ok(state.created.includes(query));
            assert.ok(!state.deleted.includes(query), '不能读取已经回收的查询');
            assert.equal(query.ended, true, '活动查询不能当作已提交结果读取');
            if (parameter === constants.available) return query.available;
            assert.equal(parameter, constants.result);
            assert.equal(query.available, true, '未就绪时不得读取结果或等待 GPU');
            const ns = query.ns;
            state.afterResult?.(query);
            return ns;
        });
    };
    const extension = {
        TIME_ELAPSED_EXT: constants.timeElapsed,
        GPU_DISJOINT_EXT: constants.disjoint
    };
    if (version === 1) {
        Object.assign(extension, {
            CURRENT_QUERY_EXT: constants.current,
            QUERY_RESULT_AVAILABLE_EXT: constants.available,
            QUERY_RESULT_EXT: constants.result,
            createQueryEXT: create,
            getQueryEXT: current,
            beginQueryEXT: begin,
            endQueryEXT: end,
            deleteQueryEXT: remove,
            getQueryObjectEXT: readQuery
        });
    }
    const extensionName = version === 2 ? 'EXT_disjoint_timer_query_webgl2' : 'EXT_disjoint_timer_query';
    const gl = {
        getExtension(name) {
            return invoke('getExtension', [name], () => state.supported && name === extensionName ? extension : null);
        },
        getParameter(parameter) {
            return invoke('disjoint', [parameter], () => {
                assert.equal(parameter, constants.disjoint);
                return state.disjoint;
            });
        },
        isContextLost() {
            return invoke('isContextLost', [], () => state.lost);
        },
        flush() {
            return invoke('flush', [], () => { throw new Error('计时器不得主动 flush'); });
        },
        finish() {
            return invoke('finish', [], () => { throw new Error('计时器不得同步等待 GPU'); });
        }
    };
    if (version === 2) {
        Object.assign(gl, {
            CURRENT_QUERY: constants.current,
            QUERY_RESULT_AVAILABLE: constants.available,
            QUERY_RESULT: constants.result,
            createQuery: create,
            getQuery: current,
            beginQuery: begin,
            endQuery: end,
            deleteQuery: remove,
            getQueryParameter: readQuery
        });
    }
    return {
        gl,
        state,
        extensionName,
        calls: operation => state.calls.filter(call => call.operation === operation),
        fail(operation, count = 1) { state.failures.set(operation, count); },
        ready(query, ns) { query.available = true; query.ns = ns; },
        external() { return { external: true, ended: false }; },
        // isContextLost 是安全的丢失状态检测，不归入已经失效的 GL 查询操作。
        driverCalls: () => state.calls.filter(call => call.operation !== 'isContextLost')
    };
}

async function createHarness(t, version, options) {
    const { createGpuRenderTimer } = await loadTimer();
    const mock = createMockGl(version, options);
    const timer = createGpuRenderTimer(mock.gl);
    t.after(() => {
        mock.state.failures.clear();
        mock.state.lost = false;
        timer.dispose();
    });
    return { timer, mock };
}

function submit(timer, mock) {
    const before = mock.state.created.length;
    timer.begin();
    assert.equal(mock.state.created.length, before + 1, '有效绘制应创建一个查询');
    const query = mock.state.created.at(-1);
    assert.equal(mock.state.active, query);
    timer.end();
    assert.equal(mock.state.active, null);
    assert.equal(query.ended, true);
    return query;
}

function assertPoll(timer, samples, status = 'supported') {
    const result = timer.poll();
    assert.deepEqual(Object.keys(result).sort(), ['generation', 'samples', 'status']);
    assert.deepEqual(result.samples, samples);
    assert.equal(result.status, status);
    assert.equal(result.generation, timer.getState().generation);
    assert.ok(result.samples.every(sample => Number.isFinite(sample) && sample >= 0));
    return result;
}

function assertReleasedOnce(mock, queries = mock.state.created) {
    for (const query of queries) {
        assert.equal(mock.calls('delete').filter(call => call.args[0] === query).length, 1);
        assert.equal(mock.state.deleted.filter(item => item === query).length, 1);
    }
}

for (const version of [1, 2]) {
    const label = `WebGL${version}`;

    test(`${label}：版本专属接口、状态快照与活动查询计入有界队列`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const initial = timer.getState();
        assert.deepEqual(Object.keys(initial).sort(), ['generation', 'pending', 'status']);
        assert.equal(initial.status, 'supported');
        assert.equal(initial.pending, 0);
        assert.ok(Number.isSafeInteger(initial.generation) && initial.generation >= 0);
        for (const method of ['begin', 'end', 'poll', 'reset', 'contextLost', 'restore', 'dispose', 'getState']) {
            assert.equal(typeof timer[method], 'function');
        }
        assert.ok(mock.calls('getExtension').some(call => call.args[0] === mock.extensionName));
        if (version === 1) assert.equal(typeof mock.gl.getQueryParameter, 'undefined');
        initial.status = 'lost'; initial.pending = 99; initial.generation = -1;
        assert.equal(timer.getState().status, 'supported');
        timer.begin();
        assert.equal(timer.getState().pending, 1);
        assertPoll(timer, []);
        assert.equal(mock.calls('available').length, 0);
        timer.end(); timer.dispose();
        assertReleasedOnce(mock);
        assert.equal(mock.calls('flush').length, 0);
        assert.equal(mock.calls('finish').length, 0);
    });

    test(`${label}：异步结果未就绪不读取，纳秒换算毫秒后只回收一次`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const query = submit(timer, mock);
        for (let frame = 0; frame < 3; frame++) assertPoll(timer, []);
        assert.equal(timer.getState().pending, 1);
        assert.equal(mock.calls('result').length, 0);
        assert.equal(mock.calls('delete').length, 0);
        mock.ready(query, 2_750_000);
        assertPoll(timer, [2.75]);
        assert.equal(timer.getState().pending, 0);
        assertPoll(timer, []); assertPoll(timer, []);
        timer.dispose();
        assert.equal(mock.calls('result').length, 1);
        assertReleasedOnce(mock);
        assert.equal(mock.calls('flush').length, 0);
        assert.equal(mock.calls('finish').length, 0);
    });

    test(`${label}：一次poll按提交顺序收集多个结果，包括合法零耗时`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const queries = [submit(timer, mock), submit(timer, mock), submit(timer, mock)];
        const values = [8_000_000, 0, 3_125_000];
        queries.forEach((query, index) => mock.ready(query, values[index]));
        assertPoll(timer, [8, 0, 3.125]);
        assert.equal(timer.getState().pending, 0);
        assert.deepEqual(mock.calls('result').map(call => call.args[0]), queries);
        assert.deepEqual(mock.state.deleted, queries);
        assertPoll(timer, []);
        timer.dispose(); assertReleasedOnce(mock);
    });

    test(`${label}：未就绪项保留，但不阻塞后续已就绪查询的有序回收`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const queries = [submit(timer, mock), submit(timer, mock), submit(timer, mock)];
        mock.ready(queries[1], 2_000_000); mock.ready(queries[2], 3_000_000);
        assertPoll(timer, [2, 3]);
        assert.equal(timer.getState().pending, 1);
        assert.deepEqual(mock.calls('result').map(call => call.args[0]), queries.slice(1));
        assertPoll(timer, []);
        mock.ready(queries[0], 1_000_000);
        assertPoll(timer, [1]);
        assert.equal(timer.getState().pending, 0);
        timer.dispose(); assertReleasedOnce(mock);
    });

    test(`${label}：负数、NaN和无穷结果不成为样本，但各查询仍回收`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const values = [-1, NaN, Infinity, -Infinity];
        const queries = values.map(value => {
            const query = submit(timer, mock); mock.ready(query, value); return query;
        });
        assertPoll(timer, []);
        assert.equal(timer.getState().pending, 0);
        assert.deepEqual(mock.calls('result').map(call => call.args[0]), queries);
        timer.dispose(); assertReleasedOnce(mock);
    });

    test(`${label}：固定容量4，队列满跳过，回收后才接受新查询`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const queries = Array.from({ length: 4 }, () => submit(timer, mock));
        const generation = timer.getState().generation;
        assert.equal(timer.getState().pending, 4);
        for (let frame = 0; frame < 5; frame++) { timer.begin(); timer.end(); assertPoll(timer, []); }
        assert.equal(mock.state.created.length, 4);
        assert.equal(mock.calls('begin').length, 4);
        assert.equal(mock.calls('end').length, 4);
        assert.equal(mock.calls('delete').length, 0);
        assert.equal(timer.getState().generation, generation);
        mock.ready(queries[0], 500_000); assertPoll(timer, [0.5]);
        timer.begin();
        assert.equal(mock.state.created.length, 5);
        assert.equal(timer.getState().pending, 4);
        timer.begin();
        assert.equal(mock.state.created.length, 5, '活动查询期间不能再创建第五个在途项');
        timer.end(); timer.dispose(); assertReleasedOnce(mock);
    });

    test(`${label}：重复begin/end不会嵌套、重复提交或结束无主查询`, async t => {
        const { timer, mock } = await createHarness(t, version);
        timer.end(); timer.begin(); timer.begin(); timer.begin();
        assert.equal(mock.state.created.length, 1);
        assert.equal(mock.calls('begin').length, 1);
        timer.end(); timer.end(); timer.end();
        assert.equal(mock.calls('end').length, 1);
        assert.equal(timer.getState().pending, 1);
        mock.ready(mock.state.created[0], 1_000_000); assertPoll(timer, [1]);
        timer.dispose(); assertReleasedOnce(mock);
    });

    test(`${label}：外部活动query使begin跳过，end/reset/dispose均不越权`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const external = mock.external(); mock.state.active = external;
        timer.begin(); timer.end(); assertPoll(timer, []); timer.reset(); timer.dispose();
        assert.equal(mock.state.active, external);
        assert.equal(external.ended, false);
        assert.equal(mock.calls('create').length, 0);
        assert.equal(mock.calls('begin').length, 0);
        assert.equal(mock.calls('end').length, 0);
        assert.equal(mock.calls('delete').length, 0);
    });

    for (const cleanup of ['reset', 'dispose']) {
        test(`${label}：${cleanup}清理已提交自身query但不结束后来出现的外部活动query`, async t => {
            const { timer, mock } = await createHarness(t, version);
            const query = submit(timer, mock);
            const external = mock.external(); mock.state.active = external;
            const ends = mock.calls('end').length;
            timer[cleanup]();
            assert.equal(mock.calls('end').length, ends);
            assert.equal(mock.state.active, external);
            assert.equal(external.ended, false);
            assert.equal(timer.getState().pending, 0);
            assertReleasedOnce(mock, [query]);
        });
    }

    for (const action of ['end', 'reset', 'dispose']) {
        test(`${label}：自身活动query被外部接管后，${action}不结束外部query`, async t => {
            const { timer, mock } = await createHarness(t, version);
            timer.begin();
            const query = mock.state.created[0];
            const external = mock.external(); mock.state.active = external;
            const generation = timer.getState().generation;
            assert.doesNotThrow(() => timer[action]());
            assert.equal(mock.calls('end').length, 0);
            assert.equal(mock.state.active, external);
            assert.equal(external.ended, false);
            assert.equal(timer.getState().pending, 0);
            assert.ok(timer.getState().generation > generation);
            assertReleasedOnce(mock, [query]);
            if (action === 'end') assertPoll(timer, [], 'error');
        });
    }

    test(`${label}：reset结束自身活动query并回收全部，旧代次不混入新样本`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const oldQueries = [submit(timer, mock), submit(timer, mock)];
        timer.begin(); oldQueries.push(mock.state.created.at(-1));
        const generation = timer.getState().generation;
        const ends = mock.calls('end').length;
        timer.reset();
        assert.equal(mock.calls('end').length, ends + 1);
        assert.equal(mock.state.active, null);
        assert.equal(timer.getState().pending, 0);
        assert.equal(timer.getState().status, 'supported');
        assert.ok(timer.getState().generation > generation);
        assertReleasedOnce(mock, oldQueries);
        oldQueries.forEach(query => mock.ready(query, 99_000_000));
        assertPoll(timer, []);
        const newQuery = submit(timer, mock); mock.ready(newQuery, 4_000_000);
        assertPoll(timer, [4]);
        const beforeEmptyReset = timer.getState().generation;
        timer.reset(); assert.ok(timer.getState().generation > beforeEmptyReset);
        timer.dispose(); assertReleasedOnce(mock);
    });

    test(`${label}：disjoint丢弃已提交及活动query，代次失效且正常帧自动恢复`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const queries = [submit(timer, mock), submit(timer, mock)];
        queries.forEach(query => mock.ready(query, 6_000_000));
        timer.begin(); queries.push(mock.state.created.at(-1));
        const generation = timer.getState().generation;
        const reads = mock.calls('result').length;
        mock.state.disjoint = true;
        const invalid = assertPoll(timer, [], 'disjoint');
        assert.ok(invalid.generation > generation);
        assert.equal(timer.getState().pending, 0);
        assert.equal(mock.state.active, null);
        assert.equal(mock.calls('result').length, reads);
        assertReleasedOnce(mock, queries);
        timer.begin(); assertPoll(timer, [], 'disjoint');
        assert.equal(timer.getState().generation, invalid.generation, '持续同一次失效不反复增加代次');
        assert.equal(mock.state.created.length, queries.length);
        mock.state.disjoint = false;
        assertPoll(timer, []);
        const query = submit(timer, mock); mock.ready(query, 7_000_000);
        assertPoll(timer, [7]); timer.dispose(); assertReleasedOnce(mock);
    });

    test(`${label}：回收期间出现disjoint，本次已读样本也全部作废`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const queries = [submit(timer, mock), submit(timer, mock), submit(timer, mock)];
        queries.forEach(query => mock.ready(query, 2_000_000));
        const generation = timer.getState().generation;
        mock.state.afterResult = () => { mock.state.disjoint = true; };
        assertPoll(timer, [], 'disjoint');
        assert.ok(timer.getState().generation > generation);
        assert.equal(timer.getState().pending, 0);
        assertReleasedOnce(mock, queries);
        mock.state.afterResult = null; mock.state.disjoint = false;
        assertPoll(timer, []);
    });

    test(`${label}：contextLost仅使本地状态失效，后续清理不访问失效GL`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const queries = [submit(timer, mock)];
        timer.begin(); queries.push(mock.state.created.at(-1));
        const generation = timer.getState().generation;
        mock.state.lost = true;
        const calls = mock.driverCalls().length;
        assert.doesNotThrow(() => timer.contextLost());
        assert.equal(timer.getState().status, 'lost');
        assert.equal(timer.getState().pending, 0);
        assert.ok(timer.getState().generation > generation);
        const lostGeneration = timer.getState().generation;
        timer.contextLost(); assert.equal(timer.getState().generation, lostGeneration);
        timer.begin(); timer.end(); assertPoll(timer, [], 'lost');
        timer.reset(); assert.ok(timer.getState().generation > lostGeneration);
        timer.dispose(); timer.dispose(); assertPoll(timer, [], 'disposed');
        assert.equal(mock.driverCalls().length, calls);
        assert.equal(mock.calls('delete').length, 0, '失效上下文中的query不能调用delete');
        assert.equal(mock.calls('result').length, 0);
    });

    test(`${label}：未收到事件但GL报告丢失时，也不结束或删除失效query`, async t => {
        const { timer, mock } = await createHarness(t, version);
        submit(timer, mock); timer.begin();
        const generation = timer.getState().generation;
        mock.state.lost = true;
        const calls = mock.driverCalls().length;
        assertPoll(timer, [], 'lost');
        assert.ok(timer.getState().generation > generation);
        assert.equal(timer.getState().pending, 0);
        timer.begin(); timer.end(); timer.dispose();
        assert.equal(mock.driverCalls().length, calls);
        assert.equal(mock.calls('delete').length, 0);
    });

    test(`${label}：restore重新探测扩展，旧上下文代次的结果不再读取`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const oldQuery = submit(timer, mock);
        mock.state.lost = true; timer.contextLost();
        const lostGeneration = timer.getState().generation;
        const probes = mock.calls('getExtension').length;
        mock.state.lost = false; mock.state.active = null;
        mock.ready(oldQuery, 100_000_000);
        timer.restore();
        assert.equal(timer.getState().status, 'supported');
        assert.ok(timer.getState().generation > lostGeneration);
        assert.ok(mock.calls('getExtension').length > probes);
        assertPoll(timer, []);
        const query = submit(timer, mock); mock.ready(query, 1_250_000);
        assertPoll(timer, [1.25]); timer.dispose();
        assert.deepEqual(mock.calls('result').map(call => call.args[0]), [query]);
        assertReleasedOnce(mock, [query]);
        assert.ok(!mock.state.deleted.includes(oldQuery));
    });

    test(`${label}：无扩展是unsupported，restore能重新探测支持变化`, async t => {
        const { timer, mock } = await createHarness(t, version, { supported: false });
        assert.equal(timer.getState().status, 'unsupported');
        timer.begin(); timer.end(); assertPoll(timer, [], 'unsupported');
        const generation = timer.getState().generation;
        timer.reset(); assert.ok(timer.getState().generation > generation);
        assert.equal(mock.calls('create').length, 0);
        assert.equal(mock.calls('disjoint').length, 0);
        mock.state.supported = true; timer.restore();
        assert.equal(timer.getState().status, 'supported');
        const query = submit(timer, mock); mock.ready(query, 3_000_000); assertPoll(timer, [3]);
        timer.contextLost(); mock.state.supported = false; timer.restore();
        assertPoll(timer, [], 'unsupported');
        timer.dispose(); assertPoll(timer, [], 'disposed'); assertReleasedOnce(mock);
    });

    test(`${label}：dispose清理自己拥有的活动和待收query，终止状态且幂等`, async t => {
        const { timer, mock } = await createHarness(t, version);
        submit(timer, mock); submit(timer, mock); timer.begin();
        const generation = timer.getState().generation;
        const ends = mock.calls('end').length;
        timer.dispose();
        assert.equal(timer.getState().status, 'disposed');
        assert.equal(timer.getState().pending, 0);
        assert.ok(timer.getState().generation > generation);
        assert.equal(mock.calls('end').length, ends + 1);
        assert.equal(mock.state.active, null);
        assertReleasedOnce(mock);
        const disposed = timer.getState(); const calls = mock.state.calls.length;
        timer.dispose(); timer.begin(); timer.end(); timer.reset(); timer.contextLost(); timer.restore();
        assertPoll(timer, [], 'disposed');
        assert.deepEqual(timer.getState(), disposed);
        assert.equal(mock.state.calls.length, calls, '销毁后的接口不能再触碰GL或重新探测');
    });

    for (const operation of ['disjoint', 'current', 'create', 'begin']) {
        test(`${label}：begin的${operation}异常不抛回渲染，状态error且restore后恢复`, async t => {
            const { timer, mock } = await createHarness(t, version);
            const generation = timer.getState().generation;
            mock.fail(operation);
            assert.doesNotThrow(() => timer.begin());
            assert.equal(timer.getState().status, 'error');
            assert.equal(timer.getState().pending, 0);
            assert.ok(timer.getState().generation > generation);
            assertReleasedOnce(mock);
            const created = mock.state.created.length;
            timer.begin(); assertPoll(timer, [], 'error');
            assert.equal(mock.state.created.length, created, '错误状态等待明确restore而非默默重新开始');
            timer.restore();
            const query = submit(timer, mock); mock.ready(query, 2_000_000); assertPoll(timer, [2]);
            timer.dispose(); assertReleasedOnce(mock);
        });
    }

    test(`${label}：create返回null按error处理，不提交空query`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const generation = timer.getState().generation;
        mock.state.nullQuery = true;
        assert.doesNotThrow(() => timer.begin());
        assert.equal(timer.getState().status, 'error');
        assert.equal(timer.getState().pending, 0);
        assert.ok(timer.getState().generation > generation);
        assert.equal(mock.calls('begin').length, 0);
        assert.equal(mock.calls('delete').length, 0);
        mock.state.nullQuery = false; timer.restore();
        submit(timer, mock); timer.dispose(); assertReleasedOnce(mock);
    });

    for (const operation of ['current', 'end']) {
        test(`${label}：end的${operation}异常清理自身资源，不抛回渲染`, async t => {
            const { timer, mock } = await createHarness(t, version);
            submit(timer, mock); timer.begin();
            const generation = timer.getState().generation;
            mock.fail(operation);
            assert.doesNotThrow(() => timer.end());
            assert.equal(timer.getState().status, 'error');
            assert.equal(timer.getState().pending, 0);
            assert.ok(timer.getState().generation > generation);
            assert.equal(mock.state.active, null);
            assertReleasedOnce(mock);
            assertPoll(timer, [], 'error');
            timer.restore(); submit(timer, mock); timer.dispose(); assertReleasedOnce(mock);
        });
    }

    for (const operation of ['available', 'result']) {
        test(`${label}：poll的${operation}异常返回空error，清理所有待收query`, async t => {
            const { timer, mock } = await createHarness(t, version);
            const queries = [submit(timer, mock), submit(timer, mock), submit(timer, mock)];
            queries.forEach(query => mock.ready(query, 5_000_000));
            const generation = timer.getState().generation;
            mock.fail(operation);
            let result;
            assert.doesNotThrow(() => { result = timer.poll(); });
            assert.deepEqual(result.samples, []);
            assert.equal(result.status, 'error');
            assert.ok(result.generation > generation);
            assert.equal(timer.getState().pending, 0);
            assertReleasedOnce(mock);
            assertPoll(timer, [], 'error');
            timer.restore(); const query = submit(timer, mock); mock.ready(query, 6_000_000);
            assertPoll(timer, [6]); timer.dispose(); assertReleasedOnce(mock);
        });
    }

    test(`${label}：poll读过部分样本后再异常，也不能返回同批残留样本`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const queries = [submit(timer, mock), submit(timer, mock), submit(timer, mock)];
        queries.forEach(query => mock.ready(query, 4_000_000));
        mock.state.afterResult = query => { if (query === queries[0]) mock.fail('result'); };
        assertPoll(timer, [], 'error');
        assert.equal(timer.getState().pending, 0);
        assertReleasedOnce(mock, queries);
        mock.state.afterResult = null;
    });

    test(`${label}：delete异常不阻断其余清理，后续dispose也不重复回收`, async t => {
        const { timer, mock } = await createHarness(t, version);
        const queries = [submit(timer, mock), submit(timer, mock), submit(timer, mock)];
        mock.fail('delete');
        assert.doesNotThrow(() => timer.reset());
        assert.equal(timer.getState().pending, 0);
        assert.deepEqual(mock.calls('delete').map(call => call.args[0]), queries);
        assert.deepEqual(mock.state.deleted, queries.slice(1));
        timer.dispose(); timer.dispose();
        assert.equal(mock.calls('delete').length, queries.length);
    });

    test(`${label}：清理活动query时current异常仍继续删除自身与待收资源`, async t => {
        const { timer, mock } = await createHarness(t, version);
        submit(timer, mock); timer.begin();
        mock.fail('current');
        assert.doesNotThrow(() => timer.reset());
        assert.equal(timer.getState().pending, 0);
        assertReleasedOnce(mock);
    });

    test(`${label}：扩展探测异常是error而非构造抛错，restore后重新探测`, async t => {
        const { createGpuRenderTimer } = await loadTimer();
        const mock = createMockGl(version); mock.fail('getExtension');
        let timer;
        assert.doesNotThrow(() => { timer = createGpuRenderTimer(mock.gl); });
        assert.equal(timer.getState().status, 'error');
        timer.begin(); timer.end(); assertPoll(timer, [], 'error');
        assert.equal(mock.state.created.length, 0);
        timer.restore();
        const query = submit(timer, mock); mock.ready(query, 2_500_000); assertPoll(timer, [2.5]);
        timer.dispose(); assertReleasedOnce(mock);
    });

    for (const action of ['begin', 'end', 'poll', 'reset', 'dispose']) {
        test(`${label}：${action}遇到持续isContextLost异常也不抛回渲染`, async t => {
            const { timer, mock } = await createHarness(t, version);
            submit(timer, mock); timer.begin();
            const calls = mock.driverCalls().length;
            mock.fail('isContextLost', Infinity);
            assert.doesNotThrow(() => timer[action]());
            // 驱动连丢失状态也不能可靠报告时，按上下文失效保守处理，禁止后续查询操作。
            assertPoll(timer, [], action === 'dispose' ? 'disposed' : 'lost');
            assert.equal(timer.getState().pending, 0);
            assert.equal(mock.driverCalls().length, calls);
        });
    }
}

for (const [label, gl] of [
    ['null', null],
    ['undefined', undefined],
    ['空对象', {}],
    ['无扩展的最小上下文', { getExtension: () => null }]
]) {
    test(`无支持：${label}不依赖浏览器，全部接口安全并允许幂等销毁`, async () => {
        const { createGpuRenderTimer } = await loadTimer();
        let timer;
        assert.doesNotThrow(() => { timer = createGpuRenderTimer(gl); });
        assert.equal(timer.getState().status, 'unsupported');
        assert.equal(timer.getState().pending, 0);
        timer.begin(); timer.end(); assertPoll(timer, [], 'unsupported');
        const generation = timer.getState().generation;
        timer.reset(); assert.ok(timer.getState().generation > generation);
        timer.contextLost(); assertPoll(timer, [], 'lost');
        timer.restore(); assertPoll(timer, [], 'unsupported');
        timer.dispose(); const disposed = timer.getState();
        timer.dispose(); timer.begin(); timer.end(); timer.reset(); timer.contextLost(); timer.restore();
        assertPoll(timer, [], 'disposed'); assert.deepEqual(timer.getState(), disposed);
    });
}
