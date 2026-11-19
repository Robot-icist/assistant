const providers = {
  ollama: {
    baseUrlEnv: "OLLAMA_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:11434",
    modelsPath: "/api/tags",
    getModels: (data) => data.models?.map((model) => model.name || model.model) || [],
  },
  llamacpp: {
    baseUrlEnv: "LLAMACPP_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:8080",
    modelsPath: "/v1/models",
    chatPath: "/v1/chat/completions",
    apiKeyEnv: "LLAMACPP_API_KEY",
    getModels: (data) => data.data?.map((model) => model.id) || [],
  },
  lmstudio: {
    baseUrlEnv: "LMSTUDIO_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:1234",
    modelsPath: "/v1/models",
    chatPath: "/v1/chat/completions",
    apiKeyEnv: "LMSTUDIO_API_KEY",
    getModels: (data) => data.data?.map((model) => model.id) || [],
  },
};

export const getProviderNames = () => Object.keys(providers);

export const getProvider = (name) => {
  const provider = providers[name];
  if (!provider) throw new Error(`Unsupported LLM provider: ${name}`);
  return {
    ...provider,
    baseUrl: (process.env[provider.baseUrlEnv] || provider.defaultBaseUrl).replace(/\/$/, ""),
    apiKey: provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined,
  };
};

export async function listModels(name) {
  const provider = getProvider(name);
  const response = await fetch(`${provider.baseUrl}${provider.modelsPath}`);
  if (!response.ok) {
    throw new Error(`${name} returned HTTP ${response.status}`);
  }

  const models = provider.getModels(await response.json());
  return [...new Set(models.filter((model) => typeof model === "string" && model))];
}