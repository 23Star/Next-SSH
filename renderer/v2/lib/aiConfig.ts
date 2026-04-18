// Build a ProviderConfig for the agent from the main-process AI settings.
//
// The renderer needs the unmasked API key to call the provider directly, so
// we go through `aiSettings.getRaw()`. Display (Settings page) uses the
// `get()` variant which returns a masked key.

import type { ProviderConfig } from '../../agent/types';

export interface LoadedAIConfig {
  configured: boolean;
  provider: ProviderConfig | null;
  // Extra fields the agent doesn't consume but the UI might want.
  systemPromptOverride: string | null;
}

export async function loadAIConfig(): Promise<LoadedAIConfig> {
  const api = window.electronAPI;
  if (!api?.aiSettings) {
    return { configured: false, provider: null, systemPromptOverride: null };
  }
  const [raw, configured] = await Promise.all([
    api.aiSettings.getRaw(),
    api.aiSettings.isConfigured(),
  ]);
  if (!configured || !raw.apiUrl || !raw.apiKey || !raw.model) {
    return { configured: false, provider: null, systemPromptOverride: raw.systemPrompt || null };
  }
  return {
    configured: true,
    provider: {
      apiUrl: raw.apiUrl,
      apiKey: raw.apiKey,
      model: raw.model,
      temperature: raw.temperature,
      maxTokens: raw.maxTokens,
    },
    systemPromptOverride: raw.systemPrompt || null,
  };
}
