# Roadmap Blueprint

## Goal
Deliver a hardened, non-redundant NVR platform evolution with reusable integrations and a native Windows x64 dashboard + installer experience.

## Guiding Rules
1. Keep only integrations that add distinct capability or measurable quality gain.
2. Reuse shared modules before adding new provider-specific logic.
3. Validate each phase with build/test checks before progressing.
4. Ship incremental updates that are independently stable.

## Phase Plan

### Phase 1 — Foundation Kickoff (now)
- Create execution backlog (`todo.md`) and roadmap blueprint.
- Scaffold native Windows x64 dashboard in Tauri.
- Set installer bundle targets to MSI + NSIS.
- Add deterministic build commands for dashboard and Windows x64 bundle artifacts.

### Phase 2 — Reusable Ingest + Recording Core
- Create provider-agnostic ingest interfaces.
- Add shared recording pipeline, retention, and recovery logic.
- Ensure new providers plug into one pipeline instead of duplicated code paths.

### Phase 3 — Provider Expansion (No Redundant Features)
- Add/expand providers in descending value order.
- Reject integrations that duplicate existing capability without meaningful enhancement.
- Track each addition in a feature-vs-overlap matrix.

### Phase 4 — Detection + Timeline Quality
- Unify event metadata schema.
- Add searchable timeline enrichment and confidence metadata.
- Preserve a single detection orchestration layer to avoid repeated pipelines.

### Phase 5 — Reliability + Release
- Add reliability controls: retries, backoff, queue protections, crash-safe recovery.
- Add test coverage for critical ingest/recording/event paths.
- Produce release artifacts and rollout notes.

## Validation Gates Per Increment
- Install dependencies
- Build changed components
- Run relevant tests
- Confirm no security regressions in changed surfaces

## Immediate Next Increment
1. Stabilize dashboard shell UI and onboarding flow.
2. Wire dashboard to local service discovery/config endpoints.
3. Add first reusable ingest module extraction with tests.
