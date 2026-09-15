import {
    cloneMask,
    createMask,
    hasBit,
    intersects,
    maskKey,
    popcount,
    setBit,
    unionInto,
} from './bitset.js';
import { OBJECTIVES } from './constants.js';
import { compareSolutions } from './score.js';

/**
 * Worker 启动阶段只构造有界的强下界，避免启发式初始化阻塞暂停和取消消息。
 * 完整精确搜索仍会枚举所有未剪枝状态，因此该预算不改变最优性。
 */
const INTERACTIVE_SEARCH_OPTIONS = Object.freeze({
    maxExactCoverStates: 100,
    maxGreedySeeds: 4,
});

/**
 * 创建一个可按固定状态数分批推进的精确搜索器。
 *
 * 搜索从中心锚点摆法出发，每次固定选择当前连通边界上候选最少的格子，
 * 再决定由哪个积木覆盖它或把它留空。这样每个连通布局都有且只有确定的
 * 格子决策路径，避免按不同积木放置顺序重复枚举同一布局。
 */
function createSearch(problem, objective, options = {}) {
    if (!Object.values(OBJECTIVES).includes(objective)) {
        throw new RangeError(`Unknown objective: ${objective}`);
    }

    const initialRemaining = Uint16Array.from(problem.inventory, item => item.amount);
    const seedIds = problem.placements
        .filter(placement => placement.hasCenterAnchor)
        .map(placement => placement.id)
        .sort((left, right) => compareCandidateIds(problem, objective, left, right));
    const stack = [];
    for (let index = seedIds.length - 1; index >= 0; index--) {
        const placement = problem.placements[seedIds[index]];
        if (initialRemaining[placement.pieceType] > 0) {
            stack.push(createSeed(problem, initialRemaining, placement));
        }
    }
    const maxExactCoverStates = normalizeInitializationLimit(
        options.maxExactCoverStates,
        10000,
        'maxExactCoverStates',
    );
    const maxGreedySeeds = normalizeInitializationLimit(
        options.maxGreedySeeds,
        stack.length,
        'maxGreedySeeds',
    );

    const visited = new Map();
    const stats = {
        iterations: 0,
        initializationStates: 0,
        initializationGreedySeeds: 0,
        generatedStates: stack.length,
        cacheHits: 0,
        prunedStates: 0,
        incumbentUpdates: 0,
    };
    let best = null;
    // 完全覆盖已经锁定格子主目标，此时优先使用小积木可同时强化数量次目标。
    const exactCover = findExactCover(
        problem,
        stack,
        OBJECTIVES.PIECES,
        maxExactCoverStates,
    );
    stats.initializationStates = exactCover.iterations;
    if (exactCover.state) {
        const exactLayoutKey = createLayoutKey(problem, exactCover.state.placementIds);
        best = createSolution(problem, exactCover.state, exactLayoutKey);
        stats.incumbentUpdates++;
    }
    // 栈尾是主搜索最先展开的高优先级种子；有限预算时也保持同一顺序。
    const firstGreedySeed = Math.max(0, stack.length - maxGreedySeeds);
    for (let index = stack.length - 1; index >= firstGreedySeed; index--) {
        const seed = stack[index];
        stats.initializationGreedySeeds++;
        const greedyState = greedilyComplete(problem, seed, objective);
        const greedyLayoutKey = createLayoutKey(problem, greedyState.placementIds);
        const solution = createSolution(problem, greedyState, greedyLayoutKey);
        if (compareSolutions(solution, best, objective) > 0) {
            best = solution;
            stats.incumbentUpdates++;
        }
    }

    /** 推进至多 maxStates 个状态，返回本批是否发现更优解。 */
    function step(maxStates = 5000) {
        if (!Number.isInteger(maxStates) || maxStates <= 0) {
            throw new RangeError('maxStates must be a positive integer');
        }

        let processed = 0;
        let improved = false;
        while (processed < maxStates && stack.length > 0) {
            const state = stack.pop();
            processed++;
            stats.iterations++;

            const layoutKey = createLayoutKey(problem, state.placementIds);
            const stateKey = [
                maskKey(state.occupied),
                maskKey(state.excluded),
                Array.from(state.remaining).join(','),
            ].join('|');
            const previousLayoutKey = visited.get(stateKey);
            if (previousLayoutKey !== undefined && previousLayoutKey <= layoutKey) {
                stats.cacheHits++;
                continue;
            }
            visited.set(stateKey, layoutKey);

            const solution = createSolution(problem, state, layoutKey);
            if (compareSolutions(solution, best, objective) > 0) {
                best = solution;
                stats.incumbentUpdates++;
                improved = true;
            }

            if (!canBusinessScoreImprove(problem, state, best, objective)) {
                stats.prunedStates++;
                continue;
            }

            const branch = chooseFrontierBranch(problem, state, objective);
            if (!branch) {
                continue;
            }

            // 先压入留白分支，使更可能改善分数的积木分支优先出栈。
            stack.push(createExcludedChild(state, branch.cellIndex));
            stats.generatedStates++;
            for (let index = branch.candidateIds.length - 1; index >= 0; index--) {
                const placement = problem.placements[branch.candidateIds[index]];
                stack.push(createPlacementChild(problem, state, placement));
                stats.generatedStates++;
            }
        }

        return {
            processed,
            improved,
            complete: stack.length === 0,
        };
    }

    return {
        step,
        getBest: () => best,
        getStats: () => ({ ...stats, pendingStates: stack.length }),
        isComplete: () => stack.length === 0,
    };
}

function normalizeInitializationLimit(value, fallback, name) {
    const limit = value === undefined ? fallback : value;
    if (!Number.isInteger(limit) || limit < 0) {
        throw new RangeError(`${name} must be a non-negative integer`);
    }
    return limit;
}

/** 为测试、基准及非 Worker 调用同步求出最优解。 */
function solveToCompletion(problem, objective) {
    const search = createSearch(problem, objective);
    while (!search.isComplete()) {
        search.step(100000);
    }
    return search.getBest();
}

function createSeed(problem, initialRemaining, placement) {
    const remaining = initialRemaining.slice();
    remaining[placement.pieceType]--;
    return {
        occupied: cloneMask(placement.mask),
        excluded: createMask(problem.targetCount),
        remaining,
        placementIds: [placement.id],
        coveredCells: placement.cellIndices.length,
        placedPieces: 1,
    };
}

function createPlacementChild(problem, state, placement) {
    const occupied = cloneMask(state.occupied);
    unionInto(occupied, placement.mask);
    const remaining = state.remaining.slice();
    remaining[placement.pieceType]--;
    return {
        occupied,
        excluded: cloneMask(state.excluded),
        remaining,
        placementIds: [...state.placementIds, placement.id],
        coveredCells: state.coveredCells + problem.inventory[placement.pieceType].cellCount,
        placedPieces: state.placedPieces + 1,
    };
}

function createExcludedChild(state, cellIndex) {
    const excluded = cloneMask(state.excluded);
    setBit(excluded, cellIndex);
    return {
        occupied: cloneMask(state.occupied),
        excluded,
        remaining: state.remaining.slice(),
        placementIds: [...state.placementIds],
        coveredCells: state.coveredCells,
        placedPieces: state.placedPieces,
    };
}

/**
 * 为每个中心起点快速构造一个下界。贪心只提供 incumbent，不参与剪枝证明，
 * 因此即使选择不理想也不会影响后续精确搜索的正确性。
 */
function greedilyComplete(problem, seed, objective) {
    let state = {
        occupied: cloneMask(seed.occupied),
        excluded: cloneMask(seed.excluded),
        remaining: seed.remaining.slice(),
        placementIds: [...seed.placementIds],
        coveredCells: seed.coveredCells,
        placedPieces: seed.placedPieces,
    };

    while (true) {
        const branch = chooseFrontierBranch(problem, state, objective);
        if (!branch) {
            return state;
        }
        state = branch.candidateIds.length > 0
            ? createPlacementChild(problem, state, problem.placements[branch.candidateIds[0]])
            : createExcludedChild(state, branch.cellIndex);
    }
}

/**
 * 用受状态数限制的 Algorithm X 风格搜索寻找完整覆盖，只用于建立强下界。
 * 达到限制后立即回到主搜索，因此面积不相等的输入不会被完整覆盖尝试拖住。
 */
function findExactCover(problem, seeds, objective, maxStates) {
    if (!isWholeTargetConnected(problem)) {
        return { state: null, iterations: 0 };
    }
    const availableArea = problem.inventory.reduce((total, item) => (
        total + item.amount * item.cellCount
    ), 0);
    if (availableArea < problem.targetCount) {
        return { state: null, iterations: 0 };
    }
    const areaDivisor = problem.inventory.reduce((divisor, item) => (
        item.amount > 0 ? greatestCommonDivisor(divisor, item.cellCount) : divisor
    ), 0);
    if (areaDivisor > 1 && problem.targetCount % areaDivisor !== 0) {
        return { state: null, iterations: 0 };
    }

    const stack = seeds.map(seed => cloneState(seed));
    let iterations = 0;
    while (stack.length > 0 && iterations < maxStates) {
        const state = stack.pop();
        iterations++;
        if (state.coveredCells === problem.targetCount) {
            return { state, iterations };
        }

        const candidateIds = chooseExactCoverCandidates(problem, state, objective);
        if (!candidateIds || candidateIds.length === 0) {
            continue;
        }
        for (let index = candidateIds.length - 1; index >= 0; index--) {
            stack.push(createPlacementChild(problem, state, problem.placements[candidateIds[index]]));
        }
    }
    return { state: null, iterations };
}

function chooseExactCoverCandidates(problem, state, objective) {
    let bestCellIndex = -1;
    let bestCandidates = null;
    for (let cellIndex = 0; cellIndex < problem.targetCount; cellIndex++) {
        if (hasBit(state.occupied, cellIndex)) {
            continue;
        }

        const candidateIds = problem.placementsByCell[cellIndex].filter(placementId => {
            const placement = problem.placements[placementId];
            return state.remaining[placement.pieceType] > 0
                && !intersects(state.occupied, placement.mask);
        });
        candidateIds.sort((left, right) => compareCandidateIds(problem, objective, left, right));
        if (bestCandidates === null
            || candidateIds.length < bestCandidates.length
            || (candidateIds.length === bestCandidates.length && cellIndex < bestCellIndex)) {
            bestCellIndex = cellIndex;
            bestCandidates = candidateIds;
            if (candidateIds.length === 0) {
                break;
            }
        }
    }
    return bestCandidates;
}

function isWholeTargetConnected(problem) {
    if (problem.targetCount === 0) {
        return false;
    }
    const seen = new Set([0]);
    const pending = [0];
    while (pending.length > 0) {
        const current = pending.pop();
        for (const neighbor of problem.neighborsByIndex[current]) {
            if (!seen.has(neighbor)) {
                seen.add(neighbor);
                pending.push(neighbor);
            }
        }
    }
    return seen.size === problem.targetCount;
}

function cloneState(state) {
    return {
        occupied: cloneMask(state.occupied),
        excluded: cloneMask(state.excluded),
        remaining: state.remaining.slice(),
        placementIds: [...state.placementIds],
        coveredCells: state.coveredCells,
        placedPieces: state.placedPieces,
    };
}

/**
 * MRV 只在当前布局四向边界上选格。合法最终布局若覆盖该格，唯一覆盖它的
 * 积木现在必然已经与布局相邻；否则该格在对应分支中可以永久留空。
 */
function chooseFrontierBranch(problem, state, objective) {
    let bestCellIndex = -1;
    let bestCandidates = null;

    for (let cellIndex = 0; cellIndex < problem.targetCount; cellIndex++) {
        if (hasBit(state.occupied, cellIndex) || hasBit(state.excluded, cellIndex)) {
            continue;
        }
        if (!problem.neighborsByIndex[cellIndex].some(neighbor => hasBit(state.occupied, neighbor))) {
            continue;
        }

        const candidateIds = [];
        for (const placementId of problem.placementsByCell[cellIndex]) {
            const placement = problem.placements[placementId];
            if (state.remaining[placement.pieceType] === 0
                || intersects(state.occupied, placement.mask)
                || intersects(state.excluded, placement.mask)) {
                continue;
            }
            candidateIds.push(placementId);
        }
        candidateIds.sort((left, right) => compareCandidateIds(problem, objective, left, right));

        if (bestCandidates === null
            || candidateIds.length < bestCandidates.length
            || (candidateIds.length === bestCandidates.length && cellIndex < bestCellIndex)) {
            bestCellIndex = cellIndex;
            bestCandidates = candidateIds;
            if (candidateIds.length === 0) {
                break;
            }
        }
    }

    return bestCandidates === null
        ? null
        : { cellIndex: bestCellIndex, candidateIds: bestCandidates };
}

function compareCandidateIds(problem, objective, leftId, rightId) {
    const left = problem.placements[leftId];
    const right = problem.placements[rightId];
    const leftSize = left.cellIndices.length;
    const rightSize = right.cellIndices.length;
    const sizeOrder = objective === OBJECTIVES.PIECES
        ? leftSize - rightSize
        : rightSize - leftSize;
    return sizeOrder || left.layoutKey.localeCompare(right.layoutKey);
}

/** 只使用必然乐观的面积和数量上界，保证剪枝不影响最优性。 */
function canBusinessScoreImprove(problem, state, best, objective) {
    if (!best) {
        return true;
    }

    let remainingPieces = 0;
    let remainingCells = 0;
    let areaDivisor = 0;
    for (let pieceType = 0; pieceType < state.remaining.length; pieceType++) {
        const amount = state.remaining[pieceType];
        if (amount === 0) {
            continue;
        }
        const cellCount = problem.inventory[pieceType].cellCount;
        remainingPieces += amount;
        remainingCells += amount * cellCount;
        areaDivisor = greatestCommonDivisor(areaDivisor, cellCount);
    }

    const freeCells = problem.targetCount - state.coveredCells - popcount(state.excluded);
    const areaLimitedCells = areaDivisor > 0
        ? freeCells - (freeCells % areaDivisor)
        : 0;
    const upperCoveredCells = state.coveredCells + Math.min(areaLimitedCells, remainingCells);
    const upperPlacedPieces = state.placedPieces + Math.min(
        remainingPieces,
        maxPiecesForCapacity(problem, state.remaining, freeCells),
    );

    if (objective === OBJECTIVES.PIECES) {
        return upperPlacedPieces > best.placedPieces
            || (upperPlacedPieces === best.placedPieces && upperCoveredCells > best.coveredCells);
    }
    return upperCoveredCells > best.coveredCells
        || (upperCoveredCells === best.coveredCells && upperPlacedPieces > best.placedPieces);
}

function createSolution(problem, state, layoutKey) {
    return {
        coveredCells: state.coveredCells,
        placedPieces: state.placedPieces,
        layoutKey,
        placementIds: [...state.placementIds].sort((left, right) => (
            problem.placements[left].layoutKey.localeCompare(problem.placements[right].layoutKey)
        )),
    };
}

function createLayoutKey(problem, placementIds) {
    return placementIds
        .map(id => problem.placements[id].layoutKey)
        .sort()
        .join('|');
}

function greatestCommonDivisor(left, right) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b !== 0) {
        [a, b] = [b, a % b];
    }
    return a;
}

/**
 * 在只考虑面积、不考虑几何的乐观条件下，小积木优先必然得到可容纳的最大块数。
 */
function maxPiecesForCapacity(problem, remaining, capacity) {
    const pieceTypes = Array.from(remaining, (_, pieceType) => pieceType)
        .filter(pieceType => remaining[pieceType] > 0)
        .sort((left, right) => (
            problem.inventory[left].cellCount - problem.inventory[right].cellCount
            || left - right
        ));
    let availableCells = capacity;
    let result = 0;
    for (const pieceType of pieceTypes) {
        const cellCount = problem.inventory[pieceType].cellCount;
        const used = Math.min(remaining[pieceType], Math.floor(availableCells / cellCount));
        result += used;
        availableCells -= used * cellCount;
    }
    return result;
}

export { createSearch, INTERACTIVE_SEARCH_OPTIONS, solveToCompletion };
