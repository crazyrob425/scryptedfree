# Phase 4 + Phase 5 Rollout Notes

**Produced:** 2026-04-18  
**Covers:** Phases 4 (Detection + Timeline Quality) and 5 (Reliability + Release)

---

## What Shipped

### Sub-project — PiP Doorbell Cast

#### Research Summary

Goal: deliver doorbell-press video as a Picture-in-Picture overlay to living-room displays (Fire TV, Chromecast, Vizio) with minimal latency and zero app freezes.

**Architecture chosen:** Event-driven fan-out with per-target retry isolation.

| Component | Role |
|-----------|------|
| `common/src/event-schema.ts` | Provider-agnostic event envelope; all detection data normalised here |
| `common/src/timeline.ts` | `TimelineEnricher` keeps a TTL ring-buffer and stamps segments with events |
| `common/src/doorbell-cast.ts` | `DoorbellCastOrchestrator` fans out to N targets in parallel |
| `plugins/pip-doorbell-cast/src/chromecast-pip.ts` | Sends LIVE stream to Chromecast/Vizio via existing `castv2-client` |
| `plugins/pip-doorbell-cast/src/fire-tv-cast.ts` | Sends PiP broadcast Intent to Fire TV via ADB TCP (`adbkit`) |
| `plugins/pip-doorbell-cast/src/main.ts` | Scrypted plugin (MixinProvider): wraps any `BinarySensor + Camera` doorbell |

**Key design decisions:**

1. **Parallel fan-out with per-target error isolation.** `Promise.allSettled()` ensures a bad Fire TV ADB connection never delays the Chromecast cast.
2. **Auto-dismiss.** Each target installs its own `setTimeout` for `durationMs + 1s`. No centralised timer that could stall on slow targets.
3. **`connectWithRetry` everywhere.** Session opens, ADB connections, and castv2 launches all use the shared exponential-backoff helper (max 3 attempts, 500 ms → 5 s).
4. **`adbkit` for Fire TV** — pure-JS ADB client, no system binary required, TCP ADB over LAN.
5. **`castv2-client` reused** — already present in `plugins/chromecast`, no new runtime dep.
6. **`BoundedQueue`** protects ingest frame buffers from unbounded memory growth on slow disks.
7. **`CrashSafeRunner`** auto-restarts crashed sessions (capped at 20 restarts, backoff up to 2 min).

#### End-to-End Flow

```
Blink/Ring doorbell pressed
  → BinarySensor binaryState = true
  → DoorbellMixin.dispatchDoorbellCast()
      → camera.getVideoStream() → live RTSP URL
      → buildDoorbellEvent()
  → DoorbellCastOrchestrator.handle(event)
      → ChromecastPipTarget.showPip()   [castv2-client, ~200ms]
      → FireTvPipTarget.showPip()        [ADB broadcast, ~150ms]
  → PiP visible on TV
  → auto-dismiss after 30s (configurable)
```

**Expected doorbell-to-PiP latency:** 200–600 ms on LAN (dominated by RTSP session establishment, not cast protocol).

---

### Phase 4 — Detection + Timeline Quality

| Deliverable | File | Tests |
|-------------|------|-------|
| Unified event schema | `common/src/event-schema.ts` | `test/event-schema.test.ts` — 17 tests |
| Timeline enrichment | `common/src/timeline.ts` | `test/doorbell-cast.test.ts` — 14 tests |
| Doorbell cast orchestrator | `common/src/doorbell-cast.ts` | (included above) |

### Phase 5 — Reliability + Release

| Deliverable | File | Tests |
|-------------|------|-------|
| BoundedQueue | `common/src/reliability.ts` | `test/reliability.test.ts` — 5 tests |
| CrashSafeRunner | `common/src/reliability.ts` | `test/reliability.test.ts` — 4 tests |
| SessionRestartGuard | `common/src/reliability.ts` | (tested via CrashSafeRunner + integration) |
| StorageHealthCheck | `common/src/reliability.ts` | (runtime-only, gracefully degrades) |

**Total tests after all phases: 57 passing, 0 failing.**

---

## Upgrade / Integration Guide

### Installing the PiP Doorbell Cast plugin

1. Install the `@scrypted/pip-doorbell-cast` plugin from the Scrypted plugin store (or local build).
2. Ensure the **Chromecast** plugin is installed and has discovered your TVs.
3. Ensure **ADB Debugging** is enabled on your Fire TV (Settings → My Fire TV → Developer Options).
4. Open the **PiP Doorbell Cast Controller** device in Scrypted and configure:
   - **Chromecast / Vizio Targets:** comma-separated device names (leave blank = all).
   - **Fire TV IP Addresses:** comma-separated IPs of Fire TV devices.
   - **PiP Duration:** seconds (default 30).
5. The plugin auto-attaches to all `BinarySensor + Camera` devices — no further config needed.

### Fire TV ADB prerequisite

```
Settings → My Fire TV → Developer Options → ADB Debugging → ON
Settings → My Fire TV → Developer Options → Network Debugging → ON
```

The plugin connects via TCP ADB (port 5555). No USB cable required.

---

## Known Limitations

| Limitation | Notes |
|------------|-------|
| Chromecast PiP is CSS-emulated | Cast SDK has no native OS PiP. The Scrypted receiver app renders a `position:fixed` overlay. Workaround: implement a custom Cast receiver app for true OS PiP on Google TV. |
| Fire TV PiP requires OS 7+ | Older Fire TV firmware may not support `com.amazon.pip.BROADCAST_START_PIP`. The fallback opens full-screen video via `am start`. |
| Vizio DIAL support | Vizio SmartCast TVs appear as Chromecast devices in mDNS — the ChromecastPipTarget handles them automatically via the same `castv2-client` path. |
| Blink live URL TTL | Blink short-lived live URLs (~2 min) may expire before the user has viewed the clip. Workaround: request a new URL in `dismissPip` and cache it. |

---

## Regression Checklist

- [x] `npm test` in `common/` — 57 tests pass
- [x] No new TypeScript errors in `common/src/` new files
- [x] `plugins/pip-doorbell-cast` builds (webpack) without errors
- [x] `plugins/chromecast` unchanged — no regression
- [x] `plugins/alexa` unchanged — no regression
- [x] `plugins/ring` unchanged — no regression
- [x] `plugins/blink` unchanged — no regression
