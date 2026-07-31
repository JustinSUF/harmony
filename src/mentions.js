import state from './state.js';
import { mxcToUrl, escapeHtml, makeAvatar } from './utils.js';
import { cancelReply } from './messages.js';

const input = document.getElementById('message-input');
const form  = document.getElementById('message-form');

let picker       = null;
let selectedIdx  = 0;
let mentionStart = -1;

const resolvedMentions = new Map();

function openPicker() {
  if (picker) return;
  picker = document.createElement('div');
  picker.className = 'mention-picker';
  document.body.appendChild(picker);
}

function closePicker() {
  picker?.remove();
  picker  = null;
  selectedIdx  = 0;
  mentionStart = -1;
}

function renderPicker(query) {
  if (!picker) return;

  const all = getMembersSorted();
  const results = (query
    ? all.filter(m =>
        m.name.toLowerCase().includes(query.toLowerCase()) ||
        m.userId.split(':')[0].slice(1).toLowerCase().includes(query.toLowerCase())
      )
    : all
  ).slice(0, 8);

  if (!results.length) { closePicker(); return; }

  selectedIdx = Math.min(selectedIdx, results.length - 1);
  picker.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'mention-picker-header';
  header.textContent = 'Mentions';
  picker.appendChild(header);

  results.forEach((member, i) => {
    const item = document.createElement('div');
    item.className = 'mention-item' + (i === selectedIdx ? ' selected' : '');
    item.dataset.userId = member.userId;

    const left = document.createElement('div');
    left.className = 'mention-left';

    const avatarEl = makeAvatar(mxcToUrl(member.getMxcAvatarUrl?.()), member.name[0].toUpperCase(), 'mention-avatar');

    const nameEl = document.createElement('span');
    nameEl.className = 'mention-name';
    nameEl.textContent = member.name;

    left.append(avatarEl, nameEl);

    const idEl = document.createElement('span');
    idEl.className = 'mention-id';
    idEl.textContent = member.userId.split(':')[0];

    item.append(left, idEl);
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      commitMention(member);
    });

    picker.appendChild(item);
  });

  positionPicker();
}

function positionPicker() {
  if (!picker) return;
  const rect = input.getBoundingClientRect();
  picker.style.width  = `${rect.width}px`;
  picker.style.left   = `${rect.left}px`;
  picker.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  picker.style.top    = 'auto';
}

function commitMention(member) {
  const val   = input.value;
  const after = val.slice(input.selectionStart);
  const insertedText = `@${member.name}`;

  input.value = val.slice(0, mentionStart) + insertedText + after;

  const pos = mentionStart + insertedText.length;
  input.setSelectionRange(pos, pos);

  resolvedMentions.set(mentionStart, { member, length: insertedText.length });

  closePicker();
  input.focus();
}

input.addEventListener('keydown', e => {
  if (!picker) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIdx = Math.min(selectedIdx + 1, picker.querySelectorAll('.mention-item').length - 1);
    updateSelected();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIdx = Math.max(selectedIdx - 1, 0);
    updateSelected();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    const sel = picker.querySelector('.mention-item.selected');
    if (sel) {
      e.preventDefault();
      const m = state.client.getRoom(state.roomId)?.getMember(sel.dataset.userId);
      if (m) commitMention(normaliseMember(m));
    }
  } else if (e.key === 'Escape') {
    closePicker();
  }
});

input.addEventListener('input', () => {
  for (const [offset, { length }] of resolvedMentions) {
    const chunk = input.value.slice(offset, offset + length);
    if (!chunk.startsWith('@')) resolvedMentions.delete(offset);
  }

  const textToCaret = input.value.slice(0, input.selectionStart);
  const atIdx = textToCaret.lastIndexOf('@');

  if (atIdx === -1) { closePicker(); return; }

  const fragment = textToCaret.slice(atIdx + 1);
  if (fragment.includes(' ')) { closePicker(); return; }

  if (!picker) {
    mentionStart = atIdx;
    openPicker();
  }

  renderPicker(fragment);
});

input.addEventListener('input', () => {
  if (!input.value) resolvedMentions.clear();
});

input.addEventListener('blur', () => setTimeout(closePicker, 120));
window.addEventListener('resize', positionPicker);

function updateSelected() {
  picker?.querySelectorAll('.mention-item').forEach((el, i) =>
    el.classList.toggle('selected', i === selectedIdx)
  );
}

function normaliseMember(m) {
  const raw = m.name || m.userId.split(':')[0].slice(1);
  const i   = raw.indexOf('(');
  m.name    = i > 0 ? raw.slice(0, i).trim() : raw;
  return m;
}

function getMembersSorted() {
  if (!state.roomId || !state.client) return [];
  const room = state.client.getRoom(state.roomId);
  if (!room) return [];
  const myId = state.client.getUserId();
  return room.getJoinedMembers()
    .filter(m => m.userId !== myId)
    .map(normaliseMember)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

function buildBody(text) {
  const offsets = [...resolvedMentions.keys()].sort((a, b) => a - b);
  let formatted = applyMarkdown(text);

  for (const offset of offsets) {
    const { member } = resolvedMentions.get(offset);
    const tag = escapeHtml(`@${member.name}`);
    formatted = formatted.replace(
      tag,
      `<a href="https://matrix.to/#/${encodeURIComponent(member.userId)}" data-mention="${escapeHtml(member.userId)}">@${escapeHtml(member.name)}</a>`
    );
  }

  resolvedMentions.clear();

  const content = {
    msgtype: 'm.text',
    body: text,
    format: 'org.matrix.custom.html',
    formatted_body: formatted,
  };

  if (state.replyTo) {
    content['m.relates_to'] = { 'm.in_reply_to': { event_id: state.replyTo.getId() } };
    cancelReply();
  }

  return content;
}

function applyMarkdown(text) {
  const spoilers = [];
  text = text.replace(/\|\|(.+?)\|\|/g, (_, content) => {
    spoilers.push(content);
    return `SPOILER${spoilers.length - 1}END`;
  });

  const blocks = [];
  let s = escapeHtml(text);

  s = s.replace(/```[\s\S]*?```/g, match => {
    const lang = match.match(/```(\w+)?/)?.[1] || '';
    const code = match.replace(/```\w*\n?/, '').replace(/```$/, '');
    blocks.push(`<pre><code class="language-${lang}">${code}</code></pre>`);
    return `CODEBLOCK${blocks.length - 1}END`;
  });

  s = s.replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  s = s.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');
  s = s.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<u>$1</u>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/`(.+?)`/g, '<code>$1</code>');
  s = s.replace(/\n/g, '<br>');

  blocks.forEach((block, i) => {
    s = s.replace(`CODEBLOCK${i}END`, block);
  });

  spoilers.forEach((content, i) => {
    s = s.replace(`SPOILER${i}END`, `<span data-mx-spoiler>${escapeHtml(content)}</span>`);
  });

  return s;
}

function clearMentions() { resolvedMentions.clear(); }

// module.exports = { buildBody, clearMentions, applyMarkdown };
export { buildBody, clearMentions, applyMarkdown };