import { safeStorage } from 'electron';

const PREFIX = 'aissh:v1:';

/**
 * 使用与 OS 密钥链集成的 safeStorage 加密凭据。
 * 为了兼容已有的明文数据，解密时通过前缀判断是否已加密。
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
 * 解密从数据库读取的值。没有前缀时视为明文直接返回（兼容已有数据）。
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
