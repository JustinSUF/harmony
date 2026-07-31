import state from './state.js';
import { mxcToUrl, escapeHtml, makeAvatar } from './utils.js';
import { showUserProfile } from './profile.js';

const ITEM_HEIGHT = 42;
const BUFFER = 10;
const sidebar = document.getElementById('members-sidebar');
const list = document.getElementById('members-list');

document.getElementById('members-btn')?.addEventListener('click', () => {
  const btn = document.getElementById('members-btn');
  const isHidden = sidebar.style.display === 'none';
  sidebar.style.display = isHidden ? 'flex' : 'none';
  btn.classList.toggle('active', isHidden);
});

function loadMembers(roomId) {
  const room = state.client.getRoom(roomId);
  if (!room) return;

  state.allMembers = room.getJoinedMembers()
    .sort((a, b) => (a.name || a.userId).toLowerCase().localeCompare((b.name || b.userId).toLowerCase()));

  const header = document.querySelector('.members-count');
  if (header) header.textContent = `${state.allMembers.length} Members`;

  sidebar.style.display = 'flex';
  list.innerHTML = '';
  list.style.position = '';
  list.style.height = '';

  if (state.allMembers.length > 100) {
    list.style.position = 'relative';
    list.style.height = `${state.allMembers.length * ITEM_HEIGHT}px`;
    renderRange(0, 40);
    list.removeEventListener('scroll', onScroll);
    list.addEventListener('scroll', onScroll);
  } else {
    state.allMembers.forEach(m => list.appendChild(makeMemberEl(m)));
  }
}

function onScroll() {
  const top = list.scrollTop;
  const start = Math.max(0, Math.floor(top / ITEM_HEIGHT) - BUFFER);
  const end = Math.min(state.allMembers.length, Math.ceil((top + list.clientHeight) / ITEM_HEIGHT) + BUFFER);
  if (start !== state.memberRange.start || end !== state.memberRange.end) renderRange(start, end);
}

function renderRange(start, end) {
  state.memberRange = { start, end };
  list.querySelectorAll('.member-item').forEach(el => el.remove());
  for (let i = start; i < end; i++) {
    if (!state.allMembers[i]) continue;
    const el = makeMemberEl(state.allMembers[i]);
    el.style.cssText = `position:absolute;top:${i * ITEM_HEIGHT}px;width:100%;height:${ITEM_HEIGHT}px`;
    list.appendChild(el);
  }
}

function makeMemberEl(member) {
  const el = document.createElement('div');
  el.className = 'member-item';

  const name = (() => {
    const raw = member.name || member.userId.split(':')[0].slice(1);
    const i = raw.indexOf('(');
    return i > 0 ? raw.slice(0, i).trim() : raw;
  })();

  const presence = state.client.getUser(member.userId)?.presence;
  if (member.userId === state.client.getUserId() || presence === 'online') {
    el.classList.add('online');
  } else if (presence === 'unavailable') {
    el.classList.add('idle');
  }

  const avatarEl = makeAvatar(mxcToUrl(member.getMxcAvatarUrl()), name[0].toUpperCase(), 'member-avatar');

  const info = document.createElement('div');
  info.className = 'member-info';
  info.innerHTML = `<div class="member-name" title="${escapeHtml(member.userId)}">${escapeHtml(name)}</div>`;

  el.append(avatarEl, info);
  el.addEventListener('click', () => showUserProfile(member, el));
  return el;
}

module.exports = { loadMembers };
