import { OBJECTIVES } from './constants.js';

/**
 * 按指定优化目标比较两个合法解。
 *
 * 返回正数表示 left 更优，负数表示 right 更优，0 表示业务评分相同。
 * layoutKey 是确定性搜索和消息去重标识，不代表额外的游戏收益目标。
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

    return 0;
}

export { compareSolutions };
