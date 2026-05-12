import type { TacticalSnapshot } from "./types";

export interface TacticalSnapshotPanelProps {
  snapshots: TacticalSnapshot[];
}

export function TacticalSnapshotPanel({ snapshots }: TacticalSnapshotPanelProps) {
  if (!snapshots.length) {
    return (
      <section className="tactical-snapshot">
        <h2>Tactical Snapshot</h2>
        <p>No active tactical snapshots.</p>
      </section>
    );
  }

  return (
    <section className="tactical-snapshot">
      <h2>Tactical Snapshot</h2>
      <div className="snapshot-grid">
        {snapshots.map((snapshot) => (
          <article key={snapshot.id} className="snapshot-card">
            <header>
              <strong>{snapshot.trigger}</strong>
              <span>{new Date(snapshot.createdAt).toLocaleTimeString()}</span>
            </header>
            <div className="snapshot-clips">
              {snapshot.clips.map((clip) => (
                <figure key={clip.id} className="snapshot-clip">
                  <video src={clip.previewUrl} controls preload="none" />
                  <figcaption>
                    {clip.title} · {Math.round(clip.durationMs / 1000)}s
                  </figcaption>
                </figure>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
