# Provider Feature-vs-Overlap Matrix

> Phase 3 — Provider Expansion reference document.
> Updated as each provider is evaluated or added.

## Evaluation Criteria

| Dimension | Description |
|-----------|-------------|
| **Distinct value** | Does the provider add a capability no existing integration offers? |
| **Overlap score** | 0 = no overlap, 3 = full duplicate of an existing provider |
| **Quality gain** | Measurable improvement (latency, reliability, detection accuracy) |
| **Priority** | Descending value order: **High / Medium / Low / Rejected** |

---

## Provider Matrix

| Provider | Distinct Value | Overlap Score | Quality Gain | Priority | Status |
|----------|---------------|--------------|--------------|----------|--------|
| **Ring** | WebRTC live view, doorbell press, alarm system, video clips | 1 (overlaps ONVIF motion) | High — native Ring event bus, low-latency WebRTC | High | ✅ Existing |
| **Blink** | Battery-powered cameras, Blink-specific cloud clips, low-bandwidth motion | 1 (overlaps basic ONVIF snapshot) | High — unique battery/wireless device class | High | 🚧 Phase 3 scaffold added |
| **ONVIF** | Vendor-agnostic IP camera standard (PTZ, audio, events) | 0 | High — covers hundreds of IP cameras | High | ✅ Existing |
| **Reolink** | Native Reolink smart detection API, AI zones, package detection | 1 (partially overlaps ONVIF) | Medium — richer detection metadata than ONVIF | Medium | ✅ Existing |
| **Hikvision** | Native Hikvision ISAPI events, smart alarm integration | 1 (partially overlaps ONVIF) | Medium — more reliable events than ONVIF baseline | Medium | ✅ Existing |
| **UniFi Protect** | Full UniFi NVR integration, smart detections, privacy zones | 1 (overlaps generic NVR) | High — dedicated Protect API with richer metadata | High | ✅ Existing |
| **Synology SS** | NVR integration for Synology Surveillance Station | 2 (largely duplicates UniFi Protect use-case) | Low — no distinct device class | Low | ✅ Existing (no expansion planned) |
| **Wyze** | Budget Wi-Fi cameras, RTSP bridge, HMS subscription | 2 (overlaps RTSP + ONVIF) | Low — limited API, RTSP only after local bridge | Low | ✅ Existing (no expansion planned) |
| **Eufy** | Battery cameras, HomeBase hub, cloud storage | 1 (partially overlaps Blink) | Medium — different device ecosystem than Blink | Medium | ✅ Existing |
| **Amcrest** | ONVIF-compatible + Amcrest Smart Home API | 2 (full overlap with ONVIF) | Low — ONVIF already covers it adequately | Low | ✅ Existing (no expansion planned) |
| **Tapo (TP-Link)** | Tapo cloud + ONVIF streams, AI detections | 2 (overlaps ONVIF + Reolink detection) | Low — detection quality similar to Reolink | Low | ✅ Existing (no expansion planned) |
| **Google Nest** | Google Home/Assistant integration, smoke/CO, Face Detect | 0 (unique AI face detection via Nest API) | High — Google-exclusive capabilities | High | ✅ Existing |
| **HomeKit** | Apple HomeKit bridge (two-way) | 0 (unique Apple ecosystem sink) | High — platform integration, not a camera source | High | ✅ Existing |
| **Alexa** | Amazon Alexa smart home bridge | 0 (unique Amazon ecosystem sink) | High — platform integration, not a camera source | High | ✅ Existing |
| **Doorbird** | IP doorbell with OSDP access control | 1 (overlaps Ring doorbell) | Medium — access-control integration (Ring lacks) | Medium | ✅ Existing |
| **BTicino** | SIP-based video doorbell (European market) | 1 (overlaps Doorbird) | Medium — distinct SIP/European market | Medium | ✅ Existing |
| **SIP** | Generic SIP video calls/doorbells | 1 (overlaps BTicino/Doorbird) | Medium — covers third-party SIP devices | Medium | ✅ Existing |
| **Z-Wave** | Z-Wave sensor/lock ecosystem | 0 (unique Z-Wave device class) | High — no other Z-Wave path in the platform | High | ✅ Existing |
| **Tuya** | Tuya Smart / SmartLife cloud devices | 2 (overlaps Wyze, generic ONVIF) | Low — limited capabilities, cloud-dependent | Low | ✅ Existing (no expansion planned) |

---

## Expansion Decisions

### Accepted expansions (Phase 3)

| Provider | Reason for acceptance |
|----------|-----------------------|
| **Blink** | Unique battery-camera device class with distinct cloud clip API; low overlap with any existing provider; high value for users who own Blink hardware. Scaffold added at `plugins/blink/`. |

### Rejected expansions

| Provider | Reason for rejection |
|----------|----------------------|
| Arlo | Full overlap with Blink+Ring (battery camera + cloud clips); no distinct capability. Re-evaluate if Arlo-specific detection (subject tracking) matures. |
| Lorex | ONVIF-compatible; fully covered by the existing ONVIF plugin. |
| Bosch / Axis (additional) | ONVIF-compatible at the streaming layer; vendor-specific event APIs would be Medium value but require dedicated maintenance. Defer until community demand is confirmed. |

---

## Guiding Rule Reminder

> "Keep only integrations that add distinct capability or measurable quality gain." — Roadmap Blueprint, Rule 1
