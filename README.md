# LegionSolverPro

An automatic MapleStory Legion block placement tool. The project preserves the original board, block data, and primary interactions while replacing the solver's search model and execution architecture.

## Online Version

[Open LegionSolverPro](https://wy2016xiao.github.io/LegionSolverPro/)

## Optimization Objectives

The page provides two persistent optimization objectives:

- **Cell Coverage First (default):** Minimize uncovered selected cells first, then place more blocks when coverage is tied.
- **Piece Count First:** Place more blocks first, then cover more selected cells when the number of placed blocks is tied.

Each input count is the maximum available inventory for that shape. When the total block area differs from the number of selected cells, the solver may leave selected cells uncovered or leave blocks unused.

Only these two business metrics determine optimality. When both scores are tied, the solver returns the first layout found by its deterministic search order. `layoutKey` is used only for caching, deduplication, and reproducibility; it is not a third optimization objective.

An **Optimal** result means the search has finished or a safe upper bound has proven that no better layout exists. Pausing displays the current best layout. Selecting **Stop** while paused cancels the remaining search and preserves that layout as **Best Known**, which means optimality has not yet been proven. The board can still be reset afterward.

## Solver Architecture

- Board occupancy is represented with `Uint32Array` bitsets.
- All legal rotations, reflections, and placements are generated and deduplicated in advance.
- Search starts from a center anchor and uses frontier-cell MRV, branch-and-bound, area-divisibility bounds, inventory bounds, and state caching.
- A bounded exact-cover pass and greedy layouts establish a strong incumbent early for pruning.
- Search runs in a Web Worker, so pause, resume, and rendering no longer compete with the search loop on the main thread.

## Local Development

```bash
npm install
npm run dev
```

The development server does not open a system browser automatically. Its default address is `http://localhost:8080/`.

## Verification

```bash
npm test
npm run benchmark
```

The test suite covers conflicting objectives, permitted blanks, unused inventory, center anchors, connectivity, the Worker message contract, and comparisons between the production search and an independent brute-force oracle on small boards.

The benchmark suite includes a 160-cell exact cover, a 159-cell partial cover, insufficient inventory, mixed block sizes, and the original project's five level-200 block shapes. It verifies the optimal score and fails if an individual fixture exceeds two seconds. This is not a guarantee that every possible input can be proven optimal within a fixed time.

## Production Build

```bash
npm run build
```

Production assets are written to `dist/prod`. The project retains the ISC license declared in `package.json`.

## GitHub Pages Deployment

Every push to `master` makes GitHub Actions install dependencies, run the tests, build `dist/prod`, and deploy the result to the free GitHub Pages URL above. The workflow can also be started manually from the Actions page.

For a new fork, enable workflows from the repository's Actions page and select `GitHub Actions` under `Settings → Pages → Build and deployment → Source` before the first deployment.
