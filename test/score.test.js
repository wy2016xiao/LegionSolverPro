import test from 'node:test';
import assert from 'node:assert/strict';

import { OBJECTIVES } from '../src/modules/solver/constants.js';
import { compareSolutions } from '../src/modules/solver/score.js';

const moreCells = { coveredCells: 158, placedPieces: 38, layoutKey: 'b' };
const morePieces = { coveredCells: 157, placedPieces: 39, layoutKey: 'a' };

test('coverage-first prefers more covered cells', () => {
    assert.ok(compareSolutions(moreCells, morePieces, OBJECTIVES.COVERAGE) > 0);
});

test('piece-first prefers more placed pieces', () => {
    assert.ok(compareSolutions(morePieces, moreCells, OBJECTIVES.PIECES) > 0);
});

test('layout key gives deterministic tie breaking', () => {
    const left = { coveredCells: 10, placedPieces: 3, layoutKey: 'a' };
    const right = { coveredCells: 10, placedPieces: 3, layoutKey: 'b' };

    assert.ok(compareSolutions(left, right, OBJECTIVES.COVERAGE) > 0);
});
