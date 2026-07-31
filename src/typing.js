import state from './state.js';

const indicator = document.createElement('div');
indicator.className = 'typing-indicator';
let typingTimeout = null;
let isTyping = false;
const messageInput = document.getElementById('message-input');

function init() {
document.querySelector('.status-row').appendChild(indicator);
  state.client.on('RoomMember.typing', () => {
    if (!state.roomId) return;
    const room = state.client.getRoom(state.roomId);
    if (!room) return;

    const typers = room.currentState.getMembers()
      .filter(m => m.typing && m.userId !== state.client.getUserId());

    if (!typers.length) { indicator.innerHTML = ''; return; }

    const names = typers.map(m => {
      const raw = m.name || m.userId.split(':')[0].slice(1);
      const i = raw.indexOf('(');
      return i > 0 ? raw.slice(0, i).trim() : raw;
    });

    const text = names.length === 1 ? `${names[0]} is typing`
               : names.length === 2 ? `${names[0]} and ${names[1]} are typing`
               : 'Several people are typing';

    indicator.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span><span class="typing-text">${text}</span>`;
  });
}

function clearTyping() { indicator.innerHTML = ''; }

function checkCurrentTypers() {
  if (!state.roomId || !state.client) return;
  const room = state.client.getRoom(state.roomId);
  if (!room) return;
  const typers = room.currentState.getMembers()
    .filter(m => m.typing && m.userId !== state.client.getUserId());
  if (!typers.length) { indicator.innerHTML = ''; return; }
  const names = typers.map(m => {
    const raw = m.name || m.userId.split(':')[0].slice(1);
    const i = raw.indexOf('(');
    return i > 0 ? raw.slice(0, i).trim() : raw;
  });
  const text = names.length === 1 ? `${names[0]} is typing`
             : names.length === 2 ? `${names[0]} and ${names[1]} are typing`
             : 'Several people are typing';
  indicator.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span><span class="typing-text">${text}</span>`;
}

messageInput.addEventListener('input', () => {
  if (!state.roomId || !state.client) return;
  if (!isTyping) {
    state.client.sendTyping(state.roomId, true, 4000);
    isTyping = true;
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    state.client.sendTyping(state.roomId, false);
    isTyping = false;
  }, 3000);
});

messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && isTyping) {
    clearTimeout(typingTimeout);
    state.client.sendTyping(state.roomId, false);
    isTyping = false;
  }
});

module.exports = { init, clearTyping, checkCurrentTypers };