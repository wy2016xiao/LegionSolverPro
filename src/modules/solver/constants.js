/** 可用的词典序优化目标。 */
const OBJECTIVES = Object.freeze({
    COVERAGE: 'coverage',
    PIECES: 'pieces',
});

/** 求解结束后可对用户展示的结果状态。 */
const RESULT_STATUS = Object.freeze({
    OPTIMAL: 'optimal',
    BEST_KNOWN: 'best-known',
    NO_SOLUTION: 'no-solution',
    INVALID: 'invalid',
    ERROR: 'error',
});

export { OBJECTIVES, RESULT_STATUS };
