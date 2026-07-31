import state from './src/state.ts';
import { scrollToBottom } from './src/utils.ts';
import { login, getSavedSession, normalizeHomeserver, showStatus } from './src/auth.ts';
import { startClient } from './src/client.ts';
import { buildMessageEl } from './src/messages.ts';
import { buildBody, clearMentions } from './src/mentions.ts';
import * as authModule from './src/auth.ts';

window.addEventListener('DOMContentLoaded', () => {
  const session = getSavedSession();
  if (session) {
    document.getElementById('login-screen')!.classList.remove('active');
    document.getElementById('loading-screen')!.classList.add('active');
    startClient(session).catch(() => {
      authModule.clearSession();
      document.getElementById('loading-screen')!.classList.remove('active');
      document.getElementById('login-screen')!.classList.add('active');
    });
  } else {
    document.getElementById('login-screen')!.classList.add('active');
  }
});

document.getElementById('login-form')!.addEventListener('submit', async e => {
  e.preventDefault();

  const homeserver = normalizeHomeserver((document.getElementById('homeserver') as HTMLInputElement).value);
  const username = (document.getElementById('username') as HTMLInputElement).value.trim();
  const password = (document.getElementById('password') as HTMLInputElement).value;
  const btn = (e.target as HTMLFormElement).querySelector<HTMLButtonElement>('button[type="submit"]')!;

  showStatus('Connecting...', 'success');
  btn.disabled = true;

  try {
    const creds = await login(homeserver, username, password);
    document.getElementById('login-screen')!.classList.remove('active');
    document.getElementById('loading-screen')!.classList.add('active');
    await startClient(creds);
  } catch (err) {
    showStatus(`Login failed: ${err instanceof Error ? err.message : err}`, 'error');
    btn.disabled = false;
  }
});

const messageForm = document.getElementById('message-form') as HTMLFormElement;
const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
const messagesContainer = document.getElementById('messages-container') as HTMLElement;

messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    messageForm.dispatchEvent(new Event('submit'));
  }
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = messageInput.scrollHeight + 'px';
});

messageForm.addEventListener('submit', async e => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !state.roomId) return;

  const msg = buildBody(text);

  messageInput.value = '';
  messageInput.style.height = 'auto';

  const tempId = `temp-${Date.now()}`;
  const fakeEvent = {
    getSender: () => state.client!.getUserId() ?? undefined,
    getContent: () => ({ msgtype: 'm.text', body: text }),
    getDate: () => new Date(),
    getType: () => 'm.room.message',
    getId: () => tempId,
  };

  const tempEl = buildMessageEl(fakeEvent);
  tempEl.dataset.tempId = tempId;
  tempEl.style.opacity = '0.6';
  messagesContainer.appendChild(tempEl);
  scrollToBottom();

  try {
    const hs = state.client!.getHomeserverUrl();
    const token = state.client!.getAccessToken();
    const txnId = `m${Date.now()}${Math.random().toString(36).slice(2)}`;
    const res = await fetch(`${hs}/_matrix/client/v3/rooms/${encodeURIComponent(state.roomId)}/send/m.room.message/${txnId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    messagesContainer.querySelector(`[data-temp-id="${tempId}"]`)?.remove();
    clearMentions();
  } catch (err) {
    console.error('Send failed:', err);
    clearMentions();
    const el = messagesContainer.querySelector<HTMLElement>(`[data-temp-id="${tempId}"]`);
    if (!el) return;
    el.style.opacity = '1';
    el.style.background = 'rgba(237,66,69,0.1)';
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.className = 'retry-btn';
    retry.onclick = async () => {
      retry.disabled = true;
      retry.textContent = 'Retrying...';
      try {
        const hs2 = state.client!.getHomeserverUrl();
        const token2 = state.client!.getAccessToken();
        const txnId2 = `m${Date.now()}${Math.random().toString(36).slice(2)}`;
        const res2 = await fetch(`${hs2}/_matrix/client/v3/rooms/${encodeURIComponent(state.roomId!)}/send/m.room.message/${txnId2}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token2}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
        });
        if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
        el.remove();
      } catch (err2) {
        console.error('Retry failed:', err2);
        retry.disabled = false;
        retry.textContent = 'Retry';
      }
    };
    el.appendChild(retry);
  }
});

const attachBtn = document.getElementById('attach-btn')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async e => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !state.roomId) return;

  if (!file.type.startsWith('image/')) { alert('Images only please'); return; }
  if (file.size > 10 * 1024 * 1024) { alert('Max image size is 10MB'); return; }

  const status = document.createElement('div');
  status.className = 'upload-status';
  status.textContent = `Uploading ${file.name}...`;
  messagesContainer.appendChild(status);
  scrollToBottom();

  try {
    const res = await state.client!.uploadContent(file, {
      name: file.name,
      type: file.type,
    });
    const hs = state.client!.getHomeserverUrl();
    const token = state.client!.getAccessToken();
    const txnId = `img${Date.now()}${Math.random().toString(36).slice(2)}`;
    await fetch(`${hs}/_matrix/client/v3/rooms/${encodeURIComponent(state.roomId)}/send/m.room.message/${txnId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.image', body: file.name, url: res.content_uri, info: { mimetype: file.type, size: file.size } }),
    });
  } catch (err) {
    alert('Upload failed: ' + (err instanceof Error ? err.message : err));
  } finally {
    status.remove();
    fileInput.value = '';
  }
});