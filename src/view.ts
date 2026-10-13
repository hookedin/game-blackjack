import type { RoundEvent } from '@hookedin/play/sdk/round';
import { addCard, readCard } from './rules.ts';
import type { CardRank } from './rules.ts';
export interface Card {
  face: number;
  suit: number;
}
type HandResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';
export function cardHand(cards: readonly Card[]) {
  return cards.reduce((hand, card) => addCard(hand, Math.min(card.face, 10) as CardRank), { total: 0, soft: false });
}
/** Replay only resolved, persisted card labels. No fresh display randomness. */
export function blackjackTable(events: readonly RoundEvent[]) {
  const hands: Card[][] = [[]],
    dealer: Card[] = [],
    doubled = [false, false];
  let split = false,
    insured = false,
    dealerBlackjack = false;
  for (const event of events) {
    if (event.action === 'split') {
      const [a, b] = hands[0]!;
      hands.splice(0, 1, [a!], [b!]);
      split = true;
    }
    if (event.action === 'insurance') insured = true;
    const card = readCard(event.label ?? '');
    if (card?.seat === 'player:0' || card?.seat === 'player:1') {
      const index = card.seat === 'player:0' ? 0 : 1;
      hands[index]!.push({ face: card.face, suit: card.suit });
      if (event.action === 'double') doubled[index] = true;
    }
    if (card?.seat === 'dealer' || card?.seat === 'dealer-blackjack') {
      dealer.push({ face: card.face, suit: card.suit });
      dealerBlackjack ||= card.seat === 'dealer-blackjack';
    }
  }
  return { hands, dealer, doubled, split, insured, dealerBlackjack };
}
/** What each of the player's hands came to in a finished round, read from the cards as the rules pay them. */
export function handResults(table: ReturnType<typeof blackjackTable>): HandResult[] {
  const dealer = cardHand(table.dealer).total;
  return table.hands.map(cards => {
    const { total } = cardHand(cards),
      natural = !table.split && cards.length === 2 && total === 21;
    if (total > 21) return 'bust';
    if (table.dealerBlackjack) return natural ? 'push' : 'lose';
    if (natural) return 'blackjack';
    return dealer > 21 || total > dealer ? 'win' : total === dealer ? 'push' : 'lose';
  });
}
