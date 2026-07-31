import state from './state.js';

function mxcToUrl(mxc) {
  if (!mxc?.startsWith('mxc://')) return null;
  try {
    const [server, mediaId] = mxc.slice(6).split('/');
    const base = state.client.getHomeserverUrl();
    const token = state.client.getAccessToken();
    return `${base}/_matrix/client/v1/media/download/${server}/${mediaId}?access_token=${token}`;
  } catch {
    return null;
  }
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function linkify(text) {
  const urlPattern = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/gim;
  return escapeHtml(text).replace(urlPattern, url =>
    `<a href="${url}" class="message-link" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
}

function makeAvatar(mxcUrl, letter, extraClass = '') {
  const el = document.createElement('div');
  if (extraClass) el.className = extraClass;

  if (mxcUrl) {
    const img = document.createElement('img');
    img.src = mxcUrl;
    img.alt = letter;
    img.addEventListener('error', () => {
      img.replaceWith(makeFallback(letter));
    });
    el.appendChild(img);
  } else {
    el.appendChild(makeFallback(letter));
  }

  return el;
}

function makeFallback(letter) {
  const d = document.createElement('div');
  d.className = 'avatar-fallback';
  d.textContent = letter;
  return d;
}

function getAverageColor(imgUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onerror = () => resolve('#5865f2');
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
      const n = d.length / 4;
      resolve(`rgb(${Math.floor(r/n)},${Math.floor(g/n)},${Math.floor(b/n)})`);
    };
    img.src = imgUrl;
  });
}

function scrollToBottom() {
  const c = document.getElementById('messages-container');
  c.scrollTop = c.scrollHeight;
}

module.exports = { mxcToUrl, escapeHtml, linkify, makeAvatar, getAverageColor, scrollToBottom };
