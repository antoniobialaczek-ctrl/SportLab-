import { footballPortraitFor } from './football-portraits.js';

const SPORTS = { nba: 'nba', nhl: 'nhl', football: 'soccer' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const installed = new WeakSet();

export function playerPhotoURL(value, playerId, sport) {
  const pathSport = SPORTS[sport], id = String(playerId || '');
  if (!pathSport || !/^\d{1,14}$/.test(id) || typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value);
    const portrait = sport === 'football' ? footballPortraitFor(id) : null;
    if (portrait && value === portrait.photoURL) return url.href;
    if (url.protocol !== 'https:' || url.hostname !== 'a.espncdn.com' || url.port || url.username || url.password || url.search || url.hash
      || url.pathname !== `/i/headshots/${pathSport}/players/full/${id}.png`) return null;
    return url.href;
  } catch { return null; }
}

export function playerPhotoHTML(player, sport) {
  const name = typeof player?.name === 'string' && player.name.trim() ? player.name.trim() : 'Zawodnik';
  const words = name.split(/\s+/).filter(Boolean), initials = words.length > 1 ? `${Array.from(words[0])[0]}${Array.from(words.at(-1))[0]}` : Array.from(words[0] || '?').slice(0, 2).join('');
  const portrait = sport === 'football' ? footballPortraitFor(player?.id) : null;
  const candidate = player?.headshot == null || player.headshot === '' ? portrait?.photoURL : player.headshot;
  const source = playerPhotoURL(candidate, player?.id, sport);
  const credit = source && source === portrait?.photoURL ? `<a class="player-photo-credit" href="${esc(portrait.creditURL)}" target="_blank" rel="noopener noreferrer" aria-label="Źródło zdjęcia: TheSportsDB">TheSportsDB</a>` : '';
  return `<span class="player-photo"${source ? '' : ` role="img" aria-label="${esc(`Brak zdjęcia: ${name}`)}"`}><span class="player-photo-initials" aria-hidden="true">${esc(initials.toLocaleUpperCase('pl-PL'))}</span>${source ? `<img src="${esc(source)}" alt="${esc(`Zdjęcie: ${name}`)}" width="64" height="64" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-player-photo data-player-name="${esc(name)}">` : ''}${credit}</span>`;
}

/** Capture is needed because native image errors do not bubble. No inline JS. */
export function installPlayerPhotoFallback(root) {
  if (!root?.addEventListener || installed.has(root)) return;
  installed.add(root);
  root.addEventListener('error', event => {
    const image = event.target;
    if (!image?.matches?.('img[data-player-photo]')) return;
    image.hidden = true;
    const wrapper = image.closest('.player-photo');
    if (wrapper) { wrapper.setAttribute('role', 'img'); wrapper.setAttribute('aria-label', `Brak zdjęcia: ${image.dataset.playerName || 'Zawodnik'}`); }
  }, true);
}
