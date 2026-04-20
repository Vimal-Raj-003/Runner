# Runner System

Industrial-grade injection-mould runner and gate design tool.

## What this is

A Next.js + Three.js workspace for sizing injection-mould runner networks,
gates, and sprue bushes, backed by a pure-TypeScript calculation engine with
formulas cited to the standard textbooks (Pye, Rosato, Menges, Beaumont,
Rees, Nayak).

The UI is a direct port of the browser-only prototype at
`docs/prototype.html` (if included). The engineering maths and geometry
engine are isolated in `@runner/core` so the same code runs on the client
for instant preview and on the server for the authoritative audit record.

## Architecture

```
runner/
├── apps/
│   └── web/              # Next.js 15 App Router + Three.js + Zustand
└── packages/
    └── core/             # @runner/core — pure TS calc & topology engine
```

Four layers:

1. **Presentation** — `apps/web/src/components/*` — bars, 3D viewer,
   engineering panel, runner-dimensions editor.
2. **Application** — Next.js server actions / route handlers *(planned,
   not in this milestone)*.
3. **Domain** — `packages/core/src/*` — pure calculations and geometry.
4. **Infrastructure** — Postgres, Vercel Blob, CadQuery micro-service
   *(planned, not in this milestone)*.

## Calculation coverage

Fifteen formulas, each with a citation attached to its result:

| Category | Formula | Source |
|---|---|---|
| Runner dia | Pye correlation D = ⁴√(W·L)/3.7 | Rosato §3.2 |
| Gate | h = n·t, W = n·√A/30 | Beaumont 1974 |
| Sprue | Orifice = nozzle + 0.75, 2° incl. | DME / HASCO |
| Clamp | F = A·P/10000 | Rees 2002 §4 |
| Pressure drop | Hagen-Poiseuille + power-law | Menges 1993; BSL 1960 |
| Shear | γ̇ (round / rect); τ = η·γ̇ | Rees 2002 §4.3 |
| Thermal | Fill, freeze (Menges), ΔT, frozen layer | Menges & Ballman 1986 |
| Balance | σ(L/D)/mean < 10 % ⇒ balanced | Beaumont 2007 |
| Yield | Shot weight, part / runner fraction | Rosato §7.2 |

Nine layout generators: H-Bridge, Radial/Star, Fishbone (sym / graduated /
one-sided), Inline, T-Runner, S-Runner, Cross-Main. Five runner profiles:
full round, trapezoidal, modified trapezoid, hexagonal, half-round.
Material database seeded with 20 common grades (PP, PC, ABS, PA6/66, POM,
PMMA, HDPE/LDPE, PS/HIPS, PVC rigid & flex, PET, TPU).

## Prerequisites

- Node.js 20+
- pnpm 9 (via `corepack prepare pnpm@9.12.0 --activate`)

## Install

```bash
pnpm install
```

## Run tests

All 28 golden-value tests in the calculation core:

```bash
pnpm --filter @runner/core test
```

## Type-check

```bash
pnpm typecheck
```

## Run the workspace

```bash
pnpm --filter @runner/web dev
# open http://localhost:3100
```

## Build for production

```bash
pnpm build
```

## Project layout

```
packages/core/src/
├── citations.ts        # central engineering source registry
├── profiles.ts         # 5 runner cross-section profiles
├── gateTypes.ts        # 13 gate-type reference entries
├── materials/          # material record schema + 20-grade seed DB
├── sprueBushes/        # DME A/B-series, HASCO Z100/Z102/Z104
├── geometry/           # runner-tree, overlap detection, override resolver
├── layouts/            # 9 topology generators
└── calc/               # 15 formulas + pipeline

apps/web/src/
├── app/                # Next.js App Router entry
├── components/
│   ├── bars/           # TopBar, LayoutBar, ViewBar, ActionBar
│   ├── Viewer3D/       # imperative Three.js viewer + raycast + axis triad
│   ├── EngineeringPanel/
│   └── RunnerDimensionsPanel/
├── hooks/useCalc.ts    # connects Zustand store → @runner/core pipeline
└── state/store.ts      # Zustand workspace state
```

## What's next

Phased from the implementation plan:

- **Phase 3 — Persistence & auth**: Postgres / Prisma / Clerk
- **Phase 4 — Reports & export**: React-PDF report with citations appendix,
  Excel BOM, STEP export via a FastAPI + CadQuery micro-service
- **Phase 5 — Advanced calcs / material DB / polish**: CAMPUS CSV import,
  Cross-WLF viscosity model, 3D balance visualisation, shareable URLs

## License

Proprietary — internal use.
