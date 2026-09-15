/**
 * 暂停搜索并把 Worker 已送达的当前最佳布局同步到页面。
 * 实时演算只控制搜索过程中的连续重绘，不能阻止用户在暂停时看到当前状态。
 */
function pauseSolverUi(solvers, { renderStats, drawBoard }) {
    for (const solver of solvers) {
        solver.pause();
    }
    if (solvers[0]) {
        renderStats(solvers[0].stats);
        drawBoard();
    }
}

/** 请求 Worker 正常取消，以便保留并返回当前最佳解。 */
function stopSolverUi(solvers) {
    for (const solver of solvers) {
        solver.stop();
    }
}

/** 暂停时辅助按钮用于停止搜索，其余状态仍保留原重置语义。 */
function secondaryControlForState(state) {
    return state === 'paused'
        ? { action: 'stop', labelKey: 'stop' }
        : { action: 'reset', labelKey: 'reset' };
}

/** 暂停态必须展示随后送达的当前最佳解；运行态仍由实时演算开关控制。 */
function shouldDrawIncumbent(isLiveSolve, state) {
    return state === 'paused' || isLiveSolve;
}

export {
    pauseSolverUi,
    secondaryControlForState,
    shouldDrawIncumbent,
    stopSolverUi,
};
