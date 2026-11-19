import { isAllowedRoute } from './catalog.js';
import { fetchJSON } from '../data/fetch.js';
import { aggregatePlayerForm } from './player-form.js';

const MAX_SCORE = 300;
const FINAL = new Set(['STATUS_FINAL', 'STATUS_FULL_TIME']);
const SCOPES = { nba: 'including_overtime', nhl: 'including_overtime_shootout', football: 'regulation_90' };
const PLAYER_SCOPE = { nba: 'including_overtime', nhl: 'including_overtime_excluding_shootout', football: 'regulation_90' };
const METRICS = { nba: ['PTS', 'AST', 'REB'], nhl: ['S'], football: ['SH'] };
const id = value => typeof value === 'string' && /^\d{1,14}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 ? value.trim() : null;
const instant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10) ? time : NaN;
};
const integer = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))
  && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= MAX_SCORE ? Number(value) : null;

function score(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const values = [value.value, value.displayValue].filter(item => item != null).map(integer);
    return values.length && values.every(item => item !== null && item === values[0]) ? values[0] : null;
  }
  return integer(value);
}

export function journalScoreScope(sport) { return SCOPES[sport] || null; }

export function journalSummaryURL(sport, fixtureId) {
  const split = typeof fixtureId === 'string' ? fixtureId.lastIndexOf(':') : -1;
  const route = split > 0 ? fixtureId.slice(0, split) : '', sourceEventId = split > 0 ? fixtureId.slice(split + 1) : '';
  if (!Object.hasOwn(SCOPES, sport) || !isAllowedRoute(sport, route) || route === 'soccer/pol.1' || !/^\d{4,14}$/.test(sourceEventId)) throw new Error('Nieprawidłowy mecz do odczytu wyniku');
  return `https://site.api.espn.com/apis/site/v2/sports/${route}/summary?event=${sourceEventId}`;
}

function regulationOnly(competition) {
  const status = competition.status, type = status?.type;
  return Number(status?.period || 0) <= 2 && competition.shootout !== true
    && !/extra\s*time|penalt|shootout|\bAET\b/i.test([type?.detail, type?.shortDetail, type?.description].filter(Boolean).join(' '))
    && competition.competitors.every(row => row.shootoutScore == null && row.penaltyScore == null
      && (!Array.isArray(row.linescores) || row.linescores.length <= 2));
}

function footballPlayedIds(data, teamId) {
  const played = new Set(), denied = new Set();
  for (const group of Array.isArray(data.rosters) ? data.rosters : []) {
    if (String(group?.team?.id || '') !== teamId) continue;
    for (const row of Array.isArray(group.roster) ? group.roster : []) {
      const playerId = String(row?.athlete?.id || '');
      if (!id(playerId)) continue;
      const appearances = (Array.isArray(row.stats) ? row.stats : []).filter(stat => stat?.name === 'appearances');
      const observed = appearances.length === 1 ? score(appearances[0]) : null;
      if (row.didNotPlay === true || observed === 0) denied.add(playerId);
      if (row.didNotPlay !== true && observed === 1 && (row.starter === true || row.subbedIn === true)) played.add(playerId);
    }
  }
  for (const playerId of denied) played.delete(playerId);
  return played;
}

function playerStatistics(data, match, sourceURL) {
  const rows = [], memberships = new Map(), invalidPlayers = new Set();
  for (const teamId of [match.homeId, match.awayId]) {
    const aggregate = aggregatePlayerForm([{ match, data, url: sourceURL }], { sport: match.sport, teamId, limit: 100 });
    const footballIds = match.sport === 'football' ? footballPlayedIds(data, teamId) : null;
    for (const player of aggregate.players) {
      const minutesKnown = player.minutes?.sample === 1 && player.minutes.average > 0;
      if (!minutesKnown && !footballIds?.has(player.id)) continue;
      const previousTeam = memberships.get(player.id);
      if (previousTeam && previousTeam !== teamId) invalidPlayers.add(player.id);
      memberships.set(player.id, teamId);
      for (const metric of METRICS[match.sport]) {
        const observed = player.metrics[metric]?.observations;
        if (!Array.isArray(observed) || observed.length !== 1 || observed[0].matchId !== match.id
          || Date.parse(observed[0].date) !== Date.parse(match.startTime) || !Number.isInteger(observed[0].value)
          || observed[0].value < 0 || observed[0].value > 1000) continue;
        rows.push({ playerId: player.id, teamId, metric, value: observed[0].value, scope: PLAYER_SCOPE[match.sport] });
      }
    }
  }
  return rows.filter(row => !invalidPlayers.has(row.playerId)).slice(0, 300);
}

/** Current final facts only. The observation time is recorded after download;
 * a missing appearance or statistic never supplies a zero for settlement.
 */
export function extractJournalResult(data, { sport, fixtureId, observedAt = new Date().toISOString() } = {}) {
  const sourceURL = journalSummaryURL(sport, fixtureId), now = instant(observedAt);
  if (!Number.isFinite(now)) throw new Error('Nieprawidłowy czas obserwacji wyniku');
  const route = fixtureId.slice(0, fixtureId.lastIndexOf(':')), sourceEventId = fixtureId.slice(fixtureId.lastIndexOf(':') + 1);
  if (!data?.header || String(data.header.id) !== sourceEventId || !Array.isArray(data.header.competitions)
    || data.header.competitions.length !== 1) return null;
  const competition = data.header.competitions[0];
  if (String(competition?.id) !== sourceEventId || !Array.isArray(competition.competitors) || competition.competitors.length !== 2) return null;
  const status = competition.status?.type, start = instant(competition.date);
  if (!status || status.state !== 'post' || status.completed !== true || !FINAL.has(status.name) || !Number.isFinite(start) || start >= now
    || /\b(retired|walkover|walk\s+over|abandoned|cancelled|canceled|defaulted)\b|w\/o/i.test((competition.notes || []).map(note => note?.text || '').join(' '))) return null;
  const home = competition.competitors.find(row => row?.homeAway === 'home'), away = competition.competitors.find(row => row?.homeAway === 'away');
  if (!home || !away || home === away || ![home.id, away.id].every(item => id(String(item || ''))) || String(home.id) === String(away.id)
    || String(home.team?.id || '') !== String(home.id) || String(away.team?.id || '') !== String(away.id)) return null;
  const homeName = text(home.team?.displayName), awayName = text(away.team?.displayName), homeScore = score(home.score), awayScore = score(away.score);
  if (!homeName || !awayName || homeScore === null || awayScore === null || sport !== 'football' && homeScore === awayScore
    || sport === 'football' && (!regulationOnly(competition) || status.name !== 'STATUS_FULL_TIME')) return null;
  if (Array.isArray(data.boxscore?.players) && (data.boxscore.players.length > 8 || data.boxscore.players.some(group => !Array.isArray(group.statistics)
    || group.statistics.length > 20 || group.statistics.some(category => !Array.isArray(category?.athletes) || category.athletes.length > 100)))) return null;
  if (Array.isArray(data.rosters) && (data.rosters.length > 8 || data.rosters.some(group => !Array.isArray(group?.roster) || group.roster.length > 100))) return null;
  const fetchedAt = new Date(now).toISOString();
  const result = { id: fixtureId, sourceEventId, sport, route, league: route.split('/').at(-1), homeId: String(home.id), awayId: String(away.id),
    home: homeName, away: awayName, homeScore, awayScore, startTime: new Date(start).toISOString(), status: 'completed',
    resultAvailableAt: fetchedAt, availabilityBasis: 'observed-result', scope: SCOPES[sport], neutralSite: competition.neutralSite === true,
    source: { provider: 'ESPN', url: sourceURL, fetchedAt } };
  result.playerStats = playerStatistics(data, result, sourceURL);
  return result;
}

export async function fetchJournalResult(sport, fixtureId, { fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  const sourceURL = journalSummaryURL(sport, fixtureId);
  const data = await fetchJSON(sourceURL, { fetchImpl, timeoutMs: 6500, retries: 0 });
  return extractJournalResult(data, { sport, fixtureId, observedAt: new Date(clock()).toISOString() });
}
