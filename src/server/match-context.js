const DAY = 86400000;
const fixed = value => Number(value.toFixed(3));
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const participant = (row, id) => row.homeId === id || row.awayId === id;
const score = (row, id) => row.homeId === id ? [row.homeScore, row.awayScore] : [row.awayScore, row.homeScore];

/** Context is descriptive. Every opponent record is evaluated before the
 * earlier match it describes, not after that match or at the current date.
 */
export function buildMatchContext(events, { sport, route, homeId, awayId, cutoff, fixtureId = null }) {
  const before = Date.parse(cutoff);
  if (!Array.isArray(events) || !Number.isFinite(before)) throw new Error('Nieprawidłowe dane kontekstu');
  const history = events.filter(row => row.sport === sport && row.route === route && row.id !== fixtureId
    && Date.parse(row.startTime) < before && Date.parse(row.resultAvailableAt) < before)
    .sort((a, b) => b.startTime.localeCompare(a.startTime) || a.id.localeCompare(b.id));
  function summarize(id) {
    const rows = history.filter(row => participant(row, id));
    const recent = rows.slice(0, 10);
    const opponents = recent.map(row => {
      const opponentId = row.homeId === id ? row.awayId : row.homeId;
      const prior = history.filter(previous => previous.id !== row.id && participant(previous, opponentId)
        && Date.parse(previous.startTime) < Date.parse(row.startTime)
        && Date.parse(previous.resultAvailableAt) < Date.parse(row.startTime)).slice(0, 10);
      const outcomes = prior.map(previous => score(previous, opponentId));
      const wins = outcomes.filter(([own, other]) => own > other).length;
      const draws = outcomes.filter(([own, other]) => own === other).length;
      return { matchId: row.id, date: row.startTime, opponentId, opponent: row.homeId === id ? row.away : row.home,
        sample: prior.length, wins, draws, losses: prior.length - wins - draws,
        winShare: prior.length ? fixed(wins / prior.length) : null };
    });
    const measured = opponents.filter(row => row.sample > 0);
    return {
      schedule: { sample: rows.length,
        matchesLast7Days: rows.filter(row => Date.parse(row.startTime) >= before - 7 * DAY).length,
        matchesLast14Days: rows.filter(row => Date.parse(row.startTime) >= before - 14 * DAY).length,
        latestStart: rows[0]?.startTime || null,
        hoursFromLatestStart: rows.length ? fixed((before - Date.parse(rows[0].startTime)) / 3600000) : null },
      opposition: { status: measured.length ? 'available' : 'unavailable', consideredGames: opponents.length,
        matchedGames: measured.length, priorMatches: measured.reduce((sum, row) => sum + row.sample, 0),
        averageWinShare: measured.length ? fixed(measured.reduce((sum, row) => sum + row.winShare, 0) / measured.length) : null,
        details: opponents },
      venue: { sample: recent.length, home: recent.filter(row => row.homeId === id).length,
        away: recent.filter(row => row.awayId === id).length,
        neutral: recent.filter(row => row.neutralSite === true).length },
    };
  }
  return { asOf: cutoff, source: 'Zapisane wyniki ESPN', home: summarize(homeId), away: summarize(awayId),
    tennisSurface: { status: 'unavailable', reason: 'Zapisana historia nie zawiera zweryfikowanych oznaczeń nawierzchni. Nie łączymy wyników z domniemaną nawierzchnią.' },
    notes: ['Siła rywali jest opisem ich dostępnych wcześniejszych bilansów, nie prognozą wyniku.',
      'Każdy bilans rywala korzysta z maksymalnie 10 wyników dostępnych przed rozpoczęciem opisywanego wcześniejszego meczu. Próby mogą się nakładać.',
      'Obciążenie terminarza obejmuje wyłącznie zapisane mecze z dostępnym wynikiem. Czas odpoczynku jest liczony od początku ostatniego takiego meczu, nie od jego zakończenia.'] };
}

const identity = value => typeof value === 'string' && /^[\w.-]{1,80}$/.test(value);
const label = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
function athlete(row, teamId) {
  if (!identity(row?.athlete?.id) || !label(row.athlete.displayName)) return null;
  if (row.athlete.team?.id && row.athlete.team.id !== teamId) return null;
  return { id: row.athlete.id, name: label(row.athlete.displayName), position: label(row.position?.abbreviation || row.athlete.position?.abbreviation) };
}

/** Source fields are bound to exactly the requested competition and its teams.
 * An empty feed is never a confirmation of health or a confirmed lineup.
 */
export function extractAvailability(data, { id, sport, fetchedAt = new Date().toISOString() }) {
  const base = { source: 'ESPN', fetchedAt, eventId: id, identityVerified: false, teams: [],
    notes: ['Kontuzje opisują stan źródła w chwili pobrania, nie historyczny stan przed meczem. Brak wpisu nie potwierdza zdolności do gry.'] };
  const matches = (Array.isArray(data?.header?.competitions) ? data.header.competitions : []).filter(row => row.id === id);
  const comp = matches.length === 1 ? matches[0] : null;
  const competitors = comp?.competitors;
  const ids = Array.isArray(competitors) ? competitors.map(row => row.team?.id || row.id) : [];
  if (!comp || !validTime(comp.date) || ids.length !== 2 || !ids.every(identity) || new Set(ids).size !== 2
    || (sport !== 'tennis' && data.header.id && data.header.id !== id)
    || competitors.some((row, index) => row.team?.id && row.id && row.id !== ids[index])) return base;
  const state = comp.status?.type?.state;
  const started = (state === 'in' || state === 'post') && Date.parse(comp.date) <= Date.parse(fetchedAt);
  const stateLabel = started ? state === 'post' ? 'postgame' : 'current' : 'reported';
  const teams = competitors.map((competitor, index) => {
    const teamId = ids[index];
    const injuryGroups = (Array.isArray(data.injuries) ? data.injuries : []).filter(group => group.team?.id === teamId);
    const injuries = new Map();
    for (const group of injuryGroups) for (const row of (Array.isArray(group.injuries) ? group.injuries : []).slice(0, 100)) {
      const player = athlete(row, teamId);
      const status = label(row.status);
      if (player && status) injuries.set(player.id, { ...player, status,
        updatedAt: validTime(row.date) && Date.parse(row.date) <= Date.parse(fetchedAt) ? row.date : null });
    }
    const rosterGroups = (Array.isArray(data.rosters) ? data.rosters : []).filter(group => group.team?.id === teamId);
    const boxGroups = (Array.isArray(data.boxscore?.players) ? data.boxscore.players : []).filter(group => group.team?.id === teamId);
    const starters = new Map();
    for (const group of rosterGroups) for (const row of (Array.isArray(group.roster) ? group.roster : []).slice(0, 100)) {
      const player = athlete(row, teamId);
      if (player && row.starter === true && row.didNotPlay !== true) starters.set(player.id, player);
    }
    // Boxscore starters are observations after kickoff, not projected starters.
    if (started) for (const group of boxGroups) for (const stats of (Array.isArray(group.statistics) ? group.statistics : [])) {
      for (const row of (Array.isArray(stats.athletes) ? stats.athletes : []).slice(0, 100)) {
        const player = athlete(row, teamId);
        if (player && row.starter === true && row.didNotPlay !== true) starters.set(player.id, player);
      }
    }
    return { id: teamId, name: label(competitor.team?.displayName || competitor.athlete?.displayName) || teamId,
      injuries: { status: injuries.size ? 'reported' : 'unavailable', items: [...injuries.values()] },
      lineup: { status: starters.size ? stateLabel : 'unavailable', confirmed: false, players: [...starters.values()],
        note: starters.size ? started ? 'Startujący zawodnicy wskazani w danych rozegranego lub trwającego meczu.' : 'Zawodnicy oznaczeni przez źródło jako starterzy; brak odrębnego potwierdzenia składu.' : 'Źródło nie podało składu wyjściowego.' } };
  });
  return { ...base, identityVerified: true, startTime: comp.date, state: state || null, teams };
}
