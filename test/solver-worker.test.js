import test from 'node:test';
import assert from 'node:assert/strict';

import { OBJECTIVES } from '../src/modules/solver/constants.js';

test('worker reports an initialization incumbent before a later search improvement', async t => {
    const messages = [];
    const scheduledBatches = [];
    const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
    const originalSetTimeout = globalThis.setTimeout;
    let currentTime = 0;

    Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: {
            // 每次读取都跨过一个时间片，让批次数量确定且不绑定具体调用顺序。
            now: () => {
                currentTime += 1000;
                return currentTime;
            },
        },
    });
    Object.defineProperty(globalThis, 'self', {
        configurable: true,
        value: { postMessage: message => messages.push(message) },
    });
    globalThis.setTimeout = callback => {
        scheduledBatches.push(callback);
        return scheduledBatches.length;
    };
    t.after(() => {
        originalPerformance
            ? Object.defineProperty(globalThis, 'performance', originalPerformance)
            : delete globalThis.performance;
        originalSelf
            ? Object.defineProperty(globalThis, 'self', originalSelf)
            : delete globalThis.self;
        globalThis.setTimeout = originalSetTimeout;
    });

    await import('../src/modules/solver/solver.worker.js');
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[0][0] = -1;
    self.onmessage({
        data: {
            type: 'start',
            payload: {
                board,
                pieces: [
                    { id: 1, amount: 30, shape: [[2, 1]] },
                    { id: 2, amount: 3, shape: [[2, 1, 1]] },
                ],
                objective: OBJECTIVES.COVERAGE,
            },
        },
    });

    assert.equal(scheduledBatches.length, 1);
    scheduledBatches.shift()();
    const initializationIncumbents = messages.filter(message => message.type === 'incumbent');
    assert.equal(initializationIncumbents.length, 1);
    assert.equal(initializationIncumbents[0].result.coveredCells, 63);

    let executedBatches = 1;
    while (scheduledBatches.length > 0) {
        assert.ok(executedBatches < 100, 'worker did not finish within 100 batches');
        executedBatches++;
        scheduledBatches.shift()();
    }

    const incumbents = messages.filter(message => message.type === 'incumbent');
    const incumbentKeys = incumbents.map(message => message.result.layoutKey);
    assert.ok(executedBatches > 1);
    assert.ok(incumbents.length > 0);
    assert.equal(new Set(incumbentKeys).size, incumbentKeys.length);
    assert.equal(messages.at(-1).type, 'completed');

    self.onmessage({ data: { type: 'resume' } });
    assert.equal(scheduledBatches.length, 0);
});

test('pausing before the first batch reports the initialized current best', async t => {
    const messages = [];
    const scheduledBatches = [];
    const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
    const originalSetTimeout = globalThis.setTimeout;
    let currentTime = 0;

    Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: { now: () => ++currentTime },
    });
    Object.defineProperty(globalThis, 'self', {
        configurable: true,
        value: { postMessage: message => messages.push(message) },
    });
    globalThis.setTimeout = callback => {
        scheduledBatches.push(callback);
        return scheduledBatches.length;
    };
    t.after(() => {
        originalPerformance
            ? Object.defineProperty(globalThis, 'performance', originalPerformance)
            : delete globalThis.performance;
        originalSelf
            ? Object.defineProperty(globalThis, 'self', originalSelf)
            : delete globalThis.self;
        globalThis.setTimeout = originalSetTimeout;
    });

    await import('../src/modules/solver/solver.worker.js?pause-before-first-batch');
    self.onmessage({
        data: {
            type: 'start',
            payload: {
                board: [[0, 0]],
                pieces: [{ id: 1, amount: 2, shape: [[2]] }],
                objective: OBJECTIVES.COVERAGE,
            },
        },
    });
    self.onmessage({ data: { type: 'pause' } });

    assert.deepEqual(messages.map(message => message.type), ['incumbent']);
    assert.equal(messages[0].result.coveredCells, 2);

    scheduledBatches.shift()();
    self.onmessage({ data: { type: 'cancel' } });
    scheduledBatches.shift()();
    assert.equal(messages.at(-1).type, 'cancelled');
});

test('worker starts elapsed timing before input compilation', async t => {
    const messages = [];
    const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
    const originalSetTimeout = globalThis.setTimeout;
    let firstTimestamp = true;

    Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: {
            now: () => {
                if (firstTimestamp) {
                    firstTimestamp = false;
                    return 10;
                }
                return 25;
            },
        },
    });
    Object.defineProperty(globalThis, 'self', {
        configurable: true,
        value: { postMessage: message => messages.push(message) },
    });
    globalThis.setTimeout = () => {
        throw new Error('invalid input must not schedule a search batch');
    };
    t.after(() => {
        originalPerformance
            ? Object.defineProperty(globalThis, 'performance', originalPerformance)
            : delete globalThis.performance;
        originalSelf
            ? Object.defineProperty(globalThis, 'self', originalSelf)
            : delete globalThis.self;
        globalThis.setTimeout = originalSetTimeout;
    });

    await import('../src/modules/solver/solver.worker.js?timing-before-compilation');
    self.onmessage({
        data: {
            type: 'start',
            payload: {
                board: [[0]],
                pieces: [{ id: 1, amount: -1, shape: [[2]] }],
                objective: OBJECTIVES.COVERAGE,
            },
        },
    });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'error');
    assert.equal(messages[0].stats.elapsedMs, 15);
});
