export type FeedTransport = "webrtc" | "canvas";

export type FeedHealth = "online" | "degraded" | "offline";

export interface StreamCapabilities {
  supportsWebRTC: boolean;
  supportsCanvas: boolean;
  preferredTransport: FeedTransport;
  targetFps: number;
}

export interface OperatorFeed {
  id: string;
  label: string;
  sourceId: string;
  transport: FeedTransport;
  health: FeedHealth;
  streamUrl?: string;
  codec?: string;
  lastFrameAt?: number;
  capabilities: StreamCapabilities;
}

export type C2Action =
  | "arm"
  | "disarm"
  | "focus"
  | "record"
  | "snapshot"
  | "acknowledge";

export interface C2Command {
  action: C2Action;
  feedId: string;
  issuedAt: number;
  issuedBy: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface TacticalSnapshotClip {
  id: string;
  feedId: string;
  title: string;
  previewUrl: string;
  triggeredAt: number;
  durationMs: number;
}

export interface TacticalSnapshot {
  id: string;
  createdAt: number;
  trigger: C2Action;
  clips: TacticalSnapshotClip[];
}

export interface OperatorPresence {
  id: string;
  username: string;
  role: "operator" | "supervisor";
  lastSeenAt: number;
}

export interface CommandCenterState {
  operators: OperatorPresence[];
  activeFeeds: OperatorFeed[];
  tacticalSnapshots: TacticalSnapshot[];
}
