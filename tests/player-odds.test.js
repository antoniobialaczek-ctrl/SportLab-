import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPlayerOdds, fetchPlayerOdds } from '../src/server/player-odds.js';

const now = Date.parse('2026-11-19T10:00:00Z');
const fixture = { sport: 'nba', route: 'basketball/nba', id: 'basketball/nba:401910020', homeId: '15', awayId: '22', startTime: '2026-11-20T01:00:00.000Z' };
function sample(event = fixture) {
  const id = event.id.slice(event.route.length + 1), [sport, league] = event.route.split('/'), core = `/v2/sports/${sport}/leagues/${league}`;
  const ref = path => ({ $ref: `http://sports.core.api.espn.com${core}${path}?lang=en&region=us` });
  const type = event.sport === 'nba' ? { id: '218', name: 'Points Milestones' } : event.sport === 'nhl' ? { id: '231', name: 'Shots on Goal Milestones' } : { id: '266', name: 'Shots Milestones' };
  const row = { competition: ref(`/events/${id}/competitions/${id}`), athlete: ref('/seasons/2027/athletes/123456'), provider: ref('/casinos/100'), type,
    current: { target: { value: 20, displayValue: '20+' } }, odds: { american: { value: '-110', open: '+250' }, decimal: { value: '1.90', open: '3.50' }, total: { value: '20+', open: '15+' } }, lastUpdated: '2026-11-19T09:58Z' };
  return { summary: { header: { id, season: { year: 2027 }, competitions: [{ id, date: event.startTime,
    status: { type: { state: 'pre', completed: false, name: 'STATUS_SCHEDULED' } }, competitors: [{ id: event.homeId, team: { id: event.homeId }, homeAway: 'home' }, { id: event.awayId, team: { id: event.awayId }, homeAway: 'away' }] }] },
    pickcenter: [{ provider: { id: '100', name: 'DraftKings' }, header: { text: 'Game Odds' } }] },
  props: { count: 1, pageIndex: 1, pageCount: 1, items: [row] },
  rosters: [{ team: { id: event.homeId }, season: { year: 2027 }, athletes: [{ id: '123456' }] }, { team: { id: event.awayId }, season: { year: 2027 }, athletes: [{ id: '654321' }] }] };
}
const extract = (data, event = fixture, time = now) => extractPlayerOdds(data, event, { now: time });

test('a source NBA N+ milestone becomes only the exact over N-0.5 price with identity and settlement proof', () => {
  const result = extract(sample()), quote = result.quotes[0];
  assert.equal(result.status, 'available'); assert.equal(result.truncated, false); assert.equal(result.maxQuotes, 500);
  assert.equal(quote.quoteKind, 'milestone'); assert.equal(quote.threshold, 20); assert.equal(quote.line, 19.5);
  assert.equal(quote.playerId, '123456'); assert.equal(quote.teamId, '15'); assert.equal(quote.metric, 'PTS');
  assert.equal(quote.scope, 'including_overtime'); assert.equal(quote.providerId, '100');
  assert.equal(quote.quotedAt, null); assert.equal(quote.freshness, 'unverified');
  assert.equal(quote.sourceRecordUpdatedAt, '2026-11-19T09:58:00.000Z'); assert.equal(quote.timestampBasis, 'source-record-lastUpdated');
  assert.equal(quote.maxSourceRecordAgeMs, 86400000);
  assert.deepEqual(quote.outcomes.map(x => [x.direction, x.line, x.american, x.decimal]), [['over', 19.5, -110, 1.909091]]);
  assert.equal(quote.readOnly, true); assert.equal(quote.usableForComparison, false);
  assert.equal(Date.parse(quote.observationValidUntil) - now, 300000);
  assert.equal(quote.scopeBasis.checkedAt, '2026-11-19T00:00:00.000Z');
  assert.ok(!JSON.stringify(result).includes('probability'));
});

test('NBA assists and rebounds require their exact type ID and full-game milestone label', () => {
  for (const [id, name, metric] of [['219', 'Assists Milestones', 'AST'], ['220', 'Rebounds Milestones', 'REB']]) {
    const data = sample(); data.props.items[0].type = { id, name };
    assert.equal(extract(data).quotes[0].metric, metric);
    data.props.items[0].type.name += ' - 1st Quarter'; assert.equal(extract(data).quotes.length, 0);
  }
  const data = sample(); data.props.items[0].type.id = '1'; assert.equal(extract(data).quotes.length, 0);
});

test('unordered ordinary over/under rows and opening prices never substitute for milestone prices', () => {
  const data = sample(); data.props.items[0].type = { id: '1', name: 'Total Points' };
  const second = structuredClone(data.props.items[0]); second.odds.american.value = '+110';
  data.props.items.push(second); data.props.count = 2;
  assert.equal(extract(data).quotes.length, 0);
  for (const mutate of [row => delete row.odds.american.value, row => delete row.current.target,
    row => row.current.target.displayValue = '19.5', row => row.odds.total.value = '21+',
    row => row.current.target.value = 20.5, row => row.period = 1,
    row => row.odds.decimal.value = '2.50']) {
    const source = sample(); mutate(source.props.items[0]); assert.equal(extract(source).quotes.length, 0);
  }
});

test('wrong match, competition, provider, athlete season and untrusted ref hosts cannot bind prices', () => {
  for (const mutate of [data => data.summary.header.id = '999999', data => data.summary.header.competitions.push(structuredClone(data.summary.header.competitions[0])),
    data => data.summary.header.competitions[0].date = '2026-11-20T02:00:00Z',
    data => data.summary.header.competitions[0].competitors[0].team.id = '22',
    data => data.summary.pickcenter[0].provider.name = 'Different Book',
    data => data.props.items[0].competition.$ref = data.props.items[0].competition.$ref.replaceAll('401910020', '401910021'),
    data => data.props.items[0].provider.$ref = data.props.items[0].provider.$ref.replace('casinos/100', 'casinos/101'),
    data => data.props.items[0].athlete.$ref = data.props.items[0].athlete.$ref.replace('seasons/2027', 'seasons/2026'),
    data => data.props.items[0].athlete.$ref = data.props.items[0].athlete.$ref.replace('sports.core.api.espn.com', 'espn.example.com'),
    data => data.props.items[0].athlete.$ref = data.props.items[0].athlete.$ref.replace('http://', 'http://user:pass@'),
    data => data.props.items[0].team = { $ref: 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/teams/22' }]) {
    const data = sample(); mutate(data); assert.equal(extract(data).quotes.length, 0);
  }
});

test('current roster membership uses IDs, rejects conflicts and accepts NHL grouped rosters', () => {
  for (const mutate of [data => data.rosters[0].team.id = '99', data => data.rosters[0].season.year = 2026,
    data => data.rosters[0].athletes[0].id = '000001', data => data.rosters[1].athletes.push({ id: '123456' }),
    data => data.rosters[0].athletes[0].team = { id: '22' }]) {
    const data = sample(); mutate(data); assert.equal(extract(data).quotes.length, 0);
  }
  const event = { ...fixture, sport: 'nhl', route: 'hockey/nhl', id: 'hockey/nhl:401892742' }, data = sample(event);
  data.rosters.forEach(roster => roster.athletes = [{ position: 'Centers', items: roster.athletes }]);
  const quote = extract(data, event).quotes[0]; assert.equal(quote.metric, 'S'); assert.equal(quote.scope, 'including_overtime_excluding_shootout');
});

test('football explicit current.over milestone prices retain shots and regulation scope', () => {
  const event = { ...fixture, sport: 'football', route: 'soccer/eng.1', id: 'soccer/eng.1:401879233' }, data = sample(event);
  delete data.props.items[0].odds;
  data.props.items[0].current.over = { american: '+150', decimal: 2.5 };
  const quote = extract(data, event).quotes[0];
  assert.equal(quote.metric, 'SH'); assert.equal(quote.scope, 'regulation_90'); assert.equal(quote.outcomes[0].decimal, 2.5);
  assert.equal(extract(data, { ...event, route: 'soccer/pol.1', id: 'soccer/pol.1:401879233' }).quotes.length, 0);
});

test('future, older-than-24h, missing or invalid source record timestamps are rejected', () => {
  for (const value of ['2026-11-19T12:25Z', '2026-11-18T09:59Z', '2026-11-17T10:00Z', '2026-11-19', '2026-13-19T09:58Z', null, undefined]) {
    const data = sample(); data.props.items[0].lastUpdated = value;
    assert.equal(extract(data).quotes.length, 0);
  }
  assert.equal(extract(sample(), fixture, Date.parse('2026-12-20T10:00:00Z')).quotes.length, 0);
});

test('an observed static record retains its real age without certifying bookmaker quote freshness', () => {
  for (const value of ['2026-11-19T09:42Z', '2026-11-18T10:00Z']) {
    const data = sample(); data.props.items[0].lastUpdated = value;
    const result = extract(data), quote = result.quotes[0];
    assert.equal(result.status, 'available'); assert.equal(quote.sourceRecordUpdatedAt, new Date(value).toISOString());
    assert.equal(quote.quotedAt, null); assert.equal(quote.freshness, 'unverified');
    assert.equal(quote.observedAt, new Date(now).toISOString());
    assert.equal(Date.parse(quote.observationValidUntil) - now, 300000);
    assert.equal(quote.usableForComparison, false); assert.equal(quote.readOnly, true);
  }
  const shortlyBeforeStart = Date.parse(fixture.startTime) - 60000, data = sample();
  data.props.items[0].lastUpdated = new Date(shortlyBeforeStart - 18 * 60000).toISOString();
  const result = extract(data, fixture, shortlyBeforeStart);
  assert.equal(result.quotes[0].observationValidUntil, fixture.startTime);
});

test('started or postponed fixtures, incomplete collections and conflicting duplicate prices fail closed', () => {
  assert.equal(extract(sample(), fixture, Date.parse(fixture.startTime)).status, 'closed');
  for (const mutate of [data => data.summary.header.competitions[0].status.type.name = 'STATUS_POSTPONED',
    data => data.props.count = 2, data => data.props.pageCount = 2,
    data => { const row = structuredClone(data.props.items[0]); row.odds.american.value = '+150'; row.odds.decimal.value = '2.50'; data.props.items.push(row); data.props.count++; }]) {
    const data = sample(); mutate(data); assert.equal(extract(data).quotes.length, 0);
  }
});

test('fetch helper performs only fixed public ESPN reads and timestamps observation after completion', async () => {
  const data = sample(), urls = [], times = [now, now + 1000];
  const result = await fetchPlayerOdds(data.summary, fixture, { clock: () => times.shift() ?? now + 1000, fetchImpl: async (url, options) => {
    urls.push(url); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    const body = url.includes('/propBets?') ? { ...data.props, pageSize: 1000 } : url.includes('/teams/15/') ? data.rosters[0] : data.rosters[1];
    return new Response(JSON.stringify(body), { status: 200 });
  } });
  assert.equal(urls.length, 3); assert.ok(urls.every(url => /^https:\/\/(?:sports\.core\.api|site\.api)\.espn\.com\//.test(url)));
  assert.equal(result.fetchedAt, '2026-11-19T10:00:01.000Z'); assert.equal(result.status, 'available');
  let calls = 0; const invalid = await fetchPlayerOdds(data.summary, { ...fixture, route: 'file:///etc/passwd' }, { now, fetchImpl: async () => { calls++; } });
  assert.equal(calls, 0); assert.equal(invalid.quotes.length, 0);
});

test('pagination is complete and coherent, while source failures do not break match details', async () => {
  const data = sample(), urls = [], second = structuredClone(data.props.items[0]); second.current.target = { value: 25, displayValue: '25+' }; second.odds.total.value = '25+';
  const result = await fetchPlayerOdds(data.summary, fixture, { now, fetchImpl: async url => {
    urls.push(url); const body = url.includes('&page=2') ? { count: 2, pageCount: 2, pageIndex: 2, pageSize: 1, items: [second] }
      : url.includes('/propBets?') ? { count: 2, pageCount: 2, pageIndex: 1, pageSize: 1, items: data.props.items }
        : url.includes('/teams/15/') ? data.rosters[0] : data.rosters[1];
    return new Response(JSON.stringify(body), { status: 200 });
  } });
  assert.equal(urls.length, 4); assert.equal(result.quotes.length, 2);
  assert.deepEqual(result.quotes.map(row => row.line), [19.5, 24.5]);
  const failed = await fetchPlayerOdds(data.summary, fixture, { now, fetchImpl: async () => { throw new Error('timeout'); } });
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.quotes.length, 0);
  assert.match(failed.reason, /chwilowo/);
});
