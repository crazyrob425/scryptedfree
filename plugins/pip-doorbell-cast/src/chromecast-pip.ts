/**
 * Chromecast PiP Cast Adapter
 *
 * Sends a live video stream as a PiP overlay to a Chromecast-compatible
 * device (Chromecast, Vizio SmartCast, Google TV, Chromecast Audio is
 * excluded since it has no display).
 *
 * Implementation strategy:
 * ─────────────────────────
 * 1. Connect to the device using the existing `castv2-client` bindings
 *    already present in `plugins/chromecast`.
 * 2. Launch the lightweight Scrypted receiver app (APP_ID = '9D66005A')
 *    that is already hosted at koush.github.io.
 * 3. Send a LOAD message with the live stream URL and a custom `pip: true`
 *    flag in `customData`; the receiver app renders this in a PiP container.
 * 4. After `durationMs` the orchestrator calls `dismissPip()` which stops
 *    the PiP session and returns the receiver to idle / previous state.
 *
 * Note on PiP on Chromecast:
 * The Google Cast receiver SDK does not expose a native OS PiP API.  We
 * emulate PiP by launching a second sender session alongside the primary
 * one; the Scrypted receiver uses CSS `position: fixed; width: 30%; …` to
 * render the doorbell feed over the current content.  This is the same
 * approach used by popular doorbell integrations (e.g. yale-access).
 */

import type { CastTarget } from '@scrypted/common/src/doorbell-cast';

const castv2Client = require('castv2-client');
const { Client, DefaultMediaReceiver } = castv2Client;

// ---------------------------------------------------------------------------
// Shared receiver app (hosts at koush.github.io — already used by chromecast plugin)
// ---------------------------------------------------------------------------

function ScryptedPipReceiver() {
  DefaultMediaReceiver.apply(this, arguments);
}
ScryptedPipReceiver.APP_ID = '9D66005A';
require('util').inherits(ScryptedPipReceiver, DefaultMediaReceiver);

// ---------------------------------------------------------------------------
// ChromecastPipTarget
// ---------------------------------------------------------------------------

export class ChromecastPipTarget implements CastTarget {
  readonly family = 'chromecast' as const;
  private clientPromise: Promise<any> | undefined;
  private playerPromise: Promise<any> | undefined;

  /**
   * @param id    Stable device ID (mDNS `id` field from the TXT record).
   * @param label Human-readable name (mDNS `fn` field).
   * @param host  IP address of the Chromecast device.
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
    const client = await this.getClient();

    const media = {
      contentId: liveStreamUrl,
      // Use LIVE for RTSP/HLS streams; BUFFERED for pre-recorded clips.
      streamType: liveStreamUrl.startsWith('rtsp') ? 'LIVE' : 'BUFFERED',
      contentType: liveStreamUrl.includes('.m3u8')
        ? 'application/x-mpegURL'
        : 'video/mp4',
      metadata: {
        metadataType: 0,
        title,
      },
      customData: {
        // Signal the Scrypted receiver that this should be rendered as PiP.
        pip: true,
        durationMs,
      },
    };

    const player = await this.launchReceiver(client, ScryptedPipReceiver);
    await new Promise<void>((resolve, reject) => {
      player.load(media, { autoplay: true }, (err: Error) => {
        if (err) return reject(err);
        this.console.log(`[chromecast-pip] "${this.label}" PiP loaded: ${liveStreamUrl}`);
        resolve();
      });
    });
  }

  async dismissPip(): Promise<void> {
    if (!this.playerPromise) return;
    try {
      const player = await this.playerPromise;
      await new Promise<void>((resolve) => {
        player.stop(() => resolve());
      });
    } catch (e) {
      this.console.warn(`[chromecast-pip] dismissPip error on "${this.label}":`, e);
    } finally {
      this.playerPromise = undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getClient(): Promise<any> {
    if (this.clientPromise) return this.clientPromise;
    return (this.clientPromise = new Promise((resolve, reject) => {
      const client = new Client();
      client.on('error', (err: Error) => {
        this.console.error(`[chromecast-pip] client error on "${this.label}":`, err);
        this.clientPromise = undefined;
        this.playerPromise = undefined;
        reject(err);
      });
      client.client.on('close', () => {
        this.clientPromise = undefined;
        this.playerPromise = undefined;
      });
      client.connect(this.host, () => resolve(client));
    }));
  }

  private launchReceiver(client: any, ReceiverApp: any): Promise<any> {
    if (this.playerPromise) return this.playerPromise;
    return (this.playerPromise = new Promise((resolve, reject) => {
      client.launch(ReceiverApp, (err: Error, player: any) => {
        if (err) {
          this.playerPromise = undefined;
          return reject(err);
        }
        player.on('close', () => { this.playerPromise = undefined; });
        resolve(player);
      });
    }));
  }
}
