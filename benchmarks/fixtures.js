import { OBJECTIVES } from '../src/modules/solver/constants.js';

function rectangle(width, height) {
    return Array.from({ length: height }, () => Array(width).fill(0));
}

const square = { id: 1, amount: 40, shape: [[2, 2], [2, 2]] };
const actualTetrominoes = [
    { id: 5, amount: 8, shape: [[2, 2], [2, 2]] },
    { id: 6, amount: 8, shape: [[1, 2, 2, 1]] },
    { id: 7, amount: 8, shape: [[1, 0, 0], [1, 2, 1]] },
    { id: 8, amount: 8, shape: [[0, 1, 0], [1, 2, 1]] },
    { id: 9, amount: 8, shape: [[1, 2, 0], [0, 2, 1]] },
];
const partialBoard = rectangle(16, 10);
partialBoard[9][15] = -1;

const fixtures = [
    {
        name: 'regular-160-exact',
        board: rectangle(16, 10),
        pieces: [square],
        objective: OBJECTIVES.COVERAGE,
        expectedScore: { coveredCells: 160, placedPieces: 40 },
    },
    {
        name: 'regular-159-partial',
        board: partialBoard,
        pieces: [square],
        objective: OBJECTIVES.COVERAGE,
        expectedScore: { coveredCells: 156, placedPieces: 39 },
    },
    {
        name: 'inventory-short-by-four',
        board: rectangle(16, 10),
        pieces: [{ ...square, amount: 39 }],
        objective: OBJECTIVES.COVERAGE,
        expectedScore: { coveredCells: 156, placedPieces: 39 },
    },
    {
        name: 'mixed-sizes-coverage',
        board: rectangle(16, 10),
        pieces: [
            { id: 1, amount: 50, shape: [[2, 1, 1]] },
            { id: 2, amount: 32, shape: [[2, 1, 1, 1, 1]] },
        ],
        objective: OBJECTIVES.COVERAGE,
        expectedScore: { coveredCells: 160, placedPieces: 52 },
    },
    {
        name: 'mixed-sizes-pieces',
        board: rectangle(16, 10),
        pieces: [
            { id: 1, amount: 50, shape: [[2, 1, 1]] },
            { id: 2, amount: 32, shape: [[2, 1, 1, 1, 1]] },
        ],
        objective: OBJECTIVES.PIECES,
        expectedScore: { coveredCells: 160, placedPieces: 52 },
    },
    {
        name: 'actual-tetromino-mix-160',
        board: rectangle(16, 10),
        pieces: actualTetrominoes,
        objective: OBJECTIVES.COVERAGE,
        expectedScore: { coveredCells: 160, placedPieces: 40 },
    },
    {
        name: 'actual-tetromino-mix-159',
        board: partialBoard,
        pieces: actualTetrominoes,
        objective: OBJECTIVES.COVERAGE,
        expectedScore: { coveredCells: 156, placedPieces: 39 },
    },
    {
        name: 'coverage-priority-conflict',
        board: [[0, 0, 0, 0, 0]],
        centerCells: [{ x: 0, y: 0 }],
        pieces: [
            { id: 1, amount: 1, shape: [[2, 1, 1, 1]] },
            { id: 2, amount: 3, shape: [[2]] },
        ],
        objective: OBJECTIVES.COVERAGE,
        expectedScore: { coveredCells: 5, placedPieces: 2 },
    },
    {
        name: 'piece-priority-conflict',
        board: [[0, 0, 0, 0, 0]],
        centerCells: [{ x: 0, y: 0 }],
        pieces: [
            { id: 1, amount: 1, shape: [[2, 1, 1, 1]] },
            { id: 2, amount: 3, shape: [[2]] },
        ],
        objective: OBJECTIVES.PIECES,
        expectedScore: { coveredCells: 3, placedPieces: 3 },
    },
    {
        name: 'no-center-start',
        board: [[0, 0, 0]],
        centerCells: [{ x: 9, y: 9 }],
        pieces: [{ id: 1, amount: 3, shape: [[2]] }],
        objective: OBJECTIVES.COVERAGE,
        expectedScore: null,
    },
];

export { fixtures };
