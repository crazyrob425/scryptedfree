import { useMemo } from "react";
import type { OperatorFeed } from "./types";

export interface MultiFeedGridProps {
  feeds: OperatorFeed[];
  onFeedCommand: (feedId: string, action: "focus" | "record" | "snapshot") => void;
}

function getGridColumns(feedCount: number): number {
  if (feedCount <= 1) {
    return 1;
  }
  if (feedCount <= 4) {
    return 2;
  }
  if (feedCount <= 9) {
    return 3;
  }
  return 4;
}

function FeedTile(props: {
  feed: OperatorFeed;
  onFeedCommand: MultiFeedGridProps["onFeedCommand"];
}) {
  const { feed, onFeedCommand } = props;
  const statusClass =
    feed.health === "online"
      ? "feed-status--online"
      : feed.health === "degraded"
        ? "feed-status--degraded"
        : "feed-status--offline";

  return (
    <article className="feed-tile" aria-label={`Feed ${feed.label}`}>
      <header className="feed-tile__header">
        <strong>{feed.label}</strong>
        <span className={`feed-status ${statusClass}`}>{feed.health}</span>
      </header>
      <div className="feed-tile__media" data-transport={feed.transport}>
        {feed.transport === "webrtc" ? (
          <video
            autoPlay
            playsInline
            muted
            controls={false}
            src={feed.streamUrl}
            preload="none"
            aria-label={`${feed.label} live stream`}
          />
        ) : (
          <canvas width={640} height={360} />
        )}
      </div>
      <footer className="feed-tile__actions">
        <button type="button" onClick={() => onFeedCommand(feed.id, "focus")}>
          Focus
        </button>
        <button type="button" onClick={() => onFeedCommand(feed.id, "record")}>
          Record
        </button>
        <button type="button" onClick={() => onFeedCommand(feed.id, "snapshot")}>
          Snapshot
        </button>
      </footer>
    </article>
  );
}

export function MultiFeedGrid({ feeds, onFeedCommand }: MultiFeedGridProps) {
  const gridColumns = useMemo(() => getGridColumns(feeds.length), [feeds.length]);

  return (
    <section
      className="multi-feed-grid"
      style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
    >
      {feeds.map((feed) => (
        <FeedTile key={feed.id} feed={feed} onFeedCommand={onFeedCommand} />
      ))}
    </section>
  );
}
