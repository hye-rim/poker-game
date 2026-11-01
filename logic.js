'use strict';
// 텍사스 홀덤 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
const LOGIC_POKER = (() => {
  const START_CHIPS = 1000;
  const BLINDS = [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [500, 1000]];
  const HANDS_PER_LEVEL = 6;
  const RANKS = '23456789TJQKA', SUITS = '♠♥♦♣';
  const CATEGORY = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
  const STYLES = [
    { name: '민수', tight: 0.05, aggr: 0.35, bluff: 0.05 },        // 조심스러움
    { name: '지아', tight: 0.0, aggr: 0.55, bluff: 0.12 },         // 공격적
    { name: '도윤', tight: -0.03, aggr: 0.25, bluff: 0.04 },       // 많이 따라옴
  ];

  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };

  // ---------- 카드와 족보 ----------
  const rankOf = (c) => (c >> 2) + 2, suitOf = (c) => c & 3;
  const cardName = (c) => RANKS[rankOf(c) - 2] + SUITS[suitOf(c)];
  const makeCard = (rank, suit) => ((rank - 2) << 2) | suit;
  function evaluate5(cards) {
    const r = cards.map(rankOf).sort((a, b) => b - a);
    const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
    const counts = {};
    for (const x of r) counts[x] = (counts[x] || 0) + 1;
    const groups = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a] || b - a);
    let straightHigh = 0;
    if (groups.length === 5) {
      if (r[0] - r[4] === 4) straightHigh = r[0];
      else if (r[0] === 14 && r[1] === 5 && r[4] === 2) straightHigh = 5;            // A-2-3-4-5
    }
    let cat, ks;
    if (straightHigh && flush) { cat = 8; ks = [straightHigh]; }
    else if (counts[groups[0]] === 4) { cat = 7; ks = [groups[0], groups[1]]; }
    else if (counts[groups[0]] === 3 && counts[groups[1]] === 2) { cat = 6; ks = [groups[0], groups[1]]; }
    else if (flush) { cat = 5; ks = r; }
    else if (straightHigh) { cat = 4; ks = [straightHigh]; }
    else if (counts[groups[0]] === 3) { cat = 3; ks = groups; }
    else if (counts[groups[0]] === 2 && counts[groups[1]] === 2) { cat = 2; ks = groups; }
    else if (counts[groups[0]] === 2) { cat = 1; ks = groups; }
    else { cat = 0; ks = r; }
    let score = cat;
    for (let i = 0; i < 5; i++) score = score * 15 + (ks[i] || 0);
    return score;
  }
  function evaluate(cards) {                                   // 5~7 장 중 가장 좋은 다섯 장
    const n = cards.length;
    if (n === 5) return evaluate5(cards);
    let best = -1;
    const pick = [];
    const rec = (start) => {
      if (pick.length === 5) { const s = evaluate5(pick); if (s > best) best = s; return; }
      for (let i = start; i < n; i++) { pick.push(cards[i]); rec(i + 1); pick.pop(); }
    };
    rec(0);
    return best;
  }
  const categoryOf = (score) => Math.floor(score / 15 ** 5);
  function handName(score) {
    const cat = categoryOf(score);
    if (cat === 8 && Math.floor(score / 15 ** 4) % 15 === 14) return '로열 플러시';
    return CATEGORY[cat];
  }

  // ---------- 게임 만들기 ----------
  function newGame(rand = Math.random, opts = {}) {
    const names = opts.names || ['나', ...STYLES.map((s) => s.name)];
    const st = {
      rand, events: [], hand: 0, level: 0, phase: 'idle', board: [], deck: [], pots: [], pot: 0, dealer: -1,
      players: names.map((name, i) => ({ name, human: i === 0, chips: opts.chips || START_CHIPS, hole: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, out: false, style: i === 0 ? null : STYLES[(i - 1) % STYLES.length] })),
      actor: -1, currentBet: 0, minRaise: 0, street: 'preflop', result: null, winner: null,
    };
    startHand(st);
    return st;
  }
  const blinds = (st) => BLINDS[Math.min(st.level, BLINDS.length - 1)];
  const ring = (st) => st.players.map((p, i) => i).filter((i) => !st.players[i].out);
  const nextInRing = (st, from, pred = () => true) => {
    const n = st.players.length;
    for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (!st.players[i].out && pred(st.players[i], i)) return i; }
    return -1;
  };

  function shuffle(st) {
    const d = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) { const j = Math.floor(st.rand() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }
  function post(st, i, amount) {
    const p = st.players[i], a = Math.min(amount, p.chips);
    p.chips -= a; p.bet += a; p.total += a;
    if (p.chips === 0) p.allIn = true;
    return a;
  }

  function startHand(st) {
    for (const p of st.players) if (p.chips <= 0) p.out = true;
    const alive = ring(st);
    if (alive.length <= 1) { st.phase = 'over'; st.winner = alive[0]; emit(st, { t: 'over', winner: alive[0] }); return; }
    if (st.players[0].out) { st.phase = 'over'; st.winner = alive[0]; emit(st, { t: 'over', winner: alive[0] }); return; }
    st.hand++;
    st.level = Math.floor((st.hand - 1) / HANDS_PER_LEVEL);
    if ((st.hand - 1) % HANDS_PER_LEVEL === 0 && st.hand > 1) emit(st, { t: 'level', blinds: blinds(st) });
    st.deck = shuffle(st); st.board = []; st.pots = []; st.result = null; st.street = 'preflop';
    for (const p of st.players) { p.hole = []; p.bet = 0; p.total = 0; p.folded = p.out; p.allIn = false; p.acted = false; p.shown = false; }
    st.dealer = st.dealer < 0 ? alive[0] : nextInRing(st, st.dealer);
    const [sbAmt, bbAmt] = blinds(st);
    const heads = alive.length === 2;
    const sb = heads ? st.dealer : nextInRing(st, st.dealer), bb = nextInRing(st, sb);
    st.sb = sb; st.bb = bb;
    for (let r = 0; r < 2; r++) for (const i of alive) st.players[i].hole.push(st.deck.pop());
    post(st, sb, sbAmt); post(st, bb, bbAmt);
    st.currentBet = Math.max(st.players[sb].bet, st.players[bb].bet); st.minRaise = bbAmt;
    st.phase = 'bet';
    emit(st, { t: 'deal', hand: st.hand, dealer: st.dealer, sb, bb, blinds: [sbAmt, bbAmt] });
    // 첫 차례: 큰 블라인드 다음 (둘만 남았으면 딜러=작은 블라인드)
    st.actor = heads ? sb : nextInRing(st, bb);
    seekActor(st, false);
  }

  const canAct = (p) => !p.out && !p.folded && !p.allIn;
  const needsAction = (st, p) => canAct(p) && (!p.acted || p.bet < st.currentBet);
  // 지금 차례인 사람이 행동할 수 없으면 다음으로. 아무도 없으면 라운드를 끝낸다
  function seekActor(st, advance) {
    if (onlyOneLeft(st)) return finishFold(st);
    let i = st.actor;
    if (advance) i = nextInRing(st, i);
    for (let k = 0; k < st.players.length; k++) {
      if (i >= 0 && needsAction(st, st.players[i])) { st.actor = i; return; }
      i = nextInRing(st, i);
    }
    endRound(st);
  }
  const onlyOneLeft = (st) => st.players.filter((p) => !p.out && !p.folded).length === 1;

  // ---------- 행동 ----------
  function legal(st) {
    if (st.phase !== 'bet') return null;
    const p = st.players[st.actor];
    const toCall = Math.min(st.currentBet - p.bet, p.chips);
    const maxTo = p.bet + p.chips;
    const minTo = Math.min(maxTo, st.currentBet + st.minRaise);
    const others = st.players.some((q, i) => i !== st.actor && canAct(q));
    return { actor: st.actor, toCall, canCheck: st.currentBet === p.bet, minRaiseTo: minTo, maxRaiseTo: maxTo, canRaise: maxTo > st.currentBet && others, pot: potTotal(st) };
  }
  const potTotal = (st) => st.players.reduce((s, p) => s + p.total, 0);

  function act(st, action) {
    if (st.phase !== 'bet') return false;
    const i = st.actor, p = st.players[i], lg = legal(st);
    let type = action.type;
    if (type === 'allin') type = 'raise', action = { type, to: lg.maxRaiseTo };
    if (type === 'check' && !lg.canCheck) return false;
    if (type === 'fold') { p.folded = true; p.acted = true; emit(st, { t: 'act', who: i, type: 'fold' }); seekActor(st, true); return true; }
    if (type === 'check') { p.acted = true; emit(st, { t: 'act', who: i, type: 'check' }); seekActor(st, true); return true; }
    if (type === 'call') {
      if (lg.canCheck) return act(st, { type: 'check' });
      const amt = post(st, i, st.currentBet - p.bet); p.acted = true;
      emit(st, { t: 'act', who: i, type: 'call', amount: amt, allIn: p.allIn });
      seekActor(st, true); return true;
    }
    if (type === 'raise') {
      let to = Math.floor(action.to);
      if (!lg.canRaise && to > st.currentBet) { /* 상대가 모두 올인이면 레이즈 대신 콜 */ return act(st, { type: 'call' }); }
      to = Math.min(to, lg.maxRaiseTo);
      if (to <= st.currentBet) return act(st, { type: 'call' });
      const full = to - st.currentBet >= st.minRaise;
      if (!full && to < lg.maxRaiseTo) return false;           // 올인이 아니면 최소 레이즈보다 작을 수 없다
      const raiseSize = to - st.currentBet;
      const amt = post(st, i, to - p.bet);
      st.currentBet = to;
      if (full) { st.minRaise = raiseSize; for (const q of st.players) if (q !== p) q.acted = false; }
      p.acted = true;
      emit(st, { t: 'act', who: i, type: 'raise', to, amount: amt, allIn: p.allIn });
      seekActor(st, true); return true;
    }
    return false;
  }

  // ---------- 라운드 진행 ----------
  function endRound(st) {
    for (const p of st.players) { p.acted = false; }
    const live = st.players.filter((p) => !p.out && !p.folded);
    const active = live.filter((p) => !p.allIn);
    if (st.street === 'river') return showdown(st);
    // 새 길에 들어가기 전, 돌려받을 수 없는 초과분은 계산에서 처리 (showdown 에서 한꺼번에)
    const nextStreet = { preflop: 'flop', flop: 'turn', turn: 'river' }[st.street];
    for (const p of st.players) p.bet = 0;
    st.currentBet = 0; st.minRaise = blinds(st)[1];
    st.street = nextStreet;
    const n = nextStreet === 'flop' ? 3 : 1;
    st.deck.pop();                                              // 버리는 카드
    for (let k = 0; k < n; k++) st.board.push(st.deck.pop());
    emit(st, { t: 'street', street: nextStreet, board: st.board.slice() });
    if (active.length <= 1) { st.runout = true; return endRound(st); }      // 더 걸 사람이 없으면 끝까지 깐다
    st.actor = nextInRing(st, st.dealer, (q) => canAct(q));
    seekActor(st, false);
  }

  function finishFold(st) {
    const w = st.players.findIndex((p) => !p.out && !p.folded);
    const total = potTotal(st);
    st.players[w].chips += total;
    st.result = { winners: [{ player: w, amount: total, hand: null }], showdown: false, pots: [{ amount: total, winners: [w] }] };
    emit(st, { t: 'win', player: w, amount: total, showdown: false });
    finishHand(st);
  }

  function buildPots(st) {
    const contrib = st.players.map((p) => p.total);
    const levels = [...new Set(contrib.filter((x) => x > 0))].sort((a, b) => a - b);
    const pots = []; let prev = 0;
    for (const lv of levels) {
      let amount = 0; const elig = [];
      st.players.forEach((p, i) => { amount += Math.max(0, Math.min(p.total, lv) - prev); if (!p.out && !p.folded && p.total >= lv) elig.push(i); });
      if (amount > 0) pots.push({ amount, eligible: elig, level: lv });
      prev = lv;
    }
    return pots;
  }

  function showdown(st) {
    st.phase = 'showdown';
    const pots = buildPots(st);
    const scores = {};
    st.players.forEach((p, i) => { if (!p.out && !p.folded) { scores[i] = evaluate([...p.hole, ...st.board]); p.shown = true; } });
    const result = { winners: [], showdown: true, pots: [], scores };
    const won = {};
    for (const pot of pots) {
      if (!pot.eligible.length) {                                 // 아무도 이길 수 없는 층: 낸 사람에게 돌려줌
        const back = st.players.map((p, i) => i).filter((i) => st.players[i].total >= pot.level)[0];
        st.players[back].chips += pot.amount; won[back] = (won[back] || 0) + pot.amount; continue;
      }
      const best = Math.max(...pot.eligible.map((i) => scores[i]));
      const winners = pot.eligible.filter((i) => scores[i] === best);
      const share = Math.floor(pot.amount / winners.length); let rem = pot.amount - share * winners.length;
      const order = winners.slice().sort((a, b) => ((a - st.dealer + st.players.length) % st.players.length) - ((b - st.dealer + st.players.length) % st.players.length));      // 딜러 왼쪽부터
      for (const w of order) { const gain = share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; st.players[w].chips += gain; won[w] = (won[w] || 0) + gain; }
      result.pots.push({ amount: pot.amount, winners });
    }
    for (const k of Object.keys(won)) result.winners.push({ player: Number(k), amount: won[k], hand: handName(scores[k]) });
    st.result = result;
    emit(st, { t: 'showdown', scores, result });
    for (const w of result.winners) emit(st, { t: 'win', player: w.player, amount: w.amount, showdown: true, hand: w.hand });
    finishHand(st);
  }

  function finishHand(st) {
    st.phase = 'handover';
    st.actor = -1;
    for (const p of st.players) { p.chips = Math.max(0, p.chips); p.bet = 0; p.total = 0; }
    const busted = st.players.map((p, i) => i).filter((i) => !st.players[i].out && st.players[i].chips === 0);
    for (const i of busted) emit(st, { t: 'bust', player: i });
  }
  function nextHand(st) {
    if (st.phase !== 'handover') return false;
    startHand(st);
    return true;
  }

  // ---------- 컴퓨터 ----------
  function equity(st, idx, sims = 140) {
    const me = st.players[idx];
    const opp = st.players.filter((p, i) => i !== idx && !p.out && !p.folded);
    const used = new Set([...me.hole, ...st.board]);
    const rest = []; for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
    let score = 0;
    const need = 5 - st.board.length;
    for (let s = 0; s < sims; s++) {
      // 부분 셔플
      const k = opp.length * 2 + need;
      for (let i = 0; i < k; i++) { const j = i + Math.floor(st.rand() * (rest.length - i)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      const board = st.board.concat(rest.slice(opp.length * 2, k));
      const mine = evaluate([...me.hole, ...board]);
      let best = -1, ties = 0;
      for (let o = 0; o < opp.length; o++) { const sc = evaluate([rest[o * 2], rest[o * 2 + 1], ...board]); if (sc > best) { best = sc; ties = 1; } else if (sc === best) ties++; }
      if (mine > best) score += 1; else if (mine === best) score += 1 / (ties + 1);
    }
    return score / sims;
  }
  function cpuDecide(st) {
    const lg = legal(st), i = st.actor, p = st.players[i], style = p.style || STYLES[0];
    const e = equity(st, i);
    const n = st.players.filter((q) => !q.out && !q.folded).length;
    const pot = lg.pot, toCall = lg.toCall;
    const fair = 1 / n;
    const strength = e / fair;                                       // 1 이면 평균적인 손
    const odds = toCall / (pot + toCall || 1);
    const r = st.rand();
    const sizeTo = (frac) => Math.max(lg.minRaiseTo, Math.min(lg.maxRaiseTo, st.currentBet + Math.round(frac * Math.max(pot, blinds(st)[1] * 2) / 5) * 5));
    const bigBet = toCall > p.chips * 0.5;
    if (lg.canCheck) {
      if (lg.canRaise && ((strength > 1.7 && r < style.aggr + 0.35) || (strength > 1.15 && r < style.aggr * 0.5) || r < style.bluff * 0.5)) {
        const frac = strength > 2.2 ? 1 : strength > 1.5 ? 0.7 : 0.5;
        return { type: 'raise', to: sizeTo(frac) };
      }
      return { type: 'check' };
    }
    const need = odds + 0.03 + style.tight + (bigBet ? 0.1 : 0);
    if (e < need && r > style.bluff * 0.3) return { type: 'fold' };
    if (lg.canRaise && ((strength > 1.9 && r < style.aggr + 0.3) || (strength > 1.4 && r < style.aggr * 0.45))) {
      const frac = strength > 2.4 ? 1 : strength > 1.7 ? 0.75 : 0.5;
      const to = sizeTo(frac);
      if (to - p.bet >= p.chips * 0.55 && strength > 2.2) return { type: 'allin' };
      return { type: 'raise', to };
    }
    return { type: 'call' };
  }
  function cpuAct(st) {
    if (st.phase !== 'bet' || st.players[st.actor].human) return false;
    const a = cpuDecide(st);
    return act(st, a) || act(st, { type: legal(st).canCheck ? 'check' : 'call' });
  }

  return {
    START_CHIPS, BLINDS, HANDS_PER_LEVEL, RANKS, SUITS, CATEGORY, STYLES,
    rng, rankOf, suitOf, cardName, makeCard, evaluate5, evaluate, categoryOf, handName,
    newGame, startHand, nextHand, legal, act, cpuAct, cpuDecide, equity, buildPots, blinds, potTotal,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_POKER;
