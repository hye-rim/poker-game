'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 포커(텍사스 홀덤): 화면·입력·소리. 규칙과 컴퓨터는 logic.js (LOGIC_POKER). 여기서는 st.events 를 보고 소리·표시를 만든다.
const L = LOGIC_POKER;
const W = 240, H = 290;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const ctrlH = $('controls').offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - ctrlH) / H);
  const cssW = Math.max(150, Math.floor(W * scale)), cssH = Math.floor(cssW * H / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('pokerMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.045, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function noise(dur, vol = 0.08, lowpass = 3000) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(audio.destination); s.start();
  } catch (_) {}
}
const melody = (notes, step, type = 'sine', vol = 0.06) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  deal: () => noise(0.05, 0.06, 4000),
  chip: () => { tone(1800, 0.04, 'triangle', 0.05); setTimeout(() => tone(2200, 0.04, 'triangle', 0.04), 40); },
  check: () => tone(300, 0.05, 'square', 0.03),
  fold: () => noise(0.12, 0.05, 1500),
  allin: () => melody([440, 554, 659], 70, 'square', 0.05),
  win: () => melody([523, 659, 784, 1047], 90),
  lose: () => melody([330, 262, 196], 160, 'sawtooth', 0.04),
  turn: () => tone(880, 0.08, 'sine', 0.05),
  start: () => melody([392, 494, 587], 90),
};

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                           // title · play · paused · over
let fxs = [];
let labels = [];                                // 사람마다 마지막 행동 표시
let banner = { text: '', sub: '', t: 0 };
let clock = 0, cpuT = 0, nextT = 0, raiseTo = 0, raising = false, bestChips = Number(store.get('pokerBest')) || 0, thinking = -1;
let peak = 1000;
let shown = [];                                 // 쇼다운에서 카드를 보여 주는 사람
let lastResultText = '';
const fast = () => G.players[0].folded || G.players[0].out || G.players[0].chips === 0;

/* @test-hooks:start */
window.__pk = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt) };
/* @test-hooks:end */

// ---------- 흐름 ----------
function bindOverlay() { document.querySelectorAll('#overlay button').forEach((b) => { b.onclick = () => onOverlayButton(b.dataset.level); }); }
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); bindOverlay(); }
const LEVEL_BUTTONS = '<div class="lv"><button id="startBtn" data-level="easy">쉬움<small>컴퓨터가 허세·올인을 덜 해요</small></button><button id="startBtn2" data-level="normal">보통<small>컴퓨터가 실수하지 않아요</small></button></div><p class="note">쉬움에서는 최고 기록이 저장되지 않아요</p>';
function hideOverlay() { $('overlay').classList.add('hidden'); }
function setBanner(text, sub = '', t = 2.5) { banner = { text, sub, t }; }
function startGame(level) {
  if (/[?&]tutorial=1/.test(location.search)) level = 'easy';
  level = level || store.get('pokerLevel');
  level = level === 'normal' ? 'normal' : 'easy';
  G = L.newGame(Math.random, { level });
  store.set('pokerLevel', level);
  labels = G.players.map(() => ''); fxs = []; shown = []; raising = false; cpuT = 0; nextT = 0; lastResultText = ''; peak = L.START_CHIPS;
  state = 'play';
  hideOverlay(); sfx.start();
  handleEvents();
  setBanner('HAND 1', `블라인드 10 / 20 · ${G.difficulty === 'easy' ? '쉬움' : '보통'}`, 2);
  refreshButtons();
}
function onOverlayButton(level) { if (state === 'paused') resume(); else startGame(level); }
let pausedFrom = null;
function pause() {
  if (state !== 'play') return;
  pausedFrom = state; state = 'paused';
  showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>');
}
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); }
function endGame() {
  state = 'over';
  const won = G.winner === 0;
  (won ? sfx.win : sfx.lose)();
  showOverlay(`<h2>${won ? '🏆 모두 이겼어요!' : '칩이 다 떨어졌어요'}</h2><p class="big">${G.hand}번째 판까지 했어요</p><p>가장 많이 가졌던 칩: ${peak} (${G.difficulty === 'easy' ? '쉬움 · 기록 저장 안 됨' : '최고 ' + bestChips})</p>${LEVEL_BUTTONS}`);
}

function handleEvents() {
  const evs = G.events; G.events = [];
  for (const e of evs) {
    if (e.t === 'deal') { sfx.deal(); labels = G.players.map(() => ''); shown = []; lastResultText = ''; if (e.hand > 1) setBanner(`HAND ${e.hand}`, `블라인드 ${e.blinds[0]} / ${e.blinds[1]}`, 1.5); for (const i of [e.sb, e.bb]) labels[i] = i === e.sb ? 'SB' : 'BB'; }
    else if (e.t === 'level') setBanner('블라인드 상승!', `${e.blinds[0]} / ${e.blinds[1]}`, 2.5);
    else if (e.t === 'act') {
      const nm = e.type === 'fold' ? '폴드' : e.type === 'check' ? '체크' : e.type === 'call' ? `콜 ${e.amount}` : `레이즈 ${e.to}`;
      labels[e.who] = e.allIn ? '올인!' : nm;
      if (e.type === 'fold') sfx.fold(); else if (e.type === 'check') sfx.check(); else if (e.allIn) sfx.allin(); else sfx.chip();
      if (e.who === 0) { if (e.type === 'fold') tutorialSignal('fold'); else if (e.type === 'raise') tutorialSignal('raise'); else tutorialSignal('call'); }
    }
    else if (e.t === 'street') { sfx.deal(); labels = labels.map((l, i) => (G.players[i].folded ? '폴드' : G.players[i].allIn ? '올인!' : '')); }
    else if (e.t === 'showdown') { shown = G.players.map((p, i) => i).filter((i) => !G.players[i].out && !G.players[i].folded); tutorialSignal('showdown'); }
    else if (e.t === 'win') {
      const p = G.players[e.player];
      lastResultText = `${p.name} +${e.amount}${e.hand ? ' (' + e.hand + ')' : ''}`;
      if (e.player === 0) { sfx.win(); tutorialSignal('win'); } else if (!e.showdown) sfx.chip();
      fxs.push({ kind: 'text', seat: e.player, text: `+${e.amount}`, t: 0, life: 2 });
    }
    else if (e.t === 'bust') { const p = G.players[e.player]; if (e.player !== 0) setBanner(`${p.name} 탈락!`, '', 2.5); }
    else if (e.t === 'over') { /* 판 시작에서 끝남 */ }
  }
}

function update(dt) {
  clock += dt;
  if (state !== 'play') return;
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
  banner.t = Math.max(0, banner.t - dt);
  if (G.phase === 'bet') {
    const actor = G.players[G.actor];
    if (actor.human) { cpuT = 0; if (thinking !== 0) { thinking = 0; sfx.turn(); refreshButtons(); } }
    else {
      thinking = G.actor; cpuT += dt;
      if (cpuT >= (fast() ? 0.25 : 0.9)) { cpuT = 0; L.cpuAct(G); handleEvents(); thinking = -1; refreshButtons(); }
    }
  } else if (G.phase === 'handover') {
    nextT += dt;
    if (nextT === dt) { refreshButtons(); peak = Math.max(peak, G.players[0].chips); if (G.difficulty === 'normal' && peak > bestChips) { bestChips = peak; store.set('pokerBest', String(bestChips)); } }
    if (nextT > (fast() ? 1.2 : 6)) goNext();
  } else if (G.phase === 'over') { endGame(); }
}
function goNext() {
  nextT = 0; raising = false;
  L.nextHand(G); handleEvents();
  if (G.phase === 'over') { endGame(); return; }
  refreshButtons();
}

// ---------- 버튼 ----------
const show = (id, on) => $(id).classList.toggle('hidden', !on);
function refreshButtons() {
  const lg = state === 'play' && G.phase === 'bet' && G.players[G.actor].human ? L.legal(G) : null;
  const next = state === 'play' && G.phase === 'handover';
  show('mainRow', !!lg && !raising); show('raisePanel', !!lg && raising); show('presets', !!lg && raising); show('confirmRow', !!lg && raising); show('nextRow', next);
  if (!lg) { if (!next) { show('mainRow', true); } for (const id of ['btnFold', 'btnCall', 'btnRaise']) $(id).disabled = true; if (!next) $('btnCall').innerHTML = '기다리는 중…'; return; }
  for (const id of ['btnFold', 'btnCall', 'btnRaise']) $(id).disabled = false;
  $('btnCall').innerHTML = lg.canCheck ? '체크' : `콜<small>${lg.toCall}${lg.toCall >= G.players[0].chips ? ' (올인)' : ''}</small>`;
  $('btnRaise').disabled = !lg.canRaise;
  $('btnRaise').innerHTML = lg.canRaise ? '레이즈' : '레이즈<small>불가</small>';
  if (raising) {
    const sl = $('raiseSlider'); sl.min = lg.minRaiseTo; sl.max = lg.maxRaiseTo; sl.step = 5; if (raiseTo < lg.minRaiseTo || raiseTo > lg.maxRaiseTo) raiseTo = lg.minRaiseTo; sl.value = raiseTo;
    updateConfirm(lg);
  }
}
function updateConfirm(lg) { $('btnConfirm').innerHTML = raiseTo >= lg.maxRaiseTo ? `올인 ${raiseTo}` : `레이즈 ${raiseTo}`; }
function myLegal() { return state === 'play' && G.phase === 'bet' && G.players[G.actor].human ? L.legal(G) : null; }
function doAct(a) { if (!myLegal()) return; raising = false; L.act(G, a); handleEvents(); cpuT = 0; thinking = -1; refreshButtons(); }
$('btnFold').onclick = () => doAct({ type: 'fold' });
$('btnCall').onclick = () => doAct({ type: 'call' });
$('btnRaise').onclick = () => { const lg = myLegal(); if (!lg || !lg.canRaise) return; raising = true; raiseTo = lg.minRaiseTo; refreshButtons(); };
$('btnCancel').onclick = () => { raising = false; refreshButtons(); };
$('btnConfirm').onclick = () => doAct({ type: 'raise', to: raiseTo });
$('raiseSlider').oninput = (e) => { raiseTo = Number(e.target.value); const lg = myLegal(); if (lg) updateConfirm(lg); };
function setRaise(v) { const lg = myLegal(); if (!lg) return; raiseTo = Math.max(lg.minRaiseTo, Math.min(lg.maxRaiseTo, Math.round(v / 5) * 5)); if (v >= lg.maxRaiseTo) raiseTo = lg.maxRaiseTo; $('raiseSlider').value = raiseTo; updateConfirm(lg); }
$('pMin').onclick = () => { const lg = myLegal(); if (lg) setRaise(lg.minRaiseTo); };
$('pHalf').onclick = () => { const lg = myLegal(); if (lg) setRaise(G.currentBet + lg.toCall + (lg.pot + lg.toCall) * 0.5); };
$('pPot').onclick = () => { const lg = myLegal(); if (lg) setRaise(G.currentBet + lg.toCall + (lg.pot + lg.toCall)); };
$('pAll').onclick = () => { const lg = myLegal(); if (lg) setRaise(lg.maxRaiseTo); };
$('btnNext').onclick = () => { if (G.phase === 'handover' && state === 'play') goNext(); };
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (state === 'title' || state === 'over') { if (k === 'enter' || k === ' ') { e.preventDefault(); onOverlayButton(); } return; }
  if (state === 'paused') { if (k === 'p' || k === 'enter') resume(); return; }
  if (k === 'p') pause(); else if (k === 'm') toggleMute();
  else if (k === 'n' && G.phase === 'handover') goNext();
  else if (k === 'f') doAct({ type: 'fold' }); else if (k === 'c') doAct({ type: 'call' });
  else if (k === 'r') $('btnRaise').onclick();
  else if (raising && '1234'.includes(k) && k) [$('pMin'), $('pHalf'), $('pPot'), $('pAll')]['1234'.indexOf(k)].onclick();
  else if (raising && k === 'enter') $('btnConfirm').onclick();
});

// ---------- 그리기 ----------
const SEATS = [{ x: 120, y: 248 }, { x: 30, y: 128 }, { x: 120, y: 38 }, { x: 210, y: 128 }];
function roundRect(x, y, w, h, r, fill, stroke) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } }
function drawCard(card, x, y, w, h, dim) {
  if (card === null) { roundRect(x, y, w, h, 2.5, '#2a4ab8', '#fff'); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5); return; }
  roundRect(x, y, w, h, 2.5, dim ? '#bbb' : '#fff', '#222');
  const red = L.suitOf(card) === 1 || L.suitOf(card) === 2;
  ctx.fillStyle = red ? '#d82a2a' : '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(h * 0.42)}px sans-serif`; ctx.fillText(L.RANKS[L.rankOf(card) - 2] === 'T' ? '10' : L.RANKS[L.rankOf(card) - 2], x + w / 2, y + h * 0.3);
  ctx.font = `${Math.round(h * 0.45)}px sans-serif`; ctx.fillText(L.SUITS[L.suitOf(card)], x + w / 2, y + h * 0.7);
}
function drawChipsText(text, x, y, color = '#ffe14a') { ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, x, y); }
function drawSeat(i) {
  const p = G.players[i], s = SEATS[i];
  if (p.out) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${p.name} (탈락)`, s.x, s.y); ctx.globalAlpha = 1; return; }
  const me = i === 0, cw = me ? 24 : 15, ch = me ? 34 : 21;
  const active = G.phase === 'bet' && G.actor === i;
  const reveal = me || shown.includes(i);
  const alpha = p.folded ? 0.4 : 1;
  ctx.globalAlpha = alpha;
  const cy = me ? s.y - 38 : i === 2 ? s.y - 6 : s.y - 26;
  if (p.hole.length) { for (let k = 0; k < 2; k++) drawCard(reveal ? p.hole[k] : null, s.x - cw - 1 + k * (cw + 2), cy, cw, ch, false); }
  // 이름표
  const ny = me ? s.y + 2 : i === 2 ? s.y - 20 : s.y - 36 + ch + 1 + 6;
  const ty = me ? s.y + 2 : i === 2 ? s.y - 20 : cy + ch + 8;
  roundRect(s.x - 28, ty - 6, 56, 20, 5, active ? 'rgba(255,225,74,.95)' : 'rgba(0,0,0,.6)', active ? '#fff' : null);
  ctx.fillStyle = active ? '#000' : '#fff'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.name, s.x, ty);
  ctx.fillStyle = active ? '#3a2a00' : '#ffe14a'; ctx.fillText(String(p.chips), s.x, ty + 9);
  ctx.globalAlpha = 1;
  // 딜러 버튼, 마지막 행동, 이번 판에 건 칩
  if (G.dealer === i) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x + 33, ty, 5, 0, 7); ctx.fill(); ctx.fillStyle = '#000'; ctx.font = 'bold 7px sans-serif'; ctx.fillText('D', s.x + 33, ty + 0.5); }
  if (labels[i] && G.phase !== 'handover') drawChipsText(labels[i], s.x, me ? s.y - 44 - 8 : i === 2 ? cy + ch + 7 : ty + 20, labels[i] === '올인!' ? '#ff7a5a' : labels[i] === '폴드' ? '#aaa' : '#bfe8ff');
  if (p.bet > 0) { const by = me ? s.y - 56 : i === 2 ? s.y + 28 : s.y + 6; const bx = i === 1 ? s.x + 34 : i === 3 ? s.x - 34 : s.x; ctx.fillStyle = '#e8a82a'; ctx.beginPath(); ctx.arc(bx - 10, by + (me ? 0 : 0), 4, 0, 7); ctx.fill(); drawChipsText(String(p.bet), bx + 2, by, '#fff'); }
}
function draw() {
  ctx.fillStyle = '#06140c'; ctx.fillRect(0, 0, W, H);
  // 테이블
  ctx.fillStyle = '#7a4a22'; ctx.beginPath(); ctx.ellipse(120, 140, 112, 118, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#0d6a3a'; ctx.beginPath(); ctx.ellipse(120, 140, 104, 110, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(120, 140, 92, 98, 0, 0, 7); ctx.stroke();
  // 공용 카드와 팟
  const pot = G.phase === 'handover' ? 0 : L.potTotal(G);
  drawChipsText(pot ? `POT ${pot}` : G.phase === 'handover' ? (lastResultText || '') : '', 120, 86, '#fff');
  for (let k = 0; k < 5; k++) { const x = 120 - 55 + k * 22; if (G.board[k] !== undefined) drawCard(G.board[k], x, 98, 20, 28, false); else { ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.strokeRect(x + 0.5, 98.5, 19, 27); } }
  // 내 족보 힌트
  const me = G.players[0];
  if (me.hole.length && !me.folded && !me.out && G.board.length >= 3) { const sc = L.evaluate([...me.hole, ...G.board]); drawChipsText(L.handName(sc), 120, 134, '#cfe'); }
  if (state === 'title') return;
  for (let i = 0; i < G.players.length; i++) if (i !== 0) drawSeat(i);
  drawSeat(0);
  for (const f of fxs) { const s = SEATS[f.seat], k = f.t / f.life; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = `rgba(255,225,74,${1 - k * 0.5})`; ctx.fillText(f.text, s.x, (f.seat === 0 ? s.y - 66 : f.seat === 2 ? s.y + 42 : s.y + 24) - k * 12); }
  // 위쪽 안내
  ctx.textAlign = 'left'; ctx.font = 'bold 8px sans-serif'; ctx.fillStyle = '#9ecfb0'; ctx.textBaseline = 'top';
  const [sb, bb] = L.blinds(G); ctx.fillText(`블라인드 ${sb}/${bb}`, 6, 4); ctx.textAlign = 'right'; ctx.fillText(`HAND ${G.hand}`, W - 52, 4);
  const msg = G.phase === 'bet' && G.players[G.actor].human ? (L.legal(G).canCheck ? '내 차례: 체크하거나 레이즈' : `내 차례: ${L.legal(G).toCall} 콜 / 레이즈 / 폴드`) : G.phase === 'bet' ? `${G.players[G.actor].name} 생각 중…` : '';
  if (msg && state === 'play') { ctx.textAlign = 'center'; ctx.fillStyle = G.players[G.actor] && G.players[G.actor].human ? '#ffe14a' : '#cfe'; ctx.font = 'bold 9px sans-serif'; ctx.fillText(msg, 120, 190); }
  if (banner.t > 0) { roundRect(62, 150, 116, 34, 6, 'rgba(0,0,0,.78)'); ctx.fillStyle = '#ffe14a'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(banner.text, 120, 162); if (banner.sub) { ctx.font = '9px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, 120, 176); } }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.1, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
function toggleMute() { muted = !muted; store.set('pokerMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
bindOverlay();
$('muteBtn').textContent = muted ? '🔇' : '🔊';
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

labels = G.players.map(() => '');
refreshButtons();
fit();
requestAnimationFrame(frame);
