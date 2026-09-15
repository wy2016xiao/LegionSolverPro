# LegionSolverPro Speed Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持联盟规则、现有棋盘交互和积木数据不变的前提下，以可证明最优的双目标搜索器替换旧回溯，并通过 Web Worker 消除页面卡顿。

**Architecture:** 新增不依赖 DOM 的纯 JavaScript Solver Core，以紧凑位图、合法摆法预计算、中心连通扩展、词典序 branch-and-bound 和状态缓存求解；原 `LegionSolver` 变为 Worker 客户端门面。UI 只负责收集输入、选择优化目标和渲染 Worker 返回的当前最佳或最优布局。

**Tech Stack:** JavaScript ES modules、Webpack 5 Web Worker、Node.js 内置 `node:test`、现有 HTML/CSS/i18n。

---

> Git 说明：项目规则禁止在用户未明确要求时执行 `git add` 或 `git commit`，因此本计划以 `git diff` 检查点替代技能模板中的提交步骤。

## 文件结构

新建：

- `src/modules/solver/constants.js`：优化目标、结果状态和 Worker 消息常量。
- `src/modules/solver/score.js`：唯一的词典序评分实现。
- `src/modules/solver/bitset.js`：棋盘位图的纯函数操作。
- `src/modules/solver/problem.js`：姿态去重、目标格压缩和合法摆法预计算。
- `src/modules/solver/search.js`：可分批执行、可暂停的精确搜索状态机。
- `src/modules/solver/solver.worker.js`：Worker 命令循环和消息封装。
- `test/score.test.js`、`test/bitset.test.js`、`test/problem.test.js`、`test/search.test.js`：Solver Core 单元和最优性测试。
- `test/helpers/brute-force.js`：只服务于小棋盘的独立真值求解器。
- `benchmarks/fixtures.js`、`benchmarks/solver-benchmark.js`：固定性能基准。

修改：

- `src/modules/legion_solver.js`：替换为兼容现有调用方式的 Worker 客户端。
- `src/board.js`：去掉四套旋转求解器，接入目标选择、状态和结果统计。
- `src/index.html`、`src/styles.css`：增加最小化的优化目标与结果状态 UI。
- `src/i18n.js`、`src/locales/{cn,en,ja,ko,tw}.js`：新增文案并修正“面积必须相等”的过期说明。
- `package.json`：增加跨平台测试和基准命令。
- `README.md`：记录双目标、Worker 和本地验证命令。

### Task 1: 建立测试入口和评分契约

**Files:**
- Modify: `package.json`
- Create: `src/modules/solver/constants.js`
- Create: `src/modules/solver/score.js`
- Create: `test/score.test.js`

- [x] **Step 1: 添加跨平台测试和基准脚本**

在 `package.json` 的 `scripts` 中加入 Node 自动发现测试的命令，避免依赖 shell glob：

```json
{
  "scripts": {
    "dev": "npx webpack serve --config webpack.config.dev.cjs",
    "build": "npm run clean && npx webpack --config webpack.config.prod.cjs",
    "clean": "rimraf dist/prod",
    "test": "node --test",
    "benchmark": "node benchmarks/solver-benchmark.js"
  }
}
```

- [x] **Step 2: 先写评分失败测试**

`test/score.test.js` 覆盖两个冲突解，并明确布局序列化键不是第三个业务目标：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { OBJECTIVES } from '../src/modules/solver/constants.js';
import { compareSolutions } from '../src/modules/solver/score.js';

const moreCells = { coveredCells: 158, placedPieces: 38, layoutKey: 'b' };
const morePieces = { coveredCells: 157, placedPieces: 39, layoutKey: 'a' };

test('coverage-first prefers more covered cells', () => {
  assert.ok(compareSolutions(moreCells, morePieces, OBJECTIVES.COVERAGE) > 0);
});

test('piece-first prefers more placed pieces', () => {
  assert.ok(compareSolutions(morePieces, moreCells, OBJECTIVES.PIECES) > 0);
});

test('layout serialization is not a third business objective', () => {
  const left = { coveredCells: 10, placedPieces: 3, layoutKey: 'a' };
  const right = { coveredCells: 10, placedPieces: 3, layoutKey: 'b' };
  assert.equal(compareSolutions(left, right, OBJECTIVES.COVERAGE), 0);
});
```

- [x] **Step 3: 运行测试并确认红灯**

Run: `npm test`

Expected: FAIL，提示找不到 `src/modules/solver/constants.js` 或 `score.js`。

- [x] **Step 4: 实现常量和评分器**

`constants.js` 使用单一规范值：

```js
export const OBJECTIVES = Object.freeze({
  COVERAGE: 'coverage',
  PIECES: 'pieces',
});

export const RESULT_STATUS = Object.freeze({
  OPTIMAL: 'optimal',
  BEST_KNOWN: 'best-known',
  NO_SOLUTION: 'no-solution',
  INVALID: 'invalid',
  ERROR: 'error',
});
```

`score.js` 让正数始终表示左侧更优：

```js
import { OBJECTIVES } from './constants.js';

export function compareSolutions(left, right, objective) {
  if (!right) return 1;
  const fields = objective === OBJECTIVES.PIECES
    ? ['placedPieces', 'coveredCells']
    : ['coveredCells', 'placedPieces'];

  for (const field of fields) {
    if (left[field] !== right[field]) return left[field] - right[field];
  }
  return 0;
}
```

`layoutKey` 仍用于确定性候选顺序、缓存和 Worker 消息去重；业务评分相同时保留确定性搜索首先找到的布局，不为最小化字符串增加额外搜索。

- [x] **Step 5: 运行测试并检查 diff**

Run: `npm test && git diff --check`

Expected: 3 tests PASS，`git diff --check` 无输出。

### Task 2: 实现位图和问题预计算

**Files:**
- Create: `src/modules/solver/bitset.js`
- Create: `src/modules/solver/problem.js`
- Create: `test/bitset.test.js`
- Create: `test/problem.test.js`

- [x] **Step 1: 写位图行为测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMask, setBit, intersects, unionInto, popcount, maskKey } from '../src/modules/solver/bitset.js';

test('bitset supports boards larger than 32 cells', () => {
  const left = createMask(70);
  const right = createMask(70);
  setBit(left, 1);
  setBit(left, 65);
  setBit(right, 65);
  assert.equal(popcount(left), 2);
  assert.equal(intersects(left, right), true);
  unionInto(right, left);
  assert.equal(popcount(right), 2);
  assert.equal(maskKey(left), maskKey(right));
});
```

- [x] **Step 2: 运行位图测试并确认红灯**

Run: `node --test test/bitset.test.js`

Expected: FAIL，提示缺少 `bitset.js`。

- [x] **Step 3: 实现无分配热路径位图函数**

`bitset.js` 至少导出以下纯函数；`intersects` 和 `unionInto` 的循环中不得创建临时数组：

```js
export const createMask = bitCount => new Uint32Array(Math.ceil(bitCount / 32));
export const cloneMask = mask => mask.slice();

export function setBit(mask, index) {
  mask[index >>> 5] |= (1 << (index & 31)) >>> 0;
}

export function intersects(left, right) {
  for (let i = 0; i < left.length; i += 1) {
    if ((left[i] & right[i]) !== 0) return true;
  }
  return false;
}

export function unionInto(target, source) {
  for (let i = 0; i < target.length; i += 1) target[i] |= source[i];
  return target;
}

export function popcount(mask) {
  let total = 0;
  for (const word of mask) {
    let value = word >>> 0;
    value -= (value >>> 1) & 0x55555555;
    value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
    total += (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return total;
}

export const maskKey = mask => Array.from(mask, word => word.toString(36)).join('.');
```

- [x] **Step 4: 写姿态与摆法预计算测试**

测试要求：方块旋转后只有一种姿态；L 形包含镜像和旋转；所有摆法只覆盖目标格；锚点坐标随变换保留。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOrientations, buildProblem } from '../src/modules/solver/problem.js';

test('orientation generation removes symmetric duplicates', () => {
  assert.equal(generateOrientations([[2, 2], [2, 2]]).length, 1);
  assert.equal(generateOrientations([[2, 1], [1, 0]]).length, 4);
});

test('placements stay inside selected target cells', () => {
  const board = [[0, 0, -1], [0, 0, -1]];
  const problem = buildProblem(board, [{ id: 1, amount: 1, shape: [[2, 1]] }], {
    centerCells: [{ x: 0, y: 0 }],
  });
  assert.ok(problem.placements.length > 0);
  assert.ok(problem.placements.every(item => item.cells.every(cell => board[cell.y][cell.x] === 0)));
  assert.ok(problem.placements.some(item => item.hasCenterAnchor));
});
```

- [x] **Step 5: 实现问题预计算**

`problem.js` 提供以下稳定契约：

```js
export function generateOrientations(shape) {
  const source = [];
  for (let y = 0; y < shape.length; y += 1) {
    for (let x = 0; x < shape[y].length; x += 1) {
      if (shape[y][x] !== 0) source.push({ x, y, isAnchor: shape[y][x] === 2 });
    }
  }

  const unique = new Map();
  for (let mirrored = 0; mirrored < 2; mirrored += 1) {
    for (let turns = 0; turns < 4; turns += 1) {
      const transformed = source.map(sourceCell => {
        let x = mirrored ? -sourceCell.x : sourceCell.x;
        let y = sourceCell.y;
        for (let turn = 0; turn < turns; turn += 1) [x, y] = [-y, x];
        return { x, y, isAnchor: sourceCell.isAnchor };
      });
      const minX = Math.min(...transformed.map(cell => cell.x));
      const minY = Math.min(...transformed.map(cell => cell.y));
      const cells = transformed
        .map(cell => ({ ...cell, x: cell.x - minX, y: cell.y - minY }))
        .sort((left, right) => left.y - right.y || left.x - right.x || Number(left.isAnchor) - Number(right.isAnchor));
      const key = cells.map(cell => `${cell.x},${cell.y},${Number(cell.isAnchor)}`).join(';');
      unique.set(key, {
        cells,
        anchorCells: cells.filter(cell => cell.isAnchor),
      });
    }
  }
  return [...unique.values()];
}

export function buildProblem(board, pieces, options = {}) {
  return {
    width,
    height,
    targetCells,
    targetCount: targetCells.length,
    centerIndices,
    inventory,
    placements: [{ id, pieceType, cells, mask, neighborMask, anchorIndices, hasCenterAnchor, layoutKey }],
    placementsByPiece,
    totalAvailablePieces,
  };
}
```

实现时用包含锚点标志的坐标字符串去重姿态；把所有非零形状格平移到左上角。原数据允许一个形状包含多个数值为 `2` 的格子，这些格子都必须保留为锚点候选；其他非零值是普通格。默认中心是 20×22 棋盘的 `(10,9)`、`(11,9)`、`(10,10)`、`(11,10)`，测试可通过 `options.centerCells` 覆盖。

- [x] **Step 6: 运行预计算测试**

Run: `node --test test/bitset.test.js test/problem.test.js && git diff --check`

Expected: 全部 PASS，无格式错误。

### Task 3: 用小棋盘真值驱动精确搜索器

**Files:**
- Create: `test/helpers/brute-force.js`
- Create: `test/search.test.js`
- Create: `src/modules/solver/search.js`

- [x] **Step 1: 实现仅供测试的小棋盘独立穷举器**

`brute-force.js` 不复用生产搜索和剪枝，只枚举所有不重叠摆法子集，过滤中心锚点和四向连通，返回两个模式各自的最佳评分。它只接收不超过 12 个摆法的 fixture，防止测试自身失控。

```js
import { createMask, intersects, unionInto, popcount } from '../../src/modules/solver/bitset.js';
import { compareSolutions } from '../../src/modules/solver/score.js';

export function bruteForce(problem, objective) {
  if (problem.placements.length > 12) throw new Error('Brute-force fixture is too large');
  let best = null;

  for (let subset = 1; subset < (1 << problem.placements.length); subset += 1) {
    const occupied = createMask(problem.targetCount);
    const used = new Uint16Array(problem.inventory.length);
    const chosen = [];
    let hasCenterAnchor = false;
    let legal = true;

    for (let id = 0; id < problem.placements.length && legal; id += 1) {
      if ((subset & (1 << id)) === 0) continue;
      const placement = problem.placements[id];
      used[placement.pieceType] += 1;
      legal = used[placement.pieceType] <= problem.inventory[placement.pieceType].amount
        && !intersects(occupied, placement.mask);
      if (legal) {
        unionInto(occupied, placement.mask);
        chosen.push(placement);
        hasCenterAnchor ||= placement.hasCenterAnchor;
      }
    }

    if (!legal || !hasCenterAnchor || !isConnected(occupied, problem.neighborsByIndex)) continue;
    const layoutKey = chosen.map(item => item.layoutKey).sort().join('|');
    const solution = {
      coveredCells: popcount(occupied),
      placedPieces: chosen.length,
      layoutKey,
      placements: chosen,
    };
    if (compareSolutions(solution, best, objective) > 0) best = solution;
  }
  return best;
}

function isConnected(occupied, neighborsByIndex) {
  const cells = [];
  for (let index = 0; index < neighborsByIndex.length; index += 1) {
    if ((occupied[index >>> 5] & ((1 << (index & 31)) >>> 0)) !== 0) cells.push(index);
  }
  if (cells.length === 0) return false;
  const seen = new Set([cells[0]]);
  const pending = [cells[0]];
  while (pending.length > 0) {
    for (const neighbor of neighborsByIndex[pending.pop()]) {
      if (!seen.has(neighbor) && cells.includes(neighbor)) {
        seen.add(neighbor);
        pending.push(neighbor);
      }
    }
  }
  return seen.size === cells.length;
}
```

- [x] **Step 2: 写两个优化目标冲突和空白测试**

fixture 使用 5 个横向目标格、一个 4 格长条和多个单格积木，使两个目标产生不同结果；再加入面积少于目标和库存多于目标的案例。

```js
test('search matches brute force for both objectives', () => {
  const problem = buildProblem([[0, 0, 0, 0, 0]], [
    { id: 1, amount: 1, shape: [[2, 1, 1, 1]] },
    { id: 2, amount: 3, shape: [[2]] },
  ], { centerCells: [{ x: 0, y: 0 }] });

  for (const objective of Object.values(OBJECTIVES)) {
    const actual = solveToCompletion(problem, objective);
    const expected = bruteForce(problem, objective);
    assert.deepEqual(actual.score, expected.score);
  }
});
```

- [x] **Step 3: 运行搜索测试并确认红灯**

Run: `node --test test/search.test.js`

Expected: FAIL，提示缺少 `search.js`。

- [x] **Step 4: 实现可分批搜索状态机**

`search.js` 的公开接口固定为：

```js
export function createSearch(problem, objective) {
  return {
    step(maxStates = 5000),
    getBest(),
    getStats(),
    isComplete(),
  };
}

export function solveToCompletion(problem, objective) {
  const search = createSearch(problem, objective);
  while (!search.isComplete()) search.step(100000);
  return search.getBest();
}
```

内部显式栈节点包含 `occupied`、`remaining`、`placementIds`、`coveredCells` 和 `placedPieces`。根节点先枚举锚点落在中心的摆法；后续候选必须满足：库存仍有剩余、不与 `occupied` 相交、`neighborMask` 与 `occupied` 相交。

每个节点都形成合法连通解并可更新 incumbent。候选以“稀缺格优先、当前主目标增益、`layoutKey`”排序。缓存键为 `maskKey(occupied) + '|' + remaining.join(',')`，值记录到达该状态的最小布局键，防止不同放置顺序重复展开同时保持确定性结果。

- [x] **Step 5: 加入安全上界剪枝**

对节点计算：

```js
const maxExtraPieces = remaining.reduce((sum, count) => sum + count, 0);
const maxExtraCells = Math.min(
  problem.targetCount - coveredCells,
  remaining.reduce((sum, count, type) => sum + count * problem.inventory[type].cellCount, 0),
);
```

把当前分数加上乐观增量后与 incumbent 比较；只有词典序上界也无法超过 incumbent 才剪枝。随后增加“剩余合法摆法覆盖并集”和“从当前邻接边界可达区域”上界，并为每一种上界写一个与 `bruteForce` 对照的测试。

- [x] **Step 6: 用生成的小棋盘做最优性回归**

枚举固定种子的 3×3/4×3 目标掩码和小库存；跳过摆法数超过 12 的输入；对两个目标比较生产搜索与独立穷举的完整 `{coveredCells, placedPieces}`。

Run: `node --test test/search.test.js`

Expected: 两种目标的所有固定 fixture 均与独立穷举一致，重复运行布局键一致。

- [x] **Step 7: 全量 Core 测试和 diff 检查**

Run: `npm test && git diff --check`

Expected: 全部 PASS。

### Task 4: 接入 Web Worker 和兼容门面

**Files:**
- Create: `src/modules/solver/solver.worker.js`
- Rewrite: `src/modules/legion_solver.js`
- Create: `test/solver-contract.test.js`

- [x] **Step 1: 写客户端消息契约测试**

用注入的 `FakeWorker` 断言 `solve()` 发出 `start`，`pause()`/`continue()`/`stop()` 发出对应命令，`incumbent` 更新只接受分数更好的结果，`completed` resolve 最终 Promise。

```js
const solver = new LegionSolver(board, pieces, onBoardUpdated, {
  objective: OBJECTIVES.COVERAGE,
  workerFactory: () => fakeWorker,
});
const promise = solver.solve();
assert.equal(fakeWorker.messages[0].type, 'start');
fakeWorker.emit({ type: 'completed', result });
assert.deepEqual(await promise, result);
```

- [x] **Step 2: 运行契约测试并确认红灯**

Run: `node --test test/solver-contract.test.js`

Expected: FAIL，因为旧 `LegionSolver` 不支持 Worker 契约。

- [x] **Step 3: 实现 Worker 分批运行**

`solver.worker.js`：

```js
let search = null;
let paused = false;
let cancelled = false;

self.onmessage = ({ data }) => {
  if (data.type === 'start') start(data.payload);
  if (data.type === 'pause') paused = true;
  if (data.type === 'resume' && paused) { paused = false; runBatch(); }
  if (data.type === 'cancel') cancelled = true;
};

function runBatch() {
  if (!search || paused) return;
  if (cancelled) return postCancelled(search.getBest(), search.getStats());
  const update = search.step(5000);
  if (update.improved) self.postMessage({ type: 'incumbent', result: search.getBest() });
  if (search.isComplete()) return self.postMessage({ type: 'completed', result: search.getBest(), stats: search.getStats() });
  setTimeout(runBatch, 0);
}
```

消息必须捕获输入校验和异常，分别返回 `invalid` 或 `error`，并保证一次搜索只结束一次。

- [x] **Step 4: 重写 `LegionSolver` 为客户端门面**

默认 Worker 工厂使用 Webpack 5 兼容写法：

```js
() => new Worker(new URL('./solver/solver.worker.js', import.meta.url), { type: 'module' })
```

门面保留 `solve()`、`pause()`、`continue()`、`stop()`、`iterations`、`time`、`board` 和 `history`。Worker 布局通过单一 `applyResultToBoard()` 转为原颜色 ID 规则，锚点格仍使用 `pieceId + 18`，避免改变棋盘显示。

- [x] **Step 5: 运行 Worker 客户端契约测试**

Run: `node --test test/solver-contract.test.js && npm test && git diff --check`

Expected: 全部 PASS，无未处理 Promise rejection。

### Task 5: UI 增加双目标和真实结果状态

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/i18n.js`
- Modify: `src/locales/cn.js`
- Modify: `src/locales/en.js`
- Modify: `src/locales/ja.js`
- Modify: `src/locales/ko.js`
- Modify: `src/locales/tw.js`
- Modify: `src/board.js`

- [x] **Step 1: 添加最小化单选 UI**

在 `#options` 内添加：

```html
<fieldset id="objectiveOptions">
  <legend id="objectiveLegend">Optimization Goal</legend>
  <label><input type="radio" name="objective" value="coverage" checked> <span id="coverageObjectiveLabel">Cell Coverage</span></label>
  <label><input type="radio" name="objective" value="pieces"> <span id="piecesObjectiveLabel">Piece Count</span></label>
</fieldset>
<div id="resultSummary" aria-live="polite"></div>
```

CSS 使用现有字号和颜色，不设固定宽度；窄屏时允许两项换行；`fieldset` 使用透明背景和当前文字色。

- [x] **Step 2: 接入规范存储键和 i18n**

`board.js` 只使用 `legionSolverObjective` 这一键：

```js
const savedObjective = localStorage.getItem('legionSolverObjective');
let objective = Object.values(OBJECTIVES).includes(savedObjective)
  ? savedObjective
  : OBJECTIVES.COVERAGE;
```

切换时更新内存和 `localStorage`。`i18n.js` 填充 `objectiveLegend`、`coverageObjective`、`piecesObjective` 和结果文案。五个 locale 使用对应语言，不保留英文 fallback 链。

- [x] **Step 3: 简化 `runSolver()`**

删除旧版为四个棋盘方向创建四套求解器并 `Promise.race` 的逻辑，只创建一个 Worker 客户端：

```js
const solver = new LegionSolver(board, pieces, onBoardUpdated, { objective });
legionSolvers = [solver];
const result = await solver.solve();
renderResult(result, solver.stats);
```

`renderResult()` 按状态展示“覆盖 x/y 格、使用 a/b 块、最优解/当前最佳”。`Live Solve` 只在 incumbent 改善时重绘，并以 100ms 为最小间隔。重置时终止 Worker 并恢复目标格，不留下已放颜色。

- [x] **Step 4: 更新使用说明**

删除“积木面积必须等于所选格子，否则死循环”的旧说明，明确数量是可用上限、允许空白，并说明两个优化目标。

- [x] **Step 5: 定向构建验证**

Run: `npm test && npx webpack --config webpack.config.dev.cjs && git diff --check`

Expected: 测试 PASS；Webpack 无模块解析或 Worker chunk 错误；diff 检查通过。

### Task 6: 建立基准并优化热路径

**Files:**
- Create: `benchmarks/fixtures.js`
- Create: `benchmarks/solver-benchmark.js`
- Modify: `src/modules/solver/search.js`
- Modify: `src/modules/solver/problem.js`

- [x] **Step 1: 固化六类基准输入**

`fixtures.js` 导出普通完全覆盖、复杂完全覆盖、目标比积木多 1 格、目标比积木多 4 格、重复积木、无中心起步。每个 fixture 包含固定棋盘、库存、模式和预期最佳评分；预期评分先由正确性测试或小规模可验证构造确认，不从新版输出反向抄写。

- [x] **Step 2: 实现可重复基准脚本**

```js
for (const fixture of fixtures) {
  const samples = [];
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now();
    const result = solveToCompletion(buildProblem(fixture.board, fixture.pieces), fixture.objective);
    samples.push(performance.now() - started);
    assert.deepEqual(result.score, fixture.expectedScore);
  }
  reportMedianAndP95(fixture.name, samples);
}
```

同时打印首解时间、最优证明时间、展开状态数、缓存命中、剪枝数和最终评分。脚本任一评分错误时以非零状态退出。

- [x] **Step 3: 记录初始新版基准**

Run: `npm run benchmark`

Expected: 所有 fixture 评分正确并输出结构化指标；若某例超过 10 秒，脚本中止该例并明确报告未达标，不挂死 CI 或本地终端。

- [x] **Step 4: 逐项优化已测得的热路径**

按 profile 证据依次考虑：候选表按库存和邻接增量过滤、位图对象复用、缓存键减少序列化、候选排序结果缓存、剩余覆盖并集上界、空白分量面积可达表。每引入一个剪枝，先新增与独立穷举器对照的测试，再保留该优化。

不得仅为追求基准而引入无完备性证明的硬剪枝；此类规则只能改变候选顺序。

- [x] **Step 5: 验证性能门槛和确定性**

Run: `npm test && npm run benchmark && git diff --check`

Expected: 普通用例即时完成；旧版慢例在 250ms 内提供首个合法解，目标 fixture 在 2 秒内完成或证明最优；同一 fixture 连续运行评分和布局键一致。未达标时保留指标并继续定位，不能把“Worker 不阻塞 UI”等同于求解已变快。

### Task 7: 浏览器冒烟、文档和最终验收

**Files:**
- Modify: `README.md`
- Modify only if defects are found: files changed in Tasks 1–6

- [x] **Step 1: 更新 README**

记录：默认格子覆盖优先、两种词典序、允许空白/剩余积木、结果状态含义、Worker 不阻塞 UI，以及 `npm test`、`npm run benchmark`、`npm run dev` 命令。不要声称所有输入都能在固定时间内证明最优。

- [x] **Step 2: 启动本地开发服务器**

Run: `npm run dev`

Expected: Webpack dev server 启动成功；`webpack.config.dev.cjs` 固定 `open: false`，不主动打开系统浏览器。

- [ ] **Step 3: 用 Codex App 内置浏览器做桌面冒烟**

验证：默认格子优先；切换后刷新仍保留；普通用例完成并显示正确统计；面积不相等仍返回布局；运行时暂停/继续；停止显示当前最佳；重置恢复目标格；实时求解不会高频闪烁。

- [ ] **Step 4: 用内置浏览器做窄屏冒烟**

验证：目标选项可见可点、标签不截断、棋盘原有横向行为不恶化、按钮和结果区不重叠。若内置浏览器不可用，改用 HTTP 黑盒、构建和 DOM 测试，并在交付中明确未完成视觉验收，不回退到 Chrome。

2026-09-15 验收记录：Codex App 内置浏览器返回 `Codex auth token is unavailable`，因此步骤 3、4 保持未勾选；已按项目规则完成 HTTP 黑盒、自动化测试和开发构建，未回退到 Chrome 或外部 Playwright。

- [x] **Step 5: 最终自动化验证**

Run: `npm test && npm run benchmark && npx webpack --config webpack.config.dev.cjs && git diff --check`

Expected: 测试、基准评分和开发构建通过，diff 无空白错误。

- [ ] **Step 6: 检查任务边界**

Run: `git status --short && git diff --stat && git diff`

Expected: 只有规格、计划和本任务实现文件发生变化；无 `dist`、日志、缓存、真实账号或敏感配置进入 diff；保持未暂存、未提交、未推送状态。

2026-09-15 边界记录：当前未提交 diff 仅包含本任务实现、测试和文档；但远端已有的 `fbae099` 提交额外包含任务外 `personal.code-workspace`。本轮不改写已推送历史，也不擅自删除该文件，因此本步骤保持未勾选并向用户单独说明。
