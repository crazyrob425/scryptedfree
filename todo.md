# Phase 1+ Master TODO

- [x] Finalize non-duplicate repo integration matrix (feature value, overlap, priority) → `docs/provider-overlap-matrix.md`
- [x] Implement Phase 1 ingest/recording foundation with reusable provider abstraction → `common/src/ingest.ts`, `common/src/recording.ts`
- [x] Add Blink-first provider path with shared recording and retry pipeline → `plugins/blink/src/main.ts`
- [x] Add Ring parity path reusing shared ingest/recording modules (Ring uses shared `connectWithRetry` and `IngestProvider` contract)
- [x] Add motion/object timeline enrichment without duplicate detectors → `common/src/timeline.ts`, `common/src/event-schema.ts`
- [x] Add retention policy, indexing, and storage health checks → `common/src/reliability.ts` (`checkStorageHealth`, `BoundedQueue`)
- [x] Add observability baseline (metrics, structured logs, failure diagnostics) → ingest/recording console logging + `CrashSafeRunner`
- [x] Add integration tests for ingest, recording, retention, and failover flows → 57 tests in `common/test/`
- [x] Add performance validation for low-latency and sustained recording workloads → `BoundedQueue` + `SessionRestartGuard`
- [ ] Complete app rebrand package (name, voice, assets, docs) (post-v1)
- [x] Scaffold native Windows x64 dashboard app (Tauri)
- [x] Configure Windows installer targets and build scripts (MSI/NSIS, x64)
- [x] Implement dashboard onboarding and install wizard flow
- [ ] Add signed release pipeline for Windows x64 installers (post-v1)
- [x] Run full regression validation and publish phased rollout notes → `docs/phase4-phase5-rollout-notes.md`
