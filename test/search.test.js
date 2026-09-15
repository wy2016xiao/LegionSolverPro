import test from 'node:test';
import assert from 'node:assert/strict';

import { OBJECTIVES } from '../src/modules/solver/constants.js';
import { buildProblem } from '../src/modules/solver/problem.js';
import {
    createSearch,
    INTERACTIVE_SEARCH_OPTIONS,
    solveToCompletion,
} from '../src/modules/solver/search.js';
import { bruteForce } from './helpers/brute-force.js';

function scoreOf(solution) {
    return solution && {
        coveredCells: solution.coveredCells,
        placedPieces: solution.placedPieces,
    };
}

function solveWithOptions(problem, objective, options) {
    const search = createSearch(problem, objective, options);
    while (!search.isComplete()) {
        search.step(100000);
    }
    return search.getBest();
}

test('search matches brute force when objectives prefer different layouts', () => {
    const problem = buildProblem([[0, 0, 0, 0, 0]], [
        { id: 1, amount: 1, shape: [[2, 1, 1, 1]] },
        { id: 2, amount: 3, shape: [[2]] },
    ], {
        centerCells: [{ x: 0, y: 0 }],
    });

    const coverageResult = solveToCompletion(problem, OBJECTIVES.COVERAGE);
    const pieceResult = solveToCompletion(problem, OBJECTIVES.PIECES);

    assert.deepEqual(scoreOf(coverageResult), { coveredCells: 5, placedPieces: 2 });
    assert.deepEqual(scoreOf(pieceResult), { coveredCells: 3, placedPieces: 3 });
    assert.deepEqual(scoreOf(coverageResult), scoreOf(bruteForce(problem, OBJECTIVES.COVERAGE)));
    assert.deepEqual(scoreOf(pieceResult), scoreOf(bruteForce(problem, OBJECTIVES.PIECES)));
});

test('search permits target blanks when inventory area is smaller', () => {
    const problem = buildProblem([[0, 0, 0, 0, 0]], [
        { id: 1, amount: 2, shape: [[2, 1]] },
    ], {
        centerCells: [{ x: 0, y: 0 }],
    });

    const result = solveToCompletion(problem, OBJECTIVES.COVERAGE);

    assert.deepEqual(scoreOf(result), { coveredCells: 4, placedPieces: 2 });
});

test('search leaves excess inventory unused', () => {
    const problem = buildProblem([[0, 0, 0]], [
        { id: 1, amount: 4, shape: [[2]] },
    ], {
        centerCells: [{ x: 0, y: 0 }],
    });

    const result = solveToCompletion(problem, OBJECTIVES.COVERAGE);

    assert.deepEqual(scoreOf(result), { coveredCells: 3, placedPieces: 3 });
});

test('search does not join pieces across unselected gaps', () => {
    const problem = buildProblem([[0, -1, 0]], [
        { id: 1, amount: 2, shape: [[2]] },
    ], {
        centerCells: [{ x: 0, y: 0 }],
    });

    const result = solveToCompletion(problem, OBJECTIVES.COVERAGE);

    assert.deepEqual(scoreOf(result), { coveredCells: 1, placedPieces: 1 });
});

test('step budget is bounded and produces a deterministic layout', () => {
    const problem = buildProblem([[0, 0, 0, 0]], [
        { id: 1, amount: 4, shape: [[2]] },
    ], {
        centerCells: [{ x: 0, y: 0 }],
    });
    const search = createSearch(problem, OBJECTIVES.COVERAGE);

    const firstStep = search.step(1);
    assert.equal(firstStep.processed, 1);

    while (!search.isComplete()) {
        search.step(1);
    }

    const repeated = solveToCompletion(problem, OBJECTIVES.COVERAGE);
    assert.equal(search.getBest().layoutKey, repeated.layoutKey);
    assert.ok(search.getStats().iterations <= 1);
});

test('initial incumbent work can be bounded without changing exact search', () => {
    const problem = buildProblem([[0, 0, 0, 0]], [
        { id: 1, amount: 2, shape: [[2, 1]] },
    ], {
        centerCells: [{ x: 1, y: 0 }, { x: 2, y: 0 }],
    });
    const search = createSearch(problem, OBJECTIVES.COVERAGE, {
        maxExactCoverStates: 0,
        maxGreedySeeds: 1,
    });

    assert.equal(search.getStats().initializationStates, 0);
    assert.equal(search.getStats().initializationGreedySeeds, 1);
    while (!search.isComplete()) {
        search.step(10);
    }
    assert.deepEqual(scoreOf(search.getBest()), { coveredCells: 4, placedPieces: 2 });
});

test('interactive search bounds synchronous initialization work', () => {
    assert.deepEqual(INTERACTIVE_SEARCH_OPTIONS, {
        maxExactCoverStates: 100,
        maxGreedySeeds: 4,
    });
});

test('search matches brute force across generated small-board cases', () => {
    for (let targetBits = 1; targetBits < 32; targetBits++) {
        const board = [Array.from({ length: 5 }, (_, x) => (
            (targetBits & (1 << x)) !== 0 ? 0 : -1
        ))];
        for (let singles = 0; singles <= 2; singles++) {
            for (let dominoes = 0; dominoes <= 1; dominoes++) {
                const problem = buildProblem(board, [
                    { id: 1, amount: singles, shape: [[2]] },
                    { id: 2, amount: dominoes, shape: [[2, 1]] },
                ], {
                    centerCells: [{ x: 0, y: 0 }],
                });

                for (const objective of Object.values(OBJECTIVES)) {
                    const actual = solveToCompletion(problem, objective);
                    const interactive = solveWithOptions(
                        problem,
                        objective,
                        INTERACTIVE_SEARCH_OPTIONS,
                    );
                    const expected = bruteForce(problem, objective);
                    assert.deepEqual(
                        scoreOf(actual),
                        scoreOf(expected),
                        `target=${targetBits}, singles=${singles}, dominoes=${dominoes}, objective=${objective}`,
                    );
                    assert.deepEqual(
                        scoreOf(interactive),
                        scoreOf(expected),
                        `interactive target=${targetBits}, singles=${singles}, dominoes=${dominoes}, objective=${objective}`,
                    );
                }
            }
        }
    }
});

test('search matches brute force across generated two-dimensional cases', () => {
    for (let targetBits = 1; targetBits < 16; targetBits++) {
        const board = Array.from({ length: 2 }, (_, y) => (
            Array.from({ length: 2 }, (_, x) => (
                (targetBits & (1 << (y * 2 + x))) !== 0 ? 0 : -1
            ))
        ));
        const problem = buildProblem(board, [
            { id: 1, amount: 2, shape: [[2]] },
            { id: 2, amount: 1, shape: [[2, 1]] },
        ], {
            centerCells: [{ x: 0, y: 0 }],
        });

        for (const objective of Object.values(OBJECTIVES)) {
            assert.deepEqual(
                scoreOf(solveToCompletion(problem, objective)),
                scoreOf(bruteForce(problem, objective)),
                `target=${targetBits}, objective=${objective}`,
            );
        }
    }
});

test('frontier branching avoids placement-order explosion on a regular board', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    const problem = buildProblem(board, [
        { id: 1, amount: 16, shape: [[2, 2], [2, 2]] },
    ]);
    const search = createSearch(problem, OBJECTIVES.COVERAGE);

    while (!search.isComplete() && search.getStats().iterations < 1000) {
        search.step(100);
    }

    assert.equal(search.isComplete(), true);
    assert.deepEqual(scoreOf(search.getBest()), { coveredCells: 64, placedPieces: 16 });
});

test('greedy incumbent prunes a large regular exact-cover board', () => {
    const board = Array.from({ length: 10 }, () => Array(16).fill(0));
    const problem = buildProblem(board, [
        { id: 1, amount: 40, shape: [[2, 2], [2, 2]] },
    ]);
    const search = createSearch(problem, OBJECTIVES.COVERAGE);

    while (!search.isComplete() && search.getStats().iterations < 100) {
        search.step(10);
    }

    assert.equal(search.isComplete(), true);
    assert.deepEqual(scoreOf(search.getBest()), { coveredCells: 160, placedPieces: 40 });
});

test('area divisibility proves the best partial cover without exhaustive search', () => {
    const board = Array.from({ length: 10 }, () => Array(16).fill(0));
    board[9][15] = -1;
    const problem = buildProblem(board, [
        { id: 1, amount: 40, shape: [[2, 2], [2, 2]] },
    ]);
    const search = createSearch(problem, OBJECTIVES.COVERAGE);

    while (!search.isComplete() && search.getStats().iterations < 2000) {
        search.step(100);
    }

    assert.equal(search.isComplete(), true);
    assert.equal(search.getStats().initializationStates, 0);
    assert.deepEqual(scoreOf(search.getBest()), { coveredCells: 156, placedPieces: 39 });
});

test('inventory-aware piece bound closes a mixed-size full cover', () => {
    const board = Array.from({ length: 10 }, () => Array(16).fill(0));
    const problem = buildProblem(board, [
        { id: 1, amount: 50, shape: [[2, 1, 1]] },
        { id: 2, amount: 32, shape: [[2, 1, 1, 1, 1]] },
    ]);

    for (const objective of Object.values(OBJECTIVES)) {
        const search = createSearch(problem, objective);
        while (!search.isComplete() && search.getStats().iterations < 100) {
            search.step(10);
        }
        assert.equal(search.isComplete(), true, objective);
        assert.deepEqual(
            scoreOf(search.getBest()),
            { coveredCells: 160, placedPieces: 52 },
            objective,
        );
    }
});
