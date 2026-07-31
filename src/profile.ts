import state from './state.ts';
import { mxcToUrl, getAverageColor, localpart } from './utils.ts';
import type { RoomMember } from 'matrix-js-sdk';

const popup = document.getElementById('user-profile-popup')!;
const closeBtn = document.getElementById('profile-close');

function stripMatrixSuffix(name: string) {
  const i = name.indexOf('(');
  return i > 0 ? name.slice(0, i).trim() : name;
}

export function showUserProfile(member: RoomMember, anchor: HTMLElement) {
  state.profileMember = member;

  const displayName = stripMatrixSuffix(member.name || localpart(member.userId));
  const letter = displayName[0]!.toUpperCase();

  document.getElementById('profile-display-name')!.textContent = displayName;
  document.getElementById('profile-username')!.textContent = member.userId;

  const avatar = document.getElementById('profile-avatar')!;
  const banner = document.getElementById('profile-banner')!;
  const avatarUrl = mxcToUrl(member.getMxcAvatarUrl());

  if (avatarUrl) {
    avatar.innerHTML = `<img src="${avatarUrl}" alt="${letter}">`;
    getAverageColor(avatarUrl).then(c => { banner.style.background = c; });
  } else {
    avatar.textContent = letter;
    banner.style.background = '#5865f2';
  }

  const badge = document.getElementById('profile-status-badge');
  if (badge) {
    const presence = state.client!.getUser(member.userId)?.presence;
    badge.className = 'profile-status-badge';
    if (presence === 'online') badge.classList.add('online');
    else if (presence === 'unavailable') badge.classList.add('idle');
    else badge.classList.add('offline');
  }

  document.querySelectorAll('.member-item').forEach(m => m.classList.remove('profile-open'));
  anchor.closest?.('.member-item')?.classList.add('profile-open');

  popup.classList.add('active');
  positionPopup(anchor);
}

function positionPopup(anchor: HTMLElement) {
  const content = popup.querySelector('.profile-popup-content') as HTMLElement;
  requestAnimationFrame(() => {
    const a = anchor.getBoundingClientRect();
    const p = content.getBoundingClientRect();
    let left = a.right + 8;
    let top = a.top;
    if (left + p.width > window.innerWidth - 12) left = a.left - p.width - 8;
    top = Math.min(top, window.innerHeight - p.height - 16);
    top = Math.max(top, 16);
    content.style.left = `${left}px`;
    content.style.top = `${top}px`;
  });
}

function closeProfile() {
  popup.classList.remove('active');
  document.querySelectorAll('.member-item').forEach(m => m.classList.remove('profile-open'));
  state.profileMember = null;
}

closeBtn?.addEventListener('click', closeProfile);

window.addEventListener('resize', () => {
  if (!popup.classList.contains('active')) return;
  const anchor = document.querySelector<HTMLElement>('.member-item.profile-open');
  if (anchor) positionPopup(anchor);
});

document.addEventListener('click', e => {
  if (!popup.classList.contains('active')) return;
  const content = popup.querySelector('.profile-popup-content') as HTMLElement;
  const target = e.target as HTMLElement | null;
  if (target &&
      !content.contains(e.target as Node) &&
      !target.closest('.member-item') &&
      !target.closest('.message-avatar') &&
      !target.classList.contains('message-sender')) {
    closeProfile();
  }
});
