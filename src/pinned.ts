import state from './state.ts';
import { mxcToUrl, escapeHtml, makeAvatar, localpart } from './utils.ts';
import { buildMessageEl } from './messages.ts';

let panel: HTMLElement | null = null;

export function showPinnedMessages() {
  if (panel) { panel.remove(); panel = null; document.getElementById('pinned-btn')?.classList.remove('active'); return; }

  const room = state.client!.getRoom(state.roomId!);
  const pinnedEvent = room?.currentState.getStateEvents('m.room.pinned_events', '');
  const pinnedIds: string[] = pinnedEvent?.getContent()?.pinned || [];

  panel = document.createElement('div');
  panel.className = 'pinned-popup';

  const header = document.createElement('div');
  header.className = 'pinned-header';
  header.innerHTML = `
    <span>Pinned Messages</span>
    <button class="pinned-close">✕</button>
  `;
  panel.appendChild(header);

  header.querySelector('.pinned-close')!.addEventListener('click', () => {
    panel?.remove(); panel = null;
    document.getElementById('pinned-btn')?.classList.remove('active');
  });

  const list = document.createElement('div');
  list.className = 'pinned-list';

  if (!pinnedIds.length) {
    list.innerHTML = '<div class="pinned-empty">No pinned messages yet</div>';
  } else {
    pinnedIds.slice().reverse().forEach(eventId => {
      const event = room!.timeline.find(e => e.getId() === eventId);
      if (!event) return;

      const sender = event.getSender()!;
      const member = room!.getMember(sender);
      const name = (() => {
        const raw = member?.name || localpart(sender);
        const i = raw.indexOf('(');
        return i > 0 ? raw.slice(0, i).trim() : raw;
      })();
      const avatarUrl = mxcToUrl(member?.getMxcAvatarUrl?.());
      const ts = new Date(event.getDate() ?? 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      const content = event.getContent();

      const item = document.createElement('div');
      item.className = 'pinned-item';

      const avatarEl = makeAvatar(avatarUrl, name[0]!.toUpperCase(), 'pinned-avatar');

      let bodyHtml = '';
      if (content.msgtype === 'm.image') {
        const url = mxcToUrl(content.url);
        bodyHtml = url ? `<img src="${url}" class="pinned-image" alt="${escapeHtml(content.body || 'Image')}">` : '[Image]';
      } else {
        const msgEl = buildMessageEl(event);
        const msgContent = msgEl.querySelector<HTMLElement>('.message-content');
        bodyHtml = msgContent ? msgContent.innerHTML : escapeHtml(content.body || '');
      }

      const inner = document.createElement('div');
      inner.className = 'pinned-item-inner';
      inner.innerHTML = `
        <div class="pinned-item-header">
            <span class="pinned-sender">${escapeHtml(name)}</span>
            <span class="pinned-time">${ts}</span>
            <button class="pinned-jump" data-event-id="${escapeHtml(eventId)}">Jump</button>
        </div>
        <div class="pinned-body message-content">${bodyHtml}</div>
        `;

      item.append(avatarEl, inner);

      inner.querySelector('.pinned-jump')!.addEventListener('click', () => {
        const target = document.querySelector(`[data-event-id="${eventId}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('message-highlight');
          setTimeout(() => target.classList.remove('message-highlight'), 2000);
        }
        panel?.remove(); panel = null;
        document.getElementById('pinned-btn')?.classList.remove('active');
      });

      list.appendChild(item);

      const divider = document.createElement('div');
      divider.className = 'pinned-divider';
      list.appendChild(divider);
    });
  }

  panel.appendChild(list);

  const btn = document.getElementById('pinned-btn')!;
  const rect = btn.getBoundingClientRect();
  panel.style.position = 'fixed';
  panel.style.top = `${rect.bottom + 8}px`;
  panel.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(panel);
  document.getElementById('pinned-btn')?.classList.add('active');

  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!panel?.contains(e.target as Node) && !btn.contains(e.target as Node)) {
        panel?.remove(); panel = null;
        document.getElementById('pinned-btn')?.classList.remove('active');
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
}

export function closePinned() {
  if (panel) { panel.remove(); panel = null; }
  document.getElementById('pinned-btn')?.classList.remove('active');
}
