import { eloProbability } from './utils.js';

export const tennisDefinition = {
  name: 'Tenis: ranking Bradley–Terry zawodników, oddzielnie ATP i WTA',
  outcomes: ['home', 'away'],
  create() {
    const ratings = new Map();
    const rating = id => ratings.get(id) ?? 1500;
    const probability = event => eloProbability(rating(event.homeId) - rating(event.awayId));
    return {
      predict(event) { const p = probability(event); return [p, 1 - p]; },
      update(event) {
        const p = probability(event);
        const adjustment = 32 * ((event.homeScore > event.awayScore ? 1 : 0) - p);
        ratings.set(event.homeId, rating(event.homeId) + adjustment);
        ratings.set(event.awayId, rating(event.awayId) - adjustment);
      }
    };
  }
};
