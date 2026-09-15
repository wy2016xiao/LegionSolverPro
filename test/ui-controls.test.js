import test from 'node:test';
import assert from 'node:assert/strict';

import {
    pauseSolverUi,
    secondaryControlForState,
    shouldDrawIncumbent,
    stopSolverUi,
} from '../src/modules/solver/ui-controls.js';

test('pausing solvers exposes the current best board even when live solve is off', () => {
    const calls = [];
    const solvers = [{
        stats: { iterations: 12, elapsedMs: 34 },
        pause: () => calls.push('pause'),
    }];

    pauseSolverUi(solvers, {
        renderStats: stats => calls.push(['stats', stats]),
        drawBoard: () => calls.push('draw'),
    });

    assert.deepEqual(calls, [
        'pause',
        ['stats', solvers[0].stats],
        'draw',
    ]);
});

test('stopping a paused solve requests cancellation without terminating it', () => {
    const calls = [];
    const solvers = [{
        stop: () => calls.push('stop'),
        terminate: () => calls.push('terminate'),
    }];

    stopSolverUi(solvers);

    assert.deepEqual(calls, ['stop']);
});

test('the secondary control changes from stop back to reset after pausing', () => {
    assert.deepEqual(secondaryControlForState('paused'), {
        action: 'stop',
        labelKey: 'stop',
    });
    assert.deepEqual(secondaryControlForState('completed'), {
        action: 'reset',
        labelKey: 'reset',
    });
});

test('a delayed incumbent redraws a paused board without enabling live solve', () => {
    assert.equal(shouldDrawIncumbent(false, 'paused'), true);
    assert.equal(shouldDrawIncumbent(false, 'running'), false);
    assert.equal(shouldDrawIncumbent(true, 'running'), true);
});
