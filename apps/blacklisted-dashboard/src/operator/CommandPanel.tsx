import type { C2Action } from "./types";

const COMMANDS: C2Action[] = ["arm", "disarm", "acknowledge"];

export interface CommandPanelProps {
  onGlobalCommand: (action: C2Action) => void;
}

export function CommandPanel({ onGlobalCommand }: CommandPanelProps) {
  return (
    <section className="command-panel">
      <h2>Command &amp; Control</h2>
      <div className="command-list">
        {COMMANDS.map((action) => (
          <button key={action} type="button" onClick={() => onGlobalCommand(action)}>
            {action}
          </button>
        ))}
      </div>
    </section>
  );
}
