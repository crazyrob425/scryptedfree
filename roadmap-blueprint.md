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

### Phase 4 — Detection + Timeline Quality (completed)
- [x] Unified event metadata schema (`common/src/event-schema.ts`).
  - `ScryptedEvent`, `DetectionResult`, `DetectionClass`, `EventType` types
  - `buildEvent()`, `createEventId()`, `computeAggregateConfidence()` helpers
  - Type guards: `isDoorbellEvent`, `isMotionEvent`, `isHighConfidence`
- [x] Timeline enrichment with confidence scores (`common/src/timeline.ts`).
  - `TimelineEnricher` — TTL ring-buffer, segment annotation, tag derivation
  - `buildDoorbellEvent()` convenience factory used by Blink + Ring
- [x] Single detection orchestration layer — `DoorbellCastOrchestrator`
  (`common/src/doorbell-cast.ts`) fans out to display targets without
  duplicating detection logic.
- [x] **Sub-project: PiP Doorbell Cast** (`plugins/pip-doorbell-cast/`).
  - `ChromecastPipTarget` — castv2-client, live stream → PiP overlay on Chromecast/Vizio
  - `FireTvPipTarget` — ADB TCP via adbkit, native PiP broadcast Intent on Fire TV
  - `DoorbellMixin` + `PipDoorbellCastPlugin` — MixinProvider attaches to any
    `BinarySensor + Camera` doorbell device; zero provider-specific code
- [x] Tests: 31 tests covering schema, timeline, cast orchestrator (all pass)

### Phase 5 — Reliability + Release (completed)
- [x] Reliability controls (`common/src/reliability.ts`):
  - `BoundedQueue<T>` — head-drop queue guards against unbounded memory
  - `CrashSafeRunner` — auto-restart with capped backoff (configurable maxRestarts)
  - `SessionRestartGuard` — manages IngestSession lifecycle + auto-restart
  - `checkStorageHealth()` — disk space check for recording output directories
- [x] Test coverage (`common/test/reliability.test.ts`) — 9 tests, all pass.
- [x] Rollout notes: `docs/phase4-phase5-rollout-notes.md`
- [x] Total: **57 tests passing, 0 failing** across all phases.

## Validation Gates Per Increment
- Install dependencies
- Build changed components
- Run relevant tests
- Confirm no security regressions in changed surfaces

## Immediate Next Increment
All planned phases (1–5) are complete. The platform is ready for:
- Production hardening of the Blink client (swap `StubBlinkClient` for a real library).
- Signed Windows x64 release pipeline.
- App rebrand assets (name, icon, splash screen).
