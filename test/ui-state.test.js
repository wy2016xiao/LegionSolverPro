import test from 'node:test';
import assert from 'node:assert/strict';

import { OBJECTIVES, RESULT_STATUS } from '../src/modules/solver/constants.js';
import { formatResultSummary, normalizeObjective } from '../src/modules/solver/ui-state.js';

test('objective defaults to coverage for missing or unknown values', () => {
    assert.equal(normalizeObjective(null), OBJECTIVES.COVERAGE);
    assert.equal(normalizeObjective('unknown'), OBJECTIVES.COVERAGE);
    assert.equal(normalizeObjective(OBJECTIVES.PIECES), OBJECTIVES.PIECES);
});

test('result summary includes optimality and both business scores', () => {
    const text = formatResultSummary({
        status: RESULT_STATUS.OPTIMAL,
        coveredCells: 158,
        targetCells: 160,
        placedPieces: 38,
        availablePieces: 40,
    }, key => ({
        resultOptimal: '最优解',
        resultCovered: '覆盖',
        resultUsed: '使用',
        cellUnit: '格',
        pieceUnit: '块',
    })[key]);

    assert.equal(text, '最优解 · 覆盖 158/160 格 · 使用 38/40 块');
});

test('result summary distinguishes best-known from proven optimal', () => {
    const text = formatResultSummary({
        status: RESULT_STATUS.BEST_KNOWN,
        coveredCells: 9,
        targetCells: 10,
        placedPieces: 3,
        availablePieces: 4,
    }, key => ({
        resultBestKnown: '当前最佳',
        resultCovered: '覆盖',
        resultUsed: '使用',
        cellUnit: '格',
        pieceUnit: '块',
    })[key]);

    assert.match(text, /^当前最佳/);
});
