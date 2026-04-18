/**
 * PiP Doorbell Cast — Scrypted Plugin Entry Point
 *
 * This plugin is the glue layer that:
 *
 *   1. Provides a settings UI where the user configures:
 *      - Which Chromecast/Vizio devices receive the PiP overlay.
 *      - Which Fire TV devices receive the PiP overlay.
 *      - PiP duration (default 30 s).
 *
 *   2. Acts as a MixinProvider for `BinarySensor + Camera` devices
 *      (Blink, Ring, SIP doorbells). When the mixin detects a doorbell press
 *      it fires the `DoorbellCastOrchestrator`.
 *
 *   3. Exposes a single `DoorbellCastController` device that shows live
 *      cast status and lets the user manually dismiss active PiP sessions.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * How it works end-to-end:
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  [Blink/Ring doorbell pressed]
 *       │
 *       ▼  binaryState = true  (BinarySensor event)
 *  [DoorbellMixin.onBinaryState()]
 *       │  builds ScryptedEvent (doorbell_press) with liveStreamUrl
 *       │
 *       ▼
 *  [DoorbellCastOrchestrator.handle(event)]
 *       │  fans out in parallel
 *       ├──────────────────────────────────┐
 *       ▼                                  ▼
 *  [ChromecastPipTarget.showPip()]    [FireTvPipTarget.showPip()]
 *  connects via castv2-client         connects via ADB TCP
 *  loads LIVE stream as PiP           broadcasts PiP intent
 *       │                                  │
 *       └──────────────┬───────────────────┘
 *                      ▼
 *               auto-dismiss after durationMs
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  BinarySensor,
  Camera,
  Device,
  DeviceProvider,
  MediaObject,
  MixinDeviceBase,
  MixinProvider,
  PictureOptions,
  RequestMediaStreamOptions,
  RequestPictureOptions,
  ResponseMediaStreamOptions,
  ScryptedDevice,
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  ScryptedMimeTypes,
  Setting,
  Settings,
  SettingValue,
  WritableDeviceState,
} from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { DoorbellCastOrchestrator, type CastTarget } from '@scrypted/common/src/doorbell-cast';
import { buildDoorbellEvent } from '@scrypted/common/src/timeline';
import { ChromecastPipTarget } from './chromecast-pip';
import { FireTvPipTarget } from './fire-tv-cast';

const { deviceManager, systemManager, mediaManager } = sdk;

// ---------------------------------------------------------------------------
// Native ID constants
// ---------------------------------------------------------------------------

const CONTROLLER_NATIVE_ID = 'pip-doorbell-cast-controller';

// ---------------------------------------------------------------------------
// Helper: find all Chromecast-family devices registered in Scrypted
// ---------------------------------------------------------------------------

function findCastDevices(): Array<{ id: string; label: string; host: string }> {
  const results: Array<{ id: string; label: string; host: string }> = [];
  try {
    const ids = systemManager.getSystemState();
    for (const id of Object.keys(ids)) {
      const device = systemManager.getDeviceById(id);
      if (!device) continue;
      // The chromecast plugin sets a 'host' storage item on each device.
      const storage = (device as any).storage;
      const host = storage?.getItem?.('host');
      if (
        host &&
        device.interfaces?.includes(ScryptedInterface.MediaPlayer)
      ) {
        results.push({ id: device.nativeId ?? id, label: device.name, host });
      }
    }
  } catch (_) {
    // systemManager may not be available during unit tests.
  }
  return results;
}

// ---------------------------------------------------------------------------
// DoorbellMixin — wraps a BinarySensor + Camera doorbell device
// ---------------------------------------------------------------------------

class DoorbellMixin
  extends MixinDeviceBase<BinarySensor & Camera>
  implements BinarySensor
{
  private orchestrator: DoorbellCastOrchestrator;

  constructor(
    mixinDevice: BinarySensor & Camera,
    mixinDeviceInterfaces: ScryptedInterface[],
    mixinDeviceState: WritableDeviceState,
    mixinProviderNativeId: string,
    orchestrator: DoorbellCastOrchestrator,
  ) {
    super({ mixinDevice, mixinDeviceInterfaces, mixinDeviceState, mixinProviderNativeId });
    this.orchestrator = orchestrator;
    this.watchBinaryState();
  }

  get binaryState(): boolean {
    return this.mixinDeviceState.binaryState;
  }
  set binaryState(v: boolean) {
    this.mixinDeviceState.binaryState = v;
  }

  private watchBinaryState() {
    // Listen for binaryState changes on the underlying device.
    // When it goes true (doorbell pressed), fire the cast.
    sdk.systemManager
      .listenDevice(
        this.id,
        { event: ScryptedInterface.BinarySensor },
        async (_source, _details, data) => {
          if (!data) return;
          this.console.log('[pip-doorbell] doorbell press detected, initiating cast');
          await this.dispatchDoorbellCast();
        },
      );
  }

  private async dispatchDoorbellCast(): Promise<void> {
    try {
      // Try to get a live stream URL from the camera.
      let liveStreamUrl: string | undefined;
      try {
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.Camera)) {
          const mo = await (this.mixinDevice as Camera).getVideoStream();
          liveStreamUrl = await mediaManager.convertMediaObjectToInsecureLocalUrl(
            mo,
            ScryptedMimeTypes.LocalUrl,
          );
        }
      } catch (e) {
        this.console.warn('[pip-doorbell] could not get live stream URL:', e);
      }

      const event = buildDoorbellEvent({
        provider: (this as any).providedInterfaces?.[0] ?? 'unknown',
        deviceId: this.nativeId ?? this.id,
        deviceLabel: this.name,
        liveStreamUrl,
        durationMs: 30_000,
      });

      await this.orchestrator.handle(event);
    } catch (e) {
      this.console.error('[pip-doorbell] cast dispatch error:', e);
    }
  }
}

// ---------------------------------------------------------------------------
// DoorbellCastController — the visible device in the Scrypted dashboard
// ---------------------------------------------------------------------------

class DoorbellCastController extends ScryptedDeviceBase implements Settings {
  settingsStorage = new StorageSettings(this, {
    chromecastTargets: {
      title: 'Chromecast / Vizio Display Targets',
      description:
        'Comma-separated list of device names to receive the PiP overlay (must be discovered by the Chromecast plugin first).',
      defaultValue: '',
    },
    fireTvHosts: {
      title: 'Fire TV IP Addresses',
      description:
        'Comma-separated list of Fire TV IP addresses to receive the PiP overlay (ADB debugging must be enabled).',
      defaultValue: '',
    },
    pipDurationSeconds: {
      title: 'PiP Duration (seconds)',
      description: 'How long the doorbell overlay stays visible before auto-dismiss.',
      type: 'number',
      defaultValue: 30,
    },
  });

  constructor(private readonly plugin: PipDoorbellCastPlugin) {
    super(CONTROLLER_NATIVE_ID);
  }

  async getSettings(): Promise<Setting[]> {
    return this.settingsStorage.getSettings();
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    await this.settingsStorage.putSetting(key, value);
    this.plugin.rebuildOrchestrator();
  }
}

// ---------------------------------------------------------------------------
// PipDoorbellCastPlugin — provider + mixin provider
// ---------------------------------------------------------------------------

class PipDoorbellCastPlugin
  extends ScryptedDeviceBase
  implements DeviceProvider, MixinProvider, Settings
{
  private orchestrator!: DoorbellCastOrchestrator;
  private controller!: DoorbellCastController;
  private mixins = new Map<string, DoorbellMixin>();

  settingsStorage = new StorageSettings(this, {
    pipDurationSeconds: {
      title: 'Default PiP Duration (seconds)',
      type: 'number',
      defaultValue: 30,
    },
  });

  constructor() {
    super();
    this.init();
  }

  private async init(): Promise<void> {
    const devices: Device[] = [
      {
        nativeId: CONTROLLER_NATIVE_ID,
        name: 'PiP Doorbell Cast Controller',
        type: ScryptedDeviceType.Unknown,
        interfaces: [ScryptedInterface.Settings],
      },
    ];
    await deviceManager.onDevicesChanged({ devices });
    this.controller = new DoorbellCastController(this);
    this.rebuildOrchestrator();
  }

  rebuildOrchestrator(): void {
    const targets = this.buildTargets();
    const durationMs =
      ((this.controller?.settingsStorage.values.pipDurationSeconds as number) ?? 30) * 1000;

    this.orchestrator = new DoorbellCastOrchestrator({
      targets,
      defaultDurationMs: durationMs,
      console: this.console,
      onCastSuccess: (targetId, event) => {
        this.console.log(`[pip-plugin] ✓ cast success → ${targetId} for event ${event.id}`);
      },
      onCastFailure: (targetId, event, err) => {
        this.console.error(
          `[pip-plugin] ✗ cast failure → ${targetId} for event ${event.id}:`,
          err,
        );
      },
    });

    this.console.log(
      `[pip-plugin] orchestrator rebuilt with ${targets.length} target(s)`,
    );
  }

  private buildTargets(): CastTarget[] {
    const targets: CastTarget[] = [];
    const durationMs =
      ((this.controller?.settingsStorage?.values?.pipDurationSeconds as number) ?? 30) * 1000;

    // Chromecast targets — auto-discovered from the Chromecast plugin.
    const configuredLabels = (
      (this.controller?.settingsStorage?.values?.chromecastTargets as string) ?? ''
    )
      .split(',')
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean);

    for (const { id, label, host } of findCastDevices()) {
      if (
        configuredLabels.length === 0 ||
        configuredLabels.includes(label.toLowerCase())
      ) {
        targets.push(new ChromecastPipTarget(id, label, host, this.console));
      }
    }

    // Fire TV targets — manually configured by IP.
    const fireTvHosts = (
      (this.controller?.settingsStorage?.values?.fireTvHosts as string) ?? ''
    )
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    for (const host of fireTvHosts) {
      targets.push(
        new FireTvPipTarget(
          `firetv-${host}`,
          `Fire TV @ ${host}`,
          host,
          this.console,
        ),
      );
    }

    return targets;
  }

  // -------------------------------------------------------------------------
  // DeviceProvider
  // -------------------------------------------------------------------------

  async getDevice(nativeId: string): Promise<any> {
    if (nativeId === CONTROLLER_NATIVE_ID) {
      return this.controller;
    }
    return this.mixins.get(nativeId);
  }

  async releaseDevice(_id: string, _nativeId: string): Promise<void> {}

  // -------------------------------------------------------------------------
  // MixinProvider — attaches to doorbell-capable devices
  // -------------------------------------------------------------------------

  async canMixin(
    type: ScryptedDeviceType,
    interfaces: string[],
  ): Promise<string[] | null> {
    // Only attach to devices that are both a BinarySensor (doorbell) and Camera.
    if (
      interfaces.includes(ScryptedInterface.BinarySensor) &&
      interfaces.includes(ScryptedInterface.Camera)
    ) {
      return [ScryptedInterface.BinarySensor];
    }
    return null;
  }

  async getMixin(
    mixinDevice: ScryptedDevice,
    mixinDeviceInterfaces: ScryptedInterface[],
    mixinDeviceState: WritableDeviceState,
  ): Promise<any> {
    const mixin = new DoorbellMixin(
      mixinDevice as BinarySensor & Camera,
      mixinDeviceInterfaces,
      mixinDeviceState,
      this.nativeId,
      this.orchestrator,
    );
    this.mixins.set(mixinDevice.nativeId, mixin);
    return mixin;
  }

  async releaseMixin(_id: string, _mixinDevice: any): Promise<void> {
    this.mixins.delete(_id);
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  async getSettings(): Promise<Setting[]> {
    return this.settingsStorage.getSettings();
  }

  async putSetting(key: string, value: SettingValue): Promise<void> {
    await this.settingsStorage.putSetting(key, value);
    this.rebuildOrchestrator();
  }
}

export default new PipDoorbellCastPlugin();
