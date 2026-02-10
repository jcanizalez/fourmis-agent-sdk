# Authentication System: fourmis-agents

Inspired by OpenCode's multi-provider auth pattern. Supports env vars, stored API keys, OAuth flows, and plugin-based auth.

---

## Design Principles

1. **Zero config for simple cases** — set `OPENAI_API_KEY` env var, it just works
2. **Auth fallback chain** — env var → stored credentials → plugin OAuth → config file
3. **OAuth for subscription services** — ChatGPT Pro, GitHub Copilot, Claude Max
4. **Pluggable** — anyone can add auth for a new provider via plugins
5. **Secure storage** — credentials stored in XDG data dir, not in project files

---

## Auth Resolution Chain

When `query()` is called with a provider, the auth system resolves credentials in this order:

```
1. Explicit apiKey in QueryOptions     →  highest priority, used as-is
2. Environment variable                →  ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
3. Stored credentials (auth.json)      →  ~/.local/share/fourmis-agents/auth.json
4. Plugin auth loader                  →  OAuth flows (Codex, Copilot, Claude Max)
5. Config file                         →  ~/.config/fourmis-agents/config.json
6. Provider-specific fallback          →  e.g., public key for free tiers
```

```ts
// Example: explicit key (priority 1)
query({ prompt: "...", options: { provider: "openai", apiKey: "sk-..." } });

// Example: env var (priority 2) — just works
// OPENAI_API_KEY=sk-... in environment
query({ prompt: "...", options: { provider: "openai", model: "gpt-5.2" } });

// Example: stored via CLI (priority 3)
// $ fourmis-agents auth login openai
query({ prompt: "...", options: { provider: "openai" } });

// Example: OAuth plugin (priority 4)
// $ fourmis-agents auth login openai --oauth
query({ prompt: "...", options: { provider: "openai" } });
```

---

## Provider Env Var Registry

Each provider defines which env vars to check:

```ts
const PROVIDER_ENV_VARS: Record<string, string[]> = {
  anthropic:          ["ANTHROPIC_API_KEY"],
  openai:             ["OPENAI_API_KEY"],
  google:             ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  xai:                ["XAI_API_KEY"],
  mistral:            ["MISTRAL_API_KEY"],
  groq:               ["GROQ_API_KEY"],
  deepinfra:          ["DEEPINFRA_API_KEY"],
  cerebras:           ["CEREBRAS_API_KEY"],
  cohere:             ["COHERE_API_KEY", "CO_API_KEY"],
  togetherai:         ["TOGETHER_AI_API_KEY", "TOGETHER_API_KEY"],
  perplexity:         ["PERPLEXITY_API_KEY"],
  openrouter:         ["OPENROUTER_API_KEY"],
  fireworks:          ["FIREWORKS_API_KEY"],

  // Complex auth (env var is just one path)
  "amazon-bedrock":   ["AWS_ACCESS_KEY_ID", "AWS_BEARER_TOKEN_BEDROCK"],
  "google-vertex":    ["GOOGLE_CLOUD_PROJECT", "GCP_PROJECT"],
  azure:              ["AZURE_API_KEY", "AZURE_OPENAI_API_KEY"],
  "github-copilot":   ["GITHUB_TOKEN"],
  gitlab:             ["GITLAB_TOKEN"],

  // Local (no auth needed)
  ollama:             [],
};
```

---

## Credential Storage

### File: `~/.local/share/fourmis-agents/auth.json`

```json
{
  "anthropic": {
    "type": "api",
    "key": "sk-ant-..."
  },
  "openai": {
    "type": "oauth",
    "accessToken": "eyJ...",
    "refreshToken": "rt-...",
    "expiresAt": "2026-03-01T00:00:00Z",
    "source": "codex"
  },
  "github-copilot": {
    "type": "oauth",
    "accessToken": "gho_...",
    "refreshToken": "ghr_...",
    "expiresAt": "2026-02-15T00:00:00Z",
    "source": "copilot"
  }
}
```

### Credential Types

```ts
type StoredCredential =
  | { type: "api"; key: string }
  | { type: "oauth"; accessToken: string; refreshToken: string; expiresAt: string; source: string }
  | { type: "custom"; data: Record<string, unknown>; source: string };
```

### Auth Namespace API

```ts
namespace Auth {
  // Read
  function get(provider: string): StoredCredential | undefined;
  function all(): Record<string, StoredCredential>;

  // Write
  function set(provider: string, credential: StoredCredential): void;
  function remove(provider: string): void;

  // OAuth helpers
  function isExpired(credential: StoredCredential): boolean;
  function refresh(provider: string): Promise<StoredCredential>;
}
```

---

## OAuth Flows

### Pattern: Plugin-based OAuth

Plugins can register auth loaders for providers that support OAuth (subscription services):

```ts
interface AuthPlugin {
  provider: string;                    // Provider ID this plugin handles
  name: string;                        // Display name
  methods: AuthMethod[];               // Available auth methods
}

type AuthMethod =
  | { type: "api_key"; prompt: string }                    // Manual API key entry
  | { type: "oauth_browser"; config: OAuthBrowserConfig }  // Browser redirect
  | { type: "oauth_device"; config: OAuthDeviceConfig };   // Device code flow

type OAuthBrowserConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string[];
  callbackPort: number;               // localhost callback port
  usePKCE: boolean;
};

type OAuthDeviceConfig = {
  deviceCodeUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string[];
  pollInterval: number;               // seconds between polls
};
```

### Built-in OAuth Plugins

#### OpenAI Codex (ChatGPT Pro/Plus)
```ts
const codexAuth: AuthPlugin = {
  provider: "openai",
  name: "ChatGPT Pro/Plus (OAuth)",
  methods: [
    {
      type: "oauth_browser",
      config: {
        authorizationUrl: "https://auth.openai.com/authorize",
        tokenUrl: "https://auth.openai.com/oauth/token",
        clientId: "...",
        scopes: ["openid", "profile", "email", "offline_access"],
        callbackPort: 1455,
        usePKCE: true,
      },
    },
    {
      type: "oauth_device",
      config: {
        deviceCodeUrl: "https://auth.openai.com/oauth/device/code",
        tokenUrl: "https://auth.openai.com/oauth/token",
        clientId: "...",
        scopes: ["openid", "profile", "email", "offline_access"],
        pollInterval: 5,
      },
    },
    { type: "api_key", prompt: "Enter your OpenAI API key:" },
  ],
};
```

#### GitHub Copilot
```ts
const copilotAuth: AuthPlugin = {
  provider: "github-copilot",
  name: "GitHub Copilot",
  methods: [
    {
      type: "oauth_device",
      config: {
        deviceCodeUrl: "https://github.com/login/device/code",
        tokenUrl: "https://github.com/login/oauth/access_token",
        clientId: "Ov23li8tweQw6odWQebz",
        scopes: ["read:user"],
        pollInterval: 5,
      },
    },
  ],
};
```

---

## Provider Configuration File

### File: `~/.config/fourmis-agents/config.json`

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-...",
      "baseUrl": "https://api.openai.com/v1"
    },
    "my-custom-llm": {
      "npm": "@ai-sdk/openai-compatible",
      "apiKey": "...",
      "baseUrl": "https://my-llm.example.com/v1",
      "env": ["MY_LLM_API_KEY"],
      "models": {
        "my-model-v1": {
          "contextWindow": 128000,
          "maxOutputTokens": 8192,
          "pricing": { "inputPerMillion": 1.0, "outputPerMillion": 3.0 }
        }
      }
    }
  }
}
```

---

## Models Database (models.dev pattern)

Like OpenCode, we can optionally fetch a model catalog from an external API:

```ts
namespace ModelDB {
  // Fetch latest model database (cached hourly)
  async function load(): Promise<ModelDatabase>;

  // Get provider info
  function getProvider(id: string): ProviderInfo | undefined;

  // Get model info (for cost calculation, context windows)
  function getModel(providerId: string, modelId: string): ModelInfo | undefined;
}

type ModelDatabase = {
  providers: Record<string, {
    id: string;
    name: string;
    env: string[];         // Env var names for API key
    api: string;           // Base API URL
    models: Record<string, {
      name: string;
      contextWindow: number;
      maxOutputTokens: number;
      pricing: { inputPerMillion: number; outputPerMillion: number };
      capabilities: string[];  // "thinking", "tool_calling", "vision", etc.
    }>;
  }>;
};
```

This lets us:
- Auto-detect available providers by scanning env vars against the database
- Calculate costs accurately with up-to-date pricing
- Know context windows for compaction thresholds
- Know model capabilities for feature gating

---

## Provider State Resolution

At startup (or lazily on first `query()`), build the full provider state:

```ts
async function resolveProviders(): Promise<ProviderState> {
  // 1. Load model database (from cache or remote)
  const db = await ModelDB.load();

  // 2. Load stored credentials
  const stored = Auth.all();

  // 3. Load config file overrides
  const config = await loadConfig();

  // 4. Load auth plugins
  const plugins = await loadAuthPlugins();

  // 5. For each known provider, resolve auth
  const providers: Record<string, ResolvedProvider> = {};

  for (const [id, info] of Object.entries(db.providers)) {
    const auth = resolveAuth(id, info, stored, config, plugins);
    if (auth) {
      providers[id] = {
        ...info,
        auth,
        models: filterModels(info.models, config.providers?.[id]),
      };
    }
  }

  // 6. Add custom providers from config
  for (const [id, custom] of Object.entries(config.providers ?? {})) {
    if (!providers[id]) {
      const auth = resolveAuth(id, custom, stored, config, plugins);
      if (auth) providers[id] = { ...custom, auth };
    }
  }

  return { providers };
}

function resolveAuth(
  id: string,
  info: ProviderInfo,
  stored: Record<string, StoredCredential>,
  config: Config,
  plugins: AuthPlugin[],
): ResolvedAuth | null {
  // Priority 1: Environment variable
  for (const envVar of info.env ?? PROVIDER_ENV_VARS[id] ?? []) {
    const value = process.env[envVar];
    if (value) return { source: "env", key: value, envVar };
  }

  // Priority 2: Stored credential
  const cred = stored[id];
  if (cred) {
    if (cred.type === "api") return { source: "stored", key: cred.key };
    if (cred.type === "oauth") {
      if (Auth.isExpired(cred)) {
        // Will refresh on first use
        return { source: "oauth", credential: cred, needsRefresh: true };
      }
      return { source: "oauth", credential: cred };
    }
  }

  // Priority 3: Plugin
  const plugin = plugins.find(p => p.provider === id);
  if (plugin) return { source: "plugin", plugin };

  // Priority 4: Config file
  const configKey = config.providers?.[id]?.apiKey;
  if (configKey) return { source: "config", key: configKey };

  // No auth found
  return null;
}
```

---

## CLI Auth Commands

```bash
# List all providers and their auth status
fourmis-agents auth status

# Login to a provider (interactive)
fourmis-agents auth login openai

# Login with specific method
fourmis-agents auth login openai --method api-key
fourmis-agents auth login openai --method oauth
fourmis-agents auth login github-copilot  # always device flow

# Remove stored credentials
fourmis-agents auth logout openai

# Show which env vars are set
fourmis-agents auth env
```

### Auth Status Output

```
Provider          Status      Source         Model Count
──────────────────────────────────────────────────────────
anthropic         ✅ Ready    env var        12 models
openai            ✅ Ready    oauth (codex)   8 models
google            ❌ No auth  —               0 models
github-copilot    ✅ Ready    oauth           6 models
ollama            ✅ Ready    (no auth)       3 models (local)
openrouter        ❌ No auth  —               0 models
```

---

## Provider-Specific Auth Customization

Some providers need special handling beyond a simple API key:

### Amazon Bedrock
```ts
// AWS credential chain: env vars → profile → IAM role → EKS IRSA
const bedrockAuth: CustomAuthLoader = {
  provider: "amazon-bedrock",
  async resolve() {
    // Check bearer token first
    const bearer = process.env.AWS_BEARER_TOKEN_BEDROCK;
    if (bearer) return { source: "env", key: bearer, type: "bearer" };

    // Try AWS credential chain
    const { fromNodeProviderChain } = await import("@aws-sdk/credential-providers");
    const credentials = await fromNodeProviderChain()();
    return { source: "aws-chain", credentials };
  },
};
```

### GitHub Copilot
```ts
// Custom fetch that refreshes Copilot token and adds required headers
const copilotAuth: CustomAuthLoader = {
  provider: "github-copilot",
  async createFetch(credential: StoredCredential) {
    return async (url: string, init: RequestInit) => {
      // Refresh token if expired
      const token = await ensureValidToken(credential);

      // Add Copilot-specific headers
      init.headers = {
        ...init.headers,
        "Authorization": `Bearer ${token}`,
        "Openai-Intent": "conversation-edits",
        "Editor-Version": "fourmis-agents/1.0",
      };

      return fetch(url, init);
    };
  },
};
```

### Azure
```ts
// Azure needs resource name + deployment ID, not just API key
const azureAuth: CustomAuthLoader = {
  provider: "azure",
  async resolve(config: ProviderConfig) {
    return {
      source: "config",
      key: config.apiKey,
      baseUrl: `https://${config.resourceName}.openai.azure.com`,
      apiVersion: config.apiVersion ?? "2024-12-01-preview",
    };
  },
};
```

---

## Integration with fourmis-agents query()

The auth system is transparent to the user of `query()`:

```ts
// In the query() implementation:
async function resolveProviderAuth(options: QueryOptions): Promise<AuthResult> {
  const providerId = options.provider ?? "anthropic";

  // Explicit key takes priority
  if (options.apiKey) {
    return { key: options.apiKey, baseUrl: options.baseUrl };
  }

  // Resolve from auth chain
  const state = await resolveProviders();
  const provider = state.providers[providerId];

  if (!provider) {
    throw new Error(
      `Provider "${providerId}" not found or not authenticated.\n` +
      `Run: fourmis-agents auth login ${providerId}\n` +
      `Or set: ${PROVIDER_ENV_VARS[providerId]?.[0] ?? "API key"} environment variable`
    );
  }

  return provider.auth;
}
```

---

## Summary: What OpenCode taught us

| Pattern | OpenCode | fourmis-agents |
|---------|----------|----------------|
| Env var registry | models.dev API fetch | Built-in map + optional remote fetch |
| Credential storage | `~/.local/share/opencode/auth.json` | `~/.local/share/fourmis-agents/auth.json` |
| OAuth flows | Built-in plugins (Codex, Copilot) | Plugin system (same flows) |
| Config override | `opencode.json` provider section | `config.json` provider section |
| Provider detection | Scan env vars at startup | Same pattern |
| Custom providers | Via models.dev or config | Via config file |
| Token refresh | Per-plugin (Codex, Copilot) | Generic OAuth refresh + per-plugin |
| Custom fetch | Copilot adds special headers | Same pattern for any provider |
| Model database | models.dev API | Optional remote DB + bundled fallback |
