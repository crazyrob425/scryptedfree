import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { OperatorDashboard } from "./operator/OperatorDashboard";
import type { C2Action, CommandCenterState } from "./operator/types";

import "./styles.css";

const FALLBACK_STATE: CommandCenterState = {
  operators: [
    {
      id: "operator-local",
      username: "local-operator",
      role: "operator",
      lastSeenAt: Date.now(),
    },
  ],
  activeFeeds: [],
  tacticalSnapshots: [],
};

async function fetchState(): Promise<CommandCenterState> {
  const response = await fetch("/web/component/c2/state", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch C2 state (${response.status})`);
  }
  return (await response.json()) as CommandCenterState;
}

async function postCommand(action: C2Action, feedId: string): Promise<void> {
  const response = await fetch("/web/component/c2/trigger", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      feedId,
      metadata: {
        source: "operator-dashboard",
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Command failed (${response.status})`);
  }
}

function App() {
  const [state, setState] = useState<CommandCenterState>(FALLBACK_STATE);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        const latest = await fetchState();
        if (mounted) {
          setState(latest);
          setError("");
        }
      } catch (e) {
        if (mounted && e instanceof Error) {
          setError(e.message);
        }
      }
    };

    refresh();
    const timer = window.setInterval(refresh, 2000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const firstFeedId = useMemo(() => state.activeFeeds[0]?.id, [state.activeFeeds]);

  const handleGlobalCommand = async (action: C2Action) => {
    if (!firstFeedId) {
      return;
    }
    try {
      await postCommand(action, firstFeedId);
      setError("");
    } catch (e) {
      if (e instanceof Error) {
        setError(e.message);
      }
    }
  };

  const handleFeedCommand = async (
    feedId: string,
    action: "focus" | "record" | "snapshot",
  ) => {
    try {
      await postCommand(action, feedId);
      setError("");
    } catch (e) {
      if (e instanceof Error) {
        setError(e.message);
      }
    }
  };

  return (
    <>
      {error ? <p className="operator-error">{error}</p> : null}
      <OperatorDashboard
        state={state}
        onGlobalCommand={handleGlobalCommand}
        onFeedCommand={handleFeedCommand}
      />
    </>
  );
}

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("App container not found.");
}

createRoot(app).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
