/** Writes src/funding.ts, the price of every action at a 1,000,000-wei stake, so the page need not price the game. */
import fs from 'node:fs/promises';
import { compileGame } from '@hookedin/play/sdk/engine';
import { createBlackjack } from '../src/rules.ts';

const stake = 1_000_000n;
const plan = compileGame(createBlackjack({ stake }), {
  bankrollFloor: 256n * stake,
  cashQuantum: 1n,
  initialCash: stake,
});
const rows = plan.nodes
  .filter(node => node.kind === 'decision')
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const source = `// Written by npm run generate: every action's price at a stake of ${stake} wei. RoundClient scales it to a stake
// that is a multiple of that while the virtual bankroll covers ${plan.conservativeBankroll / stake} stakes, and prices any other round itself.
import type { FundingTable } from '@hookedin/play/sdk/engine';
export const blackjackFunding: FundingTable = {
  bankrollFloor: ${plan.bankrollFloor}n,
  cashQuantum: ${plan.cashQuantum}n,
  initialCash: ${plan.initialCash}n,
  conservativeBankroll: ${plan.conservativeBankroll}n,
  actions: {
${rows.map(node => `    ${JSON.stringify(node.id)}: [${node.actions.map(action => `${action.requiredCash}n`).join(', ')}],`).join('\n')}
  },
};
`;
await fs.writeFile(new URL('../src/funding.ts', import.meta.url), source);
