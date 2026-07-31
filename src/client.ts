import state from './state.ts';
import { mxcToUrl } from './utils.ts';
import { logout, type Credentials } from './auth.ts';
import { loadHomeView, loadSpaces, showHomeNav, handleNewRoom } from './rooms.ts';
import { handleIncoming } from './messages.ts';
import { initPickers } from './picker.ts';
import { init as initTyping } from './typing.ts';
import { init as initReceipts } from './receipts.ts';
import * as sdk from 'matrix-js-sdk';
import type { MatrixClient } from 'matrix-js-sdk';

async function buildClient(credentials: Credentials): Promise<MatrixClient> {
  return sdk.createClient({
    baseUrl: credentials.baseUrl || credentials.homeserver,
    accessToken: credentials.accessToken || credentials.token,
    userId: credentials.userId,
  });
}

export async function startClient(credentials: Credentials) {
  console.log('Starting client with credentials:', credentials);
  state.client = await buildClient(credentials);

  const userId = state.client.getUserId()!;
  const shortName = (userId.split(':')[0] ?? '').slice(1);

  document.getElementById('user-name')!.textContent = shortName;
  document.getElementById('user-tag')!.textContent = userId;
  document.getElementById('user-avatar')!.textContent = shortName[0]!.toUpperCase();
  document.getElementById('rooms-list')!.innerHTML = '<p class="loading">Syncing with server...</p>';
  document.getElementById('messages-container')!.innerHTML = '<div class="empty-state"><p>Loading...</p></div>';

  state.client.once('sync' as any, async (syncState: string) => {
    if (syncState !== 'PREPARED') return;

    const ownUser = state.client!.getUser(userId);
    if (ownUser?.avatarUrl) {
      const url = mxcToUrl(ownUser.avatarUrl);
      if (url) {
        const avatarEl = document.getElementById('user-avatar')!;
        avatarEl.innerHTML = `<img src="${url}" onerror="this.parentElement.textContent='${shortName[0]!.toUpperCase()}'">`;
      }
    }

    loadSpaces();
    showHomeNav(true);
    loadHomeView();
    initPickers();
    initTyping();
    initReceipts();

    document.getElementById('messages-container')!.innerHTML =
      '<div class="empty-state"><p>Select a room to start messaging</p></div>';
    document.getElementById('chat-screen')!.classList.add('active');

    requestAnimationFrame(() => document.getElementById('loading-screen')!.classList.add('fade-out'));
    setTimeout(() => document.getElementById('loading-screen')!.classList.remove('active', 'fade-out'), 500);
  });

  document.getElementById('user-settings-btn')?.addEventListener('click', () => {
    if (confirm('Log out?')) logout();
  });

  state.client.on('Room.timeline' as any, handleIncoming);
  state.client.on('Room' as any, handleNewRoom);

  await state.client.startClient({
    initialSyncLimit: 100,
    lazyLoadMembers: true,
    pendingEventOrdering: sdk.PendingEventOrdering.Chronological,
  });
}
