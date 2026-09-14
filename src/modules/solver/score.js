import { OBJECTIVES } from './constants.js';

/**
 * 按指定优化目标比较两个合法解。
 *
 * 返回正数表示 left 更优，负数表示 right 更优，0 表示完全相同。
 * 布局键只用于确保相同业务评分下的结果可复现。
 */
function compareSolutions(left, right, objective) {
    if (!right) {
        return 1;
    }

    const fields = objective === OBJECTIVES.PIECES
        ? ['placedPieces', 'coveredCells']
        : ['coveredCells', 'placedPieces'];

    for (const field of fields) {
        if (left[field] !== right[field]) {
            return left[field] - right[field];
        }
    }

    return right.layoutKey.localeCompare(left.layoutKey);
}

export { compareSolutions };
