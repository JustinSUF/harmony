import state from './state.js';
import { mxcToUrl } from './utils.js';
import { logout } from './auth.js';
import { loadHomeView, loadSpaces, showHomeNav, handleNewRoom } from './rooms.js';
import { handleIncoming } from './messages.js';
import { initPickers } from './picker.js';
import { init as initTyping } from './typing.js';
import { init as initReceipts } from './receipts.js';
import * as sdk from 'matrix-js-sdk';

async function buildClient(credentials) {
  return sdk.createClient({
    baseUrl: credentials.baseUrl || credentials.homeserver,
    accessToken: credentials.accessToken || credentials.token,
    userId: credentials.userId,
    pendingEventOrdering: 'chronological',
  });
}

async function startClient(credentials) {
  console.log('Starting client with credentials:', credentials);
  state.client = await buildClient(credentials);

  const userId = state.client.getUserId();
  const shortName = userId.split(':')[0].slice(1);

  document.getElementById('user-name').textContent = shortName;
  document.getElementById('user-tag').textContent = userId;
  document.getElementById('user-avatar').textContent = shortName[0].toUpperCase();
  document.getElementById('rooms-list').innerHTML = '<p class="loading">Syncing with server...</p>';
  document.getElementById('messages-container').innerHTML = '<div class="empty-state"><p>Loading...</p></div>';

  state.client.once('sync', async syncState => {
    if (syncState !== 'PREPARED') return;

    const ownUser = state.client.getUser(userId);
    if (ownUser?.avatarUrl) {
      const url = mxcToUrl(ownUser.avatarUrl);
      if (url) {
        const avatarEl = document.getElementById('user-avatar');
        avatarEl.innerHTML = `<img src="${url}" onerror="this.parentElement.textContent='${shortName[0].toUpperCase()}'">`;
      }
    }

    loadSpaces();
    showHomeNav(true);
    loadHomeView();
    initPickers();
    initTyping();
    initReceipts();

    document.getElementById('messages-container').innerHTML =
      '<div class="empty-state"><p>Select a room to start messaging</p></div>';
    document.getElementById('chat-screen').classList.add('active');

    requestAnimationFrame(() => document.getElementById('loading-screen').classList.add('fade-out'));
    setTimeout(() => document.getElementById('loading-screen').classList.remove('active', 'fade-out'), 500);
  });

  document.getElementById('user-settings-btn')?.addEventListener('click', () => {
    if (confirm('Log out?')) logout();
  });

  state.client.on('Room.timeline', handleIncoming);
  state.client.on('Room', handleNewRoom);

  await state.client.startClient({
    initialSyncLimit: 100,
    lazyLoadMembers: true,
  });
}

module.exports = { buildClient, startClient };