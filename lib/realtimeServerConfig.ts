import "server-only";

const ALLOWED_MODELS = new Set<string>([
  "gpt-4o-realtime-preview-2025-06-03", // рекомендованный стабильный id
  "gpt-4o-realtime-preview",
  "gpt-4o-realtime-preview-2024-12-17",
  "gpt-4o-realtime-preview-2024-10-01",
  "gpt-4o-mini-realtime-preview",
  "gpt-4o-mini-realtime-preview-2024-12-17",
  "gpt-realtime",
  "gpt-realtime-2025-08-28",
  "gpt-realtime-mini",
  "gpt-realtime-mini-2025-10-06",
]);

const DEFAULT_MODEL = "gpt-4o-realtime-preview-2025-06-03";
const DEFAULT_VOICE = "ash";

function cleanEnvValue(v: string | undefined) {
  return v?.trim().replace(/^"+|"+$/g, "");
}

export function getRealtimeModel(): string {
  const envModel = cleanEnvValue(process.env.OPENAI_REALTIME_MODEL);
  if (envModel && ALLOWED_MODELS.has(envModel)) {
    return envModel;
  }
  return DEFAULT_MODEL;
}

export function getRealtimeVoice(): string {
  const envVoice = cleanEnvValue(process.env.OPENAI_REALTIME_VOICE);
  if (envVoice) {
    return envVoice;
  }
  return DEFAULT_VOICE;
}

export function getRealtimeConfig() {
  return {
    model: getRealtimeModel(),
    voice: getRealtimeVoice(),
  };
}
