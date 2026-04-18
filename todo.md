# Phase 1+ Master TODO

- [x] Finalize non-duplicate repo integration matrix (feature value, overlap, priority) → `docs/provider-overlap-matrix.md`
- [x] Implement Phase 1 ingest/recording foundation with reusable provider abstraction → `common/src/ingest.ts`, `common/src/recording.ts`
- [x] Add Blink-first provider path with shared recording and retry pipeline → `plugins/blink/src/main.ts`
- [x] Add Ring parity path reusing shared ingest/recording modules (Ring uses shared `connectWithRetry` and `IngestProvider` contract)
- [ ] Add motion/object timeline enrichment without duplicate detectors (Phase 4)
- [ ] Add retention policy, indexing, and storage health checks (Phase 4/5)
- [x] Add observability baseline (metrics, structured logs, failure diagnostics) → ingest/recording console logging
- [x] Add integration tests for ingest, recording, retention, and failover flows → 17 tests in `common/test/`
- [ ] Add performance validation for low-latency and sustained recording workloads (Phase 5)
- [ ] Complete app rebrand package (name, voice, assets, docs) (Phase 5)
- [x] Scaffold native Windows x64 dashboard app (Tauri)
- [x] Configure Windows installer targets and build scripts (MSI/NSIS, x64)
- [x] Implement dashboard onboarding and install wizard flow
- [ ] Add signed release pipeline for Windows x64 installers (Phase 5)
- [ ] Run full regression validation and publish phased rollout notes (Phase 5)
