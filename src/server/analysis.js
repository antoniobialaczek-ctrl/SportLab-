export function isResultAvailableAt(event, before, availabilityInclusive = false) {
  const available = Date.parse(event.resultAvailableAt);
  return available < before || availabilityInclusive && available === before
    && event.status === 'completed' && event.descriptiveOnly === true && event.regulationOnly === true
    && event.scoreScope === 'regulation_90' && event.availabilityBasis === 'current-descriptive-observation'
    && event.source?.fetchedAt === event.resultAvailableAt;
}

export function summarizeParticipant(events, { participantId, route, cutoff, limit = 10, availabilityInclusive = false }) {
  const before = Date.parse(cutoff);
  if (!Number.isFinite(before)) throw new Error('Nieprawidłowy punkt odcięcia');
  const history = events.filter(e => e.route === route && (e.homeId === participantId || e.awayId === participantId)
    && isResultAvailableAt(e, before, availabilityInclusive) && Date.parse(e.startTime) < before)
    .sort((a, b) => b.startTime.localeCompare(a.startTime)).slice(0, limit);
  let wins = 0, draws = 0, scored = 0, conceded = 0;
  const recent = history.map(e => {
    const home = e.homeId === participantId;
    const scoreFor = home ? e.homeScore : e.awayScore;
    const scoreAgainst = home ? e.awayScore : e.homeScore;
    const outcome = scoreFor > scoreAgainst ? 'W' : scoreFor === scoreAgainst ? 'D' : 'L';
    wins += Number(outcome === 'W'); draws += Number(outcome === 'D');
    scored += scoreFor; conceded += scoreAgainst;
    return { id: e.id, date: e.startTime, opponent: home ? e.away : e.home, scoreFor, scoreAgainst, outcome };
  });
  return {
    participantId, route, cutoff, sample: history.length, wins, draws, losses: history.length - wins - draws,
    averageFor: history.length ? scored / history.length : null,
    averageAgainst: history.length ? conceded / history.length : null,
    recent, note: 'Ostatnie dostępne mecze z zapisanej historii tej ligi. Próba może być niepełna; to opis wyników, nie prognoza.',
  };
}

const METRICS = {
  nba: [['PTS', 'Punkty'], ['AST', 'Asysty'], ['REB', 'Zbiórki']],
  nhl: [['G', 'Gole'], ['A', 'Asysty'], ['S', 'Strzały']],
  football: [['G', 'Gole'], ['A', 'Asysty'], ['SH', 'Strzały']],
};

export function analyzePlayers(players, sport) {
  return (METRICS[sport] || []).flatMap(([label, title]) => {
    const values = players.filter(p => !p.didNotPlay).flatMap(p => {
      const index = p.labels.findIndex(l => String(l).toUpperCase() === label);
      if (index < 0 || !/^\d+(\.\d+)?$/.test(String(p.stats[index]))) return [];
      return [{ id: p.id, name: p.name, team: p.team, value: Number(p.stats[index]) }];
    });
    // A player can occur in multiple boxscore groups; don't count duplicates.
    const unique = [...new Map(values.map(p => [`${p.team}:${p.id || p.name}`, p])).values()];
    if (!unique.length) return [];
    return [{ metric: label, title, sample: unique.length, leaders: unique.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, 3) }];
  });
}
