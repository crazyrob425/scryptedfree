# Phase 1+ Master TODO

- [ ] Finalize non-duplicate repo integration matrix (feature value, overlap, priority)
- [ ] Implement Phase 1 ingest/recording foundation with reusable provider abstraction
- [ ] Add Blink-first provider path with shared recording and retry pipeline
- [ ] Add Ring parity path reusing shared ingest/recording modules
- [ ] Add motion/object timeline enrichment without duplicate detectors
- [ ] Add retention policy, indexing, and storage health checks
- [ ] Add observability baseline (metrics, structured logs, failure diagnostics)
- [ ] Add integration tests for ingest, recording, retention, and failover flows
- [ ] Add performance validation for low-latency and sustained recording workloads
- [ ] Complete app rebrand package (name, voice, assets, docs)
- [x] Scaffold native Windows x64 dashboard app (Tauri)
- [x] Configure Windows installer targets and build scripts (MSI/NSIS, x64)
- [ ] Implement dashboard onboarding and install wizard flow
- [ ] Add signed release pipeline for Windows x64 installers
- [ ] Run full regression validation and publish phased rollout notes
