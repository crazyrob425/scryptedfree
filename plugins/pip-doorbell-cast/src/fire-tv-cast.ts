/**
 * Fire TV PiP Cast Adapter
 *
 * Delivers a live doorbell video stream as a Picture-in-Picture overlay on
 * Amazon Fire TV sticks, Fire TV Cubes, and Fire TV Edition smart TVs.
 *
 * Architecture:
 * ─────────────
 * Fire TV devices expose an ADB (Android Debug Bridge) interface on port 5555.
 * We use the `adbkit` npm package (no native binaries needed — pure JS) to:
 *
 *   1. Connect to the device over TCP/IP ADB.
 *   2. Launch a broadcast Intent that wakes the "Amazon Video" activity and
 *      passes the doorbell stream URL via an extras bundle.
 *   3. Alternatively, launch the pre-installed "Screen PiP" feature via the
 *      documented Fire TV broadcast `com.amazon.pip.START_PIP`.
 *   4. Dismiss via `com.amazon.pip.STOP_PIP`.
 *
 * Notes on `adbkit`:
 *   - npm: https://www.npmjs.com/package/adbkit  (MIT, ~3.2k stars)
 *   - Pure-JS ADB client; no system `adb` binary required.
 *   - Supports TCP connections directly (no USB).
 *   - Works with Fire TV ADB-over-network (Settings → My Fire TV → Developer
 *     Options → ADB Debugging ON, Network Debugging ON).
 *
 * Overlay strategy:
 *   Fire TV OS 7+ includes Amazon's Picture-in-Picture manager accessible via
 *   broadcast. For older firmware we fall back to launching ExoPlayer via an
 *   implicit video Intent (plays full-screen briefly then returns to home).
 *
 * Security:
 *   ADB connections on Fire TV are LAN-only. The IP is stored in Scrypted's
 *   device storage; no credentials are persisted beyond the device pairing
 *   step which is done once in the plugin settings UI.
 */

import type { CastTarget } from '@scrypted/common/src/doorbell-cast';

// ---------------------------------------------------------------------------
// ADB intent constants for Fire TV PiP
// ---------------------------------------------------------------------------

const INTENT_START_PIP = 'com.amazon.pip.BROADCAST_START_PIP';
const INTENT_STOP_PIP  = 'com.amazon.pip.BROADCAST_STOP_PIP';
const INTENT_VIDEO     = 'android.intent.action.VIEW';

// ---------------------------------------------------------------------------
// Lightweight ADB shell helper
// ---------------------------------------------------------------------------

async function adbShell(adbClient: any, deviceId: string, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    adbClient.shell(deviceId, cmd, (err: Error, output: any) => {
      if (err) return reject(err);
      let result = '';
      output.on('data', (d: Buffer) => { result += d.toString(); });
      output.on('end', () => resolve(result.trim()));
      output.on('error', reject);
    });
  });
}

// ---------------------------------------------------------------------------
// FireTvPipTarget
// ---------------------------------------------------------------------------

export class FireTvPipTarget implements CastTarget {
  readonly family = 'firetv' as const;

  // adbkit client and device handle, lazily created.
  private adbClient: any;
  private deviceHandle: string | undefined;
  private pipActive = false;

  /**
   * @param id      Stable target ID (used as the ADB device serial).
   * @param label   Human-readable name, e.g. "Living Room Fire TV".
   * @param host    IP address of the Fire TV (ADB over TCP, port 5555).
   * @param console Logger.
   */
  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly host: string,
    private readonly console: Console,
  ) {}

  async showPip(
    liveStreamUrl: string,
    title: string,
    durationMs: number,
  ): Promise<void> {
    const client = await this.getAdbClient();
    const device = await this.getDevice(client);

    // Try the native PiP broadcast first (Fire TV OS 7+).
    // Extras: --es url <stream> --ei duration <ms> --es title <title>
    const startPipIntent =
      `am broadcast -a ${INTENT_START_PIP}` +
      ` --es url "${liveStreamUrl}"` +
      ` --ei durationMs ${durationMs}` +
      ` --es title "${escapeShell(title)}"`;

    let output: string;
    try {
      output = await adbShell(client, device, startPipIntent);
      this.console.log(`[firetv-pip] "${this.label}" PiP broadcast result: ${output}`);
      this.pipActive = true;
    } catch (e) {
      this.console.warn(`[firetv-pip] PiP broadcast failed on "${this.label}", falling back to video intent:`, e);
      // Fallback: open the stream URL with the default video player.
      const videoIntent =
        `am start -a ${INTENT_VIDEO} -d "${liveStreamUrl}"` +
        ` -t "video/*" --ez pip true`;
      output = await adbShell(client, device, videoIntent);
      this.console.log(`[firetv-pip] "${this.label}" video intent result: ${output}`);
      this.pipActive = true;
    }
  }

  async dismissPip(): Promise<void> {
    if (!this.pipActive) return;
    try {
      const client = await this.getAdbClient();
      const device = await this.getDevice(client);
      await adbShell(client, device, `am broadcast -a ${INTENT_STOP_PIP}`);
      this.pipActive = false;
      this.console.log(`[firetv-pip] "${this.label}" PiP dismissed`);
    } catch (e) {
      this.console.warn(`[firetv-pip] dismissPip error on "${this.label}":`, e);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async getAdbClient(): Promise<any> {
    if (!this.adbClient) {
      // Dynamic import so the plugin can load even if adbkit is not installed.
      const adbkit = await import('adbkit');
      this.adbClient = adbkit.createClient();
    }
    return this.adbClient;
  }

  private async getDevice(client: any): Promise<string> {
    if (this.deviceHandle) return this.deviceHandle;

    // Connect via TCP (ADB over WiFi).
    await new Promise<void>((resolve, reject) => {
      client.connect(this.host, 5555, (err: Error) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const deviceSerial = `${this.host}:5555`;
    this.deviceHandle = deviceSerial;
    this.console.log(`[firetv-pip] ADB connected to "${this.label}" at ${deviceSerial}`);
    return deviceSerial;
  }
}

// ---------------------------------------------------------------------------
// Shell string escaping
// ---------------------------------------------------------------------------

function escapeShell(s: string): string {
  // Replace characters that could break the shell command.
  return s.replace(/["\\$`]/g, '\\$&');
}
