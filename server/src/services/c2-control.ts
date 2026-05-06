import crypto from 'crypto';

export const C2_ACTIONS = ['arm', 'disarm', 'focus', 'record', 'snapshot', 'acknowledge'] as const;
export type C2Action =
    (typeof C2_ACTIONS)[number];

export interface C2Trigger {
    id: string;
    feedId: string;
    action: C2Action;
    issuedAt: number;
    issuedBy: string;
    metadata?: Record<string, string | number | boolean>;
}

export interface C2Operator {
    id: string;
    username: string;
    role: 'operator' | 'supervisor';
    lastSeenAt: number;
}

export interface C2StreamFeed {
    id: string;
    label: string;
    transport: 'webrtc' | 'canvas';
    streamUrl?: string;
    health: 'online' | 'degraded' | 'offline';
}

export interface C2SnapshotClip {
    id: string;
    feedId: string;
    title: string;
    previewUrl: string;
    durationMs: number;
    triggeredAt: number;
}

export interface C2Snapshot {
    id: string;
    trigger: C2Action;
    createdAt: number;
    clips: C2SnapshotClip[];
}

export interface C2State {
    operators: C2Operator[];
    activeFeeds: C2StreamFeed[];
    tacticalSnapshots: C2Snapshot[];
    recentTriggers: C2Trigger[];
}

const MAX_RECENT_TRIGGERS = 100;
const MAX_TACTICAL_SNAPSHOTS = 20;

function generatePrefixedId(prefix: string) {
    return `${prefix}-${crypto.randomUUID()}`;
}

export class C2Control {
    private operators = new Map<string, C2Operator>();
    private feeds = new Map<string, C2StreamFeed>();
    private tacticalSnapshots: C2Snapshot[] = [];
    private recentTriggers: C2Trigger[] = [];

    constructor() {
        this.feeds.set('feed-front-gate', {
            id: 'feed-front-gate',
            label: 'Front Gate',
            transport: 'webrtc',
            streamUrl: '/samples/front-gate.m3u8',
            health: 'online',
        });
        this.feeds.set('feed-loading-bay', {
            id: 'feed-loading-bay',
            label: 'Loading Bay',
            transport: 'canvas',
            health: 'degraded',
        });
    }

    async getState(): Promise<C2State> {
        return {
            operators: [...this.operators.values()],
            activeFeeds: [...this.feeds.values()],
            tacticalSnapshots: this.tacticalSnapshots,
            recentTriggers: this.recentTriggers,
        };
    }

    async markOperatorPresence(username: string, role: 'operator' | 'supervisor' = 'operator') {
        const operator: C2Operator = {
            id: username,
            username,
            role,
            lastSeenAt: Date.now(),
        };
        this.operators.set(username, operator);
        return operator;
    }

    async setFeed(feed: C2StreamFeed) {
        this.feeds.set(feed.id, feed);
        return feed;
    }

    async triggerAction(options: {
        feedId: string;
        action: C2Action;
        issuedBy: string;
        metadata?: Record<string, string | number | boolean>;
    }) {
        const trigger: C2Trigger = {
            id: generatePrefixedId('trigger'),
            feedId: options.feedId,
            action: options.action,
            issuedAt: Date.now(),
            issuedBy: options.issuedBy,
            metadata: options.metadata,
        };
        this.recentTriggers = [trigger, ...this.recentTriggers].slice(0, MAX_RECENT_TRIGGERS);

        if (options.action === 'snapshot') {
            const feed = this.feeds.get(options.feedId);
            const clips: C2SnapshotClip[] = [];
            if (feed) {
                clips.push({
                    id: generatePrefixedId('clip'),
                    feedId: feed.id,
                    title: feed.label,
                    previewUrl: feed.streamUrl || '',
                    durationMs: 15000,
                    triggeredAt: trigger.issuedAt,
                });
            }
            const snapshot: C2Snapshot = {
                id: generatePrefixedId('snapshot'),
                trigger: options.action,
                createdAt: Date.now(),
                clips,
            };
            this.tacticalSnapshots = [snapshot, ...this.tacticalSnapshots].slice(0, MAX_TACTICAL_SNAPSHOTS);
            return { trigger, snapshot };
        }

        return { trigger };
    }
}
