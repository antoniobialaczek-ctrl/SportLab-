import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerPicks, evaluatePlayerLine, playerPicksHTML } from '../public/player-picks.js';

const now = Date.parse('2026-11-18T12:00:00.000Z');
const event = { id: 'basketball/nba:90000', sport: 'nba', route: 'basketball/nba', state: 'pre', date: '2026-11-19T00:00:00.000Z', homeId: '1', awayId: '2', home: 'Test A', away: 'Test B' };
function fixture() {
  const sampledMatches = Array.from({ length: 10 }, (_, index) => ({ id: `basketball/nba:${10000 + index}`, date: new Date(now - (index + 1) * 86400000).toISOString() }));
  function metric(values) { return { average: 0, sample: values.length, observations: values.map((value, index) => ({ matchId: sampledMatches[index].id, date: sampledMatches[index].date, value })) }; }
  return { sport: 'nba', route: event.route, teamId: '1', status: 'available', cutoff: '2026-11-18T11:59:00.000Z', sampledMatches,
    attemptedMatches: sampledMatches.map(match => ({ ...match, status: 'available' })),
    players: [
      { id: '101', name: 'Test Scorer', metrics: { PTS: metric([31, 28, 27, 30, 26, 29, 25, 22, 33, 20]), AST: metric([8, 6, 7, 5, 8, 6, 7, 4, 8, 5]), REB: metric([7, 8, 9, 8, 7, 8, 10, 7, 9, 8]) } },
      { id: '102', name: 'Test Big', metrics: { PTS: metric([16, 17, 18, 16, 17, 20, 15, 18, 19, 12]), REB: metric([12, 11, 14, 13, 12, 11, 10, 9, 13, 8]) } },
    ] };
}
const build = (data = fixture(), selectedEvent = event, options = {}) => buildPlayerPicks(data, selectedEvent, { now, ...options });

test('player screens produce concrete diverse half-point lines and recompute factual counts', () => {
  const result = build();
  assert.equal(result.status, 'available');
  assert.ok(result.picks.some(pick => pick.playerId === '101' && pick.metric === 'PTS' && pick.line === 24.5));
  assert.ok(result.picks.some(pick => pick.metric === 'AST'));
  assert.ok(result.picks.some(pick => pick.metric === 'REB'));
  const points = result.picks.find(pick => pick.playerId === '101' && pick.metric === 'PTS');
  assert.equal(points.hits, 8); assert.equal(points.sample, 10); assert.equal(points.average, 27.1);
  assert.match(points.statement, /powyżej 24,5 punktu/);
  assert.equal(points.probability, undefined); assert.equal(points.confidence, undefined); assert.equal(points.expectedValue, undefined);
  assert.ok(result.picks.length <= 6);
  for (const id of ['101', '102']) assert.ok(result.picks.filter(pick => pick.playerId === id).length <= 2);
});

test('undersized, duplicated, future, mismatched and missing-latest observations never become picks', () => {
  for (const mutate of [
    data => { for (const player of data.players) for (const metric of Object.values(player.metrics)) {metric.observations.length = 7; metric.sample = 7;} },
    data => { for (const player of data.players) for (const metric of Object.values(player.metrics)) metric.observations[1].matchId = metric.observations[0].matchId; },
    data => data.cutoff = '2026-11-18T13:00:00.000Z',
    data => data.teamId = '3', data => data.route = 'basketball/other',
    data => data.sampledMatches[0].date = '2026-11-18T12:01:00.000Z',
    data => data.attemptedMatches.unshift({ id: 'basketball/nba:20000', date: '2026-11-18T01:00:00.000Z', status: 'unavailable' }),
    data => { for (const player of data.players) for (const metric of Object.values(player.metrics)) metric.observations[0].date = '2026-11-17T11:00:00.000Z'; },
    data => data.players.push(structuredClone(data.players[0]), structuredClone(data.players[1])),
  ]) {
    const data = fixture(); mutate(data);
    assert.equal(build(data).picks.length, 0);
  }
  assert.equal(build(fixture(), { ...event, state: 'post' }).status, 'closed');
  assert.equal(build(fixture(), { ...event, state: 'in' }).status, 'closed');
  assert.equal(build(fixture(), { ...event, date: new Date(now).toISOString() }).picks.length, 0);
  assert.equal(build(fixture(), { ...event, date: '2026-11-21T00:00:00Z' }).picks.length, 0);
});

test('eight actual appearances suffice but recent decline or an excluded player prevents its picks', () => {
  const data = fixture(); data.players = [data.players[0]];
  for (const metric of Object.values(data.players[0].metrics)) { metric.observations.length = 8; metric.sample = 8; }
  assert.ok(build(data).picks.length > 0);
  assert.equal(build(data, event, { excludedPlayerIds: ['101'] }).picks.length, 0);
  const declined = fixture(); declined.players = [declined.players[0]];
  for (const metric of Object.values(declined.players[0].metrics)) metric.observations.slice(0, 5).forEach(row => { row.value = 0; });
  assert.equal(build(declined).picks.length, 0);
});

test('manual line comparison reports observed hits without inventing a bookmaker quote or chance', () => {
  const data = fixture();
  const value = evaluatePlayerLine(data, event, '101', 'PTS', 29.5, { now });
  assert.equal(value.status, 'available'); assert.equal(value.comparison.hits, 3); assert.equal(value.comparison.qualifies, false);
  const under = evaluatePlayerLine(data, event, '101', 'PTS', 29.5, { now, direction: 'under' });
  assert.equal(under.comparison.hits, 7); assert.equal(under.comparison.direction, 'under'); assert.match(under.comparison.statement, /poniżej 29,5/);
  const recentDecline = fixture();
  recentDecline.players[0].metrics.PTS.observations.forEach((row, index) => {row.value = index < 3 ? 0 : 30;});
  const decline = evaluatePlayerLine(recentDecline, event, '101', 'PTS', 24.5, { now });
  assert.equal(decline.comparison.hits, 7); assert.equal(decline.comparison.median, 30);
  assert.equal(decline.comparison.last5Average, 12); assert.equal(decline.comparison.qualifies, false);
  assert.equal(evaluatePlayerLine(data, event, '101', 'PTS', 29, { now }).status, 'unavailable');
  const override = build(data, event, { lineOverrides: { '101:PTS': 19.5 } });
  assert.equal(override.picks.find(pick => pick.metric === 'PTS' && pick.playerId === '101').line, 19.5);
});

test('NHL and football screens use shot observations with the correct labels', () => {
  for (const [sport, route, metric, word] of [['nhl', 'hockey/nhl', 'S', 'na bramkę'], ['football', 'soccer/eng.1', 'SH', 'strzału']]) {
    const data = fixture(); data.sport = sport; data.route = route;
    data.sampledMatches.forEach(match => {match.id = match.id.replace('basketball/nba', route);});
    data.attemptedMatches = data.sampledMatches.map(match => ({ ...match, status: 'available' }));
    const observations = data.sampledMatches.map((match, index) => ({ matchId: match.id, date: match.date, value: index < 8 ? 4 : 2 }));
    data.players = [{ id: '101', name: 'Test Shooter', metrics: { [metric]: { sample: 10, observations } } }];
    const result = build(data, { ...event, sport, route, id: `${route}:90000` });
    assert.equal(result.picks[0].line, 3.5); assert.match(result.picks[0].statement, new RegExp(word));
  }
});

test('rendered picks escape names and explain analytical lines once without repeated blocked verdicts', () => {
  const data = fixture(); data.players[0].name = '<img src=x onerror=alert(1)>';
  const html = playerPicksHTML(data, event, { now });
  assert.match(html, /Typy na zawodników/); assert.match(html, /8 z 10/);
  assert.match(html, /Mediana/); assert.match(html, /Ostatnie 5/);
  assert.match(html, /data-player-line data-player-id="101" data-team-id="1" data-metric="PTS"/);
  assert.match(html, /Sprawdź własną linię/); assert.match(html, /name="direction"/);
  assert.match(html, /value="under">Poniżej/); assert.match(html, /data-line-result role="status"/);
  assert.match(html, /&lt;img/); assert.ok(!html.includes('<img'));
  assert.equal((html.match(/Linie analityczne/g) || []).length, 1);
  assert.equal(playerPicksHTML(data, event, { now, showNote: false }).includes('Linie analityczne'), false);
  assert.ok(!html.includes('brak potwierdzonej przewagi'));
  assert.ok(!html.includes('%'));
});

test('verified source milestones choose an offered qualifying line and never borrow another athlete price', () => {
  const offer = line => ({ provider: 'DraftKings', providerId: '100', market: 'player_prop', quoteKind: 'milestone', threshold: line + 0.5,
    playerId: '101', teamId: event.homeId, metric: 'PTS', line, scope: 'including_overtime', observedAt: new Date(now - 30000).toISOString(), quotedAt: new Date(now - 30000).toISOString(), freshness: 'fresh',
    outcomes: [{ direction: 'over', side: 'over', decimal: 1.8 }] });
  const oddsData = { fixtureId: event.id, sport: event.sport, route: event.route, homeId: event.homeId, awayId: event.awayId,
    startTime: event.date, fetchedAt: new Date(now - 30000).toISOString(), status: 'available', quotes: [offer(19.5), offer(23.5)] };
  const selected = build(fixture(), event, { oddsData }).picks.find(pick => pick.playerId === '101' && pick.metric === 'PTS');
  assert.equal(selected.line, 23.5); assert.equal(selected.lineOrigin, 'source'); assert.equal(selected.priceAvailable, true);
  assert.equal(selected.hits, 8); assert.equal(selected.sample, 10);
  const other = build(fixture(), event, { oddsData: { ...oddsData, quotes: [{ ...offer(23.5), playerId: '999' }] } }).picks.find(pick => pick.playerId === '101' && pick.metric === 'PTS');
  assert.equal(other.line, 24.5); assert.equal(other.lineOrigin, 'analytical'); assert.equal(other.priceAvailable, false);
  const expired = build(fixture(), event, { oddsData: { ...oddsData, fetchedAt: new Date(now - 360000).toISOString() } }).picks.find(pick => pick.playerId === '101' && pick.metric === 'PTS');
  assert.equal(expired.lineOrigin, 'analytical'); assert.equal(expired.priceAvailable, false);
});
