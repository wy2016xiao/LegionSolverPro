import test from 'node:test';
import assert from 'node:assert/strict';

import { LegionSolver } from '../src/modules/legion_solver.js';
import { OBJECTIVES, RESULT_STATUS } from '../src/modules/solver/constants.js';

class FakeWorker {
    constructor() {
        this.messages = [];
        this.terminated = false;
        this.onmessage = null;
        this.onerror = null;
    }

    postMessage(message) {
        this.messages.push(message);
    }

    emit(message) {
        this.onmessage({ data: message });
    }

    terminate() {
        this.terminated = true;
    }
}

test('solver client sends a serializable start payload', () => {
    const worker = new FakeWorker();
    const board = [[0, 0]];
    const solver = new LegionSolver(board, [
        { id: 7, amount: 1, shape: [[2, 1]] },
    ], () => {}, {
        objective: OBJECTIVES.PIECES,
        workerFactory: () => worker,
    });

    solver.solve();

    assert.deepEqual(worker.messages[0], {
        type: 'start',
        payload: {
            board: [[0, 0]],
            pieces: [{ id: 7, amount: 1, shape: [[2, 1]] }],
            objective: OBJECTIVES.PIECES,
        },
    });
});

test('solver client applies incumbent layouts and resolves completion', async () => {
    const worker = new FakeWorker();
    const board = [[0, 0]];
    const updates = [];
    const solver = new LegionSolver(board, [], result => updates.push(result), {
        workerFactory: () => worker,
    });
    const promise = solver.solve();
    const incumbent = {
        status: RESULT_STATUS.BEST_KNOWN,
        coveredCells: 2,
        placedPieces: 1,
        targetCells: 2,
        availablePieces: 1,
        placements: [{
            pieceId: 3,
            cells: [
                { x: 0, y: 0, isAnchor: true },
                { x: 1, y: 0, isAnchor: false },
            ],
        }],
    };

    worker.emit({ type: 'incumbent', result: incumbent, stats: { iterations: 4 } });
    worker.emit({
        type: 'completed',
        result: { ...incumbent, status: RESULT_STATUS.OPTIMAL },
        stats: { iterations: 8, elapsedMs: 2 },
    });

    const result = await promise;
    assert.equal(board[0][0], 21);
    assert.equal(board[0][1], 3);
    assert.deepEqual(solver.history, [[{ x: 0, y: 0 }, { x: 1, y: 0 }]]);
    assert.equal(updates.length, 1);
    assert.equal(result.status, RESULT_STATUS.OPTIMAL);
    assert.equal(solver.iterations, 8);
    assert.equal(worker.terminated, true);
});

test('solver client forwards pause resume and cancel controls', () => {
    const worker = new FakeWorker();
    const solver = new LegionSolver([[0]], [], () => {}, {
        workerFactory: () => worker,
    });

    solver.solve();
    solver.pause();
    solver.continue();
    solver.stop();

    assert.deepEqual(worker.messages.map(message => message.type), [
        'start',
        'pause',
        'resume',
        'cancel',
    ]);
});

test('terminating a solver discards late worker results', async () => {
    const worker = new FakeWorker();
    const board = [[0]];
    const solver = new LegionSolver(board, [], () => {}, {
        workerFactory: () => worker,
    });
    const promise = solver.solve();

    solver.terminate();
    worker.emit({
        type: 'completed',
        result: {
            status: RESULT_STATUS.OPTIMAL,
            coveredCells: 1,
            placedPieces: 1,
            placements: [{
                pieceId: 1,
                cells: [{ x: 0, y: 0, isAnchor: true }],
            }],
        },
    });

    const result = await promise;
    assert.equal(result.discarded, true);
    assert.equal(board[0][0], 0);
});
