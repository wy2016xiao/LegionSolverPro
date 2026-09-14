import { OBJECTIVES, RESULT_STATUS } from './constants.js';
import { buildProblem } from './problem.js';
import { createSearch } from './search.js';

const TIME_SLICE_MS = 12;
const STATES_PER_STEP = 200;
const PROGRESS_INTERVAL_MS = 100;

let problem = null;
let search = null;
let paused = false;
let cancelled = false;
let scheduled = false;
let startedAt = 0;
let firstSolutionMs = null;
let lastProgressAt = 0;
let lastIncumbentKey = null;

self.onmessage = event => {
    const { type, payload } = event.data;
    if (type === 'start') {
        start(payload);
    } else if (type === 'pause') {
        paused = true;
    } else if (type === 'resume' && search && paused) {
        paused = false;
        scheduleBatch();
    } else if (type === 'cancel' && search) {
        cancelled = true;
        if (paused) {
            paused = false;
            scheduleBatch();
        }
    }
};

function start(payload) {
    try {
        validatePayload(payload);
        problem = buildProblem(payload.board, payload.pieces);
        if (problem.targetCount === 0) {
            finishInvalid('Select at least one target cell');
            return;
        }
        if (problem.totalAvailablePieces === 0) {
            finishInvalid('Enter at least one available piece');
            return;
        }

        search = createSearch(problem, payload.objective || OBJECTIVES.COVERAGE);
        paused = false;
        cancelled = false;
        startedAt = performance.now();
        firstSolutionMs = null;
        lastProgressAt = startedAt;
        lastIncumbentKey = null;
        scheduleBatch();
    } catch (error) {
        finishError(error);
    }
}

function scheduleBatch() {
    if (scheduled || paused || !search) {
        return;
    }
    scheduled = true;
    setTimeout(runBatch, 0);
}

function runBatch() {
    scheduled = false;
    if (!search || paused) {
        return;
    }
    if (cancelled) {
        finishCancelled();
        return;
    }

    try {
        const deadline = performance.now() + TIME_SLICE_MS;
        do {
            search.step(STATES_PER_STEP);
        } while (!search.isComplete() && performance.now() < deadline);

        const best = search.getBest();
        if (best && firstSolutionMs === null) {
            firstSolutionMs = performance.now() - startedAt;
        }
        // 初始化阶段也可能已建立 best，是否上报只能由该布局是否曾发送决定。
        if (best && best.layoutKey !== lastIncumbentKey) {
            lastIncumbentKey = best.layoutKey;
            self.postMessage({
                type: 'incumbent',
                result: serializeResult(best, RESULT_STATUS.BEST_KNOWN),
                stats: createStats(),
            });
        }

        const now = performance.now();
        if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
            lastProgressAt = now;
            self.postMessage({ type: 'progress', stats: createStats() });
        }

        if (search.isComplete()) {
            finishCompleted();
        } else {
            scheduleBatch();
        }
    } catch (error) {
        finishError(error);
    }
}

function finishCompleted() {
    const best = search.getBest();
    self.postMessage({
        type: 'completed',
        result: serializeResult(best, best ? RESULT_STATUS.OPTIMAL : RESULT_STATUS.NO_SOLUTION),
        stats: createStats(),
    });
    clearSearch();
}

function finishCancelled() {
    self.postMessage({
        type: 'cancelled',
        result: serializeResult(search.getBest(), RESULT_STATUS.BEST_KNOWN),
        stats: createStats(),
    });
    clearSearch();
}

function finishInvalid(message) {
    self.postMessage({
        type: 'invalid',
        result: emptyResult(RESULT_STATUS.INVALID, message),
        stats: createStats(),
    });
    clearSearch();
}

function finishError(error) {
    self.postMessage({
        type: 'error',
        result: emptyResult(
            RESULT_STATUS.ERROR,
            error instanceof Error ? error.message : String(error),
        ),
        stats: createStats(),
    });
    clearSearch();
}

function serializeResult(best, status) {
    if (!best) {
        return emptyResult(status);
    }
    return {
        status,
        coveredCells: best.coveredCells,
        placedPieces: best.placedPieces,
        targetCells: problem.targetCount,
        availablePieces: problem.totalAvailablePieces,
        layoutKey: best.layoutKey,
        placements: best.placementIds.map(id => {
            const placement = problem.placements[id];
            return {
                pieceId: placement.pieceId,
                cells: placement.cells,
            };
        }),
    };
}

function emptyResult(status, message = '') {
    return {
        status,
        message,
        coveredCells: 0,
        placedPieces: 0,
        targetCells: problem ? problem.targetCount : 0,
        availablePieces: problem ? problem.totalAvailablePieces : 0,
        placements: [],
    };
}

function createStats() {
    const searchStats = search ? search.getStats() : { iterations: 0 };
    return {
        ...searchStats,
        elapsedMs: startedAt ? performance.now() - startedAt : 0,
        firstSolutionMs,
    };
}

function validatePayload(payload) {
    if (!payload || !Array.isArray(payload.board) || !Array.isArray(payload.pieces)) {
        throw new TypeError('Invalid solver payload');
    }
    if (!Object.values(OBJECTIVES).includes(payload.objective)) {
        throw new RangeError(`Unknown objective: ${payload.objective}`);
    }
}

function clearSearch() {
    problem = null;
    search = null;
    paused = false;
    cancelled = false;
}
