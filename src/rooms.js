import state from './state.js';
import { mxcToUrl, escapeHtml, makeAvatar } from './utils.js';
import { loadMessages, loadFullHistory } from './messages.js';
import { loadMembers } from './members.js';
import { clearTyping, checkCurrentTypers } from './typing.js';
import { updateReceipts, sendReceipt, clearReceipts } from './receipts.js';
import { showPinnedMessages, closePinned } from './pinned.js';

const roomsList = document.getElementById('rooms-list');

function showHomeNav(visible) {
  document.getElementById('home-nav')?.classList.toggle('visible', visible);
  const membersBtn = document.getElementById('members-btn');
  const pinnedBtn = document.getElementById('pinned-btn');
  const show = (visible && !state.roomId) ? 'none' : 'flex';
  if (membersBtn) membersBtn.style.display = show;
  if (pinnedBtn) pinnedBtn.style.display = show;
}

document.getElementById('nav-dms')?.addEventListener('click', () => setHomeView('dms'));
document.getElementById('nav-rooms')?.addEventListener('click', () => setHomeView('rooms'));

function setHomeView(view) {
  state.homeView = view;
  document.querySelectorAll('.home-nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`nav-${view}`)?.classList.add('active');
  loadHomeView();

  const lastRoom = state.lastRoomPerSpace['home'];
  if (lastRoom && state.client?.getRoom(lastRoom)) {
    openRoom(lastRoom);
  } else {
    setTimeout(() => {
      const firstRoom = document.querySelector('#rooms-list .room-item');
      if (firstRoom?.dataset.roomId) openRoom(firstRoom.dataset.roomId);
    }, 0);
  }
}

document.getElementById('pinned-btn')?.addEventListener('click', () => {
  showPinnedMessages();
});

document.getElementById('home-server')?.addEventListener('click', () => {
  state.spaceId = null;
  state.roomId = null;
  clearReceipts();
  clearTyping();
  document.getElementById('current-room-name').innerHTML = '';
  document.querySelectorAll('.server-icon').forEach(i => i.classList.remove('active'));
  document.getElementById('home-server')?.classList.add('active');
  document.querySelector('.sidebar-header h2').textContent = 'Home';
  showHomeNav(true);
  loadHomeView();

  const lastRoom = state.lastRoomPerSpace['home'];
  if (lastRoom && state.client.getRoom(lastRoom)) {
    openRoom(lastRoom);
  } else {
    document.getElementById('messages-container').innerHTML =
      '<div class="empty-state"><p>Select a room to start messaging</p></div>';
    document.getElementById('message-input-container').style.display = 'none';
    document.getElementById('members-sidebar').style.display = 'none';
    document.getElementById('members-btn').style.display = 'none';
  }
});

function loadHomeView() {
  if (!state.client) return;

  const rooms = state.client.getRooms();
  const dmIds = new Set(
    Object.values(state.client.getAccountData('m.direct')?.getContent() || {}).flat()
  );

  const homeRooms = rooms.filter(r => {
    if (r.isSpaceRoom()) return false;
    return !(r.currentState.getStateEvents('m.space.parent')?.length > 0);
  });

  roomsList.innerHTML = '';

  if (state.homeView === 'dms') {
    const dms = homeRooms.filter(r => dmIds.has(r.roomId))
      .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());

    if (!dms.length) { roomsList.innerHTML = '<p class="loading">No direct messages</p>'; return; }
    dms.forEach(r => roomsList.appendChild(makeRoomEl(r, true)));

  } else {
    const nonDm = homeRooms.filter(r => !dmIds.has(r.roomId));
    if (!nonDm.length) { roomsList.innerHTML = '<p class="loading">No rooms</p>'; return; }

    const getJoinRule = r => r.currentState.getStateEvents('m.room.join_rules', '')?.getContent()?.join_rule;
    const regular = nonDm.filter(r => getJoinRule(r) !== 'public');
    const global = nonDm.filter(r => getJoinRule(r) === 'public');

    if (regular.length) {
      roomsList.appendChild(makeCategoryHeader('Rooms'));
      regular.sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())
             .forEach(r => roomsList.appendChild(makeRoomEl(r)));
    }
    if (global.length) {
      roomsList.appendChild(makeCategoryHeader('Global Rooms'));
      global.sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())
            .forEach(r => roomsList.appendChild(makeRoomEl(r)));
    }
  }
}

function loadSpaces() {
  const spacesList = document.getElementById('spaces-list');
  if (!spacesList) return;
  spacesList.innerHTML = '';

  state.client.getRooms()
    .filter(r => r.isSpaceRoom() && !r.currentState.getStateEvents('m.space.parent')?.length)
    .forEach(space => spacesList.appendChild(makeSpaceIcon(space)));
}

function makeSpaceIcon(space) {
  const icon = document.createElement('div');
  icon.className = 'server-icon';
  icon.title = space.name || 'Unnamed Space';
  icon.dataset.spaceId = space.roomId;

  const url = mxcToUrl(space.getMxcAvatarUrl?.());
  const letter = (space.name || '?')[0].toUpperCase();

  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = letter;
    img.addEventListener('error', () => { icon.textContent = letter; });
    icon.appendChild(img);
  } else {
    icon.textContent = letter;
  }

  icon.addEventListener('click', () => switchSpace(space.roomId));
  return icon;
}

function switchSpace(spaceId) {
  state.spaceId = spaceId;
  showHomeNav(false);
  document.querySelectorAll('.server-icon').forEach(i => i.classList.remove('active'));
  document.querySelector(`[data-space-id="${spaceId}"]`)?.classList.add('active');
  document.getElementById('home-server')?.classList.remove('active');
  const name = state.client.getRoom(spaceId)?.name || 'Space';
  document.querySelector('.sidebar-header h2').textContent = name;
  loadSpaceRooms(spaceId);

  const lastRoom = state.lastRoomPerSpace[spaceId];
  if (lastRoom && state.client.getRoom(lastRoom)) {
    openRoom(lastRoom);
  } else {
    setTimeout(() => {
      const firstRoom = document.querySelector('#rooms-list .room-item');
      if (firstRoom?.dataset.roomId) openRoom(firstRoom.dataset.roomId);
    }, 0);
  }
}

function loadSpaceRooms(spaceId) {
  const all = state.client.getRooms();
  const space = state.client.getRoom(spaceId);
  const childIds = new Set(
    (space?.currentState.getStateEvents('m.space.child') || []).map(e => e.getStateKey()).filter(Boolean)
  );

  const subSpaces = [], direct = [];
  all.forEach(room => {
    const id = room.roomId;
    const isChild = childIds.has(id) || childIds.has(id.split(':')[0]);
    if (!isChild) {
      const parents = room.currentState.getStateEvents('m.space.parent') || [];
      if (!parents.some(e => e.getStateKey() === spaceId)) return;
    }
    (room.isSpaceRoom() ? subSpaces : direct).push(room);
  });

  roomsList.innerHTML = '';
  if (!subSpaces.length && !direct.length) {
    roomsList.innerHTML = '<p class="loading">No rooms</p>';
    return;
  }

  subSpaces.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
           .forEach(sub => renderSubSpaceCategory(sub));

  direct.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .forEach(r => roomsList.appendChild(makeRoomEl(r)));
}

function renderSubSpaceCategory(sub) {
  const isExpanded = localStorage.getItem(`space-${sub.roomId}-expanded`) !== 'false';

  const cat = document.createElement('div');
  cat.className = 'space-category';
  cat.dataset.spaceId = sub.roomId;
  cat.innerHTML = `
    <div class="space-category-header">
      <svg class="space-category-arrow ${isExpanded ? 'expanded' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9.29 15.88L13.17 12 9.29 8.12c-.39-.39-.39-1.02 0-1.41.39-.39 1.02-.39 1.41 0l4.59 4.59c.39.39.39 1.02 0 1.41L10.7 17.3c-.39.39-1.02.39-1.41 0-.38-.39-.39-1.03 0-1.42z"/>
      </svg>
      <span class="space-category-name">${escapeHtml(sub.name || 'Unnamed')}</span>
    </div>
    <div class="space-category-rooms ${isExpanded ? 'expanded' : ''}"></div>
  `;
  roomsList.appendChild(cat);

  const arrow = cat.querySelector('.space-category-arrow');
  const roomsEl = cat.querySelector('.space-category-rooms');

  cat.querySelector('.space-category-header').addEventListener('click', () => {
    const expanded = arrow.classList.toggle('expanded');
    roomsEl.classList.toggle('expanded');
    localStorage.setItem(`space-${sub.roomId}-expanded`, expanded);
  });

  const subChildIds = new Set(
    (sub.currentState.getStateEvents('m.space.child') || []).map(e => e.getStateKey()).filter(Boolean)
  );

  state.client.getRooms()
    .filter(r => {
      if (r.isSpaceRoom()) return false;
      if (subChildIds.has(r.roomId) || subChildIds.has(r.roomId.split(':')[0])) return true;
      return (r.currentState.getStateEvents('m.space.parent') || []).some(e => e.getStateKey() === sub.roomId);
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .forEach(r => roomsEl.appendChild(makeRoomEl(r)));
}

function makeRoomEl(room, isDm = false) {
  const el = document.createElement('div');
  el.className = 'room-item';
  el.dataset.roomId = room.roomId;

  if (isDm) {
    const members = room.getJoinedMembers();
    const other = members.find(m => m.userId !== state.client.getUserId()) || members[0];
    const name = other?.name || room.name || '?';
    const letter = name[0].toUpperCase();
    const avatarMxc = other?.getMxcAvatarUrl() || state.client.getUser(other?.userId)?.avatarUrl;
    const avatarEl = makeAvatar(mxcToUrl(avatarMxc), letter, 'dm-avatar');
    const nameEl = document.createElement('div');
    nameEl.className = 'room-name';
    nameEl.textContent = room.name || name;
    el.append(avatarEl, nameEl);
  } else {
    el.innerHTML = `<div class="room-name">${escapeHtml(room.name || 'Unnamed Room')}</div>`;
  }

  el.addEventListener('click', () => openRoom(room.roomId));
  return el;
}

function makeCategoryHeader(text) {
  const el = document.createElement('div');
  el.className = 'room-category';
  el.textContent = text;
  return el;
}

function openRoom(roomId) {
  clearTyping();
  clearReceipts();
  closePinned();
  state.roomId = roomId;
  state.lastRoomPerSpace[state.spaceId || 'home'] = roomId;
  checkCurrentTypers();
  const room = state.client.getRoom(roomId);
  const encrypted = state.client.isRoomEncrypted(roomId);

  if (!state.spaceId) {
    showHomeNav(true);
  } else {
    showHomeNav(false);
  }
  

  document.getElementById('current-room-name').innerHTML = `
    <span class="encryption-indicator ${encrypted ? 'encrypted' : 'unencrypted'}"></span>
    ${escapeHtml(room.name || 'Unnamed Room')}`;

  document.getElementById('message-input-container').style.display = 'flex';
  document.getElementById('message-input').placeholder = `Message #${room.name || roomId}`;
  document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-room-id="${roomId}"]`)?.classList.add('active');

  loadMessages(roomId);
  loadMembers(roomId);
  loadFullHistory(roomId);
  sendReceipt();
  updateReceipts();
}

function handleNewRoom(room) {
  if (!state.spaceId) loadHomeView();
  loadSpaces();
}

module.exports = { loadHomeView, loadSpaces, openRoom, showHomeNav, handleNewRoom };
