import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchContext, extractAvailability } from '../src/server/match-context.js';
import { buildMatchAnalysis } from '../src/server/match-analysis.js';
import { contextHTML, availabilityHTML } from '../public/context-view.js';

const route = 'basketball/nba';
const cutoff = '2026-01-20T12:00:00.000Z';
const query = { sport: 'nba', route, homeId: '1', awayId: '2', cutoff, fixtureId: `${route}:9000` };
function row(id, day, homeId, awayId, homeScore = 100, awayScore = 90, overrides = {}) {
  return { id: `${route}:${id}`, route, sport: 'nba', startTime: `2026-01-${String(day).padStart(2, '0')}T12:00:00.000Z`,
    resultAvailableAt: `2026-01-${String(day + 1).padStart(2, '0')}T12:00:00.000Z`,
    homeId, awayId, home: `Team ${homeId}`, away: `Team ${awayId}`, homeScore, awayScore,
    neutralSite: false, ...overrides };
}
function summary(state = 'pre') {
  return { header: { id: '9000', competitions: [{ id: '9000', date: '2026-01-21T12:00:00Z', status: { type: { state } },
    competitors: [{ id: '1', team: { id: '1', displayName: 'Team 1' } }, { id: '2', team: { id: '2', displayName: 'Team 2' } }] }] },
    injuries: [{ team: { id: '1' }, injuries: [{ athlete: { id: '11', displayName: 'Player 11' }, status: 'Out', date: '2026-01-19T12:00:00Z' }] }],
    rosters: [{ team: { id: '1' }, roster: [{ athlete: { id: '12', displayName: 'Player 12' }, starter: true }, { athlete: { id: '13', displayName: 'Player 13' }, starter: false }] }] };
}
const fetchOptions = { id: '9000', sport: 'nba', fetchedAt: cutoff };
const event = { sourceEventId: '9000', sport: 'nba', state: 'pre', date: '2026-01-21T12:00:00Z', homeId: '1', awayId: '2', home: 'Team 1', away: 'Team 2' };

test('opponent strength uses information before the earlier match, excluding later known improvement', () => {
  const rows = [row('1000', 2, '3', '4'), row('1001', 5, '4', '3', 110, 90), row('1002', 10, '1', '3'),
    row('1003', 12, '3', '5'), row('1004', 15, '2', '5')];
  const context = buildMatchContext(rows, query);
  const opponent = context.home.opposition.details[0];
  assert.equal(opponent.opponentId, '3');
  assert.equal(opponent.sample, 2);
  assert.equal(opponent.wins, 1);
  assert.equal(opponent.losses, 1);
  assert.equal(context.home.opposition.averageWinShare, 0.5);
  assert.equal(context.home.schedule.matchesLast14Days, 1);
  assert.equal(context.home.schedule.matchesLast7Days, 0);
  assert.equal(context.home.schedule.hoursFromLatestStart, 240);
});

test('context excludes source results at cutoffs, target fixture, another league and future matches', () => {
  const base = row('1000', 10, '1', '3');
  const context = buildMatchContext([base,
    row('1001', 11, '1', '4', 100, 90, { resultAvailableAt: cutoff }),
    row('1002', 12, '1', '5', 100, 90, { route: 'basketball/other' }),
    row('1003', 21, '1', '6'), row('9000', 13, '1', '2'),
    row('1004', 8, '3', '7', 100, 90, { resultAvailableAt: base.startTime }),
  ], query);
  assert.equal(context.home.schedule.sample, 1);
  assert.equal(context.home.opposition.details[0].sample, 0);
  assert.equal(context.home.opposition.averageWinShare, null);
  assert.equal(context.away.schedule.hoursFromLatestStart, null);
});

test('descriptive context is integrated without producing probabilities; tennis surface remains explicit', () => {
  const analysis = buildMatchAnalysis([row('1000', 10, '1', '2')], query);
  assert.equal(analysis.context.home.schedule.sample, 1);
  assert.equal(analysis.context.tennisSurface.status, 'unavailable');
  assert.ok(!JSON.stringify(analysis.context).includes('probability'));
  const html = contextHTML(analysis, { ...event, sport: 'tennis' });
  assert.match(html, /Nawierzchnia/);
  assert.match(html, /zweryfikowanych oznaczeń nawierzchni/);
  assert.match(html, /nie prognozą/);
});

test('availability is bound to exact competition and team identities, never a matching name alone', () => {
  const data = summary();
  data.injuries.push({ team: { id: '9', displayName: 'Team 1' }, injuries: [{ athlete: { id: '91', displayName: 'Wrong team player' }, status: 'Out' }] });
  data.injuries[0].injuries.push({ athlete: { id: '98', displayName: 'Conflicting team', team: { id: '9' } }, status: 'Out' });
  const availability = extractAvailability(data, fetchOptions);
  assert.equal(availability.identityVerified, true);
  assert.deepEqual(availability.teams[0].injuries.items.map(player => player.id), ['11']);
  assert.equal(availability.teams[1].injuries.status, 'unavailable');
  assert.deepEqual(extractAvailability(data, { ...fetchOptions, id: '9999' }).teams, []);
  const conflicting = summary(); conflicting.header.competitions[0].competitors[0].id = '9';
  assert.equal(extractAvailability(conflicting, fetchOptions).identityVerified, false);
});

test('reported starters never become confirmed pregame lineups and bench entries are excluded', () => {
  const availability = extractAvailability(summary(), fetchOptions);
  assert.equal(availability.teams[0].lineup.status, 'reported');
  assert.equal(availability.teams[0].lineup.confirmed, false);
  assert.deepEqual(availability.teams[0].lineup.players.map(player => player.id), ['12']);
  const source = summary(); source.rosters = [];
  source.boxscore = { players: [{ team: { id: '1' }, statistics: [{ athletes: [{ athlete: { id: '15', displayName: 'Observed starter' }, starter: true }] }] }] };
  assert.equal(extractAvailability(source, fetchOptions).teams[0].lineup.status, 'unavailable');
  source.header.competitions[0].status.type.state = 'post';
  const post = extractAvailability(source, { ...fetchOptions, fetchedAt: '2026-01-22T12:00:00Z' });
  assert.equal(post.teams[0].lineup.status, 'postgame');
  assert.equal(post.teams[0].lineup.players[0].id, '15');
});

test('availability HTML shows absence as unknown, suppresses hindsight and rejects mismatched fixtures', () => {
  const details = { availability: extractAvailability(summary(), fetchOptions) };
  const before = { now: Date.parse(cutoff) };
  const html = availabilityHTML(details, event, before);
  assert.match(html, /Player 11 — Out/);
  assert.match(html, /nie potwierdza pełnej dostępności/);
  assert.match(html, /brak odrębnego potwierdzenia składu/);
  const archived = availabilityHTML(details, { ...event, state: 'post' }, before);
  assert.ok(!archived.includes('Player 11'));
  assert.match(archived, /nie potwierdzają wiedzy/);
  const mismatch = availabilityHTML(details, { ...event, awayId: '9' }, before);
  assert.ok(!mismatch.includes('Player 11'));
  assert.match(mismatch, /nie potwierdziło danych/);
});

test('new context renders escaped names from both historical opponents and live availability', () => {
  const analysis = buildMatchAnalysis([row('1000', 2, '3', '4'), row('1001', 10, '1', '3', 100, 90, { away: '<img src=x onerror=alert(1)>' })], query);
  const historical = contextHTML(analysis, { ...event, home: '<script>bad()</script>' });
  assert.ok(!historical.includes('<img'));
  assert.ok(!historical.includes('<script>'));
  assert.match(historical, /&lt;img/);
  const source = summary(); source.injuries[0].injuries[0].athlete.displayName = '<img src=x>';
  const html = availabilityHTML({ availability: extractAvailability(source, fetchOptions) }, event, { now: Date.parse(cutoff) });
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
});
