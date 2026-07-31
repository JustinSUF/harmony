import state from './state.ts';
import * as sdk from 'matrix-js-sdk';

const KEYS = {
  token: 'mx_token',
  userId: 'mx_user_id',
  homeserver: 'mx_homeserver',
};

export interface Credentials {
  homeserver: string;
  token: string;
  userId: string;
  baseUrl?: string;
  accessToken?: string;
}

export function saveSession(homeserver: string, token: string, userId: string) {
  localStorage.setItem(KEYS.token, token);
  localStorage.setItem(KEYS.userId, userId);
  localStorage.setItem(KEYS.homeserver, homeserver);
}

export function clearSession() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
}

export function getSavedSession(): { token: string; userId: string; homeserver: string } | null {
  const token = localStorage.getItem(KEYS.token);
  const userId = localStorage.getItem(KEYS.userId);
  const homeserver = localStorage.getItem(KEYS.homeserver);
  return token && userId && homeserver ? { token, userId, homeserver } : null;
}

export function normalizeHomeserver(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (!s.startsWith('matrix.')) s = 'matrix.' + s;
  return 'https://' + s;
}

export function showStatus(msg: string, type: string) {
  const el = document.getElementById('login-status')!;
  el.textContent = msg;
  el.className = `status-message ${type}`;
  el.style.display = 'block';
}

export async function login(homeserver: string, username: string, password: string): Promise<Credentials> {
  const tempClient = sdk.createClient({ baseUrl: homeserver });
  const res = await tempClient.login('m.login.password', {
    identifier: { type: 'm.id.user', user: username },
    password,
    initial_device_display_name: 'Harmony',
  });
  saveSession(homeserver, res.access_token, res.user_id);
  return { homeserver, token: res.access_token, userId: res.user_id };
}

export async function logout() {
  if (state.client) {
    state.client.stopClient();
    try { await state.client.logout(); } catch { /* ignore */ }
  }

  state.client = null;
  state.roomId = null;
  state.spaceId = null;
  clearSession();

  document.getElementById('rooms-list')!.innerHTML = '';
  document.getElementById('messages-container')!.innerHTML = '';
  document.getElementById('members-list')!.innerHTML = '';

  const btn = document.querySelector<HTMLButtonElement>('#login-form button[type="submit"]')!;
  btn.disabled = false;
  btn.textContent = 'Login';

  const usernameInput = document.getElementById('username') as HTMLInputElement;
  const passwordInput = document.getElementById('password') as HTMLInputElement;
  usernameInput.value = '';
  passwordInput.value = '';
  document.getElementById('login-status')!.style.display = 'none';

  document.getElementById('chat-screen')!.classList.remove('active');
  document.getElementById('login-screen')!.classList.add('active');
  requestAnimationFrame(() => { usernameInput.focus(); usernameInput.select(); });
}
