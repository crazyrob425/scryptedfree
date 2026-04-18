type WizardStep = "welcome" | "discover" | "configure" | "complete";

type DiscoveryStatus = "pending" | "success" | "failure";

interface DiscoveryResult {
  baseUrl: string;
  endpoint: string;
  status: DiscoveryStatus;
  details: string;
}

interface OnboardingConfig {
  serviceUrl: string;
  authToken: string;
  installMode: "local" | "managed";
}

const DEFAULT_BASE_URLS = [
  "http://127.0.0.1:10443",
  "http://localhost:10443",
  "http://127.0.0.1:11080",
  "http://localhost:11080",
];

const DISCOVERY_ENDPOINTS = [
  "/status",
  "/health",
  "/api/status",
  "/api/config",
];

function getAppContainer(): HTMLElement {
  const container = document.querySelector<HTMLElement>("#app");
  if (!container) {
    throw new Error("App container not found.");
  }

  return container;
}

const app = getAppContainer();

let step: WizardStep = "welcome";
let isDiscovering = false;
let isValidatingConfig = false;
let discoveryResults: DiscoveryResult[] = [];
let selectedBaseUrl = "";
let inlineError = "";

const storedConfig = loadStoredConfig();
const onboardingConfig: OnboardingConfig = {
  serviceUrl: storedConfig?.serviceUrl || "",
  authToken: storedConfig?.authToken || "",
  installMode: storedConfig?.installMode || "local",
};

const year = new Date().getFullYear();

function loadStoredConfig(): OnboardingConfig | undefined {
  try {
    const raw = window.localStorage.getItem("blacklisted-dashboard.onboarding");
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as Partial<OnboardingConfig>;
    if (!parsed.serviceUrl || !parsed.installMode) {
      return;
    }

    return {
      serviceUrl: parsed.serviceUrl,
      authToken: parsed.authToken || "",
      installMode: parsed.installMode === "managed" ? "managed" : "local",
    };
  } catch {
    return;
  }
}

function saveConfig(): void {
  window.localStorage.setItem(
    "blacklisted-dashboard.onboarding",
    JSON.stringify(onboardingConfig),
  );
}

function sanitizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function withSlashPath(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/$/, "")}${endpoint}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchWithTimeout(url: string, timeoutMs = 3000): Promise<Response> {
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(() => abortController.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "GET",
      signal: abortController.signal,
      headers: {
        Accept: "application/json, text/plain;q=0.8, */*;q=0.6",
      },
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function probeSingleBaseUrl(baseUrl: string): Promise<DiscoveryResult> {
  const normalizedBaseUrl = sanitizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return {
      baseUrl,
      endpoint: "",
      status: "failure",
      details: "Invalid URL format",
    };
  }

  for (const endpoint of DISCOVERY_ENDPOINTS) {
    const target = withSlashPath(normalizedBaseUrl, endpoint);

    try {
      const response = await fetchWithTimeout(target);
      if (response.ok) {
        return {
          baseUrl: normalizedBaseUrl,
          endpoint,
          status: "success",
          details: `Reachable (${response.status})`,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          baseUrl: normalizedBaseUrl,
          endpoint,
          status: "success",
          details: `Reachable (auth required: ${response.status})`,
        };
      }
    } catch {
      // continue trying fallback endpoints
    }
  }

  return {
    baseUrl: normalizedBaseUrl,
    endpoint: DISCOVERY_ENDPOINTS[0],
    status: "failure",
    details: "No reachable discovery/config endpoint",
  };
}

function stepNumber(stepName: WizardStep): number {
  if (stepName === "welcome") {
    return 1;
  }
  if (stepName === "discover") {
    return 2;
  }
  if (stepName === "configure") {
    return 3;
  }

  return 4;
}

function sortedCandidateUrls(): string[] {
  const configured = sanitizeBaseUrl(onboardingConfig.serviceUrl);
  const entries = configured
    ? [configured, ...DEFAULT_BASE_URLS]
    : [...DEFAULT_BASE_URLS];

  return [...new Set(entries)];
}

function renderDiscoveryRows(): string {
  if (!discoveryResults.length) {
    return `<li class="result pending">No checks performed yet.</li>`;
  }

  return discoveryResults
    .map((result) => {
      const statusClass =
        result.status === "success"
          ? "success"
          : result.status === "failure"
            ? "failure"
            : "pending";
      const endpointText = result.endpoint ? ` ${result.endpoint}` : "";
      return `<li class="result ${statusClass}"><strong>${escapeHtml(result.baseUrl)}${escapeHtml(endpointText)}</strong><span>${escapeHtml(result.details)}</span></li>`;
    })
    .join("");
}

function render(): void {
  const currentStep = stepNumber(step);
  const progress = `${currentStep}/4`;
  const discoveryRows = renderDiscoveryRows();
  const discoverButton = isDiscovering ? "Discovering..." : "Run local discovery";
  const validateButton = isValidatingConfig
    ? "Validating..."
    : "Validate and continue";

  app.innerHTML = `
    <img class="brand" src="/src/assets/brand-logo.svg" alt="Blacklisted Binary Labs logo" />
    <header class="heading">
      <h1>Windows x64 Native Dashboard</h1>
      <p class="tagline">Onboarding + installation wizard for the Phase 1 shell.</p>
      <p class="step-indicator">Step ${progress}</p>
    </header>

    <section class="wizard-card">
      ${
        step === "welcome"
          ? `
          <h2>Welcome</h2>
          <p>Set up this console to connect with your local Scrypted service and complete the first-run install flow.</p>
          <ul>
            <li>Discover local service endpoints</li>
            <li>Validate discovery/config reachability</li>
            <li>Save connection defaults for future runs</li>
          </ul>
          <button id="start-onboarding" class="primary">Start onboarding</button>
        `
          : ""
      }

      ${
        step === "discover"
          ? `
          <h2>Discover local service</h2>
          <p>Probe known local addresses and discovery/config endpoints.</p>
          <div class="stack">
            <button id="run-discovery" class="primary" ${isDiscovering ? "disabled" : ""}>${discoverButton}</button>
            <ul class="results">${discoveryRows}</ul>
          </div>
          <div class="actions">
            <button id="back-to-welcome">Back</button>
            <button id="continue-to-configure" ${selectedBaseUrl ? "" : "disabled"}>Continue</button>
          </div>
        `
          : ""
      }

      ${
        step === "configure"
          ? `
          <h2>Configure install connection</h2>
          <p>Confirm your local endpoint and optional auth token.</p>
          <form id="config-form" class="stack">
            <label>
              Service URL
              <input type="url" id="service-url" value="${escapeHtml(onboardingConfig.serviceUrl || selectedBaseUrl)}" placeholder="http://127.0.0.1:10443" required />
            </label>
            <label>
              Auth token (optional)
              <input type="password" id="auth-token" value="${escapeHtml(onboardingConfig.authToken)}" placeholder="Paste token" />
            </label>
            <fieldset>
              <legend>Install mode</legend>
              <label><input type="radio" name="install-mode" value="local" ${onboardingConfig.installMode === "local" ? "checked" : ""} /> Local</label>
              <label><input type="radio" name="install-mode" value="managed" ${onboardingConfig.installMode === "managed" ? "checked" : ""} /> Managed</label>
            </fieldset>
            ${inlineError ? `<p class="error">${escapeHtml(inlineError)}</p>` : ""}
            <div class="actions">
              <button type="button" id="back-to-discovery">Back</button>
              <button type="submit" class="primary" ${isValidatingConfig ? "disabled" : ""}>${validateButton}</button>
            </div>
          </form>
        `
          : ""
      }

      ${
        step === "complete"
          ? `
          <h2>Setup complete</h2>
          <p>Your onboarding profile was saved.</p>
          <dl class="summary">
            <div><dt>Service URL</dt><dd>${escapeHtml(onboardingConfig.serviceUrl)}</dd></div>
            <div><dt>Install mode</dt><dd>${escapeHtml(onboardingConfig.installMode)}</dd></div>
            <div><dt>Discovery status</dt><dd>${selectedBaseUrl ? "Verified" : "Manual"}</dd></div>
          </dl>
          <div class="actions">
            <button id="restart-wizard">Run setup again</button>
          </div>
        `
          : ""
      }
    </section>

    <footer>© ${year} Blacklisted Binary Labs</footer>
  `;

  bindHandlers();
}

function bindHandlers(): void {
  const start = document.querySelector<HTMLButtonElement>("#start-onboarding");
  if (start) {
    start.addEventListener("click", () => {
      step = "discover";
      inlineError = "";
      render();
    });
  }

  const runDiscovery = document.querySelector<HTMLButtonElement>("#run-discovery");
  if (runDiscovery) {
    runDiscovery.addEventListener("click", async () => {
      isDiscovering = true;
      selectedBaseUrl = "";
      discoveryResults = [];
      render();

      const candidates = sortedCandidateUrls();
      for (const baseUrl of candidates) {
        const result = await probeSingleBaseUrl(baseUrl);
        discoveryResults = [...discoveryResults, result];
        if (!selectedBaseUrl && result.status === "success") {
          selectedBaseUrl = result.baseUrl;
          onboardingConfig.serviceUrl = result.baseUrl;
        }
        render();
      }

      isDiscovering = false;
      render();
    });
  }

  const continueToConfigure = document.querySelector<HTMLButtonElement>(
    "#continue-to-configure",
  );
  if (continueToConfigure) {
    continueToConfigure.addEventListener("click", () => {
      step = "configure";
      inlineError = "";
      render();
    });
  }

  const backToWelcome = document.querySelector<HTMLButtonElement>("#back-to-welcome");
  if (backToWelcome) {
    backToWelcome.addEventListener("click", () => {
      step = "welcome";
      render();
    });
  }

  const backToDiscovery = document.querySelector<HTMLButtonElement>("#back-to-discovery");
  if (backToDiscovery) {
    backToDiscovery.addEventListener("click", () => {
      step = "discover";
      inlineError = "";
      render();
    });
  }

  const configForm = document.querySelector<HTMLFormElement>("#config-form");
  if (configForm) {
    configForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const urlInput = document.querySelector<HTMLInputElement>("#service-url");
      const authInput = document.querySelector<HTMLInputElement>("#auth-token");
      const selectedMode = document.querySelector<HTMLInputElement>(
        "input[name='install-mode']:checked",
      );

      const serviceUrl = sanitizeBaseUrl(urlInput?.value || "");
      if (!serviceUrl) {
        inlineError = "Enter a valid service URL.";
        render();
        return;
      }

      onboardingConfig.serviceUrl = serviceUrl;
      onboardingConfig.authToken = authInput?.value || "";
      onboardingConfig.installMode = selectedMode?.value === "managed" ? "managed" : "local";

      isValidatingConfig = true;
      inlineError = "";
      render();

      const validation = await probeSingleBaseUrl(serviceUrl);
      isValidatingConfig = false;

      if (validation.status !== "success") {
        inlineError = "Unable to validate service endpoint. Check URL or service status.";
        render();
        return;
      }

      selectedBaseUrl = serviceUrl;
      saveConfig();
      step = "complete";
      render();
    });
  }

  const restartWizard = document.querySelector<HTMLButtonElement>("#restart-wizard");
  if (restartWizard) {
    restartWizard.addEventListener("click", () => {
      discoveryResults = [];
      selectedBaseUrl = onboardingConfig.serviceUrl;
      inlineError = "";
      step = "welcome";
      render();
    });
  }
}

render();
