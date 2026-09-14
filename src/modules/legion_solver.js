import { OBJECTIVES, RESULT_STATUS } from './solver/constants.js';

/**
 * UI 与求解 Worker 之间的兼容门面。
 *
 * 该类保留旧页面使用的 solve/pause/continue/stop 和 board/history 字段，
 * 但不再在主线程执行搜索或直接访问 DOM。
 */
class LegionSolver {
    constructor(board, pieces, onBoardUpdated = () => {}, options = {}) {
        this.board = board;
        this.targetBoard = board.map(row => [...row]);
        this.pieces = pieces.map(piece => ({
            id: piece.id,
            amount: Number(piece.amount),
            shape: piece.shape.map(row => [...row]),
        }));
        this.onBoardUpdated = onBoardUpdated;
        this.objective = options.objective || OBJECTIVES.COVERAGE;
        this.workerFactory = options.workerFactory || (() => (
            new Worker(new URL('./solver/solver.worker.js', import.meta.url), { type: 'module' })
        ));
        this.worker = null;
        this.history = [];
        this.iterations = 0;
        this.stats = { iterations: 0, elapsedMs: 0 };
        this.time = 0;
        this.success = undefined;
        this.currentResult = null;
        this.solvePromise = null;
        this.resolveSolve = null;
        this.discarded = false;
    }

    /** 启动一次求解；同一实例重复调用时复用原 Promise。 */
    solve() {
        if (this.solvePromise) {
            return this.solvePromise;
        }

        this.time = Date.now();
        this.discarded = false;
        this.worker = this.workerFactory();
        this.worker.onmessage = event => this.handleMessage(event.data);
        this.worker.onerror = event => this.finish({
            status: RESULT_STATUS.ERROR,
            message: event.message || 'Solver worker failed',
            coveredCells: 0,
            placedPieces: 0,
            placements: [],
        });
        this.solvePromise = new Promise(resolve => {
            this.resolveSolve = resolve;
        });
        this.worker.postMessage({
            type: 'start',
            payload: {
                board: this.targetBoard.map(row => [...row]),
                pieces: this.pieces.map(piece => ({
                    ...piece,
                    shape: piece.shape.map(row => [...row]),
                })),
                objective: this.objective,
            },
        });
        return this.solvePromise;
    }

    /** 请求 Worker 在当前批次后暂停。 */
    pause() {
        this.postControl('pause');
    }

    /** 继续已暂停的搜索。 */
    continue() {
        this.postControl('resume');
    }

    /** 停止搜索并保留 Worker 已找到的当前最佳布局。 */
    stop() {
        this.postControl('cancel');
    }

    /** 立即释放 Worker，供页面重置或卸载时使用。 */
    terminate() {
        this.discarded = true;
        this.releaseWorker();
        if (this.resolveSolve) {
            const resolve = this.resolveSolve;
            this.resolveSolve = null;
            resolve({
                ...(this.currentResult || {
                    status: RESULT_STATUS.BEST_KNOWN,
                    coveredCells: 0,
                    placedPieces: 0,
                    placements: [],
                }),
                discarded: true,
            });
        }
    }

    handleMessage(message) {
        if (this.discarded) {
            return;
        }
        if (message.stats) {
            this.stats = { ...this.stats, ...message.stats };
            this.iterations = this.stats.iterations || 0;
        }

        switch (message.type) {
            case 'progress':
                return;
            case 'incumbent':
                this.applyResult(message.result);
                this.onBoardUpdated(message.result, this.stats);
                return;
            case 'completed':
            case 'cancelled':
            case 'invalid':
            case 'error':
                this.finish(message.result);
                return;
            default:
                this.finish({
                    status: RESULT_STATUS.ERROR,
                    message: `Unknown worker message: ${message.type}`,
                    coveredCells: 0,
                    placedPieces: 0,
                    placements: [],
                });
        }
    }

    postControl(type) {
        if (this.worker) {
            this.worker.postMessage({ type });
        }
    }

    finish(result) {
        if (!this.resolveSolve) {
            return;
        }

        this.applyResult(result);
        this.currentResult = result;
        this.success = result.status === RESULT_STATUS.OPTIMAL;
        if (!this.stats.elapsedMs) {
            this.stats.elapsedMs = Date.now() - this.time;
        }
        const resolve = this.resolveSolve;
        this.resolveSolve = null;
        this.releaseWorker();
        resolve(result);
    }

    applyResult(result) {
        if (!result) {
            return;
        }

        for (let y = 0; y < this.targetBoard.length; y++) {
            for (let x = 0; x < this.targetBoard[y].length; x++) {
                this.board[y][x] = this.targetBoard[y][x] === -1 ? -1 : 0;
            }
        }

        this.history = [];
        for (const placement of result.placements || []) {
            const historyEntry = [];
            for (const cell of placement.cells) {
                this.board[cell.y][cell.x] = cell.isAnchor
                    ? placement.pieceId + 18
                    : placement.pieceId;
                historyEntry.push({ x: cell.x, y: cell.y });
            }
            this.history.push(historyEntry);
        }
        this.currentResult = result;
    }

    releaseWorker() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}

export { LegionSolver };
