import type { C2Action } from "./types";

const COMMANDS: C2Action[] = ["arm", "disarm", "acknowledge"];
const COMMAND_LABELS: Record<C2Action, string> = {
  arm: "Arm System",
  disarm: "Disarm System",
  acknowledge: "Acknowledge Alert",
  focus: "Focus Feed",
  record: "Record Feed",
  snapshot: "Capture Snapshot",
};

export interface CommandPanelProps {
  onGlobalCommand: (action: C2Action) => void;
  disabled?: boolean;
}

export function CommandPanel({ onGlobalCommand, disabled }: CommandPanelProps) {
  return (
    <section className="command-panel">
      <h2>Command &amp; Control</h2>
      <div className="command-list">
        {COMMANDS.map((action) => (
          <button
            key={action}
            type="button"
            disabled={disabled}
            onClick={() => onGlobalCommand(action)}
          >
            {COMMAND_LABELS[action]}
          </button>
        ))}
      </div>
    </section>
  );
}
