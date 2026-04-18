# Roadmap Blueprint

## Goal
Deliver a hardened, non-redundant NVR platform evolution with reusable integrations and a native Windows x64 dashboard + installer experience.

## Guiding Rules
1. Keep only integrations that add distinct capability or measurable quality gain.
2. Reuse shared modules before adding new provider-specific logic.
3. Validate each phase with build/test checks before progressing.
4. Ship incremental updates that are independently stable.

## Phase Plan (Completed)

### Phase 1 — Foundation Kickoff (completed)
- [x] Create execution backlog (`todo.md`) and roadmap blueprint.
- [x] Scaffold native Windows x64 dashboard in Tauri.
- [x] Set installer bundle targets to MSI + NSIS.
- [x] Add deterministic build commands for dashboard and Windows x64 bundle artifacts.

### Phase 2 — Reusable Ingest + Recording Core (completed)
- [x] Create provider-agnostic ingest interfaces.
- [x] Add shared recording pipeline, retention, and recovery logic.
- [x] Ensure new providers plug into one pipeline instead of duplicated code paths.

### Phase 3 — Provider Expansion (No Redundant Features) (completed)
- [x] Add/expand providers in descending value order.
- [x] Reject integrations that duplicate existing capability without meaningful enhancement.
- [x] Track each addition in a feature-vs-overlap matrix.

### Phase 4 — Detection + Timeline Quality (completed)
- [x] Unify event metadata schema.
- [x] Add searchable timeline enrichment and confidence metadata.
- [x] Preserve a single detection orchestration layer to avoid repeated pipelines.

### Phase 5 — Reliability + Release (completed)
- [x] Add reliability controls: retries, backoff, queue protections, crash-safe recovery.
- [x] Add test coverage for critical ingest/recording/event paths.
- [x] Produce release artifacts and rollout notes.

## Validation Gates Per Increment
- Install dependencies
- Build changed components
- Run relevant tests
- Confirm no security regressions in changed surfaces

## Immediate Next Increment (Completed)
- [x] Stabilize dashboard shell UI and onboarding flow.
- [x] Wire dashboard to local service discovery/config endpoints.
- [x] Add first reusable ingest module extraction with tests.
