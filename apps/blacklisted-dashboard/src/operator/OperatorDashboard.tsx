import { CommandPanel } from "./CommandPanel";
import { MultiFeedGrid } from "./MultiFeedGrid";
import { TacticalSnapshotPanel } from "./TacticalSnapshotPanel";
import type { C2Action, CommandCenterState } from "./types";

export interface OperatorDashboardProps {
  state: CommandCenterState;
  onFeedCommand: (feedId: string, action: "focus" | "record" | "snapshot") => void;
  onGlobalCommand: (action: C2Action) => void;
}

export function OperatorDashboard(props: OperatorDashboardProps) {
  const { state, onFeedCommand, onGlobalCommand } = props;

  return (
    <main className="operator-shell">
      <header className="operator-header">
        <h1>OVERWATCH Operator Command Center</h1>
        <p>
          {state.operators.length} operators online · {state.activeFeeds.length} feeds active
        </p>
      </header>
      <div className="operator-layout">
        <MultiFeedGrid feeds={state.activeFeeds} onFeedCommand={onFeedCommand} />
        <aside className="operator-sidebar">
          <CommandPanel
            onGlobalCommand={onGlobalCommand}
            disabled={!state.activeFeeds.length}
          />
          <TacticalSnapshotPanel snapshots={state.tacticalSnapshots} />
        </aside>
      </div>
    </main>
  );
}
