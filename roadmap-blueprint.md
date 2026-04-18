# Roadmap Blueprint

## Goal
Deliver a hardened, non-redundant NVR platform evolution with reusable integrations and a native Windows x64 dashboard + installer experience.

## Guiding Rules
1. Keep only integrations that add distinct capability or measurable quality gain.
2. Reuse shared modules before adding new provider-specific logic.
3. Validate each phase with build/test checks before progressing.
4. Ship incremental updates that are independently stable.

## Phase Plan

### Phase 1 — Foundation Kickoff (completed)
- [x] Create execution backlog (`todo.md`) and roadmap blueprint.
- [x] Scaffold native Windows x64 dashboard in Tauri.
- [x] Set installer bundle targets to MSI + NSIS.
- [x] Add deterministic build commands for dashboard and Windows x64 bundle artifacts.
- [x] Implement dashboard onboarding/install wizard flow.
- [x] Wire dashboard to local service discovery/config endpoints.

### Phase 2 — Reusable Ingest + Recording Core (completed)
- [x] Create provider-agnostic ingest interfaces (`common/src/ingest.ts`).
  - `IngestProvider`, `IngestSession`, `IngestFrame`, `IngestConnectionOptions`, `RetryOptions`
  - `connectWithRetry()` shared exponential-backoff helper
- [x] Add shared recording pipeline, retention, and recovery logic (`common/src/recording.ts`).
  - `RecordingPipeline` class (segment rotation, size+age retention pruning, crash-safe index)
  - `NullSegmentIndex` for testing; `SegmentIndex` interface for FS/DB backends
- [x] Ensure new providers plug into one pipeline instead of duplicated code paths.
  - All providers implement `IngestProvider` → pipeline consumes `IngestSession` generically
- [x] Add unit tests for ingest and recording core (`common/test/ingest.test.ts`, `common/test/recording.test.ts`).
  - 17 passing tests covering session lifecycle, retry logic, rotation, retention, and recovery

### Phase 3 — Provider Expansion (No Redundant Features) (completed)
- [x] Finalize feature-vs-overlap matrix (`docs/provider-overlap-matrix.md`).
- [x] Reject integrations that duplicate existing capability without meaningful enhancement.
- [x] Scaffold Blink provider implementing shared `IngestProvider` interface (`plugins/blink/`).
  - `BlinkIngestProvider`, `BlinkCameraDevice`, stub client ready for upstream library swap

### Phase 4 — Detection + Timeline Quality
- [ ] Unify event metadata schema.
- [ ] Add searchable timeline enrichment and confidence metadata.
- [ ] Preserve a single detection orchestration layer to avoid repeated pipelines.

### Phase 5 — Reliability + Release
- [ ] Add reliability controls: retries, backoff, queue protections, crash-safe recovery.
- [ ] Add test coverage for critical ingest/recording/event paths.
- [ ] Produce release artifacts and rollout notes.

## Validation Gates Per Increment
- Install dependencies
- Build changed components
- Run relevant tests
- Confirm no security regressions in changed surfaces

## Immediate Next Increment (Phase 4)
- [ ] Define unified event metadata schema (`common/src/event-schema.ts`).
- [ ] Add timeline enrichment with confidence scores to the recording pipeline.
- [ ] Wire object/motion detection events into the shared schema.
