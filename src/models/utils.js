export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function outcome(event) {
  return event.homeScore === event.awayScore ? 1 : event.homeScore > event.awayScore ? 0 : event.sport === 'football' ? 2 : 1;
}

export function eloProbability(difference) {
  return clamp(1 / (1 + 10 ** (-difference / 400)), 0.01, 0.99);
}

export function poisson(lambda, maximum = 20) {
  const values = [Math.exp(-lambda)];
  for (let k = 1; k <= maximum; k++) values.push(values[k - 1] * lambda / k);
  return values;
}

export function goalProbabilities(homeRate, awayRate) {
  const home = poisson(homeRate), away = poisson(awayRate);
  const values = [0, 0, 0];
  for (let h = 0; h < home.length; h++) {
    for (let a = 0; a < away.length; a++) values[h > a ? 0 : h === a ? 1 : 2] += home[h] * away[a];
  }
  const sum = values.reduce((a, b) => a + b, 0);
  return values.map(p => p / sum);
}

// Each instance belongs to exactly one sport AND league. Priors are fixed in
// versioned code; they are never estimated from a future season or test block.
export function createGoalState({ homePrior, awayPrior, priorGames, maximumRate }) {
  const teams = new Map();
  let homeGoals = homePrior * priorGames, awayGoals = awayPrior * priorGames, games = priorGames;
  function team(id) {
    if (!teams.has(id)) teams.set(id, { scored: 0, conceded: 0, games: 0 });
    return teams.get(id);
  }
  return {
    rates(event) {
      const h = team(event.homeId), a = team(event.awayId);
      const base = (homeGoals + awayGoals) / (2 * games);
      const offense = t => (t.scored + base * priorGames) / (t.games + priorGames) / base;
      const defense = t => (t.conceded + base * priorGames) / (t.games + priorGames) / base;
      const homeBase = event.neutralSite ? base : homeGoals / games;
      const awayBase = event.neutralSite ? base : awayGoals / games;
      return [clamp(homeBase * offense(h) * defense(a), 0.1, maximumRate), clamp(awayBase * offense(a) * defense(h), 0.1, maximumRate)];
    },
    update(event) {
      const h = team(event.homeId), a = team(event.awayId);
      h.scored += event.homeScore; h.conceded += event.awayScore; h.games++;
      a.scored += event.awayScore; a.conceded += event.homeScore; a.games++;
      homeGoals += event.homeScore; awayGoals += event.awayScore; games++;
    }
  };
}
