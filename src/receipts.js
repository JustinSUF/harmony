import state from './state.js';
import { mxcToUrl, makeAvatar } from './utils.js';
import { showUserProfile } from './profile.js';

const bar = document.createElement('div');
bar.className = 'receipts-bar';
let popup = null;

function init() {
document.querySelector('.status-row').appendChild(bar);
  const myId = state.client.getUserId();

  state.client.on('Room.receipt', (event, room) => {
    if (room.roomId !== state.roomId) return;
    renderReceipts(room);
  });

  state.client.on('Room.timeline', (event, room) => {
    if (room.roomId !== state.roomId) return;
    if (event.getType() !== 'm.room.message') return;
    if (event.getSender() === myId) return;
    state.client.sendReadReceipt(event);
    renderReceipts(room);
  });
}

function renderReceipts(room) {
  if (room.roomId !== state.roomId) { bar.innerHTML = ''; return; }
  
  const timeline = room.timeline;
  if (!timeline.length) { bar.innerHTML = ''; return; }

  const lastEvent = [...timeline].reverse().find(e => e.getType() === 'm.room.message');
  if (!lastEvent) { bar.innerHTML = ''; return; }

  const myId = state.client.getUserId();
  const receipts = room.getReceiptsForEvent(lastEvent)
    .filter(r => r.userId !== myId)
    .sort((a, b) => b.data.ts - a.data.ts);

  if (!receipts.length) { bar.innerHTML = ''; return; }

  bar.innerHTML = '';

  const preview = receipts.slice(0, 2);
const stack = document.createElement('div');
stack.className = 'receipts-stack';

preview.forEach(r => {
  const member = room.getMember(r.userId);
  const name = member?.name || r.userId.split(':')[0].slice(1);
  const avatarUrl = mxcToUrl(member?.getMxcAvatarUrl?.());
  const el = makeAvatar(avatarUrl, name[0].toUpperCase(), 'receipt-avatar');
  el.title = name;
  stack.appendChild(el);
});

if (receipts.length > 2) {
  const more = document.createElement('div');
  more.className = 'receipt-avatar receipt-more';
  const extra = Math.min(receipts.length - 2, 9);
  more.textContent = `+${extra}`;
  stack.appendChild(more);
}

  stack.addEventListener('click', (e) => showReceiptPopup(receipts, room, stack));
  bar.appendChild(stack);
}

function showReceiptPopup(receipts, room, anchor) {
  if (popup) { popup.remove(); popup = null; return; }
  popup = document.createElement('div');
  popup.className = 'receipt-popup';

  const title = document.createElement('div');
  title.className = 'receipt-popup-title';
  title.textContent = 'Seen by';
  popup.appendChild(title);

  const list = document.createElement('div');
  list.className = 'receipt-popup-list';

  receipts.forEach(r => {
    const member = room.getMember(r.userId);
    const name = member?.name || r.userId.split(':')[0].slice(1);
    const avatarUrl = mxcToUrl(member?.getMxcAvatarUrl?.());
    const item = document.createElement('div');
    item.className = 'receipt-popup-item';
    const avatarEl = makeAvatar(avatarUrl, name[0].toUpperCase(), 'receipt-popup-avatar');
    const nameEl = document.createElement('span');
    nameEl.textContent = name;
    item.append(avatarEl, nameEl);
    if (member) item.addEventListener('click', () => { showUserProfile(member, item); popup.remove(); popup = null; });
    list.appendChild(item);
  });

  popup.appendChild(list);

  const rect = anchor.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  popup.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(popup);

  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!popup?.contains(e.target) && !anchor.contains(e.target)) {
        popup?.remove(); popup = null;
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
}

function updateReceipts() {
  if (!state.roomId || !state.client) return;
  const room = state.client.getRoom(state.roomId);
  if (room) renderReceipts(room);
}

function sendReceipt() {
  if (!state.roomId || !state.client) return;
  const room = state.client.getRoom(state.roomId);
  if (!room) return;
  const last = [...room.timeline].reverse().find(e => e.getType() === 'm.room.message');
  if (last) state.client.sendReadReceipt(last);
}

function clearReceipts() { bar.innerHTML = ''; }

module.exports = { init, updateReceipts, sendReceipt, clearReceipts };
