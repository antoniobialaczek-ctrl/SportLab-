import test from 'node:test';
import assert from 'node:assert/strict';
import { playerFormHTML } from '../public/analysis-view.js';

const metric = (label, values) => ({
  label, sample: values.length, average: values.reduce((sum, value) => sum + value, 0) / values.length,
  last5Average: values.at(-1), median: values[0],
  observations: values.map((value, index) => ({ matchId: `basketball/nba:${10000 + index}`, date: `2024-11-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`, value })),
});
const fixture = () => ({ sport: 'nba', teamId: '1', players: [
  { id: '101', name: 'Alpha Player', games: 2, metrics: { REB: metric('Zbiórki', [3, 4]), PTS: metric('Punkty', [20, 22]) } },
  { id: '102', name: 'Beta Player', games: 2, metrics: { PTS: metric('Punkty', [12, 14]), AST: metric('Asysty', [6, 7]) } },
] });
const values = html => [...html.matchAll(/data-value="(\d+)"/g)].map(match => Number(match[1]));

test('the explorer selects the requested athlete and stat, with a sport-specific default', () => {
  const data = fixture();
  const defaultHTML = playerFormHTML(data, 'Test Team');
  assert.match(defaultHTML, /<option value="101" selected>/);
  assert.match(defaultHTML, /<option value="PTS" selected>Punkty<\/option>/);
  assert.deepEqual(values(defaultHTML), [20, 22]);
  const selectedHTML = playerFormHTML(data, 'Test Team', { playerId: '102', metric: 'AST', eventId: 'basketball/nba:99999' });
  assert.match(selectedHTML, /<option value="102" selected>/);
  assert.match(selectedHTML, /<option value="AST" selected>Asysty<\/option>/);
  assert.match(selectedHTML, /<h4>Beta Player<\/h4>/);
  assert.match(selectedHTML, /data-event-id="basketball\/nba:99999"/);
  assert.deepEqual(values(selectedHTML), [6, 7]);
  assert.deepEqual(values(playerFormHTML(data, 'Test Team', { playerId: 'unknown', metric: 'unknown' })), [20, 22]);
});

test('athlete names, stat labels and explorer attributes escape untrusted text', () => {
  const unsafe = '"><script>alert(1)</script>';
  const data = fixture();
  data.teamId = unsafe;
  data.players = [{ id: unsafe, name: '<img src=x onerror=alert(1)>', games: 2, metrics: { PTS: metric('<svg onload=alert(1)>', [2, 3]) } }];
  data.errors = ['<iframe src=x>'];
  const html = playerFormHTML(data, '<b>Team</b>', { playerId: unsafe, eventId: unsafe });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<iframe'));
  assert.ok(!html.includes('<svg onload'));
  assert.match(html, /data-team-id="&quot;&gt;&lt;script&gt;/);
  assert.match(html, /data-event-id="&quot;&gt;&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
  assert.match(html, /&lt;b&gt;Team&lt;\/b&gt;/);
  assert.deepEqual(values(html), [2, 3]);
});

test('missing observations show chart unavailability while an actual zero remains visible as a value', () => {
  const data = fixture();
  data.players = [data.players[0]];
  data.players[0].metrics = { PTS: { label: 'Punkty', sample: 0 } };
  const unavailable = playerFormHTML(data, 'Test Team');
  assert.match(unavailable, /class="pc-unavailable"/);
  assert.match(unavailable, /Brak wcześniejszych wyników zawodnika do wykresu/);
  assert.ok(!unavailable.includes('<svg'));
  assert.deepEqual(values(unavailable), []);
  data.players[0].metrics.PTS = metric('Punkty', [0]);
  const available = playerFormHTML(data, 'Test Team');
  assert.match(available, /class="pc-svg"/);
  assert.match(available, /class="pc-bar"[^>]*height="0"/);
  assert.deepEqual(values(available), [0]);
});

test('profile labels the latest available outing and warns about a newer team game or stale schedule', () => {
  const data = fixture();
  data.view = 'latest'; data.fetchedAt = '2024-11-04T12:00:00.000Z';
  data.attemptedMatches = [{ date: '2024-11-03T12:00:00.000Z' }];
  data.recentHistory = { coverage: { status: 'fallback' } };
  const html = playerFormHTML(data, 'Test Team');
  assert.match(html, /Ostatni dostępny występ w tej lidze: <b>2\.11\.2024<\/b>/);
  assert.match(html, /Nie jest to stan sprzed wybranego meczu/);
  assert.match(html, /Nowszy mecz drużyny: 3\.11\.2024/);
  assert.match(html, /nie potwierdza pełnej aktualności historii/);
});
