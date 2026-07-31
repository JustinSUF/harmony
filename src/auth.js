import state from './state.js';
import * as sdk from 'matrix-js-sdk';

const KEYS = {
  token: 'mx_token',
  userId: 'mx_user_id',
  homeserver: 'mx_homeserver',
};

function saveSession(homeserver, token, userId) {
  localStorage.setItem(KEYS.token, token);
  localStorage.setItem(KEYS.userId, userId);
  localStorage.setItem(KEYS.homeserver, homeserver);
}

function clearSession() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
}

function getSavedSession() {
  const token = localStorage.getItem(KEYS.token);
  const userId = localStorage.getItem(KEYS.userId);
  const homeserver = localStorage.getItem(KEYS.homeserver);
  return token && userId && homeserver ? { token, userId, homeserver } : null;
}

function normalizeHomeserver(raw) {
  let s = raw.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (!s.startsWith('matrix.')) s = 'matrix.' + s;
  return 'https://' + s;
}

function showStatus(msg, type) {
  const el = document.getElementById('login-status');
  el.textContent = msg;
  el.className = `status-message ${type}`;
  el.style.display = 'block';
}

async function login(homeserver, username, password) {
  const tempClient = sdk.createClient({ baseUrl: homeserver });
  const res = await tempClient.login('m.login.password', { user: username, password });
  saveSession(homeserver, res.access_token, res.user_id);
  return { homeserver, token: res.access_token, userId: res.user_id };
}

async function logout() {
  if (state.client) {
    state.client.stopClient();
    try { await state.client.logout(); } catch { /* ignore */ }
  }

  state.client = null;
  state.roomId = null;
  state.spaceId = null;
  clearSession();

  document.getElementById('rooms-list').innerHTML = '';
  document.getElementById('messages-container').innerHTML = '';
  document.getElementById('members-list').innerHTML = '';

  const btn = document.querySelector('#login-form button[type="submit"]');
  btn.disabled = false;
  btn.textContent = 'Login';

  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  usernameInput.value = '';
  passwordInput.value = '';
  document.getElementById('login-status').style.display = 'none';

  document.getElementById('chat-screen').classList.remove('active');
  document.getElementById('login-screen').classList.add('active');
  requestAnimationFrame(() => { usernameInput.focus(); usernameInput.select(); });
}

module.exports = { login, logout, saveSession, clearSession, getSavedSession, normalizeHomeserver, showStatus };
