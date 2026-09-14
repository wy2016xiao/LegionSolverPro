import { createMask, hasBit, intersects, popcount, unionInto } from '../../src/modules/solver/bitset.js';
import { compareSolutions } from '../../src/modules/solver/score.js';

/**
 * 仅用于小型测试输入的独立穷举器。
 * 它不复用生产搜索逻辑，避免测试与实现犯下相同错误。
 */
function bruteForce(problem, objective) {
    if (problem.placements.length > 20) {
        throw new Error('Brute-force fixture has too many placements');
    }

    let best = null;
    const subsetCount = 2 ** problem.placements.length;
    for (let subset = 1; subset < subsetCount; subset++) {
        const occupied = createMask(problem.targetCount);
        const used = new Uint16Array(problem.inventory.length);
        const chosen = [];
        let hasCenterAnchor = false;
        let legal = true;

        for (let id = 0; id < problem.placements.length && legal; id++) {
            if ((subset & (2 ** id)) === 0) {
                continue;
            }

            const placement = problem.placements[id];
            used[placement.pieceType]++;
            legal = used[placement.pieceType] <= problem.inventory[placement.pieceType].amount
                && !intersects(occupied, placement.mask);
            if (legal) {
                unionInto(occupied, placement.mask);
                chosen.push(placement);
                hasCenterAnchor ||= placement.hasCenterAnchor;
            }
        }

        if (!legal || !hasCenterAnchor || !isConnected(occupied, problem.neighborsByIndex)) {
            continue;
        }

        const solution = {
            coveredCells: popcount(occupied),
            placedPieces: chosen.length,
            layoutKey: chosen.map(placement => placement.layoutKey).sort().join('|'),
            placementIds: chosen.map(placement => placement.id),
        };
        if (compareSolutions(solution, best, objective) > 0) {
            best = solution;
        }
    }

    return best;
}

function isConnected(occupied, neighborsByIndex) {
    let first = -1;
    let occupiedCount = 0;
    for (let index = 0; index < neighborsByIndex.length; index++) {
        if (hasBit(occupied, index)) {
            first = first === -1 ? index : first;
            occupiedCount++;
        }
    }
    if (first === -1) {
        return false;
    }

    const seen = new Set([first]);
    const pending = [first];
    while (pending.length > 0) {
        const current = pending.pop();
        for (const neighbor of neighborsByIndex[current]) {
            if (hasBit(occupied, neighbor) && !seen.has(neighbor)) {
                seen.add(neighbor);
                pending.push(neighbor);
            }
        }
    }
    return seen.size === occupiedCount;
}

export { bruteForce };
