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
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

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
  if (!key || key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
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
  const dir = path.dirname(getSettingsPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = {
    apiUrl: input.apiUrl,
    apiKey: input.apiKey ? encryptCredential(input.apiKey) : '',
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    systemPrompt: input.systemPrompt,
  };
  fs.writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), 'utf-8');
}

export function isAiConfigured(): boolean {
  const settings = getAiSettings();
  return !!(settings.apiUrl && settings.apiKey && settings.model);
}
