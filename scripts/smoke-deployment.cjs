const assert = require('node:assert/strict');

async function main() {
  const [target, ...args] = process.argv.slice(2);
  if (!target) throw new Error('Użycie: npm run smoke -- https://adres-wdrożenia [--date RRRR-MM-DD] [--sport nba] [--expected-football-leagues 11]');
  const base = new URL(target);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Podaj sam adres strony bez danych logowania, ścieżki i parametrów.');
  }
  let date = new Date(Date.now() - 86400000).toISOString().slice(0, 10), sport = 'nba', expectedFootballLeagues;
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = args.slice(index, index + 2);
    if (!value) throw new Error(`Brak wartości ${flag}`);
    if (flag === '--date') date = value;
    else if (flag === '--sport') sport = value;
    else if (flag === '--expected-football-leagues') expectedFootballLeagues = Number(value);
    else throw new Error(`Nieznany parametr: ${flag}`);
  }
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
  assert.ok(['nba', 'football', 'nhl', 'tennis'].includes(sport), 'Nieobsługiwana dyscyplina testu');

  async function get(path, options = {}) {
    const response = await fetch(new URL(path, base), { ...options, redirect: 'error', signal: AbortSignal.timeout(25000) });
    assert.ok(response.ok, `${path}: HTTP ${response.status}`);
    return response;
  }
  const page = await (await get('/')).text();
  assert.match(page, /SportLab 3\.1/);
  assert.match(page, /id="cards"/);
  for (const asset of ['/app.js', '/styles.css']) assert.ok((await (await get(asset)).text()).length > 100, `Brak zasobu ${asset}`);

  const report = await (await get('/api/model')).json();
  assert.equal(report.version, '3.1');
  assert.ok(Number.isFinite(Date.parse(report.generatedAt)), 'Brak wygenerowanego raportu');
  for (const name of ['nba', 'football', 'nhl', 'tennis', 'cs2']) {
    const entry = report.sports?.[name];
    assert.ok(entry, `Brak raportu: ${name}`);
    assert.ok(['unavailable', 'research', 'validated'].includes(entry.status));
    if (entry.publication?.eligible) {
      assert.equal(entry.status, 'validated', 'Nieweryfikowany model dopuszczony do publikacji');
      assert.equal(entry.provenance?.pointInTimeVerified, true, 'Brak wiarygodnej historii przedmeczowej');
    }
    if (entry.metrics) {
      assert.ok(entry.metrics.count > 0);
      assert.ok(Number.isFinite(entry.metrics.brier));
      assert.ok(entry.metrics.accuracy >= 0 && entry.metrics.accuracy <= 1);
    }
  }
  if (expectedFootballLeagues !== undefined) {
    assert.equal(report.sports.football.leagues.length, expectedFootballLeagues, 'Niepełny zakres raportu lig piłkarskich');
  }

  const invalid = await fetch(new URL('/api/scores?sport=nba&date=20260230', base), { signal: AbortSignal.timeout(15000) });
  assert.equal(invalid.status, 400, 'API przyjęło nieprawidłową datę');
  const invalidMethod = await fetch(new URL('/api/model', base), { method: 'POST', signal: AbortSignal.timeout(15000) });
  assert.equal(invalidMethod.status, 405, 'API przyjęło niedozwoloną metodę');

  const query = new URLSearchParams({ sport, date: date.replaceAll('-', ''), league: 'all' });
  const scores = await (await get(`/api/scores?${query}`)).json();
  assert.ok(Array.isArray(scores.events) && scores.events.length > 0, 'Brak meczów do pełnego testu; wybierz historyczną datę z meczami');
  assert.equal(scores.errors.length, 0, 'Część źródeł wyników jest niedostępna');
  for (const event of scores.events) {
    assert.equal(event.forecast?.status, 'withheld', 'Bieżący procent nie przeszedł oddzielnej walidacji');
    assert.equal(event.forecast?.probability, undefined);
    assert.equal(event.forecast?.probabilities, undefined);
  }
  const event = scores.events.find(item => item.state === 'post') || scores.events[0];
  const detailQuery = new URLSearchParams({ sport, route: event.route, id: event.sourceEventId });
  const details = await (await get(`/api/details?${detailQuery}`)).json();
  assert.ok(Array.isArray(details.players) && Array.isArray(details.teamStats) && Array.isArray(details.injuries));
  assert.equal(details.source, 'ESPN');
  const cutoff = new Date(Math.min(Date.now(), Date.parse(event.date))).toISOString();
  const analysisQuery = new URLSearchParams({ sport, route: event.route, participantId: event.homeId, cutoff });
  const analysis = await (await get(`/api/analysis?${analysisQuery}`)).json();
  assert.equal(analysis.available, true, 'Brak dostępnej historii analizy');
  assert.equal(analysis.cutoff, cutoff);
  assert.ok(analysis.sample >= 0 && analysis.sample <= 10);
  assert.ok(analysis.recent.every(row => Date.parse(row.date) < Date.parse(cutoff)), 'Analiza zawiera przyszły mecz');
  console.log(JSON.stringify({ target: base.origin, status: 'OK', reportGeneratedAt: report.generatedAt, reportStale: report.stale, sport, date, matches: scores.events.length, detailEvent: event.id, players: details.players.length, analysisSample: analysis.sample }, null, 2));
}

main().catch(error => { console.error(`Test wdrożenia nieudany: ${error.message}`); process.exitCode = 1; });
