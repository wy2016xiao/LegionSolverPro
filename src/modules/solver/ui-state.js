import { OBJECTIVES, RESULT_STATUS } from './constants.js';

const STATUS_KEYS = Object.freeze({
    [RESULT_STATUS.OPTIMAL]: 'resultOptimal',
    [RESULT_STATUS.BEST_KNOWN]: 'resultBestKnown',
    [RESULT_STATUS.NO_SOLUTION]: 'resultNoSolution',
    [RESULT_STATUS.INVALID]: 'resultInvalid',
    [RESULT_STATUS.ERROR]: 'resultError',
});

/** 把持久化数据限制为两个规范目标，未知值回到格子覆盖优先。 */
function normalizeObjective(value) {
    return Object.values(OBJECTIVES).includes(value)
        ? value
        : OBJECTIVES.COVERAGE;
}

/** 生成统一的用户可见求解结果摘要。 */
function formatResultSummary(result, translate) {
    if (!result) {
        return '';
    }

    const status = translate(STATUS_KEYS[result.status] || 'resultError');
    if (result.status === RESULT_STATUS.INVALID || result.status === RESULT_STATUS.ERROR) {
        return status;
    }

    return [
        status,
        `${translate('resultCovered')} ${result.coveredCells}/${result.targetCells} ${translate('cellUnit')}`,
        `${translate('resultUsed')} ${result.placedPieces}/${result.availablePieces} ${translate('pieceUnit')}`,
    ].join(' · ');
}

export { formatResultSummary, normalizeObjective };
