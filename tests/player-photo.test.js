import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedPlayerPhoto } from '../src/server/player-photo.js';
import { aggregatePlayerForm } from '../src/server/player-form.js';
import { playerPhotoHTML, playerPhotoURL, installPlayerPhotoFallback } from '../public/player-photo.js';
import { playerFormHTML } from '../public/analysis-view.js';

const portrait = 'https://a.espncdn.com/i/headshots/nba/players/full/1966.png';

test('player portraits require an ESPN-provided HTTPS image for the exact athlete and sport', () => {
  assert.equal(verifiedPlayerPhoto({ href: portrait }, '1966', 'nba'), portrait);
  assert.equal(playerPhotoURL(portrait, '1966', 'nba'), portrait);
  for (const value of [null, 'javascript:alert(1)', portrait.replace('https:', 'http:'), portrait.replace('a.espncdn.com', 'a.espncdn.com.evil.test'),
    portrait.replace('/1966.png', '/1967.png'), portrait.replace('/nba/', '/nhl/'), `${portrait}?redirect=evil`, `${portrait}#fragment`, portrait.replace('a.espncdn.com', 'user:pass@a.espncdn.com')]) {
    assert.equal(verifiedPlayerPhoto(value, '1966', 'nba'), null);
    assert.equal(playerPhotoURL(value, '1966', 'nba'), null);
  }
  assert.equal(verifiedPlayerPhoto({ href: portrait }, '1966', 'cs2'), null);
});

test('headshot metadata follows the source athlete without altering factual observations or missing portraits', () => {
  const match = { id: 'basketball/nba:100001', sourceEventId: '100001', startTime: '2026-11-17T01:00:00.000Z', homeId: '1', awayId: '2', home: 'Home', away: 'Away' };
  const row = (id, name, headshot, points) => ({ athlete: { id, displayName: name, headshot }, stats: [String(points)] });
  const source = { boxscore: { players: [{ team: { id: '1', displayName: 'Home' }, statistics: [{ labels: ['PTS'], athletes: [
    row('1966', 'LeBron James', { href: portrait }, 21), row('20', 'Another Player', { href: portrait }, 12), row('21', 'No Portrait', undefined, 0),
  ] }] }] } };
  const result = aggregatePlayerForm([{ match, data: source, url: 'https://site.api.espn.com/summary?event=100001' }], { sport: 'nba', teamId: '1' });
  assert.equal(result.players.find(player => player.id === '1966').headshot, portrait);
  assert.equal(result.players.find(player => player.id === '20').headshot, null);
  assert.equal(result.players.find(player => player.id === '21').headshot, null);
  assert.deepEqual(result.players.map(player => player.metrics.PTS.average), [21, 12, 0]);
  assert.ok(result.players.every(player => player.games === 1 && player.metrics.PTS.sample === 1));
});

test('portrait rendering escapes names, loads lazily and keeps initials when an image is missing or fails', () => {
  const html = playerPhotoHTML({ id: '1966', name: 'LeBron James', headshot: portrait }, 'nba');
  assert.match(html, /alt="Zdjęcie: LeBron James"/);
  assert.match(html, /loading="lazy" decoding="async"/);
  assert.match(html, /player-photo-initials" aria-hidden="true">LJ/);
  assert.ok(!html.includes('onerror='));
  const missing = playerPhotoHTML({ id: '1966', name: '<Test> "Player"', headshot: portrait.replace('1966', '1') }, 'nba');
  assert.ok(!missing.includes('<img'));
  assert.match(missing, /Brak zdjęcia: &lt;Test&gt; &quot;Player&quot;/);
  let handler, capture;
  const root = { addEventListener(type, callback, useCapture) { assert.equal(type, 'error'); handler = callback; capture = useCapture; } };
  installPlayerPhotoFallback(root); installPlayerPhotoFallback(root);
  assert.equal(capture, true);
  const attrs = {}, wrapper = { setAttribute(key, value) { attrs[key] = value; } };
  const image = { hidden: false, dataset: { playerName: 'LeBron James' }, matches: selector => selector === 'img[data-player-photo]', closest: () => wrapper };
  handler({ target: image });
  assert.equal(image.hidden, true);
  assert.equal(attrs['aria-label'], 'Brak zdjęcia: LeBron James');
  const form = playerFormHTML({ sport: 'nba', players: [{ id: '1966', name: 'LeBron James', headshot: portrait, games: 8, metrics: {} }], successfulMatches: 8, requestedMatches: 10 }, 'Home');
  assert.match(form, /class="player-identity"/); assert.match(form, /headshots\/nba\/players\/full\/1966.png/);
});
