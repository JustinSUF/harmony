import state from './state.ts';
import { mxcToUrl, escapeHtml, linkify, makeAvatar, scrollToBottom, localpart } from './utils.ts';
import { showUserProfile } from './profile.ts';
import twemoji from 'twemoji';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import type { IContent } from 'matrix-js-sdk';

import * as picker from './picker.ts';
import * as mentions from './mentions.ts';

declare const hljs: { highlightElement(element: HTMLElement): void };

const container = document.getElementById('messages-container')!;

export interface EventLike {
  getSender(): string | undefined;
  getContent(): any;
  getDate(): Date | null;
  getType(): string;
  getId(): string | undefined;
  getTs?(): number;
  isRedacted?(): boolean;
  getAssociatedId?(): string | undefined;
  event?: { redacts?: string };
}

async function matrixSend(roomId: string, content: object) {
  const hs = state.client!.getHomeserverUrl();
  const token = state.client!.getAccessToken();
  const txnId = `m${Date.now()}${Math.random().toString(36).slice(2)}`;
  const res = await fetch(`${hs}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(content),
  });
  if (!res.ok) throw new Error(`Send failed: ${res.status}`);
  return await res.json();
}

async function matrixRedact(roomId: string, eventId: string) {
  const hs = state.client!.getHomeserverUrl();
  const token = state.client!.getAccessToken();
  const txnId = `r${Date.now()}${Math.random().toString(36).slice(2)}`;
  const res = await fetch(`${hs}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${txnId}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Redact failed: ${res.status}`);
  return await res.json();
}

function formatTimestamp(date: Date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  if (msgDay.getTime() === today.getTime()) return timeStr;
  if (msgDay.getTime() === yesterday.getTime()) return `Yesterday at ${timeStr}`;
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: 'numeric' }) + ` at ${timeStr}`;
}

function formatDateDivider(date: Date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (msgDay.getTime() === today.getTime()) return 'Today';
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function createDateDivider(date: Date): HTMLElement {
  const el = document.createElement('div');
  el.className = 'date-divider';
  el.dataset.date = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime().toString();
  el.innerHTML = `<span class="date-divider-text">${formatDateDivider(date)}</span>`;
  return el;
}

const TWEMOJI_OPTS = {};

const ALLOWED_TAGS = new Set(['a', 'b', 'i', 'em', 'strong', 'code', 'pre', 'br', 'del', 'u', 'blockquote', 'span', 'p', 'ul', 'ol', 'li', 'h1', 'h2', 'h3']);

function sanitiseHtml(html: string) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  function clean(node: HTMLElement) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }

      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        el.replaceWith(document.createTextNode(el.textContent ?? ''));
        continue;
      }

      const keep = tag === 'a' ? ['href', 'data-mention', 'target', 'rel']
                 : tag === 'code' ? ['class']
                 : tag === 'span' ? ['data-mx-spoiler']
                 : [];
      for (const attr of [...el.attributes]) {
        if (!keep.includes(attr.name)) el.removeAttribute(attr.name);
      }

      if (tag === 'a' && el.dataset.mention) el.removeAttribute('href');

      if (tag === 'a') {
        const href = el.getAttribute('href') || '';
        if (href.startsWith('https://matrix.to/#/@')) {
          const userId = decodeURIComponent(href.replace('https://matrix.to/#/', ''));
          el.setAttribute('data-mention', userId);
          el.removeAttribute('href');
        }
      }

      clean(el);
    }
  }

  clean(tmp);

  tmp.querySelectorAll('span[data-mx-spoiler]').forEach(el => {
    el.classList.add('spoiler');
  });

  return tmp.innerHTML;
}

function renderBody(content: IContent) {
  if (content.format === 'org.matrix.custom.html' && content.formatted_body) {
    const html = sanitiseHtml(content.formatted_body as string);
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('pre code').forEach(block => {
      hljs.highlightElement(block as HTMLElement);
    });
    twemoji.parse(tmp, TWEMOJI_OPTS);
    return tmp.innerHTML;
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = linkify(content.body || '');
  twemoji.parse(tmp, TWEMOJI_OPTS);
  return tmp.innerHTML;
}

function buildReplyQuote(content: IContent, room: Room | null) {
  const replyTo = content['m.relates_to']?.['m.in_reply_to']?.event_id;
  if (!replyTo) return '';

  const original = room?.timeline.find(e => e.getId() === replyTo);
  if (!original) return '';

  const sender = original.getSender()!;
  const member = room!.getMember(sender);
  const name = (() => {
    const raw = member?.name || localpart(sender);
    const i = raw.indexOf('(');
    return i > 0 ? raw.slice(0, i).trim() : raw;
  })();

  const avatarUrl = mxcToUrl(member?.getMxcAvatarUrl?.());
  const avatarHtml = avatarUrl
    ? `<img src="${avatarUrl}" class="reply-avatar">`
    : `<div class="reply-avatar reply-avatar-letter">${escapeHtml(name[0]!.toUpperCase())}</div>`;

  const origContent = original.getContent();
  let preview = '';
  if (origContent.msgtype === 'm.image') {
    preview = 'Click to view media';
  } else {
    preview = escapeHtml((origContent.body || '').replace(/^>.*\n?/gm, '').trim().slice(0, 100));
  }

  return `
    <div class="reply-quote" data-reply-to="${replyTo}">
      <div class="reply-line"></div>
      ${avatarHtml}
      <span class="reply-sender">${escapeHtml(name)}</span>
      <span class="reply-preview">${preview}</span>
    </div>
  `;
}

function getSenderName(userId: string) {
  if (!state.roomId) return localpart(userId);
  const member = state.client!.getRoom(state.roomId)?.getMember(userId);
  if (!member?.name) return localpart(userId);
  const i = member.name.indexOf('(');
  return i > 0 ? member.name.slice(0, i).trim() : member.name;
}

function isGrouped(sender: string, ts: number, prevEl: HTMLElement) {
  return prevEl.dataset.senderId === sender &&
    ts - parseInt(prevEl.dataset.timestamp || '0') < 5 * 60 * 1000;
}

function buildMessageEl(event: MatrixEvent | EventLike, prevEvent: MatrixEvent | EventLike | null = null) {
  const sender = event.getSender()!;
  const content = event.getContent();
  const ts = new Date(event.getDate() ?? Date.now());
  const timeStr = ts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  const fullTimeStr = formatTimestamp(ts);
  const name = getSenderName(sender);
  const letter = name[0]!.toUpperCase();
  const hasReply = !!content['m.relates_to']?.['m.in_reply_to']?.event_id;
  const myId = state.client!.getUserId();
  const isOwn = sender === myId;

  let grouped = false;
  if (!hasReply && prevEvent) {
    grouped = prevEvent.getSender() === sender &&
      prevEvent.getType() === 'm.room.message' &&
      ts.getTime() - new Date(prevEvent.getDate() ?? 0).getTime() < 5 * 60 * 1000;
  } else if (!hasReply) {
    const last = container.querySelector<HTMLElement>('.message:last-of-type');
    if (last) grouped = isGrouped(sender, ts.getTime(), last);
  }

  const bodyText = content.body || '';
  const myName = (() => {
    const member = state.client!.getRoom(state.roomId ?? undefined)?.getMember(myId ?? '');
    const raw = member?.name || localpart(myId || '');
    const i = raw.indexOf('(');
    return i > 0 ? raw.slice(0, i).trim() : raw;
  })();
  const isMentioned = sender !== myId && (
    bodyText.includes(myId ?? '') ||
    (myName && bodyText.toLowerCase().includes('@' + myName.toLowerCase()))
  );

  const el = document.createElement('div');
  el.className = grouped ? 'message message-grouped' : 'message';
  if (isMentioned) el.classList.add('message-mention');
  el.dataset.senderId = sender;
  el.dataset.timestamp = ts.getTime().toString();

  const room = state.client!.getRoom(state.roomId ?? undefined);
  const replyQuote = buildReplyQuote(content, room);

  let body = '';
  if (content.msgtype === 'm.image') {
    const url = mxcToUrl(content.url);
    body = url
      ? `<div class="message-image-container"><img src="${url}" alt="${escapeHtml(content.body || 'Image')}" class="message-image" loading="lazy"></div>`
      : `<div class="message-content">[Image]</div>`;
  } else {
    body = `<div class="message-content">${renderBody(content)}</div>`;
  }

  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.innerHTML = `
    <button class="message-action-btn" data-action="react" title="Add Reaction">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>
      </svg>
    </button>
    <button class="message-action-btn" data-action="reply" title="Reply">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
      </svg>
    </button>
    <button class="message-action-btn" data-action="edit" title="Edit" style="display:${isOwn ? 'flex' : 'none'}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
      </svg>
    </button>
    <button class="message-action-btn" data-action="pin" title="Pin Message">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>
      </svg>
    </button>
    <button class="message-action-btn action-danger" data-action="delete" title="Delete Message" style="display:${isOwn ? 'flex' : 'none'}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
      </svg>
    </button>
  `;

  if (grouped) {
    el.innerHTML = `
      <div class="message-grouped-content">
        <span class="message-time-hover" title="${fullTimeStr}">${timeStr}</span>
        ${body}
      </div>`;
  } else {
    const avatarUrl = mxcToUrl(room?.getMember(sender)?.getMxcAvatarUrl());
    const avatarEl = makeAvatar(avatarUrl, letter, 'message-avatar');

    if (replyQuote) {
      const replyWrapper = document.createElement('div');
      replyWrapper.innerHTML = replyQuote;
      el.appendChild(replyWrapper.firstElementChild!);
    }

    const row = document.createElement('div');
    row.className = 'message-row';
    row.appendChild(avatarEl);

    const msgBody = document.createElement('div');
    msgBody.className = 'message-body';
    msgBody.innerHTML = `
      <div class="message-header">
        <span class="message-sender">${escapeHtml(name)}</span>
        <span class="message-time" title="${fullTimeStr}">${fullTimeStr}</span>
      </div>
      ${body}`;
    row.appendChild(msgBody);
    el.appendChild(row);
  }

  el.appendChild(actions);
  el.dataset.eventId = event.getId()!;
  el.dataset.body = (content.body || '').replace(/^>.*$/gm, '').replace(/^\s+/, '').trim();

  return el;
}

function applyEditsToTimeline(timeline: MatrixEvent[]) {
  const edits = new Map<string, MatrixEvent>();
  timeline.forEach(ev => {
    if (ev.getType() !== 'm.room.message') return;
    const rel = ev.getContent()['m.relates_to'];
    if (rel?.rel_type === 'm.replace' && rel.event_id) {
      edits.set(rel.event_id, ev);
    }
  });
  return edits;
}

function makeEditedEvent(ev: MatrixEvent | EventLike, editEv: MatrixEvent | EventLike): EventLike {
  const newContent = { ...(editEv.getContent()['m.new_content'] || editEv.getContent()) };
  if (newContent.body?.startsWith('* ')) newContent.body = newContent.body.slice(2);
  return {
    getSender: () => ev.getSender(),
    getContent: () => newContent,
    getDate: () => ev.getDate(),
    getType: () => 'm.room.message',
    getId: () => ev.getId(),
  };
}

function startReply(event: MatrixEvent | EventLike, room: Room | null) {
  const sender = event.getSender()!;
  const member = room?.getMember(sender);
  const name = (() => {
    const raw = member?.name || getSenderName(sender) || localpart(sender);
    const i = raw.indexOf('(');
    return i > 0 ? raw.slice(0, i).trim() : raw;
  })();
  const content = event.getContent();
  const preview = content.msgtype === 'm.image' ? '📷 Image' : (content.body || '').slice(0, 80);

  state.replyTo = event as MatrixEvent;
  cancelEdit();

  let bar = document.getElementById('reply-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'reply-bar';
    bar.className = 'reply-bar';
    document.querySelector('.message-input-container')!.prepend(bar);
  }
  bar.innerHTML = `
    <div class="reply-bar-inner">
      <div class="reply-bar-left">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" class="reply-bar-icon">
          <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
        </svg>
        <span class="reply-bar-text">Replying to <strong>${escapeHtml(name)}</strong></span>
        <span class="reply-bar-preview">${escapeHtml(preview)}</span>
      </div>
      <button class="reply-bar-close">✕</button>
    </div>
  `;
  bar.querySelector('.reply-bar-close')!.addEventListener('click', cancelReply);
  (document.getElementById('message-input') as HTMLTextAreaElement).focus();
}

export function cancelReply() {
  state.replyTo = null;
  document.getElementById('reply-bar')?.remove();
}

function startEdit(event: MatrixEvent | EventLike, msgEl: HTMLElement | null) {
  cancelEdit();
  cancelReply();
  state.editingEvent = event as MatrixEvent;

  if (!msgEl) msgEl = container.querySelector(`[data-event-id="${event.getId()}"]`);
  if (!msgEl) return;

  const contentEl = msgEl.querySelector<HTMLElement>('.message-content');
  if (!contentEl) return;

  const original = msgEl.dataset.body || event.getContent().body || '';
  contentEl.style.display = 'none';

  const editBox = document.createElement('div');
  editBox.className = 'edit-box';
  editBox.id = 'edit-box';
  editBox.innerHTML = `
    <textarea class="edit-input">${escapeHtml(original)}</textarea>
    <div class="edit-hint">escape to <span class="edit-cancel-link">cancel</span> • enter to <span class="edit-save-link">save</span></div>
  `;
  contentEl.insertAdjacentElement('afterend', editBox);

  const textarea = editBox.querySelector<HTMLTextAreaElement>('.edit-input')!;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  editBox.querySelector('.edit-cancel-link')!.addEventListener('click', cancelEdit);
  editBox.querySelector('.edit-save-link')!.addEventListener('click', () => saveEdit(textarea.value, event));

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(textarea.value, event); }
  });
}

export function cancelEdit() {
  const editBox = document.getElementById('edit-box');
  if (editBox) {
    const contentEl = editBox.previousElementSibling as HTMLElement | null;
    if (contentEl?.classList.contains('message-content')) {
      contentEl.style.removeProperty('display');
    }
    editBox.remove();
  }
  state.editingEvent = null;
}

async function saveEdit(newText: string, event: MatrixEvent | EventLike) {
  const msgEl = container.querySelector<HTMLElement>(`[data-event-id="${event.getId()}"]`);
  const displayedOriginal = msgEl?.dataset.body || event.getContent().body || '';
  if (!newText.trim() || newText.trim() === displayedOriginal.trim()) {
    cancelEdit();
    return;
  }
  const formatted = mentions.applyMarkdown(newText);
  const existingRelation = event.getContent()['m.relates_to'];
  const replyRelation = existingRelation?.['m.in_reply_to']
    ? { 'm.in_reply_to': existingRelation['m.in_reply_to'] }
    : undefined;
  const newContent = {
    msgtype: 'm.text',
    body: newText,
    format: 'org.matrix.custom.html',
    formatted_body: formatted,
    ...(replyRelation ? { 'm.relates_to': replyRelation } : {}),
  };
  await matrixSend(state.roomId!, {
    'm.new_content': newContent,
    'm.relates_to': { rel_type: 'm.replace', event_id: event.getId() },
    msgtype: 'm.text',
    body: `* ${newText}`,
  });
  cancelEdit();
}

export function loadMessages(roomId: string) {
  const room = state.client!.getRoom(roomId);
  const timeline = room!.timeline;
  container.innerHTML = '';

  if (state.client!.isRoomEncrypted(roomId)) {
    const notice = document.createElement('div');
    notice.className = 'encryption-notice';
    notice.innerHTML = 'Encryption currently not supported. Coming Soon.';
    container.appendChild(notice);
    return;
  }

  if (!timeline.length) {
    container.innerHTML = '<div class="empty-state"><p>No messages yet</p></div>';
    state.canLoadMore = false;
    return;
  }

  const edits = applyEditsToTimeline(timeline);
  const slice = timeline.slice(-100);
  let lastMsgDate: Date | null = null;
  slice.forEach((ev, i, arr) => {
    if (ev.getType() !== 'm.room.message') return;
    if (ev.isRedacted?.()) return;
    const rel = ev.getContent()['m.relates_to'];
    if (rel?.rel_type === 'm.replace') return;

    const editEv = edits.get(ev.getId() ?? '');
    const renderEvent = editEv ? makeEditedEvent(ev, editEv) : ev;
    const evDate = ev.getDate() ?? new Date(ev.getTs?.() ?? 0);
    if (!evDate.getTime()) return;
    if (!lastMsgDate || !isSameDay(evDate, lastMsgDate)) {
      container.appendChild(createDateDivider(evDate));
      lastMsgDate = evDate;
    }
    const el = buildMessageEl(renderEvent, i > 0 ? arr[i - 1] ?? null : null);
    el.dataset.eventId = ev.getId()!;

    if (editEv) {
      const tag = document.createElement('span');
      tag.className = 'message-edited';
      tag.textContent = '(edited)';
      el.querySelector('.message-content')?.appendChild(tag);
    }

    container.appendChild(el);
  });

  state.canLoadMore = true;
  scrollToBottom();
  setupInfiniteScroll(roomId);
  buildReactionsFromTimeline(timeline);
}

export async function loadFullHistory(roomId: string) {
  if (state.client!.isRoomEncrypted(roomId)) return;
  const room = state.client!.getRoom(roomId);
  if (!room) return;
  let loads = 0;
  let prevScroll = 0;

  while (loads < 3) {
    if (state.roomId !== roomId) return;
    try {
      const result = await state.client!.scrollback(room, 50);
      if (state.roomId !== roomId) return;
      if (!result) break;
      loads++;
    } catch {
      break;
    }
  }

  if (state.roomId !== roomId) return;
  prevScroll = container.scrollHeight - container.scrollTop;
  rebuildMessages(room.timeline);
  container.scrollTop = container.scrollHeight - prevScroll;
  state.canLoadMore = loads < 10;
  setupInfiniteScroll(roomId);
}

function rebuildMessages(timeline: MatrixEvent[]) {
  container.innerHTML = '';
  const edits = applyEditsToTimeline(timeline);
  let lastRebuildDate: Date | null = null;
  timeline.forEach((ev, i, arr) => {
    if (ev.getType() !== 'm.room.message') return;
    if (ev.isRedacted?.()) return;
    const rel = ev.getContent()['m.relates_to'];
    if (rel?.rel_type === 'm.replace') return;

    const editEv = edits.get(ev.getId() ?? '');
    const renderEvent = editEv ? makeEditedEvent(ev, editEv) : ev;
    const evDate = ev.getDate() ?? new Date(ev.getTs?.() ?? 0);
    if (!evDate.getTime()) return;
    if (!lastRebuildDate || !isSameDay(evDate, lastRebuildDate)) {
      container.appendChild(createDateDivider(evDate));
      lastRebuildDate = evDate;
    }
    const el = buildMessageEl(renderEvent, i > 0 ? arr[i - 1] ?? null : null);
    el.dataset.eventId = ev.getId()!;

    if (editEv) {
      const tag = document.createElement('span');
      tag.className = 'message-edited';
      tag.textContent = '(edited)';
      el.querySelector('.message-content')?.appendChild(tag);
    }

    container.appendChild(el);
  });

  buildReactionsFromTimeline(timeline);
}

let scrollHandler: (() => void) | null = null;

function setupInfiniteScroll(roomId: string) {
  if (scrollHandler) container.removeEventListener('scroll', scrollHandler);
  scrollHandler = () => {
    if (container.scrollTop < 800 && !state.loadingHistory && state.canLoadMore) {
      loadOlderMessages(roomId);
    }
  };
  container.addEventListener('scroll', scrollHandler);
}

async function loadOlderMessages(roomId: string) {
  if (state.loadingHistory || !state.canLoadMore) return;
  state.loadingHistory = true;

  const room = state.client!.getRoom(roomId);

  try {
    await state.client!.scrollback(room!, 50);
    const timeline = room!.timeline;
    const edits = applyEditsToTimeline(timeline);

    const oldestId = container.querySelector<HTMLElement>('.message')?.dataset?.eventId;
    let startIdx = oldestId ? timeline.findIndex(e => e.getId() === oldestId) : 0;
    if (startIdx === -1) startIdx = 0;

    const older = timeline.slice(Math.max(0, startIdx - 50), startIdx);
    const olderEls: HTMLElement[] = [];
    let olderLastDate: Date | null = null;
    older.forEach((ev, i, arr) => {
      if (ev.getType() !== 'm.room.message') return;
      if (ev.isRedacted?.()) return;
      const rel = ev.getContent()['m.relates_to'];
      if (rel?.rel_type === 'm.replace') return;

      const prevEv = i > 0 ? arr[i - 1] ?? null : null;
      const editEv = edits.get(ev.getId() ?? '');
      const renderEvent = editEv ? makeEditedEvent(ev, editEv) : ev;
      const evDate = ev.getDate() ?? new Date(ev.getTs?.() ?? 0);
      if (!evDate.getTime()) return;
      if (!olderLastDate || !isSameDay(evDate, olderLastDate)) {
        olderEls.push(createDateDivider(evDate));
        olderLastDate = evDate;
      }
      const el = buildMessageEl(renderEvent, prevEv);
      el.dataset.eventId = ev.getId()!;

      if (editEv) {
        const tag = document.createElement('span');
        tag.className = 'message-edited';
        tag.textContent = '(edited)';
        el.querySelector('.message-content')?.appendChild(tag);
      }

      olderEls.push(el);
    });
    const firstChild = container.firstElementChild;
    if (firstChild?.classList.contains('date-divider')) {
      const firstMsgEl = container.querySelector<HTMLElement>('.message');
      const firstMsgDate = firstMsgEl ? new Date(parseInt(firstMsgEl.dataset.timestamp ?? '')) : null;
      const lastOlderEl = olderEls.filter(el => el.classList?.contains('date-divider')).pop();
      const lastOlderDate = lastOlderEl ? new Date(parseInt(lastOlderEl.dataset.date ?? '')) : null;
      if (lastOlderDate && firstMsgDate && isSameDay(lastOlderDate, firstMsgDate)) {
        firstChild.remove();
      }
    }
    const fragment = document.createDocumentFragment();
    olderEls.reverse().forEach(el => fragment.appendChild(el));
    container.prepend(fragment);
    state.canLoadMore = true;
  } catch {
    state.canLoadMore = false;
  }

  state.loadingHistory = false;
}

export function handleIncoming(event: MatrixEvent, room: Room, toStart: boolean) {
  if (toStart || room.roomId !== state.roomId) return;

  if (event.getType() === 'm.room.redaction') {
    const redactedId = event.getAssociatedId?.() || event.event?.redacts;
    if (redactedId) {
      const el = container.querySelector(`[data-event-id="${redactedId}"]`);
      if (el) el.remove();
    }
    return;
  }

  if (event.getType() === 'm.reaction') {
    const rel = event.getContent()['m.relates_to'];
    if (rel?.rel_type === 'm.annotation') {
      setTimeout(() => {
        const msgEl = container.querySelector(`[data-event-id="${rel.event_id}"]`);
        if (msgEl) {
          const reactions = getReactionsForEvent(room.timeline, rel.event_id!);
          renderReactions(msgEl as HTMLElement, reactions);
        }
      }, 100);
    }
    return;
  }

  if (event.getType() !== 'm.room.message') return;

  const relation = event.getContent()['m.relates_to'];
  if (relation?.rel_type === 'm.replace') {
    const originalId = relation.event_id;
    const original = container.querySelector<HTMLElement>(`[data-event-id="${originalId}"]`);
    if (original) {
      const timeline = room.timeline;
      const origIdx = timeline.findIndex(e => e.getId() === originalId);
      const origEv = timeline[origIdx];
      const prevEvent = origIdx > 0 ? timeline[origIdx - 1] ?? null : null;

      const baseEvent = origEv || {
        getSender: () => original.dataset.senderId,
        getContent: () => ({ msgtype: 'm.text', body: original.dataset.body || '' }),
        getDate: () => new Date(parseInt(original.dataset.timestamp || String(Date.now()))),
        getType: () => 'm.room.message',
        getId: () => originalId,
      };
      const renderEvent = makeEditedEvent(baseEvent, event);
      const newEl = buildMessageEl(renderEvent, prevEvent);
      newEl.dataset.eventId = originalId;
      newEl.dataset.senderId = baseEvent.getSender()!;
      newEl.dataset.timestamp = original.dataset.timestamp;

      const editedTag = document.createElement('span');
      editedTag.className = 'message-edited';
      editedTag.textContent = '(edited)';
      newEl.querySelector('.message-content')?.appendChild(editedTag);
      original.replaceWith(newEl);
    }
    return;
  }

  if (event.getSender() === state.client!.getUserId()) {
    container.querySelectorAll('[data-temp-id]').forEach(el => el.remove());
  }

  const lastMsg = [...container.querySelectorAll<HTMLElement>('.message')].pop();
  const lastMsgTs = lastMsg ? parseInt(lastMsg.dataset.timestamp ?? '') : 0;
  const newMsgDate = event.getDate() ?? new Date();
  if (!lastMsgTs || !isSameDay(newMsgDate, new Date(lastMsgTs))) {
    container.appendChild(createDateDivider(newMsgDate));
  }

  const el = buildMessageEl(event);
  el.dataset.senderId = event.getSender()!;
  el.dataset.eventId = event.getId()!;
  container.appendChild(el);
  scrollToBottom();
}

document.addEventListener('click', async e => {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.message-action-btn')) {
    const btn = target.closest('.message-action-btn') as HTMLElement;
    const action = btn.dataset.action;
    const msg = btn.closest('.message') as HTMLElement | null;
    const eventId = msg?.dataset.eventId;
    const room = state.client!.getRoom(state.roomId!);
    const timelineEvent = room?.timeline.find(ev => ev.getId() === eventId) ||
                  room?.timeline.find(ev => {
                    const rel = ev.getContent()['m.relates_to'];
                    return rel?.rel_type === 'm.replace' && rel.event_id === eventId;
                  });
    const event: EventLike = timelineEvent || {
      getSender: () => msg?.dataset.senderId,
      getContent: () => ({ msgtype: 'm.text', body: msg?.dataset.body || '', 'm.relates_to': undefined }),
      getDate: () => new Date(parseInt(msg?.dataset.timestamp || String(Date.now()))),
      getType: () => 'm.room.message',
      getId: () => eventId,
    };

    if (action === 'react') {
      picker.showReactionPicker(btn, eventId!);
    } else if (action === 'reply') {
      startReply(event, room);
    } else if (action === 'edit') {
      startEdit(event, msg);
    } else if (action === 'pin') {
      const pinned = room?.currentState.getStateEvents('m.room.pinned_events', '')?.getContent()?.pinned || [];
      if (!pinned.includes(eventId)) {
        state.client!.sendStateEvent(state.roomId!, 'm.room.pinned_events' as any, { pinned: [...pinned, eventId] }, '');
      }
    } else if (action === 'delete') {
      msg?.remove();
      try { await matrixRedact(state.roomId!, eventId!); } catch (err) { console.error('Delete error:', err); }
    }
    return;
  }

  if (target?.closest('.message-avatar') || target?.classList.contains('message-sender')) {
    const msg = target.closest('.message') as HTMLElement | null;
    if (!msg) return;
    const member = state.client!.getRoom(state.roomId!)?.getMember(msg.dataset.senderId!);
    if (member) showUserProfile(member, (target.closest('.message-avatar') || target) as HTMLElement);
    return;
  }

  if (target?.classList.contains('message-image')) {
    e.preventDefault();
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox';
    const img = document.createElement('img');
    img.src = (target as HTMLImageElement).src;
    overlay.appendChild(img);
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
    return;
  }

  if (target?.classList.contains('spoiler')) {
    target.classList.toggle('revealed');
    return;
  }

  if (target?.closest('.reply-quote')) {
    const replyTo = target.closest('.reply-quote')!.getAttribute('data-reply-to')!;
    const targetEl = container.querySelector(`[data-event-id="${replyTo}"]`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetEl.classList.add('message-highlight');
      setTimeout(() => targetEl.classList.remove('message-highlight'), 2000);
    }
    return;
  }

  if (target?.closest('a[data-mention]')) {
    e.preventDefault();
    const userId = target.closest('a[data-mention]')!.getAttribute('data-mention')!;
    if (!userId || !state.roomId) return;
    const member = state.client!.getRoom(state.roomId)?.getMember(userId);
    if (member) showUserProfile(member, target);
  }
});

interface ReactionInfo {
  count: number;
  senders: string[];
  myReactionId: string | null;
}

function getReactionsForEvent(timeline: MatrixEvent[], eventId: string) {
  const reactions = new Map<string, ReactionInfo>();
  const myId = state.client!.getUserId();
  timeline.forEach(ev => {
    if (ev.getType() !== 'm.reaction') return;
    const rel = ev.getContent()['m.relates_to'];
    if (rel?.rel_type !== 'm.annotation' || rel.event_id !== eventId) return;
    const key = rel.key!;
    if (!reactions.has(key)) reactions.set(key, { count: 0, senders: [], myReactionId: null });
    const r = reactions.get(key)!;
    r.count++;
    r.senders.push(ev.getSender()!);
    if (ev.getSender() === myId) r.myReactionId = ev.getId()!;
  });
  return reactions;
}

const pendingRedactions = new Set<string>();
const pendingReactions = new Set<string>();

function renderReactions(el: HTMLElement, reactions: Map<string, ReactionInfo>) {
  let bar = el.querySelector<HTMLElement>('.reactions-bar');
  if (reactions.size === 0) { bar?.remove(); return; }

  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'reactions-bar';
    const row = el.querySelector<HTMLElement>('.message-row') || el.querySelector<HTMLElement>('.message-grouped-content');
    row ? row.insertAdjacentElement('afterend', bar) : el.appendChild(bar);
  }

  bar.innerHTML = '';

  reactions.forEach(({ count, senders, myReactionId }, emoji) => {
    const pill = document.createElement('button');
    pill.className = 'reaction-pill' + (myReactionId ? ' reaction-mine' : '');
    pill.title = senders.map(s => getSenderName(s)).join(', ');
    pill.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">${count}</span>`;
    pill.dataset.emoji = emoji;
    pill.dataset.myReactionId = myReactionId || '';

    pill.dataset.eventId = el.dataset.eventId;
    pill.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentMyReactionId = pill.dataset.myReactionId;
      const key = emoji;
      const targetEventId = pill.dataset.eventId;
      const reactionKey = `${targetEventId}:${key}`;

      if (pendingReactions.has(reactionKey)) return;
      pendingReactions.add(reactionKey);

      if (currentMyReactionId) {
        if (pendingRedactions.has(currentMyReactionId)) { pendingReactions.delete(reactionKey); return; }
        pendingRedactions.add(currentMyReactionId);
        pill.dataset.myReactionId = '';
        pill.classList.remove('reaction-mine');
        const countEl = pill.querySelector('.reaction-count')!;
        const newCount = parseInt(countEl.textContent ?? '0') - 1;
        if (newCount <= 0) {
          pill.remove();
        } else {
          countEl.textContent = newCount.toString();
        }
        try {
          await matrixRedact(state.roomId!, currentMyReactionId);
        } catch (err) {
          console.error('Unreact error:', err);
          const room2 = state.client!.getRoom(state.roomId!);
          if (room2) {
            const reactions2 = getReactionsForEvent(room2.timeline, targetEventId!);
            const msgEl2 = container.querySelector<HTMLElement>(`[data-event-id="${targetEventId}"]`);
            if (msgEl2) renderReactions(msgEl2, reactions2);
          }
        } finally {
          pendingRedactions.delete(currentMyReactionId);
          pendingReactions.delete(reactionKey);
        }
      } else {
        try {
          const hs = state.client!.getHomeserverUrl();
          const token = state.client!.getAccessToken();
          const txnId = `rx${Date.now()}${Math.random().toString(36).slice(2)}`;
          const res = await fetch(`${hs}/_matrix/client/v3/rooms/${encodeURIComponent(state.roomId!)}/send/m.reaction/${txnId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ 'm.relates_to': { rel_type: 'm.annotation', event_id: targetEventId, key: key } }),
          });
          if (!res.ok) throw new Error(`React failed: ${res.status}`);
        } catch (err) {
          console.error('Reaction error:', err);
        } finally {
          pendingReactions.delete(reactionKey);
        }
      }
    });

    bar!.appendChild(pill);
    twemoji.parse(pill.querySelector<HTMLElement>('.reaction-emoji')!, TWEMOJI_OPTS);
  });
}

function applyReactionsToMessage(timeline: MatrixEvent[], el: HTMLElement) {
  const eventId = el.dataset.eventId;
  if (!eventId) return;
  const reactions = getReactionsForEvent(timeline, eventId);
  renderReactions(el, reactions);
}

function buildReactionsFromTimeline(timeline: MatrixEvent[]) {
  container.querySelectorAll<HTMLElement>('.message[data-event-id]').forEach(el => {
    applyReactionsToMessage(timeline, el);
  });
}

export { buildMessageEl };
