import { safeStorage } from 'electron';

const PREFIX = 'aissh:v1:';

/**
 * 認証情報を OS キーチェーン連携の safeStorage で暗号化する。
 * 既存の平文データとの互換のため、復号時にプレフィックスで暗号化済みを判別する。
 */
export function encryptCredential(plain: string | null): string | null {
  if (plain === null) return null;
  if (plain === '') return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Credential encryption is not available (e.g. keychain not ready).');
  }
  const buf = safeStorage.encryptString(plain);
  return PREFIX + buf.toString('base64');
}

/**
 * DB から読み出した値を復号する。プレフィックスがない場合は平文としてそのまま返す（既存データ互換）。
 */
export function decryptCredential(stored: string | null): string | null {
  if (stored === null || stored === '') return stored === null ? null : '';
  if (!stored.startsWith(PREFIX)) return stored;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Credential decryption is not available (e.g. keychain not ready).');
  }
  const base64 = stored.slice(PREFIX.length);
  const buf = Buffer.from(base64, 'base64');
  return safeStorage.decryptString(buf);
}
