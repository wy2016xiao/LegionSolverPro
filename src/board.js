import { Point } from './modules/point.js';
import { LegionSolver } from './modules/legion_solver.js';
import { pieceColours, pieces } from './pieces.js';
import { i18n } from './i18n.js';
import { OBJECTIVES, RESULT_STATUS } from './modules/solver/constants.js';
import { formatResultSummary, normalizeObjective } from './modules/solver/ui-state.js';
import {
    pauseSolverUi,
    secondaryControlForState,
    shouldDrawIncumbent,
    stopSolverUi,
} from './modules/solver/ui-controls.js';

let board = JSON.parse(localStorage.getItem("legionBoard"));
if (!board) {
    board = [];
    for (let i = 0; i < 20; i++) {
        board[i] = [];
        for (let j = 0; j < 22; j++) {
            board[i][j] = -1;
        }
    }
}
let legionSolvers = [];
let pieceHistory = [];
let activeRunId = 0;
let lastLiveDraw = 0;
const objectiveStorageKey = 'legionSolverObjective';
let objective = normalizeObjective(localStorage.getItem(objectiveStorageKey));

const states = {
    START: 'start',
    RUNNING: 'running',
    PAUSED: 'paused',
    STOPPING: 'stopping',
    COMPLETED: 'completed',
}
let state = states.START;

const objectiveInput = document.querySelector(`input[name="objective"][value="${objective}"]`);
objectiveInput.checked = true;

const legionGroups = [];
for (let i = 0; i < 16; i++) {
    legionGroups[i] = [];
}

document.querySelector('#legionBoard tbody').innerHTML =
    board.map(row => `<tr>${row.map(_ => `<td class="legionCell"></td>`).join('')}</tr>`).join('');

drawBoard();
setLegionGroups();

let boardFilled = 0;
if (localStorage.getItem("boardFilled")) {
    boardFilled = JSON.parse(localStorage.getItem("boardFilled"));
    document.getElementById('boardFilledValue').innerText = `${boardFilled}`;
}

let isBigClick = false;
if (localStorage.getItem("isBigClick")) {
    document.getElementById("bigClick").checked = JSON.parse(localStorage.getItem("isBigClick"));
    if (JSON.parse(localStorage.getItem("isBigClick"))) {
        activateBigClick();
    }
}

let isLiveSolve = false;
if (localStorage.getItem("isLiveSolve")) {
    document.getElementById("liveSolve").checked = JSON.parse(localStorage.getItem("isLiveSolve"));
    if (JSON.parse(localStorage.getItem("isLiveSolve"))) {
        activateLiveSolve();
    }
}

document.getElementById("bigClick").addEventListener("click", activateBigClick);
document.getElementById("liveSolve").addEventListener("click", activateLiveSolve);
document.getElementById("clearBoard").addEventListener("click", clearBoard);
document.getElementById("boardButton").addEventListener("click", handleButton);
document.getElementById("resetButton").addEventListener("click", handleSecondaryButton);
document.getElementById("darkMode").addEventListener("click", activateDarkMode);
for (const input of document.querySelectorAll('input[name="objective"]')) {
    input.addEventListener('change', event => {
        objective = normalizeObjective(event.target.value);
        localStorage.setItem(objectiveStorageKey, objective);
    });
}

let dragging = false;
let dragValue;
for (let i = 0; i < board.length; i++) {
    for (let j = 0; j < board[0].length; j++) {
        let grid = getLegionCell(i, j)

        grid.addEventListener("mousedown", () => {
            dragValue = board[i][j] == 0 ? -1 : 0;
            setBoard(i, j, dragValue);
            dragging = true;
        });
        grid.addEventListener("mouseover", () => {
            if (dragging) {
                setBoard(i, j, dragValue);
            } else {
                hoverOverBoard(i, j);
            }
        });
        grid.addEventListener("mouseout", () => {
            if (!dragging) {
                hoverOffBoard(i, j) ;
            }
        });
    }
}
document.documentElement.addEventListener("mouseup", () => { dragging = false });
document.getElementById("legion").addEventListener("dragstart", (evt) => evt.preventDefault());

function setLegionGroups() {
    for (let i = 0; i < board.length / 4; i++) {
        for (let j = i; j < board.length / 2; j++) {
            legionGroups[0].push(new Point(j, i));
            legionGroups[1].push(new Point(i, j + 1))
            legionGroups[2].push(new Point(i, board[0].length - 2 - j))
            legionGroups[3].push(new Point(j, board[0].length - 1 - i))
            legionGroups[4].push(new Point(board.length - 1 - j, board[0].length - 1 - i))
            legionGroups[5].push(new Point(board.length - 1 - i, board[0].length - 2 - j))
            legionGroups[6].push(new Point(board.length - 1 - i, j + 1))
            legionGroups[7].push(new Point(board.length - 1 - j, i))
        }
    }
    for (let i = board.length / 4; i < board.length / 2; i++) {
        for (let j = i; j < board.length / 2; j++) {
            legionGroups[8].push(new Point(j, i));
            legionGroups[9].push(new Point(i, j + 1));
            legionGroups[10].push(new Point(3 * board.length / 4 - 1 - j, board.length / 4 + 1 + i));
            legionGroups[11].push(new Point(j, board[0].length - 1 - i));
            legionGroups[12].push(new Point(board.length - 1 - j, board[0].length - 1 - i));
            legionGroups[13].push(new Point(j + board.length / 4, i + board.length / 4 + 1));
            legionGroups[14].push(new Point(j + board.length / 4, 3 * board.length / 4 - i));
            legionGroups[15].push(new Point(board.length - j - 1, i));
        }
    }
}

function setLegionBorders() {
    for (let i = 0; i < board.length; i++) {
        for (let j = 0; j < board[0].length; j++) {
            getLegionCell(i, j).style.borderWidth = '1px';
        }
    }
    for (let i = 0; i < board[0].length / 2; i++) {
        getLegionCell(i, i).style.borderTopWidth = '3px';
        getLegionCell(i, i).style.borderRightWidth = '3px';
        getLegionCell(board.length - i - 1, i).style.borderBottomWidth = '3px';
        getLegionCell(board.length - i - 1, i).style.borderRightWidth = '3px';
        getLegionCell(i, board[0].length - i - 1).style.borderTopWidth = '3px';
        getLegionCell(i, board[0].length - i - 1).style.borderLeftWidth = '3px';
        getLegionCell(board.length - i - 1, board[0].length - i - 1).style.borderBottomWidth = '3px';
        getLegionCell(board.length - i - 1, board[0].length - i - 1).style.borderLeftWidth = '3px';
    }
    for (let i = 0; i < board.length; i++) {
        getLegionCell(i, 0).style.borderLeftWidth = '3px';
        getLegionCell(i, board[0].length / 2).style.borderLeftWidth = '3px';
        getLegionCell(i, board[0].length - 1).style.borderRightWidth = '3px';
    }
    for (let i = 0; i < board[0].length; i++) {
        getLegionCell(0, i).style.borderTopWidth = '3px';
        getLegionCell(board.length / 2, i).style.borderTopWidth = '3px';
        getLegionCell(board.length - 1, i).style.borderBottomWidth = '3px';
    }
    for (let i = board.length / 4; i < 3 * board.length / 4; i++) {
        getLegionCell(i, Math.floor(board[0].length / 4)).style.borderLeftWidth = '3px';
        getLegionCell(i, Math.floor(3 * board[0].length / 4)).style.borderRightWidth = '3px';
    }
    for (let i = Math.ceil(board[0].length / 4); i < Math.floor(3 * board[0].length / 4); i++) {
        getLegionCell(board.length / 4, i).style.borderTopWidth = '3px';
        getLegionCell(3 * board.length / 4, i).style.borderTopWidth = '3px';
    }
}

let isDarkMode = false;
if (localStorage.getItem("isDarkMode")) {
    document.getElementById("darkMode").checked = JSON.parse(localStorage.getItem("isDarkMode"));
    if (JSON.parse(localStorage.getItem("isDarkMode"))) {
        activateDarkMode();
    }
}


function findGroupNumber(i, j) {
    for (let k = 0; k < legionGroups.length; k++) {
        for (let point of legionGroups[k]) {
            if (point.x == i && point.y == j) {
                return k;
            }
        }
    }
}

function getLegionCell(i, j) {
    return document.getElementById("legionBoard")
    .getElementsByTagName("tr")[i]
    .getElementsByTagName("td")[j];
}

function clearBoard() {
    for (let i = 0; i < board.length; i++) {
        for (let j = 0; j < board[0].length; j++) {
            board[i][j] = -1;
            getLegionCell(i, j).style.background = pieceColours.get(board[i][j])
        }
    }
    boardFilled = 0;
    localStorage.setItem("legionBoard", JSON.stringify(board));
    localStorage.setItem("boardFilled", JSON.stringify(0));
    document.getElementById('boardFilledValue').innerText = `${boardFilled}`;
}

function setBoard(i, j, value) {
    if (state != states.START) {
        return;
    }

    if (isBigClick) {
        if (value == 0) {
            for (let point of legionGroups[findGroupNumber(i, j)]) {
                let grid = getLegionCell(point.x, point.y);
                grid.style.background = pieceColours.get(0);
                if (board[point.x][point.y] == -1) {
                    boardFilled++;
                }
                board[point.x][point.y] = 0;
            }
        } else {
            for (let point of legionGroups[findGroupNumber(i, j)]) {
                let grid = getLegionCell(point.x, point.y);
                grid.style.background = pieceColours.get(-1);
                if (board[point.x][point.y] == 0) {
                    boardFilled--;
                }
                board[point.x][point.y] = -1;
            }
        }
    } else {
        let grid = getLegionCell(i, j);
        if (value == -1) {
            if (board[i][j] != -1) {
                board[i][j] = -1;
                grid.style.background = pieceColours.get(-1);
                boardFilled--;
            }
        } else {
            if (board[i][j] != 0) {
                board[i][j] = 0;
                grid.style.background = pieceColours.get(0);
                boardFilled++;
            }
        }
    }
    localStorage.setItem("legionBoard", JSON.stringify(board));
    localStorage.setItem("boardFilled", JSON.stringify(boardFilled));
    document.getElementById('boardFilledValue').innerText = `${boardFilled}`;
}

function hoverOverBoard(i, j) {
    if (state != states.START) {
        return;
    }
    if (isBigClick) {
        for (let point of legionGroups[findGroupNumber(i, j)]) {
            if (board[point.x][point.y] == -1) {
                if (isDarkMode) {
                    getLegionCell(point.x, point.y).style.background = 'dimgrey';
                } else {
                    getLegionCell(point.x, point.y).style.background = 'silver';
                }
            } else {
                if (isDarkMode) {
                    getLegionCell(point.x, point.y).style.background = 'rgb(20, 20, 20)';
                } else {
                    getLegionCell(point.x, point.y).style.background = 'dimgrey';
                }

            }

        }
    } else {
        if (board[i][j] == -1) {
            if (isDarkMode) {
                getLegionCell(i, j).style.background = 'dimgrey';
            } else {
                getLegionCell(i, j).style.background = 'silver';
            }
        } else {
            if (isDarkMode) {
                getLegionCell(i, j).style.background = 'rgb(20, 20, 20)';
            } else {
                getLegionCell(i, j).style.background = 'dimgrey';
            }
        }

    }
}

function hoverOffBoard(i, j) {
    if (state != states.START) {
        return;
    }
    if (isBigClick) {
        for (let point of legionGroups[findGroupNumber(i, j)]) {
            if (board[point.x][point.y] == -1) {
                getLegionCell(point.x, point.y).style.background = pieceColours.get(-1);
            } else {
                getLegionCell(point.x, point.y).style.background = pieceColours.get(0);
            }
        }
    } else {
        if (board[i][j] == -1) {
            getLegionCell(i, j).style.background = pieceColours.get(-1);
        } else {
            getLegionCell(i, j).style.background = pieceColours.get(0);
        }
    }
}

function resetBoard() {
    const targetBoard = legionSolvers[0] && legionSolvers[0].targetBoard;
    for (const solver of legionSolvers) {
        solver.terminate();
    }

    if (targetBoard) {
        for (let y = 0; y < targetBoard.length; y++) {
            for (let x = 0; x < targetBoard[y].length; x++) {
                board[y][x] = targetBoard[y][x];
            }
        }
    }

    pieceHistory = [];
    setLegionBorders();
    legionSolvers = [];
    drawBoard();
}

function drawBoard() {
    setLegionBorders();
    colourBoard();
}

function colourBoard() {
    let spot;
    for (let i = 0; i < board.length; i++) {
        for (let j = 0; j < board[0].length; j++) {
            spot = board[i][j];
            getLegionCell(i, j).style.background = pieceColours.get(spot);
        }
    }

    if (pieceHistory.length == 0 && legionSolvers[0]) {
        pieceHistory = legionSolvers[0].history;
    }

    for (let piece of pieceHistory) {
        for (let i = 0; i < piece.length; i++) {
            if (board[piece[i].y][piece[i].x - 1] > 0 && (getLegionCell(piece[i].y, piece[i].x).style.borderLeftWidth == '3px' || getLegionCell(piece[i].y, piece[i].x - 1).style.borderRightWidth == '3px')) {
                getLegionCell(piece[i].y, piece[i].x).style.borderLeftWidth = '1px';
                getLegionCell(piece[i].y, piece[i].x - 1).style.borderRightWidth = '1px';
            }
            if (board[piece[i].y - 1] && board[piece[i].y - 1][piece[i].x] > 0 && (getLegionCell(piece[i].y, piece[i].x).style.borderTopWidth == '3px' || getLegionCell(piece[i].y - 1, piece[i].x).style.borderBottomWidth == '3px' )) {
                getLegionCell(piece[i].y, piece[i].x).style.borderTopWidth = '1px';
                getLegionCell(piece[i].y - 1, piece[i].x).style.borderBottomWidth = '1px';
            }
            for (let j = 0; j < piece.length; j++) {
                if (i != j && piece[i].x - 1 == piece[j].x && piece[i].y == piece[j].y) {
                    getLegionCell(piece[i].y, piece[i].x).style.borderLeftWidth = '0px';
                    if (board[0][piece[i].x - 1]) {
                        getLegionCell(piece[i].y, piece[i].x - 1).style.borderRightWidth = '0px';
                    }
                }
                if (i != j && piece[i].x == piece[j].x && piece[i].y - 1 == piece[j].y) {
                    getLegionCell(piece[i].y, piece[i].x).style.borderTopWidth = '0px';
                    if (board[piece[i].y - 1]) {
                        getLegionCell(piece[i].y - 1, piece[i].x).style.borderBottomWidth = '0px';
                    }
                }
            }
        }
    }
}

function activateDarkMode() {
    isDarkMode = !isDarkMode;
    localStorage.setItem("isDarkMode", JSON.stringify(isDarkMode));
    let cell;
    let switchTo;
    if (isDarkMode) {
        switchTo = 'white';
        document.getElementById("body").style.backgroundColor = 'rgb(54, 57, 63)';
        for (let i = 0 ; i < pieces.length; i++) {
            document.getElementById(`piece${i+1}`).style.backgroundColor = 'silver';
        }
        pieceColours.set(-1, 'grey');
        pieceColours.set(0, 'rgb(50, 50, 50)');
    } else {
        switchTo = 'black';
        document.getElementById("body").style.backgroundColor = 'white';
        for (let i = 0 ; i < pieces.length; i++) {
            document.getElementById(`piece${i+1}`).style.backgroundColor = 'white';
        }
        pieceColours.set(-1, 'white');
        pieceColours.set(0, 'grey');
    }
    drawBoard();
    for (let i = 0; i < board.length; i++) {
        for (let j = 0; j < board[0].length; j++) {
            cell = getLegionCell(i, j);
            if (cell.style.borderTopColor != switchTo) {
                cell.style.borderTopColor = switchTo
            }
            if (cell.style.borderBottomColor != switchTo) {
                cell.style.borderBottomColor = switchTo
            }
            if (cell.style.borderRightColor != switchTo) {
                cell.style.borderRightColor = switchTo
            }
            if (cell.style.borderLeftColor != switchTo) {
                cell.style.borderLeftColor = switchTo
            }
        }
    }
    document.getElementById("body").style.color = switchTo;
}

function activateBigClick() {
    isBigClick = !isBigClick;
    localStorage.setItem("isBigClick", JSON.stringify(isBigClick));
}

function activateLiveSolve() {
    isLiveSolve = !isLiveSolve;
    localStorage.setItem("isLiveSolve", JSON.stringify(isLiveSolve));
    if (isLiveSolve && state != states.COMPLETED) {
        drawBoard();
    }
}

function reset() {
    activeRunId++;
    resetBoard();
    document.getElementById("clearBoard").disabled = false;
    document.getElementById("boardButton").disabled = false;
    document.getElementById("boardButton").innerText = i18n("start");
    document.getElementById("resetButton").innerText = i18n("reset");
    document.getElementById("resetButton").style.visibility = 'hidden';
    document.getElementById("iterations").style.visibility = 'hidden';
    document.getElementById("time").style.visibility = 'hidden';
    document.getElementById("failText").style.visibility = 'hidden';
    document.getElementById("resultSummary").textContent = '';
    setObjectiveDisabled(false);
    pieceHistory = [];
    state = states.START;
}

async function handleButton(evt) {
    switch (state) {
        case states.START: {
            const runId = ++activeRunId;
            evt.target.innerText = i18n("pause");
            document.getElementById("clearBoard").disabled = true;
            document.getElementById("resultSummary").textContent = '';
            setObjectiveDisabled(true);
            state = states.RUNNING;
            await runSolver();
            if (runId !== activeRunId) {
                break;
            }
            evt.target.disabled = false;
            evt.target.innerText = i18n("reset");
            state = states.COMPLETED;
            break;
        }
        case states.RUNNING:
            evt.target.innerText = i18n("continue");
            pauseSolverUi(legionSolvers, { renderStats, drawBoard });
            state = states.PAUSED;
            document.getElementById("resetButton").innerText = i18n(
                secondaryControlForState(state).labelKey,
            );
            document.getElementById("resetButton").style.visibility = 'visible';
            break;
        case states.PAUSED:
            evt.target.innerText = i18n("pause");
            for (const solver of legionSolvers) {
                solver.continue();
            }
            state = states.RUNNING;
            document.getElementById("resetButton").style.visibility = 'hidden';
            break;
        case states.COMPLETED:
            reset();
            break;
    }
}

function handleSecondaryButton() {
    const control = secondaryControlForState(state);
    if (control.action === 'stop') {
        stopSolverUi(legionSolvers);
        state = states.STOPPING;
        document.getElementById("boardButton").disabled = true;
        document.getElementById("resetButton").style.visibility = 'hidden';
        return;
    }
    reset();
}

async function runSolver() {
    pieceHistory = [];
    const solver = new LegionSolver(board, pieces, onBoardUpdated, { objective });
    legionSolvers = [solver];

    let result;
    try {
        result = await solver.solve();
    } catch (error) {
        result = {
            status: RESULT_STATUS.ERROR,
            message: error instanceof Error ? error.message : String(error),
            coveredCells: 0,
            placedPieces: 0,
            targetCells: boardFilled,
            availablePieces: pieces.reduce((total, piece) => total + piece.amount, 0),
            placements: [],
        };
    }

    if (!result.discarded) {
        pieceHistory = solver.history;
        renderResult(result);
        renderStats(solver.stats);
        drawBoard();
    }
    return result;
}

function onBoardUpdated(result, stats) {
    if (!legionSolvers[0]) {
        return;
    }
    pieceHistory = legionSolvers[0].history;
    renderResult(result);
    renderStats(stats);

    const now = Date.now();
    if (shouldDrawIncumbent(isLiveSolve, state)
        && (state === states.PAUSED || now - lastLiveDraw >= 100)) {
        lastLiveDraw = now;
        drawBoard();
    }
}

function renderResult(result) {
    document.getElementById("resultSummary").textContent = formatResultSummary(result, i18n);
}

function renderStats(stats) {
    document.getElementById("iterations").style.visibility = 'visible';
    document.getElementById("iterationsValue").innerText = `${stats.iterations || 0}`;
    document.getElementById("time").style.visibility = 'visible';
    document.getElementById("timeValue").innerText = `${Math.round(stats.elapsedMs || 0)}ms`;
}

function setObjectiveDisabled(disabled) {
    for (const input of document.querySelectorAll('input[name="objective"]')) {
        input.disabled = disabled;
    }
}

export { pieceColours };
