import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

export function loadFirebaseConfig(): FirebaseConfig | null {
  const projectRootFromMain = path.join(__dirname, '..', '..');
  const candidates = [
    path.join(projectRootFromMain, 'config', 'firebase.local.json'),
    path.join(process.cwd(), 'config', 'firebase.local.json'),
    path.join(app.getAppPath(), 'config', 'firebase.local.json'),
    path.join(app.getPath('userData'), 'config', 'firebase.local.json'),
  ];
  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';
      const authDomain = typeof data.authDomain === 'string' ? data.authDomain : '';
      const projectId = typeof data.projectId === 'string' ? data.projectId : '';
      const storageBucket = typeof data.storageBucket === 'string' ? data.storageBucket : '';
      const messagingSenderId = typeof data.messagingSenderId === 'string' ? data.messagingSenderId : '';
      const appId = typeof data.appId === 'string' ? data.appId : '';
      if (apiKey && authDomain && projectId && appId) {
        return {
          apiKey,
          authDomain,
          projectId,
          storageBucket,
          messagingSenderId,
          appId,
          measurementId: typeof data.measurementId === 'string' ? data.measurementId : undefined,
        };
      }
    } catch {
      // ファイルなし or パースエラーは次を試す
    }
  }
  return null;
}
