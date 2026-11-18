import { createGoalState, goalProbabilities } from './utils.js';

export const footballDefinition = {
  name: 'Piłka nożna: osobne siły ataku i obrony, Poisson 1/X/2',
  outcomes: ['home', 'draw', 'away'],
  create() {
    const state = createGoalState({ homePrior: 1.5, awayPrior: 1.2, priorGames: 12, maximumRate: 5 });
    return { predict: event => goalProbabilities(...state.rates(event)), update: event => state.update(event) };
  }
};
