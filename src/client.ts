import state from './state.ts';
import { mxcToUrl } from './utils.ts';
import { logout, type Credentials } from './auth.ts';
import { loadHomeView, loadSpaces, showHomeNav, handleNewRoom } from './rooms.ts';
import { handleIncoming } from './messages.ts';
import { initPickers } from './picker.ts';
import { init as initTyping } from './typing.ts';
import { init as initReceipts } from './receipts.ts';
import * as sdk from 'matrix-js-sdk';
import type { MatrixClient, ICreateClientOpts, Filter } from 'matrix-js-sdk';

const SYNC_TIMELINE_TYPES = ['m.room.message', 'm.room.redaction', 'm.reaction'];
const SYNC_STATE_TYPES = [
  'm.room.member',
  'm.room.name',
  'm.room.avatar',
  'm.room.topic',
  'm.room.create',
  'm.room.join_rules',
  'm.room.pinned_events',
  'm.room.encrypted',
  'm.room.canonical_alias',
  'm.room.aliases',
  'm.room.power_levels',
  'm.space.parent',
  'm.space.child',
];
const SYNC_EPHEMERAL_TYPES = ['m.typing', 'm.receipt'];
const SYNC_ACCOUNT_DATA_TYPES = ['m.direct', 'm.push_rules'];

function buildSyncFilter(userId: string): sdk.Filter {
  const filter = new sdk.Filter(userId);
  filter.setDefinition({
    room: {
      timeline: { types: SYNC_TIMELINE_TYPES },
      state: { types: SYNC_STATE_TYPES },
      ephemeral: { types: SYNC_EPHEMERAL_TYPES },
      account_data: { types: SYNC_ACCOUNT_DATA_TYPES },
    },
  });
  return filter;
}

async function buildClient(credentials: Credentials): Promise<MatrixClient> {
  const opts: ICreateClientOpts & { filter: Filter } = {
    baseUrl: credentials.baseUrl || credentials.homeserver,
    accessToken: credentials.accessToken || credentials.token,
    userId: credentials.userId,
    filter: buildSyncFilter(credentials.userId),
  };
  return sdk.createClient(opts);
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
    initialSyncLimit: 50,
    lazyLoadMembers: true,
    pendingEventOrdering: sdk.PendingEventOrdering.Chronological,
  });
}
