import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeTo, gameWallet, memoryStore } from '@hookedin/play/testing/game-wallet.ts';
import { RoundClient } from '@hookedin/play/sdk/round';
import { createBlackjack } from '../src/rules.ts';
import { blackjackFunding } from '../src/funding.ts';

test('a hand plays through the real wallet on the funding table, and survives a reload mid-hand', async () => {
  const f = await gameWallet(),
    w = f.wallet;
  w.openGame(f.identity('blackjack'));
  await w.setGameAllowance('1000000');
  const bridge = bridgeTo(w),
    store = memoryStore(),
    graph = (setup: any) => createBlackjack({ stake: BigInt(setup.stake) });
  let round = new RoundClient(bridge, graph, blackjackFunding, { store, name: 'blackjack' }),
    state = await round.start({ stake: '1000000' });
  assert.equal(round['plan']!.bankrollFloor, blackjackFunding.bankrollFloor, 'the table prices the hand');
  const before = await w.balance();
  for (let i = 0; !state.terminal && i < 64; i++) {
    state = await round.action(state.actions.includes('stand') ? 'stand' : state.actions[0]!);
    // The page reloads: a new client finds the hand where it was.
    if (i === 1) round = new RoundClient(bridge, graph, blackjackFunding, { store, name: 'blackjack' });
    state = (await round.restore())!;
  }
  assert.equal(state.terminal, true);
  assert.equal(await w.balance(), before - BigInt(state.contributed) + BigInt(state.cash));
});
