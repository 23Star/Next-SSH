import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithPopup, signOut as fbSignOut, onAuthStateChanged, GoogleAuthProvider, type User } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { FirebaseConfig } from './types';
import { showMessage } from './message';
import { t } from './i18n';

const REGISTERED_ACCOUNTS_KEY = 'aissh:registeredAccounts';
const MAX_REGISTERED_ACCOUNTS = 10;
let accountListModalCloseBound = false;

function getRegisteredAccounts(): string[] {
  try {
    const raw = localStorage.getItem(REGISTERED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function addRegisteredAccount(email: string): void {
  if (!email) return;
  const list = getRegisteredAccounts();
  const next = [email, ...list.filter((e) => e !== email)].slice(0, MAX_REGISTERED_ACCOUNTS);
  try {
    localStorage.setItem(REGISTERED_ACCOUNTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

let app: FirebaseApp | null = null;
let auth: ReturnType<typeof getAuth> | null = null;
let db: ReturnType<typeof getFirestore> | null = null;

export function isFirebaseAvailable(): boolean {
  return auth !== null;
}

/**
 * Main から取得した設定で Firebase を初期化。設定がなければ何もしない。
 */
export async function initFirebase(getConfig: () => Promise<FirebaseConfig | null>): Promise<boolean> {
  const config = await getConfig();
  if (!config) return false;
  try {
    app = initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
    return true;
  } catch {
    return false;
  }
}

export function signInWithGoogle(): Promise<void> {
  if (!auth) return Promise.reject(new Error('Firebase not initialized'));
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider).then(() => {});
}

/** 新規登録: 常にアカウント選択画面を表示してからログイン */
export function signUpWithGoogle(): Promise<void> {
  if (!auth) return Promise.reject(new Error('Firebase not initialized'));
  return signOut().then(() => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return signInWithPopup(auth!, provider).then(() => {});
  });
}

export function signOut(): Promise<void> {
  if (!auth) return Promise.resolve();
  return fbSignOut(auth);
}

export function getCurrentUser(): User | null {
  return auth?.currentUser ?? null;
}

export function onAuthStateChange(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => {};
  }
  const unsubscribe = onAuthStateChanged(auth, callback);
  return () => unsubscribe();
}

/** users/{uid} の profile を取得。未ログイン or Firestore 未初期化なら null。 */
export async function getProfile(uid: string): Promise<Record<string, unknown> | null> {
  if (!db) return null;
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as Record<string, unknown>;
}

/** users/{uid} に profile をマージで書き込み。 */
export async function setProfile(uid: string, data: Record<string, unknown>): Promise<void> {
  if (!db) throw new Error('Firestore not initialized');
  const ref = doc(db, 'users', uid);
  await setDoc(ref, data, { merge: true });
}

/** Functions の chatComplete を呼び出し。未ログイン or 未初期化なら null。 */
export async function callChatComplete(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Promise<string | null> {
  if (!app || !auth?.currentUser) return null;
  const functions = getFunctions(app, 'us-central1');
  const fn = httpsCallable<{ messages: Array<{ role: string; content: string }> }, { content: string }>(
    functions,
    'chatComplete',
  );
  const result = await fn({ messages });
  return result.data?.content ?? null;
}

/** Stripe Checkout セッションを作成し、決済ページの URL を返す。未ログイン or 未初期化なら null。 */
export async function callCreateCheckoutSession(
  successUrl: string,
  cancelUrl: string,
  priceId?: string,
): Promise<string | null> {
  if (!app || !auth?.currentUser) return null;
  const functions = getFunctions(app, 'us-central1');
  const fn = httpsCallable<
    { successUrl: string; cancelUrl: string; priceId?: string },
    { url: string }
  >(functions, 'createCheckoutSession');
  const result = await fn({ successUrl, cancelUrl, priceId });
  return result.data?.url ?? null;
}

/**
 * ログイン・ログアウトボタンとメール表示をバインド。Firebase 未初期化の場合は何もしない。
 */
/** 決済完了・キャンセル時のリダイレクト先（Firebase Hosting）。 */
const STRIPE_SUCCESS_URL = 'https://aissh-f540b.web.app/stripe/success';
const STRIPE_CANCEL_URL = 'https://aissh-f540b.web.app/stripe/cancel';

/** プラン ID → Stripe Price ID。pro / expert は Stripe で作成後に差し替え。 */
export const STRIPE_PLAN_PRICE_IDS: Record<string, string> = {
  standard: 'price_1T34XdD9OOkJwoyh2PfaQdP3',
  pro: 'price_1T34YQD9OOkJwoyhHJvXz1fE',
  expert: 'price_1T34YoD9OOkJwoyhKNyXMLhy',
};

/** 指定プランで Checkout を開く。 */
export async function openCheckoutForPlan(planId: string): Promise<void> {
  const priceId = STRIPE_PLAN_PRICE_IDS[planId];
  if (!priceId || !window.electronAPI?.openExternal) return;
  try {
    const url = await callCreateCheckoutSession(STRIPE_SUCCESS_URL, STRIPE_CANCEL_URL, priceId);
    if (url) window.electronAPI.openExternal(url);
    else
      void showMessage({
        title: 'Checkout error',
        message: 'Checkout の取得に失敗しました。ログイン状態を確認してください。',
      });
  } catch (err) {
    void showMessage({
      title: 'Checkout error',
      message: `課金ページを開けませんでした: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export function bindFirebaseAuthUI(): void {
  const btnLogin = document.getElementById('btnFirebaseLogin');
  const btnSignUp = document.getElementById('btnFirebaseSignUp');
  const btnLogout = document.getElementById('btnFirebaseLogout');
  const btnBilling = document.getElementById('btnBilling');
  const emailSpan = document.getElementById('firebaseUserEmail');
  if (!btnLogin || !btnLogout || !emailSpan) return;

  const loginBtn = btnLogin;
  const signUpBtn = btnSignUp;
  const logoutBtn = btnLogout;
  const billingBtn = btnBilling;
  const emailEl = emailSpan;
  function updateUI(user: User | null): void {
    if (user) {
      addRegisteredAccount(user.email ?? user.uid);
      loginBtn.style.display = 'none';
      if (signUpBtn) signUpBtn.style.display = 'none';
      emailEl.textContent = user.email ?? user.uid;
      emailEl.style.display = 'inline';
      logoutBtn.style.display = 'inline';
      if (billingBtn) billingBtn.style.display = 'inline';
      // ログイン時に profile を Firestore に同期
      setProfile(user.uid, {
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    } else {
      loginBtn.style.display = 'inline';
      if (signUpBtn) signUpBtn.style.display = 'inline';
      emailEl.style.display = 'none';
      logoutBtn.style.display = 'none';
      if (billingBtn) billingBtn.style.display = 'none';
    }
  }

  onAuthStateChange(updateUI);

  function logAuth(...args: unknown[]): void {
    const line = ['[auth]', ...args].map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    console.log(line);
    window.electronAPI?.logToMain?.('[auth]', ...args);
  }

  const handleLoginError = (err: unknown, source?: string): void => {
    const msg = err instanceof Error ? err.message : String(err);
    logAuth('Login error', source ? `(source: ${source})` : '', msg);
    // ポップアップを×で閉じた／キャンセルした場合はモーダルを出さずに無視
    if (msg.includes('auth/cancelled-popup-request') || msg.includes('auth/popup-closed-by-user')) {
      return;
    }
    showMessage({
      title: 'Login error',
      message: `ログインに失敗しました: ${msg}`,
    });
  };

  function closeAccountListModal(): void {
    const modal = document.getElementById('accountListModal');
    if (modal) modal.style.display = 'none';
  }

  function showAccountListModal(): void {
    const modal = document.getElementById('accountListModal');
    const listEl = document.getElementById('accountListModalList');
    const titleEl = document.getElementById('accountListModalTitle');
    const otherBtn = document.getElementById('accountListModalOther');
    if (!modal || !listEl || !otherBtn) return;
    if (titleEl) titleEl.textContent = t('auth.accountListTitle');
    otherBtn.textContent = t('auth.otherAccount');

    listEl.innerHTML = '';
    const accounts = getRegisteredAccounts();
    const lastAccount = accounts[0] ?? null; // 最後にログインしたアカウントのみ表示
    if (!lastAccount) {
      const empty = document.createElement('p');
      empty.className = 'accountListEmpty';
      empty.textContent = t('auth.noAccounts');
      listEl.appendChild(empty);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'accountItem';
      btn.textContent = lastAccount;
      btn.addEventListener('click', () => {
        closeAccountListModal();
        logAuth('Starting signInWithGoogle from loginModal_lastAccount');
        signInWithGoogle().catch((e) => handleLoginError(e, 'loginModal_lastAccount'));
      });
      listEl.appendChild(btn);
    }

    const doSignInAndClose = (): void => {
      closeAccountListModal();
      logAuth('Starting signInWithGoogle from loginModal_otherAccount');
      signInWithGoogle().catch((e) => handleLoginError(e, 'loginModal_otherAccount'));
    };
    otherBtn.replaceWith(otherBtn.cloneNode(true));
    const otherBtnNew = document.getElementById('accountListModalOther');
    if (otherBtnNew) {
      otherBtnNew.textContent = t('auth.otherAccount');
      otherBtnNew.addEventListener('click', doSignInAndClose);
    }

    modal.style.display = 'flex';
  }

  function bindAccountListModalCloseOnce(): void {
    if (accountListModalCloseBound) return;
    accountListModalCloseBound = true;
    document.getElementById('accountListModalClose')?.addEventListener('click', closeAccountListModal);
    document.getElementById('accountListModalBackdrop')?.addEventListener('click', closeAccountListModal);
  }

  loginBtn.addEventListener('click', () => {
    bindAccountListModalCloseOnce();
    showAccountListModal();
  });
  signUpBtn?.addEventListener('click', () => {
    logAuth('Starting signUpWithGoogle from signUpButton');
    signUpWithGoogle().catch((e) => handleLoginError(e, 'signUpButton'));
  });
  logoutBtn.addEventListener('click', () => signOut());

  billingBtn?.addEventListener('click', () => {
    const settingsModal = document.getElementById('settingsModal');
    const planModal = document.getElementById('planModal');
    if (settingsModal) settingsModal.style.display = 'none';
    if (planModal) planModal.style.display = 'flex';
  });
}
