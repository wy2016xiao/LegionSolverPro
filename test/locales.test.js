import test from 'node:test';
import assert from 'node:assert/strict';

import locales from '../src/locales/index.js';

const solverKeys = [
    'optimizationGoal',
    'coverageObjective',
    'piecesObjective',
    'resultOptimal',
    'resultBestKnown',
    'resultNoSolution',
    'resultInvalid',
    'resultError',
    'resultCovered',
    'resultUsed',
    'cellUnit',
    'pieceUnit',
    'stop',
];

test('every supported locale defines the solver UI contract', () => {
    for (const [region, messages] of Object.entries(locales)) {
        for (const key of solverKeys) {
            assert.equal(typeof messages[key], 'string', `${region}.${key}`);
            assert.notEqual(messages[key].trim(), '', `${region}.${key}`);
        }
    }
});
