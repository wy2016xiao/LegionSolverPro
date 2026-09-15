# LegionSolverPro Speed Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old backtracking solver with a provably optimal dual-objective search while preserving Legion rules, the existing board interactions, and block data. Move search into a Web Worker to keep the page responsive.

**Architecture:** Add a pure JavaScript Solver Core with no DOM dependency. It uses compact bitsets, legal-placement precomputation, center-connected expansion, lexicographic branch-and-bound, and state caching. The existing `LegionSolver` becomes a Worker client facade. The UI only collects input, selects an optimization objective, and renders the incumbent or proven-optimal layout returned by the Worker.

**Tech Stack:** JavaScript ES modules, Webpack 5 Web Workers, Node.js built-in `node:test`, and the existing HTML/CSS/i18n stack.

---

> Git note: Project rules require explicit user approval before `git add` or `git commit`. During implementation, this plan therefore used `git diff` checkpoints in place of the commit steps from the skill template. The completed implementation was committed only after the user explicitly requested it.

## File Structure

Create:

- `src/modules/solver/constants.js`: Optimization objectives, result states, and Worker message constants.
- `src/modules/solver/score.js`: The single lexicographic scoring implementation.
- `src/modules/solver/bitset.js`: Pure board-bitset operations.
- `src/modules/solver/problem.js`: Orientation deduplication, target-cell compression, and legal-placement precomputation.
- `src/modules/solver/search.js`: A resumable exact-search state machine.
- `src/modules/solver/solver.worker.js`: Worker command loop and message adapter.
- `test/score.test.js`, `test/bitset.test.js`, `test/problem.test.js`, and `test/search.test.js`: Solver Core unit and optimality tests.
- `test/helpers/brute-force.js`: An independent small-board oracle used only by tests.
- `benchmarks/fixtures.js` and `benchmarks/solver-benchmark.js`: Fixed performance fixtures and benchmark runner.

Modify:

- `src/modules/legion_solver.js`: Replace the implementation with a Worker client compatible with existing callers.
- `src/board.js`: Remove the four rotated solver instances and connect the objective, state, and result summary.
- `src/index.html` and `src/styles.css`: Add minimal objective and result-state UI.
- `src/i18n.js` and `src/locales/{cn,en,ja,ko,tw}.js`: Add copy and remove the obsolete equal-area requirement.
- `package.json`: Add cross-platform test and benchmark commands.
- `README.md`: Document the objectives, Worker architecture, and local verification commands.

### Task 1: Establish the Test Entry Point and Scoring Contract

**Files:**

- Modify: `package.json`
- Create: `src/modules/solver/constants.js`
- Create: `src/modules/solver/score.js`
- Create: `test/score.test.js`

- [x] **Step 1: Add cross-platform test and benchmark scripts**

Add Node's automatic test discovery to `package.json` so the project does not depend on shell glob behavior:

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

- [x] **Step 2: Write failing scoring tests first**

Cover conflicting solutions for both objectives and explicitly prove that the serialized layout key is not a third business objective:

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

- [x] **Step 3: Run the tests and confirm the red state**

Run: `npm test`

Expected: FAIL because `src/modules/solver/constants.js` or `score.js` does not exist yet.

- [x] **Step 4: Implement constants and scoring**

`constants.js` uses one canonical value for every contract field:

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

In `score.js`, a positive result always means the left solution is better:

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

`layoutKey` remains available for deterministic candidate order, caching, and Worker message deduplication. When business scores are tied, keep the first layout found by deterministic search rather than extending the search merely to minimize a string.

- [x] **Step 5: Run the tests and inspect the diff**

Run: `npm test && git diff --check`

Expected: Three tests PASS and `git diff --check` produces no output.

### Task 2: Implement Bitsets and Problem Precomputation

**Files:**

- Create: `src/modules/solver/bitset.js`
- Create: `src/modules/solver/problem.js`
- Create: `test/bitset.test.js`
- Create: `test/problem.test.js`

- [x] **Step 1: Write bitset behavior tests**

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

- [x] **Step 2: Run the bitset test and confirm the red state**

Run: `node --test test/bitset.test.js`

Expected: FAIL because `bitset.js` does not exist yet.

- [x] **Step 3: Implement allocation-free hot-path bitset functions**

`bitset.js` exports at least the following pure functions. The loops in `intersects` and `unionInto` must not allocate temporary arrays:

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

- [x] **Step 4: Write orientation and placement precomputation tests**

The tests require a square to have one orientation, an L-shape to include rotations and reflections, every placement to remain inside target cells, and anchor coordinates to survive transformation:

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

- [x] **Step 5: Implement problem precomputation**

`problem.js` provides these stable contracts:

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

Deduplicate orientations with coordinate strings that include the anchor flag, and translate every nonzero shape cell to the top-left origin. Source data may contain multiple cells whose value is `2`; preserve every one as an anchor candidate. Other nonzero values are ordinary cells. The default center of the 20x22 board is `(10,9)`, `(11,9)`, `(10,10)`, and `(11,10)`. Tests may override it with `options.centerCells`.

- [x] **Step 6: Run precomputation tests**

Run: `node --test test/bitset.test.js test/problem.test.js && git diff --check`

Expected: All tests PASS with no formatting errors.

### Task 3: Drive the Exact Search with a Small-board Oracle

**Files:**

- Create: `test/helpers/brute-force.js`
- Create: `test/search.test.js`
- Create: `src/modules/solver/search.js`

- [x] **Step 1: Implement an independent brute-force oracle for tests**

`brute-force.js` does not reuse production search or pruning. It enumerates every non-overlapping placement subset, filters for center anchoring and four-direction connectivity, and returns the best score for either objective. It accepts only fixtures with at most 12 placements so the test oracle cannot grow without bound.

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

- [x] **Step 2: Add conflicting-objective and permitted-blank tests**

Use five horizontal target cells, one four-cell bar, and several single-cell blocks so the objectives choose different layouts. Add cases where inventory area is smaller than the target and where inventory exceeds the target.

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

- [x] **Step 3: Run the search test and confirm the red state**

Run: `node --test test/search.test.js`

Expected: FAIL because `search.js` does not exist yet.

- [x] **Step 4: Implement a resumable search state machine**

The public interface of `search.js` is fixed:

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

Each explicit stack node contains `occupied`, `remaining`, `placementIds`, `coveredCells`, and `placedPieces`. Root states enumerate placements whose anchors are in the center. Later candidates require available inventory, no intersection with `occupied`, and an intersection between `neighborMask` and `occupied`.

Every node is a legal connected solution and may update the incumbent. Sort candidates by constrained-cell scarcity, gain under the current primary objective, and `layoutKey`. The cache key is `maskKey(occupied) + '|' + remaining.join(',')`. Its value records the smallest layout key that reached the state, preventing repeated expansion through different placement orders while preserving deterministic results.

- [x] **Step 5: Add safe upper-bound pruning**

Calculate:

```js
const maxExtraPieces = remaining.reduce((sum, count) => sum + count, 0);
const maxExtraCells = Math.min(
  problem.targetCount - coveredCells,
  remaining.reduce((sum, count, type) => sum + count * problem.inventory[type].cellCount, 0),
);
```

Compare the current score plus optimistic gains with the incumbent. Prune only if the lexicographic upper bound cannot beat the incumbent. Then add bounds for the union of cells covered by remaining legal placements and the region reachable from the current frontier. Add an oracle comparison test for every bound.

- [x] **Step 6: Run generated small-board optimality regression**

Enumerate fixed-seed 3x3 and 4x3 target masks with small inventories. Skip inputs with more than 12 placements. For both objectives, compare the full `{coveredCells, placedPieces}` result from production search against the independent brute-force oracle.

Run: `node --test test/search.test.js`

Expected: Every fixed fixture matches the oracle under both objectives, and repeated runs produce the same layout key.

- [x] **Step 7: Run the full Core suite and diff check**

Run: `npm test && git diff --check`

Expected: All tests PASS.

### Task 4: Integrate the Web Worker and Compatibility Facade

**Files:**

- Create: `src/modules/solver/solver.worker.js`
- Rewrite: `src/modules/legion_solver.js`
- Create: `test/solver-contract.test.js`

- [x] **Step 1: Write client message-contract tests**

Use an injected `FakeWorker` to assert that `solve()` sends `start`, `pause()`/`continue()`/`stop()` send the corresponding commands, `incumbent` updates accept only better scores, and `completed` resolves the final Promise.

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

- [x] **Step 2: Run the contract test and confirm the red state**

Run: `node --test test/solver-contract.test.js`

Expected: FAIL because the old `LegionSolver` does not implement the Worker contract.

- [x] **Step 3: Implement batched Worker execution**

`solver.worker.js`:

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

The message layer catches validation failures and unexpected exceptions, returning `invalid` and `error` respectively. A search may terminate only once.

- [x] **Step 4: Rewrite `LegionSolver` as a Worker client facade**

The default Worker factory uses the Webpack 5-compatible form:

```js
() => new Worker(new URL('./solver/solver.worker.js', import.meta.url), { type: 'module' })
```

The facade preserves `solve()`, `pause()`, `continue()`, `stop()`, `iterations`, `time`, `board`, and `history`. Convert Worker placements to the original color-ID convention through one `applyResultToBoard()` function. Anchor cells continue using `pieceId + 18` so board rendering remains unchanged.

- [x] **Step 5: Run Worker client contract tests**

Run: `node --test test/solver-contract.test.js && npm test && git diff --check`

Expected: All tests PASS with no unhandled Promise rejection.

### Task 5: Add Dual Objectives and Accurate Result States to the UI

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

- [x] **Step 1: Add minimal radio-button UI**

Add this inside `#options`:

```html
<fieldset id="objectiveOptions">
  <legend id="objectiveLegend">Optimization Goal</legend>
  <label><input type="radio" name="objective" value="coverage" checked> <span id="coverageObjectiveLabel">Cell Coverage</span></label>
  <label><input type="radio" name="objective" value="pieces"> <span id="piecesObjectiveLabel">Piece Count</span></label>
</fieldset>
<div id="resultSummary" aria-live="polite"></div>
```

Use the existing font size and colors. Do not assign a fixed width. Allow both options to wrap on narrow screens. The `fieldset` uses a transparent background and the current text color.

- [x] **Step 2: Connect the canonical storage key and i18n**

`board.js` uses only the `legionSolverObjective` key:

```js
const savedObjective = localStorage.getItem('legionSolverObjective');
let objective = Object.values(OBJECTIVES).includes(savedObjective)
  ? savedObjective
  : OBJECTIVES.COVERAGE;
```

Update memory and `localStorage` when the option changes. `i18n.js` fills `objectiveLegend`, `coverageObjective`, `piecesObjective`, and the result copy. All five locales use their own translations without an English fallback chain.

- [x] **Step 3: Simplify `runSolver()`**

Remove the old logic that created four solvers for four board rotations and raced them with `Promise.race`. Create only one Worker client:

```js
const solver = new LegionSolver(board, pieces, onBoardUpdated, { objective });
legionSolvers = [solver];
const result = await solver.solve();
renderResult(result, solver.stats);
```

`renderResult()` displays `Covered x/y cells`, `Used a/b pieces`, and `Optimal` or `Best Known` according to the result state. Live Solve redraws only when the incumbent improves and is throttled to at most one update every 100 ms. Reset terminates the Worker and restores target cells without leaving block colors behind.

- [x] **Step 4: Update usage instructions**

Remove the obsolete warning that block area must equal selected area or the solver will loop forever. State that counts are availability limits, blanks are allowed, and two optimization objectives are available.

- [x] **Step 5: Run targeted build verification**

Run: `npm test && npx webpack --config webpack.config.dev.cjs && git diff --check`

Expected: Tests PASS, Webpack reports no module-resolution or Worker-chunk errors, and the diff check passes.

### Task 6: Establish Benchmarks and Optimize Hot Paths

**Files:**

- Create: `benchmarks/fixtures.js`
- Create: `benchmarks/solver-benchmark.js`
- Modify: `src/modules/solver/search.js`
- Modify: `src/modules/solver/problem.js`

- [x] **Step 1: Fix six benchmark categories**

`fixtures.js` exports an ordinary exact cover, a complex exact cover, a target one cell larger than available block area, a target four cells larger than available block area, repeated block types, and a case with no legal center start. Every fixture contains a fixed board, inventory, objective, and expected optimal score. Establish expected scores from correctness tests or independently verifiable constructions rather than copying output from the new solver.

- [x] **Step 2: Implement a repeatable benchmark runner**

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

Also print first-solution time, optimality-proof time, expanded states, cache hits, pruned states, and final score. Exit with a nonzero status on any incorrect score.

- [x] **Step 3: Record the initial new-solver benchmark**

Run: `npm run benchmark`

Expected: Every fixture reports the correct score and structured metrics. If any fixture exceeds ten seconds, abort it and report the missed target rather than hanging CI or the local terminal.

- [x] **Step 4: Optimize measured hot paths one at a time**

Based on profiling evidence, consider candidate filtering by inventory and adjacency gain, bitset reuse, reduced cache-key serialization, cached candidate order, remaining-coverage union bounds, and reachable-area tables for blank components. Add an independent oracle comparison test before retaining any new pruning rule.

Do not introduce an unproven hard prune solely to improve the benchmark. Such a rule may change candidate order but may not discard branches.

- [x] **Step 5: Verify performance thresholds and determinism**

Run: `npm test && npm run benchmark && git diff --check`

Expected: Ordinary cases complete immediately, formerly slow inputs produce a legal incumbent within 250 ms, target fixtures complete or prove optimality within two seconds, and repeated runs of the same fixture produce the same score and layout key. If a target is missed, retain the metrics and continue profiling; do not equate a responsive Worker with a faster solver.

### Task 7: Browser Smoke Tests, Documentation, and Final Acceptance

**Files:**

- Modify: `README.md`
- Modify only if defects are found: files changed in Tasks 1 through 6

- [x] **Step 1: Update the README**

Document the default Cell Coverage First mode, both lexicographic orders, permitted blanks and unused inventory, result-state meanings, non-blocking Worker architecture, and the `npm test`, `npm run benchmark`, and `npm run dev` commands. Do not claim that every input can be proven optimal within a fixed time.

- [x] **Step 2: Start the local development server**

Run: `npm run dev`

Expected: Webpack dev server starts successfully. `webpack.config.dev.cjs` keeps `open: false` and does not launch a system browser.

- [ ] **Step 3: Run a desktop smoke test in the Codex App browser**

Verify that Cell Coverage First is the default, the selected objective survives a refresh, an ordinary case completes with correct statistics, unequal areas still return a layout, pause/resume works, stop displays Best Known, reset restores the target, and Live Solve does not flicker from excessive updates.

- [ ] **Step 4: Run a narrow-viewport smoke test in the Codex App browser**

Verify that objective options remain visible and clickable, labels are not clipped, the board's existing horizontal behavior does not regress, and controls do not overlap the result area. If the in-app browser is unavailable, use HTTP black-box checks, builds, and DOM tests instead; record the missing visual acceptance and do not fall back to Chrome.

2026-09-15 acceptance record: The Codex App browser returned `Codex auth token is unavailable`, so Steps 3 and 4 remain unchecked. HTTP black-box checks, automated tests, and development builds passed. Chrome and external Playwright were not used as fallbacks.

- [x] **Step 5: Run final automated verification**

Run: `npm test && npm run benchmark && npx webpack --config webpack.config.dev.cjs && git diff --check`

Expected: Tests and benchmark scores pass, the development build succeeds, and the diff contains no whitespace errors.

- [x] **Step 6: Verify task boundaries**

Before the user-approved commit, run: `git status --short && git diff --stat && git diff`

Expected: Only the specification, plan, implementation, and test files for this task are changed. No `dist` output, logs, caches, credentials, or sensitive configuration enters the diff.

2026-09-15 completion record: Task files were reviewed and committed as `5324a06` after explicit user approval, then pushed to `master`. The older `fbae099` commit also contained the unrelated `personal.code-workspace`; published history was not rewritten and that file was not changed as part of this task. GitHub Pages deployment was added separately in `687f173`.
