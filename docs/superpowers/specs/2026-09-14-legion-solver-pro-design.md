# LegionSolverPro Solver Acceleration Design

- Date: 2026-09-14
- Status: Approved
- Scope: Preserve Legion rules and primary UI interactions, replace the internal solving algorithm for speed, and add selectable optimization objectives

## 1. Background

The original project ran the board state, solver state, and backtracking process on the browser's main thread. The solver tried blocks cell by cell and repeatedly copied, scanned, and sorted several arrays during placement and rollback. Simple inputs completed quickly, but complex inputs entered a very large space of repeated searches. Although the main thread yielded periodically, the page could still become noticeably unresponsive.

This change does not alter the business meaning of Legion blocks, redesign the page, or assume that JavaScript itself is the root cause. The primary targets are the search model, data representation, pruning, and thread isolation. The first version remains in JavaScript. Rust/WASM should be evaluated only if the new algorithm and benchmarks still fail to meet the performance targets.

## 2. Product Goals

### 2.1 Behavior That Remains Unchanged

- Users continue selecting the cells they want to cover on the existing board.
- Users continue entering the available inventory for each block shape.
- Board dimensions, block shapes, rotation and reflection rules, center-anchor rules, and four-direction connectivity rules remain unchanged.
- Existing controls such as start, pause, resume, reset, live solve, region selection, and dark mode remain available.
- Users do not need to enter character combat stats, Legion member effects, or stat weights.

### 2.2 New Optimization Objectives

Add an **Optimization Goal** control to the existing solver area with two mutually exclusive options:

1. `Cell Coverage First`, selected by default.
2. `Piece Count First`.

Persist the selection in `localStorage` and restore it on the next visit. When no saved value exists, use `Cell Coverage First`.

The entered block count is the maximum available inventory for that shape. The solver may leave blocks unused and may leave selected cells uncovered.

### 2.3 Non-goals

- Do not calculate the real combat value of character cards or Legion grid cells.
- Do not add class, equipment, character sheet, or stat-weight configuration.
- Do not replace the frontend framework or perform an unrelated visual redesign.
- Do not introduce server-side solving, Rust, or WebAssembly in the first version.

## 3. Exact Scoring Semantics

Each legal solution records:

- `coveredCells`: Number of selected cells covered by blocks.
- `placedPieces`: Number of blocks actually placed on the board.
- `layoutKey`: A deterministic layout identifier derived from block type, orientation, and coordinates. It is used only for stable search, caching, and message deduplication; it does not represent additional in-game value.

Both modes use lexicographic comparison instead of collapsing the two metrics into a potentially misleading weighted score:

```text
Cell Coverage First: coveredCells DESC, placedPieces DESC
Piece Count First: placedPieces DESC, coveredCells DESC
```

When the business scores are tied, the solver keeps the first layout found by its deterministic search order. The same input therefore produces the same `layoutKey`, but the solver does not perform additional exponential search merely to minimize a string with no business meaning.

For example, if one solution covers 158 cells with 38 blocks and another covers 157 cells with 39 blocks, Cell Coverage First selects the first solution while Piece Count First selects the second.

A result is marked **Optimal** only after the search is exhausted or an upper bound proves that no better solution exists. Pausing or stopping may preserve the best layout found so far, but it must be marked **Best Known** rather than presented as optimal.

## 4. Legal Solution Constraints

- Blocks may cover only user-selected target cells. They may not leave the board, cover unselected cells, or overlap one another.
- Usage of each block type may not exceed its entered inventory.
- Rotations and reflections that produce identical orientations are retained only once.
- At least one placed block must have an anchor cell on a legal cell in the board's center region.
- All placed blocks must form one four-direction connected component.
- A blank means a selected target cell that remains uncovered. Unselected cells do not participate in scoring.
- If no cells are selected, no blocks are available, or no legal center placement exists, return an explicit invalid-input or no-solution result without starting a meaningless search.

## 5. Architecture

### 5.1 UI Adapter Layer

`board.js` remains responsible for DOM interactions, board rendering, and status presentation. The public `LegionSolver` entry point remains as a compatibility facade, while its internals communicate with a Worker so that search details do not leak into the UI.

The UI redraws the board only when:

- A better solution arrives.
- The user pauses or stops.
- Search completes.
- The user resets the board.

When Live Solve is enabled, improved-solution messages must still be throttled so that frequent DOM updates do not cancel the algorithmic gains.

### 5.2 Worker Control Layer

Solving runs in a Web Worker. The message protocol includes at least:

- Input: target cells, block inventory, optimization objective, and run command.
- Control: `start`, `pause`, `resume`, and `cancel`.
- Output: `progress`, `incumbent`, `completed`, `cancelled`, and `error`.

Search uses a resumable explicit stack and runs in batches. Each batch yields the Worker event loop so pause and cancellation commands can be handled promptly. The design does not depend on `SharedArrayBuffer` or special cross-origin response headers.

### 5.3 Pure Solver Core

The Solver Core does not access the DOM, `localStorage`, or timers. It accepts plain data and emits search events, which allows it to run directly in Node.js tests.

Recommended module boundaries:

- Board encoding: Compress target cells into contiguous indices and represent occupancy with `Uint32Array` bitsets.
- Orientation generation: Generate and deduplicate rotations and reflections for each block type. Preserve every source cell whose value is `2` as an anchor candidate rather than collapsing a shape to one anchor.
- Legal placement precomputation: Generate every placement that lies entirely inside the target region. Record its coverage mask, anchor indices, and adjacency information.
- Scoring: Centralize both lexicographic comparisons so business code never constructs its own weighted score.
- Search: Maintain occupancy, remaining inventory, current layout, current incumbent, and statistics.

These modules communicate through plain objects and documented data contracts. If the search implementation is later replaced with WASM, the UI and scoring semantics should not need to change.

## 6. Search Algorithm

### 6.1 Initial Solution and Search Order

First, use a fast greedy pass with limited local improvement to produce a legal layout and establish a strong lower bound early. Then run an exact branch-and-bound search:

1. Start from placements whose anchors are legal in the center region.
2. At every step, expand only placements that are four-direction adjacent to and do not conflict with the current layout, preserving connectivity by construction.
3. Try branches that are more likely to improve the current mode's primary objective first.
4. Compare and save the incumbent at every node so pausing or cancellation can still return a usable result.

The same final occupancy may be reached through different placement orders. Cache search states by `occupancy bitset + remaining inventory` to avoid repeated expansion. Blocks of the same type are not distinguished by instance ID, eliminating exchange symmetry.

### 6.2 Branch Selection

Use an MRV strategy to process the constrained frontier cell with the fewest legal placements first, combined with these ordering heuristics:

- Whether a placement fills a narrow region or small connected component.
- Number of newly covered cells.
- Gain under the active optimization objective.
- Stable block type, orientation, and coordinate order.

Heuristics change only how quickly good solutions are found. They do not change the legal solution set or final optimality.

### 6.3 Upper Bounds and Pruning

Calculate optimistic upper bounds for every state:

- Maximum additional cells that remaining inventory could cover.
- Maximum additional number of blocks that remaining inventory could place.
- Union of uncovered target cells that still have a legal candidate placement.
- Target region still reachable from the current connected component.
- Whether small blank components can be filled by a combination of remaining block areas.
- Whether board parity coloring and the remaining blocks' parity contributions make the incumbent target impossible.

Prune a state immediately when even its optimistic bound cannot beat the incumbent under the active lexicographic objective. Every pruning rule must have a proof that it cannot exclude the true optimum. Rules that only improve ordering and lack a completeness proof may be used as heuristics but may not discard branches.

## 7. State and Error Handling

User-visible states:

- **Solving:** Display elapsed time, explored-state count, and the current best score.
- **Paused:** Preserve the Worker stack and current layout so the search can resume.
- **Optimal:** The current layout has been proven optimal.
- **Best Known:** The user stopped or cancelled after a usable layout was found, but optimality has not been proven.
- **No Solution:** No block can be placed while satisfying the center and connectivity rules.
- **Invalid Input:** For example, no target cells were selected or an inventory value is invalid.
- **Solver Error:** A Worker or algorithm exception occurred. Restore the controls and retain diagnostic information that contains no sensitive data.

The result area displays `Covered x/y cells`, `Used a/b pieces`, and the optimality state. A boolean `true` result must no longer imply that every block was used or every target cell was covered.

## 8. Performance Targets

Compare the old and new implementations on the same development machine, browser, and fixed inputs:

- The main thread must not execute the search loop. Start, pause, resume, and stop should produce visible UI feedback within 100 ms.
- Ordinary exact-cover cases should remain effectively immediate and must not regress noticeably because of the new architecture.
- For complex or unequal-area inputs that the old solver cannot finish in three to five seconds, the new solver should produce its first legal incumbent within 250 ms.
- Target benchmark fixtures should complete or prove optimality within two seconds. If they do not, continue profiling algorithmic bottlenecks before evaluating Rust/WASM.
- Cancellation should take effect on the Worker's next execution batch, with a target response time of no more than 100 ms.

Performance reports record the input summary, environment, first-solution time, optimality-proof time, explored states, cache hits, and final score rather than reporting one accidental wall-clock sample.

## 9. Testing and Acceptance

### 9.1 Correctness

- Unit tests for orientation deduplication, coordinate transformations, and legal placement precomputation.
- Conflicting fixtures for both scoring modes, including a test proving that tied layouts do not create a third business objective.
- Tests for center anchors, bounds, overlap, inventory limits, and four-direction connectivity.
- Tests for permitted blanks, unused blocks, and inputs with unequal areas.
- Compare both optimization modes against an independent brute-force oracle on small boards.
- Repeated runs of a fixed input must produce the same score and layout.

### 9.2 Worker and UI

- Tests for start, pause, resume, cancel, reset, and error recovery.
- Tests for the default `localStorage` value and persistence of both optimization objectives.
- Live Solve displays only monotonically improving solutions and throttles update frequency.
- The new options do not obscure existing buttons or the board at desktop or narrow viewport widths.
- All five existing locales include the optimization objective, result state, and error copy.

### 9.3 Performance Regression

Create a fixed benchmark suite containing at least: an ordinary exact cover, a complex exact cover, block area one cell larger than the target, block area several cells smaller than the target, repeated block types, and a case with no legal center start. The benchmark must not depend on the DOM and must run deterministically in Node.js.

## 10. Implementation Boundaries and License

The implementation retains the repository's existing technology stack and license boundaries. General algorithmic ideas such as bitsets, MRV, branch-and-bound, and connected-component pruning may be implemented independently, but source code from AGPL-licensed solvers must not be copied. Any future third-party code or WASM dependency requires a license and distribution-impact review first.

After implementation, perform only targeted local tests, static checks, benchmarks, and browser smoke verification. Do not run `git add`, `git commit`, or `git push` without separate explicit user authorization.
