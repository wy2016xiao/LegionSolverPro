import { createMask, setBit } from './bitset.js';

const DIRECTIONS = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
];

/**
 * 生成积木的所有旋转和镜像姿态，并移除几何及锚点完全相同的重复项。
 * 原项目允许多个数值为 2 的格子，因此锚点必须作为姿态的一部分保留。
 */
function generateOrientations(shape) {
    const source = [];
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x] !== 0) {
                source.push({ x, y, isAnchor: shape[y][x] === 2 });
            }
        }
    }

    if (source.length === 0) {
        return [];
    }

    const unique = new Map();
    for (let mirrored = 0; mirrored < 2; mirrored++) {
        for (let turns = 0; turns < 4; turns++) {
            const transformed = source.map(sourceCell => {
                let x = mirrored ? -sourceCell.x : sourceCell.x;
                let y = sourceCell.y;
                for (let turn = 0; turn < turns; turn++) {
                    [x, y] = [-y, x];
                }
                return { x, y, isAnchor: sourceCell.isAnchor };
            });

            const minX = Math.min(...transformed.map(cell => cell.x));
            const minY = Math.min(...transformed.map(cell => cell.y));
            const cells = transformed
                .map(cell => ({
                    x: cell.x - minX,
                    y: cell.y - minY,
                    isAnchor: cell.isAnchor,
                }))
                .sort(compareCells);
            const key = cells
                .map(cell => `${cell.x},${cell.y},${Number(cell.isAnchor)}`)
                .join(';');

            if (!unique.has(key)) {
                unique.set(key, {
                    cells,
                    anchorCells: cells.filter(cell => cell.isAnchor),
                    width: Math.max(...cells.map(cell => cell.x)) + 1,
                    height: Math.max(...cells.map(cell => cell.y)) + 1,
                });
            }
        }
    }

    return [...unique.values()];
}

/**
 * 把 UI 棋盘和积木库存编译为搜索器消费的紧凑问题模型。
 */
function buildProblem(board, pieces, options = {}) {
    validateBoard(board);
    const height = board.length;
    const width = board[0].length;
    const targetCells = [];
    const coordinateToIndex = new Map();

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (board[y][x] === 0) {
                const index = targetCells.length;
                targetCells.push({ x, y, index });
                coordinateToIndex.set(coordinateKey(x, y), index);
            }
        }
    }

    const centerCells = options.centerCells || defaultCenterCells(width, height);
    const centerIndices = new Set();
    for (const cell of centerCells) {
        const index = coordinateToIndex.get(coordinateKey(cell.x, cell.y));
        if (index !== undefined) {
            centerIndices.add(index);
        }
    }

    const neighborsByIndex = targetCells.map(cell => DIRECTIONS
        .map(([dx, dy]) => coordinateToIndex.get(coordinateKey(cell.x + dx, cell.y + dy)))
        .filter(index => index !== undefined));
    const targetMask = createMask(targetCells.length);
    for (let index = 0; index < targetCells.length; index++) {
        setBit(targetMask, index);
    }

    const inventory = pieces.map((piece, pieceType) => normalizePiece(piece, pieceType));
    const placements = [];
    const placementsByPiece = inventory.map(() => []);
    const placementsByCell = targetCells.map(() => []);

    for (let pieceType = 0; pieceType < inventory.length; pieceType++) {
        const item = inventory[pieceType];
        if (item.amount === 0) {
            continue;
        }

        const orientations = generateOrientations(item.shape);
        for (let orientationIndex = 0; orientationIndex < orientations.length; orientationIndex++) {
            const orientation = orientations[orientationIndex];
            for (let y = 0; y <= height - orientation.height; y++) {
                for (let x = 0; x <= width - orientation.width; x++) {
                    const placement = createPlacement({
                        x,
                        y,
                        pieceType,
                        orientationIndex,
                        orientation,
                        targetCount: targetCells.length,
                        coordinateToIndex,
                        centerIndices,
                        neighborsByIndex,
                    });
                    if (!placement) {
                        continue;
                    }

                    placement.id = placements.length;
                    placement.pieceId = item.id;
                    placements.push(placement);
                    placementsByPiece[pieceType].push(placement.id);
                    for (const cellIndex of placement.cellIndices) {
                        placementsByCell[cellIndex].push(placement.id);
                    }
                }
            }
        }
    }

    return {
        width,
        height,
        targetCells,
        targetCount: targetCells.length,
        targetMask,
        centerIndices,
        neighborsByIndex,
        inventory,
        placements,
        placementsByPiece,
        placementsByCell,
        totalAvailablePieces: inventory.reduce((total, item) => total + item.amount, 0),
    };
}

function createPlacement({
    x,
    y,
    pieceType,
    orientationIndex,
    orientation,
    targetCount,
    coordinateToIndex,
    centerIndices,
    neighborsByIndex,
}) {
    const cells = [];
    const cellIndices = [];
    const anchorIndices = [];

    for (const shapeCell of orientation.cells) {
        const realX = x + shapeCell.x;
        const realY = y + shapeCell.y;
        const index = coordinateToIndex.get(coordinateKey(realX, realY));
        if (index === undefined) {
            return null;
        }
        cells.push({ x: realX, y: realY, isAnchor: shapeCell.isAnchor });
        cellIndices.push(index);
        if (shapeCell.isAnchor) {
            anchorIndices.push(index);
        }
    }

    const mask = createMask(targetCount);
    const neighborMask = createMask(targetCount);
    const ownIndices = new Set(cellIndices);
    for (const index of cellIndices) {
        setBit(mask, index);
        for (const neighbor of neighborsByIndex[index]) {
            if (!ownIndices.has(neighbor)) {
                setBit(neighborMask, neighbor);
            }
        }
    }

    return {
        id: -1,
        pieceId: -1,
        pieceType,
        orientationIndex,
        cells,
        cellIndices,
        anchorIndices,
        hasCenterAnchor: anchorIndices.some(index => centerIndices.has(index)),
        mask,
        neighborMask,
        layoutKey: [pieceType, orientationIndex, y, x]
            .map(value => String(value).padStart(3, '0'))
            .join(':'),
    };
}

function normalizePiece(piece, pieceType) {
    const amount = Number(piece.amount);
    if (!Number.isInteger(amount) || amount < 0) {
        throw new RangeError(`Piece ${pieceType} has an invalid amount`);
    }
    if (!Array.isArray(piece.shape) || piece.shape.length === 0) {
        throw new TypeError(`Piece ${pieceType} has an invalid shape`);
    }

    const cellCount = piece.shape.reduce((total, row) => (
        total + row.filter(value => value !== 0).length
    ), 0);
    if (cellCount === 0) {
        throw new TypeError(`Piece ${pieceType} has an empty shape`);
    }

    return {
        id: piece.id,
        pieceType,
        amount,
        shape: piece.shape.map(row => [...row]),
        cellCount,
    };
}

function validateBoard(board) {
    if (!Array.isArray(board) || board.length === 0 || !Array.isArray(board[0]) || board[0].length === 0) {
        throw new TypeError('Board must be a non-empty rectangular array');
    }
    const width = board[0].length;
    if (board.some(row => !Array.isArray(row) || row.length !== width)) {
        throw new TypeError('Board must be rectangular');
    }
}

function defaultCenterCells(width, height) {
    const left = Math.floor((width - 1) / 2);
    const right = Math.floor(width / 2);
    const top = Math.floor((height - 1) / 2);
    const bottom = Math.floor(height / 2);
    return [
        { x: left, y: top },
        { x: right, y: top },
        { x: left, y: bottom },
        { x: right, y: bottom },
    ];
}

function coordinateKey(x, y) {
    return `${x},${y}`;
}

function compareCells(left, right) {
    return left.y - right.y
        || left.x - right.x
        || Number(left.isAnchor) - Number(right.isAnchor);
}

export { buildProblem, generateOrientations };
