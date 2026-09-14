import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProblem, generateOrientations } from '../src/modules/solver/problem.js';

test('orientation generation removes symmetric duplicates', () => {
    assert.equal(generateOrientations([[2, 2], [2, 2]]).length, 1);
    assert.equal(generateOrientations([[2, 1], [1, 0]]).length, 4);
});

test('orientation generation preserves every original anchor cell', () => {
    const orientations = generateOrientations([[2, 2, 1]]);

    assert.ok(orientations.length > 0);
    assert.ok(orientations.every(orientation => orientation.anchorCells.length === 2));
});

test('placements stay inside selected target cells and track center anchors', () => {
    const board = [
        [0, 0, -1],
        [0, 0, -1],
    ];
    const problem = buildProblem(board, [
        { id: 1, amount: 1, shape: [[2, 1]] },
    ], {
        centerCells: [{ x: 0, y: 0 }],
    });

    assert.ok(problem.placements.length > 0);
    assert.ok(problem.placements.every(placement => (
        placement.cells.every(cell => board[cell.y][cell.x] === 0)
    )));
    assert.ok(problem.placements.some(placement => placement.hasCenterAnchor));
    assert.deepEqual(problem.neighborsByIndex[0].sort((a, b) => a - b), [1, 2]);
});

test('zero inventory does not generate unusable placements', () => {
    const problem = buildProblem([[0, 0]], [
        { id: 1, amount: 0, shape: [[2]] },
    ], {
        centerCells: [{ x: 0, y: 0 }],
    });

    assert.equal(problem.placements.length, 0);
    assert.equal(problem.totalAvailablePieces, 0);
});
