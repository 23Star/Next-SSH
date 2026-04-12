import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { encryptCredential, decryptCredential } from '../crypto/credentialCrypto';

export interface AiSettings {
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

export interface AiSettingsDisplay {
  apiUrl: string;
  apiKeyMasked: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

export interface AiSettingsInput {
  apiUrl: string;
  apiKey?: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

export interface AiModelPreset {
  name: string;
  apiUrl: string;
  model: string;
}

export const AI_MODEL_PRESETS: AiModelPreset[] = [
  { name: 'DeepSeek V3', apiUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'DeepSeek R1', apiUrl: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner' },
  { name: 'OpenAI GPT-4o', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'OpenAI GPT-4.1', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { name: 'GLM-5 (Z.AI)', apiUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5' },
  { name: 'GLM-4.7 (Z.AI)', apiUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7' },
  { name: 'GLM-Z1 (Z.AI)', apiUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-z1-airx' },
  { name: 'Qwen Turbo', apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
  { name: 'Qwen Plus', apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'Qwen Max', apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-max' },
  { name: 'QwQ', apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwq-plus' },
  { name: 'Claude (Anthropic)', apiUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514' },
  { name: 'Gemini (Google)', apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { name: 'Mistral', apiUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { name: 'SiliconFlow', apiUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B' },
  { name: 'Groq', apiUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { name: 'Ollama (Local)', apiUrl: 'http://localhost:11434/v1', model: 'qwen3:8b' },
];

const FILENAME = 'ai-settings.json';
const DEFAULTS: AiSettings = {
  apiUrl: '',
  apiKey: '',
  model: '',
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '',
};

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), FILENAME);
}

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return '********';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

export function getAiSettings(): AiSettings {
  const filePath = getSettingsPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as Partial<AiSettings>;
    const apiKey = typeof data.apiKey === 'string' ? decryptCredential(data.apiKey) ?? '' : '';
    return {
      apiUrl: typeof data.apiUrl === 'string' ? data.apiUrl : DEFAULTS.apiUrl,
      apiKey,
      model: typeof data.model === 'string' ? data.model : DEFAULTS.model,
      temperature: typeof data.temperature === 'number' ? data.temperature : DEFAULTS.temperature,
      maxTokens: typeof data.maxTokens === 'number' ? data.maxTokens : DEFAULTS.maxTokens,
      systemPrompt: typeof data.systemPrompt === 'string' ? data.systemPrompt : DEFAULTS.systemPrompt,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getAiSettingsDisplay(): AiSettingsDisplay {
  const settings = getAiSettings();
  return {
    ...settings,
    apiKeyMasked: settings.apiKey ? maskApiKey(settings.apiKey) : '',
  };
}

export function setAiSettings(input: AiSettingsInput): void {
  const current = getAiSettings();

  // Resolve API key: only update if a new key is provided
  // Empty/falsy → clear the key. No key field → keep existing.
  let apiKey: string;
  if (input.apiKey === undefined || input.apiKey === '') {
    apiKey = current.apiKey;
  } else {
    apiKey = input.apiKey;
  }

  const dir = path.dirname(getSettingsPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = {
    apiUrl: input.apiUrl,
    apiKey: apiKey ? encryptCredential(apiKey) : '',
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    systemPrompt: input.systemPrompt,
  };
  fs.writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), 'utf-8');
}

export function isAiConfigured(): boolean {
  const settings = getAiSettings();
  return !!(settings.apiUrl && settings.apiKey);
}
