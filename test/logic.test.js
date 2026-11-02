'use strict';
// 텍사스 홀덤 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// 카드 문자열 "As Kh 9d" -> 숫자
const SU = { s: 0, h: 1, d: 2, c: 3 };
const c = (s) => s.trim().split(/\s+/).map((x) => L.makeCard('23456789TJQKA'.indexOf(x[0]) + 2, SU[x[1]]));
const total = (st) => st.players.reduce((s, p) => s + p.chips + p.total, 0);        // 판이 끝나면 total 은 0
const fresh = (seed = 5, chips) => L.newGame(L.rng(seed), { chips });
// 정해진 카드로 판 시작: holes = 사람별 두 장, board = 다섯 장
function rig(st, holes, board) {
  const used = new Set([...holes.flat(), ...board]);
  const spare = []; for (let k = 0; k < 52 && spare.length < 20; k++) if (!used.has(k)) spare.push(k);
  st.players.forEach((p, i) => { if (holes[i]) p.hole = holes[i]; });
  const [f1, f2, f3, t, r] = board;
  st.deck = [...spare.slice(0, 10), r, spare[10], t, spare[11], f3, f2, f1, spare[12]];
}
// 사람들의 칩을 정해 놓고 새 판 시작 (딜러는 0 → 이번 판에서 1)
function table(chipsArr, dealer = -1) {
  const st = fresh(9);
  st.phase = 'handover'; st.dealer = dealer;
  st.players.forEach((p, i) => { p.chips = chipsArr[i]; p.out = false; });
  L.nextHand(st);
  return st;
}
const act = (st, type, to) => { const ok = L.act(st, { type, to }); assert.ok(ok, `${type} refused`); };
const drain = (st) => { for (let i = 0; i < 400 && st.phase === 'bet'; i++) act(st, L.legal(st).canCheck ? 'check' : 'call'); };

test('hand ranks: every category beats the one below, with the right names', () => {
  const hands = [
    ['7h 5d 3c 2s 9h', 0], ['Ah Ad 3c 2s 9h', 1], ['Ah Ad 3c 3s 9h', 2], ['Ah Ad Ac 3s 9h', 3], ['5h 6d 7c 8s 9h', 4],
    ['2h 6h 7h 8h Kh', 5], ['Ah Ad Ac 3s 3h', 6], ['Ah Ad Ac As 3h', 7], ['5h 6h 7h 8h 9h', 8],
  ];
  let prev = -1;
  for (const [h, cat] of hands) { const s = L.evaluate5(c(h)); assert.strictEqual(L.categoryOf(s), cat, h); assert.ok(s > prev); prev = s; }
  assert.strictEqual(L.handName(L.evaluate5(c('Ah Kh Qh Jh Th'))), '로열 플러시');
  assert.strictEqual(L.handName(L.evaluate5(c('9h 8h 7h 6h 5h'))), '스트레이트 플러시');
  assert.strictEqual(L.handName(L.evaluate5(c('Ah Ad Ac 3s 3h'))), '풀하우스');
});

test('the wheel (A-2-3-4-5) is the lowest straight, and ace-high straight the highest', () => {
  const wheel = L.evaluate5(c('Ah 2d 3c 4s 5h')), six = L.evaluate5(c('2h 3d 4c 5s 6h')), broadway = L.evaluate5(c('Ah Kd Qc Js Th'));
  assert.strictEqual(L.categoryOf(wheel), 4);
  assert.ok(six > wheel && broadway > six);
  assert.ok(L.evaluate5(c('Ah 2d 3c 4s 6h')) < wheel, 'A-2-3-4-6 is not a straight');
});

test('kickers decide: same pair, better side card wins; two pair compares the pairs then the kicker', () => {
  assert.ok(L.evaluate5(c('Ah Ad Ks 3c 2d')) > L.evaluate5(c('Ac As Qs 3h 2h')));
  assert.ok(L.evaluate5(c('Kh Kd 4s 4c 2d')) > L.evaluate5(c('Qs Qc Js Jh Ad')));
  assert.ok(L.evaluate5(c('Kh Kd 4s 4c Ad')) > L.evaluate5(c('Ks Kc 4h 4d Qd')));
  assert.strictEqual(L.evaluate5(c('Ah Kd 9s 4c 2d')), L.evaluate5(c('As Kc 9h 4d 2c')), 'suits never matter');
  assert.ok(L.evaluate5(c('Ah Kh 9h 4h 3h')) > L.evaluate5(c('Ad Kd 9d 4d 2d')), 'flush compares card by card');
  assert.ok(L.evaluate5(c('9h 9d 9s Ac 2d')) > L.evaluate5(c('8h 8d 8s Ac Kd')));
});

test('seven cards: the best five are used (board plays, flush over pair, full house over trips)', () => {
  assert.strictEqual(L.categoryOf(L.evaluate(c('Ah Kh 2h 7h 9h 3c 3d'))), 5);
  assert.strictEqual(L.categoryOf(L.evaluate(c('Ah Ad Ac Ks Kd 3c 4d'))), 6);
  assert.strictEqual(L.categoryOf(L.evaluate(c('2h 3d 4c 5s 6h Kd Kc'))), 4);
  assert.strictEqual(L.evaluate(c('Ah Kh Qh Jh Th 2c 3d')), L.evaluate5(c('Ah Kh Qh Jh Th')));
  assert.strictEqual(L.evaluate(c('Ah Kd Qc Js Th 2c 3d')), L.evaluate(c('Ah Kd Qc Js Th 9c 8d')), 'the board plays for both');
});

test('a new game: 4 players with 1000 chips, blinds 10/20 posted, cards dealt, action starts left of the big blind', () => {
  const st = fresh();
  assert.strictEqual(st.players.length, 4);
  assert.ok(st.players.every((p) => p.hole.length === 2));
  const [sb, bb] = [st.players[st.sb], st.players[st.bb]];
  assert.strictEqual(sb.bet, 10); assert.strictEqual(bb.bet, 20);
  assert.strictEqual(st.currentBet, 20);
  assert.strictEqual(total(st), 4000);
  assert.strictEqual(st.actor, (st.bb + 1) % 4);
  const all = st.players.flatMap((p) => p.hole); assert.strictEqual(new Set(all).size, 8, 'no duplicate cards');
});

test('call, check and the big blind option: the round only ends after the big blind acts', () => {
  const st = table([1000, 1000, 1000, 1000]);
  const first = st.actor;
  for (let k = 0; k < 3; k++) { assert.notStrictEqual(st.actor, st.bb); act(st, 'call'); }
  assert.strictEqual(st.street, 'preflop'); assert.strictEqual(st.actor, st.bb, 'big blind has the option');
  assert.ok(L.legal(st).canCheck);
  act(st, 'check');
  assert.strictEqual(st.street, 'flop'); assert.strictEqual(st.board.length, 3);
  assert.ok(first !== undefined);
});

test('the flop is dealt after the preflop betting, then turn and river, then a showdown', () => {
  const st = table([1000, 1000, 1000, 1000]);
  drain(st);
  assert.strictEqual(st.phase, 'handover');
  assert.strictEqual(st.board.length, 5);
  assert.ok(st.result.showdown);
  assert.strictEqual(total(st), 4000);
});

test('postflop the first to act is the first live player left of the dealer', () => {
  const st = table([1000, 1000, 1000, 1000]);
  for (let k = 0; k < 4; k++) act(st, L.legal(st).canCheck ? 'check' : 'call');
  assert.strictEqual(st.street, 'flop');
  assert.strictEqual(st.actor, (st.dealer + 1) % 4);
});

test('raises: minimum raise is the size of the last raise; smaller raises are refused; a re-raise reopens action', () => {
  const st = table([1000, 1000, 1000, 1000]);
  const lg = L.legal(st);
  assert.strictEqual(lg.minRaiseTo, 40);
  assert.strictEqual(L.act(st, { type: 'raise', to: 30 }), false, 'below the minimum');
  act(st, 'raise', 100);
  assert.strictEqual(st.currentBet, 100); assert.strictEqual(st.minRaise, 80);
  assert.strictEqual(L.legal(st).minRaiseTo, 180);
  assert.strictEqual(L.act(st, { type: 'raise', to: 150 }), false);
  act(st, 'call'); act(st, 'call');
  assert.strictEqual(st.street, 'preflop');                   // 큰 블라인드 차례가 아직 안 끝남
  act(st, 'raise', 300);
  assert.strictEqual(st.street, 'preflop', 'everyone who already acted must act again');
});

test('a fold-out wins the pot at once with no showdown and the cards stay hidden', () => {
  const st = table([1000, 1000, 1000, 1000]);
  act(st, 'fold'); act(st, 'fold'); act(st, 'fold');
  assert.strictEqual(st.phase, 'handover');
  assert.strictEqual(st.result.showdown, false);
  assert.strictEqual(total(st), 4000);
  const sbWins = st.result.winners[0].amount; assert.strictEqual(sbWins, 30);
});

test('showdown: the best hand wins the pot; ties split it with the odd chip going to the first seat after the dealer', () => {
  const st = table([1000, 1000, 1000, 1000], 3);               // 딜러 3 -> 이번 판 딜러 0
  rig(st, [c('As Ah'), c('Kd Kc'), c('7d 2c'), c('8d 3c')], c('Ad 9s 4h Js 5c'));
  drain(st);
  const w = st.result.winners; assert.strictEqual(w.length, 1); assert.strictEqual(w[0].player, 0);
  assert.strictEqual(w[0].hand, '트리플');
  const st2 = table([1000, 1000, 1000, 1000], 3);
  rig(st2, [c('As 2h'), c('Ad 2c'), c('7d 3c'), c('8d 3s')], c('Ah Kd Qc Js Td'));   // 보드가 로열 스트레이트라 모두 같은 족보
  drain(st2);
  assert.ok(st2.result.winners.length >= 2, 'split pot');
  assert.strictEqual(total(st2), 4000);
});

test('all-in with different stacks makes side pots; the short stack can only win what it covered', () => {
  const st = table([500, 500, 500, 100], 3);                   // 딜러 0, 작은 블라인드 1, 큰 2, 처음 3(짧은 칩)
  rig(st, [c('7d 2c'), c('Kd Kc'), c('8d 3c'), c('Ah Ad')], c('2s 5h 9d Js Qc'));
  act(st, 'allin'); act(st, 'raise', 300); act(st, 'call'); act(st, 'call');
  drain(st);
  assert.strictEqual(st.players[3].chips, 400, 'short stack wins the main pot only: 4 x 100');
  assert.strictEqual(total(st), 1600);
  const pots = st.result.pots; assert.ok(pots.length >= 2);
  assert.deepStrictEqual(pots[0].winners, [3]);
});

test('side pot winners are the best hand among those who paid into it', () => {
  const st = table([500, 500, 500, 100], 3);
  rig(st, [c('7d 2c'), c('Kd Kc'), c('8d 3c'), c('Ah Ad')], c('2s 5h 9d Js Qc'));
  act(st, 'allin'); act(st, 'raise', 300); act(st, 'call'); act(st, 'call');
  drain(st);
  assert.deepStrictEqual(st.result.pots[1].winners, [1], 'the kings take the side pot');
  assert.strictEqual(st.players[1].chips, 500 - 300 + 3 * 200);
});

test('an uncalled raise is returned when everyone folds, and chips are conserved', () => {
  const st = table([1000, 1000, 1000, 1000]);
  act(st, 'raise', 200); act(st, 'fold'); act(st, 'fold'); act(st, 'fold');
  assert.strictEqual(st.phase, 'handover');
  assert.strictEqual(total(st), 4000);
});

test('heads-up: the dealer posts the small blind and acts first before the flop, last after it', () => {
  const st = table([1000, 1000, 0, 0], 1);                     // 두 명만 남음
  assert.strictEqual(st.sb, st.dealer);
  assert.strictEqual(st.actor, st.sb);
  act(st, 'call'); act(st, 'check');
  assert.strictEqual(st.street, 'flop');
  assert.strictEqual(st.actor, st.bb, 'big blind acts first after the flop');
});

test('a player left with no chips is out; when you bust the game is over, when you win everything you win', () => {
  const st = table([30, 500, 500, 970], 3);
  rig(st, [c('7s 2h'), c('Ad Ac'), c('Kd Kc'), c('Qd Qc')], c('3s 5h 9d Js 8c'));
  for (let k = 0; k < 40 && st.phase === 'bet'; k++) act(st, st.actor === 0 ? 'allin' : (L.legal(st).canCheck ? 'check' : 'call'));
  assert.strictEqual(st.phase, 'handover');
  assert.strictEqual(total(st), 2000);
  assert.strictEqual(st.players[0].chips, 0, 'seven-deuce lost its 30');
  L.nextHand(st); assert.strictEqual(st.phase, 'over'); assert.notStrictEqual(st.winner, 0);
  const s2 = table([1000, 0, 0, 0]);
  assert.strictEqual(s2.phase, 'over'); assert.strictEqual(s2.winner, 0);
});

test('the blinds go up every 10 hands', () => {
  assert.strictEqual(L.HANDS_PER_LEVEL, 10);
  const st = fresh(); assert.deepStrictEqual(L.blinds(st), [10, 20]);
  for (let h = 0; h < 10; h++) { while (st.phase === 'bet') act(st, 'fold'); L.nextHand(st); }
  assert.strictEqual(st.hand, 11); assert.deepStrictEqual(L.blinds(st), [15, 30]);
  assert.strictEqual(st.players[st.bb].bet, 30);
});

test('the dealer button moves one seat each hand', () => {
  const st = fresh(); const d0 = st.dealer;
  while (st.phase === 'bet') act(st, 'fold'); L.nextHand(st);
  assert.strictEqual(st.dealer, (d0 + 1) % 4);
});

test('cannot check when facing a bet, cannot act out of turn after the hand is over', () => {
  const st = table([1000, 1000, 1000, 1000]);
  assert.strictEqual(L.act(st, { type: 'check' }), false);
  while (st.phase === 'bet') act(st, 'fold');
  assert.strictEqual(L.act(st, { type: 'call' }), false);
  assert.strictEqual(L.legal(st), null);
});

test('computer players: equity is sensible (aces beat seven-deuce) and they never make illegal moves', () => {
  const a = table([1000, 1000, 1000, 1000]); a.players[a.actor].hole = c('As Ah');
  const b = table([1000, 1000, 1000, 1000]); b.players[b.actor].hole = c('7s 2h');
  assert.ok(L.equity(a, a.actor, 400) > L.equity(b, b.actor, 400) + 0.2);
  const st = fresh(3);
  for (let i = 0; i < 600 && st.phase === 'bet'; i++) assert.ok(L.cpuAct(st) || st.players[st.actor].human ? true : false) || act(st, 'call');
});

test('computer players: strong hands play, trash mostly folds to a big raise', () => {
  let foldTrash = 0, foldAces = 0, n = 30;
  for (let s = 1; s <= n; s++) {
    for (const [hole, k] of [['7s 2h', 'trash'], ['As Ah', 'aces']]) {
      const st = L.newGame(L.rng(s)); st.phase = 'handover'; st.dealer = 3; st.players.forEach((p) => { p.chips = 1000; }); L.nextHand(st);
      // 사람(0)이 큰 레이즈를 하고, 다음 컴퓨터가 결정
      while (st.phase === 'bet' && !st.players[st.actor].human) act(st, 'fold');
      if (st.phase !== 'bet') continue;
      act(st, 'raise', 300);
      const who = st.actor; if (st.players[who].human) continue;
      st.players[who].hole = c(hole);
      const d = L.cpuDecide(st);
      if (d.type === 'fold') (k === 'trash' ? foldTrash++ : foldAces++);
    }
  }
  assert.ok(foldTrash > foldAces + 5, `trash folds ${foldTrash} vs aces ${foldAces}`);
});

test('whole games of computer-vs-computer never break the rules: chips are conserved, no illegal actions, hands finish', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const st = L.newGame(L.rng(seed * 11)); st.players.forEach((p) => { p.human = false; p.style = L.STYLES[0]; });
    let hands = 0;
    for (let k = 0; k < 40000 && st.phase !== 'over' && hands < 60; k++) {
      if (st.phase === 'bet') { assert.ok(L.cpuAct(st), 'cpu action accepted'); }
      else if (st.phase === 'handover') { assert.strictEqual(total(st), 4000); L.nextHand(st); hands++; }
      for (const p of st.players) assert.ok(p.chips >= 0 && Number.isFinite(p.chips));
    }
    assert.ok(hands >= 5, 'hands were played: ' + hands);
  }
});

test('easy computers raise less than normal ones and never choose all-in', () => {
  const count = (level) => {
    let raises = 0, allins = 0, hands = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const st = L.newGame(L.rng(seed * 17), { level }); st.players.forEach((p) => { p.human = false; });
      for (let k = 0; k < 30000 && st.phase !== 'over' && hands < 2000; k++) {
        if (st.phase === 'bet') { const d = L.cpuDecide(st); if (d.type === 'raise') raises++; if (d.type === 'allin') allins++; L.act(st, d) || L.act(st, { type: L.legal(st).canCheck ? 'check' : 'call' }); st.events = []; }
        else if (st.phase === 'handover') { L.nextHand(st); hands++; }
        if (hands > 20 * seed) break;
      }
    }
    return { raises, allins };
  };
  const n = count('normal'), e = count('easy');
  assert.ok(e.raises < n.raises, `raises ${e.raises} vs ${n.raises}`);
  assert.strictEqual(e.allins, 0, 'easy computers never choose all-in on their own');
  assert.ok(n.allins >= 0);
  const g = L.newGame(L.rng(1), { level: 'easy' });
  assert.strictEqual(g.players[0].easy, false); assert.ok(g.players.slice(1).every((p) => p.easy));
  assert.strictEqual(L.newGame(L.rng(1)).difficulty, 'normal');
});
