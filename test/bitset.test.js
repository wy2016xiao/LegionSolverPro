import test from 'node:test';
import assert from 'node:assert/strict';

import {
    cloneMask,
    createMask,
    hasBit,
    intersects,
    maskKey,
    popcount,
    setBit,
    unionInto,
} from '../src/modules/solver/bitset.js';

test('bitset supports boards larger than 32 cells', () => {
    const left = createMask(70);
    const right = createMask(70);

    setBit(left, 1);
    setBit(left, 65);
    setBit(right, 65);

    assert.equal(popcount(left), 2);
    assert.equal(hasBit(left, 65), true);
    assert.equal(intersects(left, right), true);

    unionInto(right, left);

    assert.equal(popcount(right), 2);
    assert.equal(maskKey(left), maskKey(right));
});

test('cloneMask creates an independent copy', () => {
    const original = createMask(40);
    setBit(original, 2);

    const copy = cloneMask(original);
    setBit(copy, 35);

    assert.equal(hasBit(original, 35), false);
    assert.equal(hasBit(copy, 35), true);
});
