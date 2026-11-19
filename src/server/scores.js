import { leagueLabel } from './catalog.js';

const record = competitor => competitor.records?.find(r => r.type === 'total')?.summary || null;
const name = competitor => competitor.team?.displayName || competitor.athlete?.displayName || competitor.roster?.displayName;
export function liveEvents(data, { sport, route, date }) {
  if (!Array.isArray(data.events)) throw new Error('Nieprawidłowa odpowiedź źródła');
  const rows = [];
  for (const event of data.events) {
    const competitions = sport === 'tennis'
      ? (event.groupings || []).filter(g => g.grouping?.slug === (route === 'tennis/atp' ? 'mens-singles' : 'womens-singles')).flatMap(g => g.competitions || [])
      : event.competitions || [];
    for (const competition of competitions) {
      if (sport === 'tennis' && competition.type?.slug && competition.type.slug !== (route === 'tennis/atp' ? 'mens-singles' : 'womens-singles')) continue;
      const participants = competition.competitors || [];
      if (participants.length !== 2 || !/^\d{4,14}$/.test(String(competition.id || ''))) continue;
      const home = participants.find(c => c.homeAway === 'home');
      const away = participants.find(c => c.homeAway === 'away');
      const start = competition.date || event.date;
      if (!home || !away || !name(home) || !name(away) || !Number.isFinite(Date.parse(start))) continue;
      if (![home.id, away.id].every(id => /^\d{1,14}$/.test(String(id || ''))) || String(home.id) === String(away.id)) continue;
      // Tennis responses contain the entire tournament, not just the requested day.
      if (sport === 'tennis' && start.slice(0, 10) !== date) continue;
      const status = competition.status?.type || event.status?.type;
      if (!['pre', 'in', 'post'].includes(status?.state)) continue;
      const score = competitor => sport === 'tennis'
        ? (competitor.linescores?.length ? competitor.linescores.filter(s => s.winner === true).length : null)
        : (competitor.score ?? null);
      rows.push({
        id: `${route}:${competition.id}`, sourceEventId: String(competition.id), sport, route,
        league: leagueLabel(route), leagueId: route.split('/').at(-1), date: start,
        home: name(home), away: name(away), homeId: String(home.id), awayId: String(away.id),
        homeScore: score(home), awayScore: score(away), state: status.state,
        statusDetail: status.detail || status.description || '',
        homeRecord: record(home), awayRecord: record(away),
        forecast: { status: 'withheld', reason: 'Brak zweryfikowanego modelu dla bieżącego spotkania.' },
      });
    }
  }
  return rows;
}
