import { footballPortraitFor } from '../../public/football-portraits.js';

const SPORTS = { nba: 'nba', nhl: 'nhl', football: 'soccer' };

/** A provider image is accepted only when its path identifies this athlete.
 * Missing football portraits use only the catalog's verified identity mapping.
 */
export function verifiedPlayerPhoto(value, playerId, sport) {
  const pathSport = SPORTS[sport], id = String(playerId || '');
  const source = typeof value === 'string' ? value : value?.href;
  if (!pathSport || !/^\d{1,14}$/.test(id)) return null;
  const portrait = sport === 'football' ? footballPortraitFor(id) : null;
  if (source == null || source === '') return portrait?.photoURL ?? null;
  if (typeof source !== 'string' || source.length > 300) return null;
  try {
    const url = new URL(source);
    if (portrait && source === portrait.photoURL) return url.href;
    if (url.protocol !== 'https:' || url.hostname !== 'a.espncdn.com' || url.port || url.username || url.password || url.search || url.hash
      || url.pathname !== `/i/headshots/${pathSport}/players/full/${id}.png`) return null;
    return url.href;
  } catch { return null; }
}
