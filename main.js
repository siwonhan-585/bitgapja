if (window.Kakao && !Kakao.isInitialized()) {
  Kakao.init('eff2cdacdb285473e50722e36f9c43c3');
}

let loanSeq = 0;

function addLoan(preset) {
  loanSeq++;
  const p = (preset && !preset.type) ? preset : {};
  const d = document.createElement('div');
  d.className = 'loan';
  d.innerHTML = `
    <button type="button" class="rm" onclick="this.parentNode.remove()" aria-label="이 대출 삭제">×</button>
    <div class="field">
      <label>대출 이름</label>
      <input type="text" class="lName" placeholder="예: 신용대출, 마이너스통장" value="${p.name || ''}">
    </div>
    <div class="grid2">
      <div class="field">
        <label>남은 잔액</label>
        <div class="won" data-unit="만원"><input type="text" class="lBal" inputmode="numeric" placeholder="3000" value="${p.bal || ''}"></div>
      </div>
      <div class="field">
        <label>연 금리</label>
        <div class="won" data-unit="%"><input type="text" class="lRate" inputmode="decimal" placeholder="6.5" value="${p.rate || ''}"></div>
      </div>
    </div>
    <div class="grid2">
      <div class="field">
        <label>남은 상환 기간</label>
        <div class="won" data-unit="개월"><input type="text" class="lMonths" inputmode="numeric" placeholder="60" value="${p.months || ''}"></div>
      </div>
      <div class="field">
        <label>상환 방식 <span class="qm" onclick="toggleTip('mtip${loanSeq}')">?</span></label>
        <select class="lMethod">
          <option value="amortizing">원리금균등</option>
          <option value="principal">원금균등</option>
          <option value="bullet">만기일시</option>
        </select>
      </div>
    </div>
    <div class="tip mtip" id="mtip${loanSeq}">
      <b>원리금균등</b> — 매달 같은 금액(원금+이자)을 냅니다. 가장 흔한 방식.<br>
      <b>원금균등</b> — 매달 같은 원금 + 남은 이자. 처음엔 많이, 갈수록 줄어듭니다.<br>
      <b>만기일시</b> — 매달 이자만 내다가, 만기에 원금을 한 번에 갚습니다.
    </div>`;
  document.getElementById('loans').appendChild(d);
  if (p.method) d.querySelector('.lMethod').value = p.method;
}

addLoan();
addLoan();

function toggleLump() {
  document.getElementById('lumpField').style.display =
    document.getElementById('lumpOn').checked ? 'block' : 'none';
}

function num(v) { return parseFloat(String(v).replace(/,/g, '')) || 0; }
function fmtWon(manwon) {
  const w = Math.round(manwon);
  if (w >= 10000) {
    const eok = Math.floor(w / 10000), rest = w % 10000;
    return rest ? `${eok}억 ${rest.toLocaleString()}만원` : `${eok}억원`;
  }
  return `${w.toLocaleString()}만원`;
}
function fmtManOnly(manwon) { return Math.round(manwon).toLocaleString(); }
function fmtMon(m) {
  const y = Math.floor(m / 12), r = m % 12;
  if (y && r) return `${y}년 ${r}개월`;
  if (y) return `${y}년`;
  return `${r}개월`;
}
function absoluteDate(monthsFromNow) {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsFromNow);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}
function shortDate(m) {
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readLoans() {
  const out = [];
  document.querySelectorAll('.loan').forEach((el, i) => {
    const name = el.querySelector('.lName').value.trim() || `대출 ${i + 1}`;
    const bal = num(el.querySelector('.lBal').value);
    const rate = num(el.querySelector('.lRate').value);
    const months = Math.round(num(el.querySelector('.lMonths').value));
    const method = el.querySelector('.lMethod').value;
    if (bal > 0) out.push({ name, bal, rate, months, method });
  });
  return out;
}

// ── Result 렌더링 상태 변수 (v3 병합, 2026-07-13) ─────────
let currentLoans = [];
let currentExtra = 0;
let currentLump = 0;
let currentA = null, currentS = null, currentWinner = null;
let currentSchedShown = 12;
let currentSchedMethods = {};
let chart = null;

// ── 애니메이션: 페이드인 ─────────────────────────
const io = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.05 });

// ── 계산 진입점: 사용자가 폼에 입력한 뒤 [갚는 순서 계산하기] 클릭 ────
function calc() {
  const err = document.getElementById('err');
  const res = document.getElementById('result');
  err.style.display = 'none'; res.style.display = 'none';

  const loans = readLoans();
  const extra = num(document.getElementById('extra').value);
  const lump = document.getElementById('lumpOn').checked ? num(document.getElementById('lump').value) : 0;

  if (loans.length < 2) return showErr('대출을 2개 이상 입력해 주세요. 1개라면 순서를 고민할 필요 없이 그냥 갚으면 됩니다.');
  if (loans.some(l => l.rate <= 0)) return showErr('금리가 0이거나 비어 있는 대출이 있어요. 연 금리(%)를 입력해 주세요.');
  if (loans.some(l => l.months <= 0)) return showErr('남은 상환 기간(개월)이 비어 있는 대출이 있어요.');

  // 상태 저장
  currentLoans = loans;
  currentExtra = extra;
  currentLump = lump;
  currentSchedShown = 12;

  // 시나리오 UI를 실제 추가금으로 동기화
  const slider = document.getElementById('scenarioSlider');
  if (slider) slider.value = Math.min(extra, 100);
  const amtEl = document.getElementById('scenarioAmt');
  if (amtEl) amtEl.textContent = Math.min(extra, 100);
  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.amt, 10) === extra);
  });

  const ok = render();
  if (!ok) return showErr('이 조건으로는 50년 안에 완제가 되지 않아요. 상환 기간이나 추가금을 다시 확인해 주세요.');

  res.style.display = 'block';
  res.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── 렌더 (계산 + 화면 갱신) ──────────────────────
function render() {
  currentA = runSimulation(currentLoans, currentExtra, 'avalanche', currentLump);
  currentS = runSimulation(currentLoans, currentExtra, 'snowball', currentLump);
  if (!currentA || !currentS) return false;

  const save = currentS.totalInterest - currentA.totalInterest;
  const tie = Math.abs(save) <= 1;
  const avalancheWins = save >= 0;
  currentWinner = avalancheWins ? currentA : currentS;

  currentSchedMethods = {};
  currentLoans.forEach(l => { currentSchedMethods[l.name] = l.method; });

  renderSummary();
  renderKPIs(currentWinner);
  renderCompare(currentA, currentS, save, tie, avalancheWins);
  renderChart(currentA, currentS);
  renderOrder(currentWinner);
  renderSchedule();
  renderScenario();
  renderGuides();

  document.getElementById('bulletNote').style.display =
    currentLoans.some(l => l.method === 'bullet') ? 'block' : 'none';

  document.querySelectorAll('.fade-in').forEach(el => io.observe(el));
  return true;
}

// ── 1. Hero Summary ──────────────────────────
function renderSummary() {
  const totalBal = currentLoans.reduce((s, l) => s + l.bal, 0);

  const parts = [
    `<div class="fact">총 잔액 <b>${fmtWon(totalBal)}</b></div>`,
    `<div class="fact">대출 <b>${currentLoans.length}개</b></div>`,
  ];
  if (currentExtra > 0) parts.push(`<div class="fact">매달 추가 <b>+${fmtWon(currentExtra)}</b></div>`);
  if (currentLump > 0) parts.push(`<div class="fact">목돈 <b>${fmtWon(currentLump)}</b></div>`);
  document.getElementById('factsRow').innerHTML = parts.join('');

  const w = currentA.totalInterest <= currentS.totalInterest ? currentA : currentS;
  const save = Math.abs(currentS.totalInterest - currentA.totalInterest);
  const tie = save <= 1;
  const avalancheWins = currentS.totalInterest - currentA.totalInterest >= 0;

  const lines = [];
  lines.push(`예상 완납일은 <span class="accent">${absoluteDate(w.months)}</span>입니다.`);
  if (tie) {
    lines.push(`아발란치 방식과 스노우볼 방식의 예상 총이자가 <span class="accent">거의 같게 계산됩니다</span>.`);
  } else {
    const winMethod = avalancheWins ? '아발란치 방식' : '스노우볼 방식';
    const loseMethod = avalancheWins ? '스노우볼 방식' : '아발란치 방식';
    lines.push(`${winMethod}의 예상 총이자가 ${loseMethod}보다 <span class="save-accent">약 ${fmtWon(save)}</span> 적게 계산됩니다.`);
  }
  document.getElementById('heroLines').innerHTML = lines.map(l => `<div class="hero-line">${l}</div>`).join('');

  let capText = `📌 총 잔액 <b>${fmtWon(totalBal)}</b> · 대출 <b>${currentLoans.length}개</b>`;
  if (currentExtra > 0) capText += ` · 매달 추가 <b>+${fmtWon(currentExtra)}</b>`;
  if (currentLump > 0) capText += ` · 목돈 <b>${fmtWon(currentLump)}</b>`;
  document.getElementById('capSummary').innerHTML = capText;
}

// ── 2. KPI ───────────────────────────────
function renderKPIs(w) {
  const dateEl = document.getElementById('kpiDate');
  const periodEl = document.getElementById('kpiPeriod');
  const interestEl = document.getElementById('kpiInterest');
  const totalBal = currentLoans.reduce((s, l) => s + l.bal, 0);

  dateEl.textContent = absoluteDate(w.months);
  dateEl.classList.toggle('small', absoluteDate(w.months).length > 8);
  document.getElementById('kpiDateSub').textContent = `${w.months}개월 뒤 · 오늘로부터 ${fmtMon(w.months)}`;

  periodEl.textContent = fmtMon(w.months);
  periodEl.classList.toggle('small', fmtMon(w.months).length > 5);
  const totalPaid = totalBal + w.totalInterest;
  const avgMonthly = totalPaid / w.months;
  document.getElementById('kpiPeriodSub').textContent = `평균 월납입 약 ${fmtWon(avgMonthly)}`;

  interestEl.textContent = fmtWon(w.totalInterest);
  interestEl.classList.toggle('small', fmtWon(w.totalInterest).length > 8);
  const ratio = ((w.totalInterest / totalBal) * 100).toFixed(1);
  const monthlyInterest = w.totalInterest / w.months;
  document.getElementById('kpiInterestSub').textContent = `원금 대비 ${ratio}% · 월평균 약 ${fmtWon(monthlyInterest)}`;
}

// ── 3. 두 방식 비교 ──────────────────────────
function renderCompare(A, S, save, tie, avalancheWins) {
  document.getElementById('cmpAMon').innerHTML = fmtMon(A.months);
  document.getElementById('cmpSMon').innerHTML = fmtMon(S.months);
  document.getElementById('cmpAInt').innerHTML = fmtWon(A.totalInterest) +
    (avalancheWins && !tie ? '<span class="winner-tag">이자 최소</span>' : '');
  document.getElementById('cmpSInt').innerHTML = fmtWon(S.totalInterest) +
    (!avalancheWins && !tie ? '<span class="winner-tag">이자 최소</span>' : '');

  const diffEl = document.getElementById('cmpDiff');
  const noteEl = document.getElementById('cmpNote');
  if (tie) {
    diffEl.innerHTML = '<span class="tie-label">거의 없음</span>';
    noteEl.innerHTML = '입력한 조건을 기준으로 계산하면 두 방식의 예상 총이자가 거의 같게 계산됩니다. 이럴 땐 갚아야 할 대출 개수를 빨리 줄일 수 있는 <b>스노우볼 방식</b>이 심리적 부담을 낮추는 데 도움이 될 수 있습니다.';
  } else {
    diffEl.innerHTML = `<span class="save">${fmtWon(Math.abs(save))}</span>`;
    const winMethod = avalancheWins ? '아발란치 방식' : '스노우볼 방식';
    const loseMethod = avalancheWins ? '스노우볼 방식' : '아발란치 방식';
    noteEl.innerHTML = `입력한 조건을 기준으로 계산하면 <b>${winMethod}</b>의 예상 총이자가 <b>${loseMethod}</b>보다 <b>${fmtWon(Math.abs(save))}</b> 적게 계산됩니다.`;
  }
}

// ── 4. 그래프 ──────────────────────────────
function renderChart(A, S) {
  const ctx = document.getElementById('balanceChart');
  if (chart) chart.destroy();
  const maxLen = Math.max(A.trajectory.length, S.trajectory.length);
  const labels = Array.from({ length: maxLen }, (_, i) => i);
  const pad = (arr) => arr.concat(Array(maxLen - arr.length).fill(0));
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '아발란치', data: pad(A.trajectory), borderColor: '#1B2A41', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.15 },
        { label: '스노우볼', data: pad(S.trajectory), borderColor: '#8A97AC', backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: 0.15 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 12, family: "'Pretendard Variable',sans-serif" }, boxWidth: 14, padding: 12 } },
      },
      scales: {
        x: { title: { display: true, text: '개월', color: '#8A97AC', font: { size: 11 } }, ticks: { maxTicksLimit: 8, font: { size: 10 }, color: '#8A97AC' }, grid: { display: false } },
        y: { ticks: { callback: v => v >= 10000 ? (v / 10000).toFixed(0) + '억' : v.toLocaleString() + '만', font: { size: 10 }, color: '#8A97AC' }, grid: { color: '#F0F2F5' }, border: { display: false } }
      }
    }
  });
}

// ── 5. 상환 순서 ─────────────────────────────
function renderOrder(w) {
  const el = document.getElementById('orderList');
  el.innerHTML = w.order.map((o, i) => `
    <div class="order-row">
      <div class="order-no">${i + 1}</div>
      <div class="order-info">
        <div class="order-name">${escapeHtml(o.name)}</div>
        <div class="order-meta">연 ${o.rate}%</div>
      </div>
      <div class="order-when">
        <b>${fmtMon(o.month)} 뒤</b>
        <small>${absoluteDate(o.month)} 완납</small>
      </div>
    </div>`).join('');
}

// ── 6. 월별 스케줄 ────────────────────────────
function renderSchedule() {
  const table = document.getElementById('schedTable');
  const names = currentLoans.map(l => l.name);
  let head = '<thead><tr><th>개월</th>';
  names.forEach(n => head += `<th>${escapeHtml(n)}</th>`);
  head += '<th>합계</th></tr></thead>';

  let body = '<tbody>';
  currentWinner.schedule.slice(0, currentSchedShown).forEach(m => {
    body += `<tr><td class="mcol">${m.month}<small>${shortDate(m.month)}</small></td>`;
    names.forEach(n => {
      const r = m.rows.find(x => x.name === n);
      if (r && r.pay > 0.001) {
        const justPaid = r.balAfter <= 0.001;
        if (justPaid) {
          const isBalloon = currentSchedMethods[n] === 'bullet' && r.principal > r.interest * 3;
          if (isBalloon) {
            body += `<td class="balloon"><b>${fmtManOnly(r.pay)}</b><small>만기 일시</small></td>`;
          } else {
            body += `<td class="just-paid"><b>${fmtManOnly(r.pay)}</b><small>완납</small></td>`;
          }
        } else {
          body += `<td><b>${fmtManOnly(r.pay)}</b><small class="principal">원금 ${fmtManOnly(r.principal)}</small><small>잔액 ${fmtManOnly(r.balAfter)}</small></td>`;
        }
      } else {
        body += `<td class="done">—</td>`;
      }
    });
    body += `<td class="tot">${fmtManOnly(m.total)}${(m.month === 1 && currentLump > 0) ? '<small class="lump-note">목돈 ' + fmtWon(currentLump) + ' 포함</small>' : ''}</td></tr>`;
  });
  body += '</tbody>';
  table.innerHTML = head + body;

  const moreBtn = document.getElementById('moreBtn');
  const total = currentWinner.schedule.length;
  if (currentSchedShown < total) {
    moreBtn.style.display = 'block';
    moreBtn.textContent = `${currentSchedShown} / ${total}개월 · 더 보기`;
    moreBtn.onclick = showMore;
  } else if (total > 12) {
    moreBtn.style.display = 'block';
    moreBtn.textContent = '접기';
    moreBtn.onclick = collapse;
  } else {
    moreBtn.style.display = 'none';
  }
}
function showMore() {
  currentSchedShown = Math.min(currentSchedShown + 24, currentWinner.schedule.length);
  renderSchedule();
}
function collapse() {
  currentSchedShown = 12;
  renderSchedule();
  document.getElementById('schedTable').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── 7. 추가 상환 시나리오 ─────────────────────────
function renderScenario() {
  const result = document.getElementById('scenarioResult');
  if (currentExtra <= 0) {
    result.innerHTML = '추가 없이 지금 조건 그대로 갚을 때의 결과입니다. 위 값을 조정해 보세요.';
    result.classList.add('dim');
    return;
  }
  result.classList.remove('dim');
  // 목돈 조건은 유지하고 매달 추가금만 0으로 비교 (순수한 추가금 효과 측정)
  const baseA = runSimulation(currentLoans, 0, 'avalanche', currentLump);
  const baseS = runSimulation(currentLoans, 0, 'snowball', currentLump);
  if (!baseA || !baseS) return;
  const bestBase = baseA.totalInterest <= baseS.totalInterest ? baseA : baseS;
  const bestNow = currentA.totalInterest <= currentS.totalInterest ? currentA : currentS;
  const monthSaved = bestBase.months - bestNow.months;
  const interestSaved = bestBase.totalInterest - bestNow.totalInterest;
  let msg = `매달 <b>${fmtWon(currentExtra)}</b>씩 추가로 상환할 경우, `;
  if (monthSaved > 0) {
    msg += `완납 시점이 <span class="highlight-num">${fmtMon(monthSaved)}</span> 앞당겨지고, 예상 총이자가 <span class="highlight-num">${fmtWon(interestSaved)}</span> 적게 계산됩니다.`;
  } else {
    msg += `예상 총이자가 <span class="highlight-num">${fmtWon(interestSaved)}</span> 적게 계산됩니다.`;
  }
  result.innerHTML = msg;
}
function setScenario(amt, btn) {
  currentExtra = amt;
  document.getElementById('scenarioSlider').value = amt;
  document.getElementById('scenarioAmt').textContent = amt;
  document.getElementById('extra').value = amt; // 입력 폼 동기화
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  render();
}

// ── 8. 관련 가이드 ─────────────────────────
const ALL_GUIDES = {
  'avalanche-vs-snowball': { url: '/guides/avalanche-vs-snowball.html', title: '아발란치 vs 스노우볼 — 갚는 순서는 딱 두 가지', desc: '총이자를 아끼는 순서와 포기하지 않는 순서, 판단 기준까지.' },
  'prepayment-fee': { url: '/guides/prepayment-fee.html', title: '중도상환수수료, 3분 확인으로 안 낼 수 있다', desc: '3년 면제 규정과 계산 공식에서 다들 틀리는 부분.' },
  'rate-cut-request': { url: '/guides/rate-cut-request.html', title: '금리인하요구권 — 갚기 전에 금리부터 깎기', desc: '은행 앱에서 5분. 거절돼도 잃는 게 없는 법적 권리.' },
  'minus-account': { url: '/guides/minus-account.html', title: '마이너스통장 먼저 갚아야 할까?', desc: '갚아도 한도가 살아있는 함정과 진짜 없애는 두 단계.' },
  'repayment-methods': { url: '/guides/repayment-methods.html', title: '원리금균등 vs 원금균등 vs 만기일시', desc: '세 방식의 총이자 비교와 만기일시 목돈 폭탄 대응법.' },
  'credit-score': { url: '/guides/credit-score.html', title: '빚을 갚으면 신용점수가 오르는 이유', desc: '완제 → 점수 상승 → 금리인하요구 선순환 구조.' },
  'refinancing': { url: '/guides/refinancing.html', title: '대환대출, 무조건 이득일까?', desc: '갈아타기 전 확인할 4가지 — 수수료·우대금리·기간.' },
  'repay-or-save': { url: '/guides/repay-or-save.html', title: '여윳돈 생기면 대출부터 갚을까, 저축부터 할까?', desc: '세후 수익률 비교로 정하는 단순한 산수.' }
};
function renderGuides() {
  const picks = ['avalanche-vs-snowball'];
  if (currentLoans.some(l => l.method === 'bullet')) picks.push('repayment-methods');
  if (currentLoans.some(l => l.name.includes('마이너스') || l.name.includes('마통'))) picks.push('minus-account');
  if (currentLoans.some(l => l.rate >= 10)) picks.push('refinancing');
  if (currentExtra > 0 || currentLump > 0) picks.push('repay-or-save');
  picks.push('rate-cut-request');
  picks.push('credit-score');
  picks.push('prepayment-fee');
  const uniq = [...new Set(picks)].slice(0, 4);
  const el = document.getElementById('guidesGrid');
  el.innerHTML = uniq.map(k => {
    const g = ALL_GUIDES[k];
    return `<a class="guide-card" href="${g.url}">
      <span class="g-cat" data-cat-slot></span>
      <div class="g-title">${g.title}</div>
      <div class="g-desc">${g.desc}</div>
      <div class="g-arrow">읽어보기 →</div>
    </a>`;
  }).join('');
}

// ── 9. 공유·저장 ─────────────────────────
function buildShareText() {
  const totalBal = currentLoans.reduce((s, l) => s + l.bal, 0);
  const save = currentS.totalInterest - currentA.totalInterest;
  const avalancheWins = save >= 0;
  const tie = Math.abs(save) <= 1;
  const w = currentWinner;
  let t = `대출 갚는 순서 계산해봤어요.\n\n`;
  t += `📌 총 잔액: ${fmtWon(totalBal)} (대출 ${currentLoans.length}개)\n`;
  if (currentExtra > 0) t += `📌 매달 추가 납입: ${fmtWon(currentExtra)}\n`;
  if (currentLump > 0) t += `📌 목돈 투입: ${fmtWon(currentLump)}\n`;
  t += `\n📊 계산 결과 (${avalancheWins ? '아발란치' : '스노우볼'} 방식 기준)\n`;
  w.order.forEach((o, i) => { t += `${i + 1}. ${o.name} (연 ${o.rate}%) → ${absoluteDate(o.month)} 완납\n`; });
  t += `\n예상 총이자: ${fmtWon(w.totalInterest)}\n`;
  if (!tie) t += `다른 방식보다 ${fmtWon(Math.abs(save))} 적게 계산됩니다.\n`;
  t += `\n대출 여러 개 순서 헷갈리시면 여기서 계산해 보세요.\n👉 https://bitgapja.com`;
  return t;
}
function saveImage() {
  const area = document.getElementById('captureArea');
  html2canvas(area, {
    backgroundColor: '#F7F9FC', scale: 2,
    // 저장 이미지에서만 월별 상환 스케줄 섹션 제외 (화면 표시는 그대로)
    ignoreElements: function (el) {
      return el.classList && el.classList.contains('rsec') && !!el.querySelector('#schedTable');
    }
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = 'bitgapja_결과.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }).catch(() => alert('이미지 저장에 실패했어요. 화면을 캡처해 주세요.'));
}
function shareKakao() {
  const text = buildShareText();
  if (window.Kakao && Kakao.isInitialized && Kakao.isInitialized()) {
    try {
      Kakao.Share.sendDefault({
        objectType: 'text',
        text,
        link: { mobileWebUrl: 'https://bitgapja.com', webUrl: 'https://bitgapja.com' },
        buttonTitle: '내 대출로 계산하기'
      });
      return;
    } catch (e) {}
  }
  navigator.clipboard.writeText(text).then(() => alert('결과를 복사했어요. 카카오톡에 붙여넣기 하세요.'));
}
function copyText(ev) {
  navigator.clipboard.writeText(buildShareText()).then(() => {
    const b = ev.target;
    const old = b.textContent;
    b.textContent = '복사 완료';
    setTimeout(() => b.textContent = old, 1600);
  });
}

// ── 오류 표시 ────────────────────────────
function showErr(msg) {
  const err = document.getElementById('err');
  err.textContent = msg;
  err.style.display = 'block';
  err.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── 시나리오 슬라이더 이벤트 바인딩 ───────────────
(function() {
  const slider = document.getElementById('scenarioSlider');
  if (!slider) return;
  slider.addEventListener('input', function() {
    const v = parseInt(this.value, 10);
    document.getElementById('scenarioAmt').textContent = v;
    document.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('active', parseInt(c.dataset.amt, 10) === v);
    });
  });
  slider.addEventListener('change', function() {
    currentExtra = parseInt(this.value, 10);
    document.getElementById('extra').value = currentExtra;
    if (currentA) render(); // 계산 이미 한 번 돌린 이후에만 재계산
  });
})();
