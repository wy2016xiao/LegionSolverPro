import assert from 'node:assert/strict';

import { buildProblem } from '../src/modules/solver/problem.js';
import { createSearch } from '../src/modules/solver/search.js';
import { fixtures } from './fixtures.js';

const RUNS = 5;
const MAX_RUN_MS = 2000;

for (const fixture of fixtures) {
    const samples = [];
    let lastStats = null;
    for (let run = 0; run < RUNS; run++) {
        const startedAt = performance.now();
        const problem = buildProblem(fixture.board, fixture.pieces, {
            centerCells: fixture.centerCells,
        });
        const search = createSearch(problem, fixture.objective);
        const firstSolutionMs = search.getBest() ? performance.now() - startedAt : null;

        while (!search.isComplete() && performance.now() - startedAt < MAX_RUN_MS) {
            search.step(500);
        }
        const elapsedMs = performance.now() - startedAt;
        assert.equal(search.isComplete(), true, `${fixture.name} exceeded ${MAX_RUN_MS}ms`);

        const result = search.getBest();
        const score = result && {
            coveredCells: result.coveredCells,
            placedPieces: result.placedPieces,
        };
        assert.deepEqual(score, fixture.expectedScore, `${fixture.name} returned a wrong score`);
        samples.push(elapsedMs);
        lastStats = {
            ...search.getStats(),
            firstSolutionMs,
        };
    }

    samples.sort((left, right) => left - right);
    const report = {
        fixture: fixture.name,
        objective: fixture.objective,
        medianMs: round(samples[Math.floor(samples.length / 2)]),
        p95Ms: round(samples[Math.ceil(samples.length * 0.95) - 1]),
        score: fixture.expectedScore,
        iterations: lastStats.iterations,
        initializationStates: lastStats.initializationStates,
        cacheHits: lastStats.cacheHits,
        prunedStates: lastStats.prunedStates,
        firstSolutionMs: lastStats.firstSolutionMs === null
            ? null
            : round(lastStats.firstSolutionMs),
    };
    console.log(JSON.stringify(report));
}

function round(value) {
    return Math.round(value * 100) / 100;
}
