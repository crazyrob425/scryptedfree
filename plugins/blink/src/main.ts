/**
 * Blink camera provider — Phase 3 scaffold.
 *
 * Implements the shared IngestProvider interface so the recording pipeline
 * can consume Blink streams without knowing Blink-specific APIs.
 *
 * The Blink REST / WebSocket client is intentionally abstracted behind a
 * `BlinkClient` interface so it can be replaced with the upstream
 * `blink-camera-dash` library or a similar package once selected.
 */

import {
  connectWithRetry,
  type IngestConnectionOptions,
  type IngestFrame,
  type IngestProvider,
  type IngestSession,
} from '@scrypted/common/src/ingest';
import sdk, {
  Device,
  DeviceProvider,
  MediaObject,
  Camera,
  PictureOptions,
  RequestPictureOptions,
  ResponseMediaStreamOptions,
  RequestMediaStreamOptions,
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  Setting,
  Settings,
  SettingValue,
} from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';

const { deviceManager, mediaManager } = sdk;

// ---------------------------------------------------------------------------
// Blink client abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal contract for talking to the Blink API.
 * Replace with the real SDK client once integrated.
 */
export interface BlinkClient {
  listCameraIds(): Promise<string[]>;
  /** Return a short-lived RTSP/HLS URL for the given camera. */
  getLiveUrl(cameraId: string): Promise<string>;
  /** Fetch the latest thumbnail JPEG. */
  getThumbnailBuffer(cameraId: string): Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// IngestSession backed by a Blink live view URL
// ---------------------------------------------------------------------------

class BlinkIngestSession implements IngestSession {
  private _stopped = false;
  private readonly _controller = new AbortController();

  constructor(
    private readonly client: BlinkClient,
    private readonly cameraId: string,
    public readonly label: string,
  ) {}

  async stop(): Promise<void> {
    this._stopped = true;
    this._controller.abort();
  }

  async *frames(): AsyncGenerator<IngestFrame> {
    /**
     * In a full implementation this generator would read chunked binary data
     * from the live RTSP/HLS URL and yield each encoded video/audio chunk.
     *
     * For the scaffold we yield a single metadata-only frame so the pipeline
     * can be exercised end-to-end without a live Blink account.
     */
    if (this._stopped) {
      return;
    }

    const liveUrl = await this.client.getLiveUrl(this.cameraId);
    const nowMs = Date.now();

    yield {
      data: Buffer.from(liveUrl), // placeholder — real impl would stream RTSP
      meta: {
        timestampMs: nowMs,
        codec: 'h264',
        keyframe: true,
      },
    };

    // Signal pipeline that the session ended cleanly.
  }
}

// ---------------------------------------------------------------------------
// BlinkIngestProvider
// ---------------------------------------------------------------------------

export class BlinkIngestProvider implements IngestProvider {
  readonly providerId = 'blink';

  constructor(private readonly client: BlinkClient) {}

  async listDeviceIds(): Promise<string[]> {
    return this.client.listCameraIds();
  }

  async openSession(
    deviceId: string,
    _opts?: IngestConnectionOptions,
  ): Promise<IngestSession> {
    return connectWithRetry(
      async () =>
        new BlinkIngestSession(this.client, deviceId, `blink:${deviceId}`),
      { maxAttempts: 5, initialDelayMs: 1_000 },
    );
  }
}

// ---------------------------------------------------------------------------
// Scrypted device for a single Blink camera
// ---------------------------------------------------------------------------

export class BlinkCameraDevice extends ScryptedDeviceBase implements Camera {
  constructor(
    private readonly client: BlinkClient,
    nativeId: string,
  ) {
    super(nativeId);
  }

  async takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
    if (!this.nativeId) {
      throw new Error('BlinkCameraDevice: nativeId is not set');
    }
    const jpeg = await this.client.getThumbnailBuffer(this.nativeId);
    return mediaManager.createMediaObject(jpeg, 'image/jpeg');
  }

  async getPictureOptions(): Promise<PictureOptions[]> {
    return [];
  }

  async getVideoStream(
    options?: RequestMediaStreamOptions,
  ): Promise<MediaObject> {
    if (!this.nativeId) {
      throw new Error('BlinkCameraDevice: nativeId is not set');
    }
    const liveUrl = await this.client.getLiveUrl(this.nativeId);
    return mediaManager.createMediaObject(
      Buffer.from(
        JSON.stringify({ url: liveUrl, container: 'rtsp' }),
      ),
      'x-scrypted/x-media-url',
    );
  }

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    return [
      {
        id: 'blink-live',
        name: 'Blink Live',
        video: { codec: 'h264' },
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

class BlinkPlugin extends ScryptedDeviceBase implements DeviceProvider, Settings {
  private client: BlinkClient | undefined;
  private devices = new Map<string, BlinkCameraDevice>();

  settingsStorage = new StorageSettings(this, {
    email: {
      title: 'Email',
      description: 'Blink account email address.',
      onPut: async () => this.tryDiscover(),
    },
    password: {
      title: 'Password',
      type: 'password',
      description: 'Blink account password.',
      onPut: async () => this.tryDiscover(),
    },
  });

  constructor() {
    super();
    this.tryDiscover().catch(e => this.console.error('Blink discovery failed', e));
  }

  getSettings(): Promise<Setting[]> {
    return this.settingsStorage.getSettings();
  }

  putSetting(key: string, value: SettingValue): Promise<void> {
    return this.settingsStorage.putSetting(key, value);
  }

  private async tryDiscover(): Promise<void> {
    const { email, password } = this.settingsStorage.values as {
      email?: string;
      password?: string;
    };
    if (!email || !password) {
      this.log.a('Enter your Blink email and password to complete setup.');
      return;
    }

    /**
     * Replace the stub below with the real Blink client once the upstream
     * library is selected (e.g. blink-camera-dash or a purpose-built client).
     */
    this.client = new StubBlinkClient(email);
    await this.discoverDevices();
  }

  async discoverDevices(): Promise<void> {
    if (!this.client) {
      return;
    }

    const ids = await this.client.listCameraIds();
    const discovered: Device[] = ids.map(id => ({
      nativeId: id,
      name: `Blink Camera ${id}`,
      type: ScryptedDeviceType.Camera,
      interfaces: [ScryptedInterface.Camera],
    }));

    await deviceManager.onDevicesChanged({ devices: discovered });
    for (const id of ids) {
      this.devices.set(id, new BlinkCameraDevice(this.client!, id));
    }

    this.console.log(`Blink: discovered ${ids.length} camera(s).`);
  }

  async getDevice(nativeId: string): Promise<BlinkCameraDevice | undefined> {
    return this.devices.get(nativeId);
  }

  async releaseDevice(_id: string, _nativeId: string): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Stub client — used before a real Blink library is wired
// ---------------------------------------------------------------------------

class StubBlinkClient implements BlinkClient {
  constructor(private readonly email: string) {}

  async listCameraIds(): Promise<string[]> {
    this.assertCredentials();
    return [];
  }

  async getLiveUrl(cameraId: string): Promise<string> {
    this.assertCredentials();
    return `rtsp://stub-blink-host/${cameraId}`;
  }

  async getThumbnailBuffer(_cameraId: string): Promise<Buffer> {
    this.assertCredentials();
    return Buffer.alloc(0);
  }

  private assertCredentials(): void {
    if (!this.email) {
      throw new Error('Blink credentials not configured.');
    }
  }
}

export default BlinkPlugin;
