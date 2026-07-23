/* 빚갚자 계산 엔진 — 상환방식별 월 납입 + 여윳돈 추가 시뮬레이션 */

// 만원 단위, 월 단위 시뮬레이션
// method: 'amortizing'(원리금균등) | 'principal'(원금균등) | 'bullet'(만기일시)

function baseMonthlyPrincipalAndInterest(loan) {
  // 그 대출이 '원래' 매달 내는 최소 금액(원금+이자)을 상환방식에 따라 반환하는 함수 생성
  const r = loan.rate / 100 / 12;
  const n = loan.months; // 남은 개월(상환방식 계산용)
  if (loan.method === 'amortizing') {
    const pay = r === 0 ? loan.bal / n : loan.bal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    return { type: 'amortizing', fixedPay: pay };
  }
  if (loan.method === 'principal') {
    return { type: 'principal', fixedPrincipal: loan.bal / n };
  }
  // bullet: 매달 이자만, 만기(n개월)에 원금 일시
  return { type: 'bullet', maturity: n };
}

// 한 달치 '최소 납입액'(그 대출의 상환방식에 따른 정규 납입) 계산
function minPaymentThisMonth(loan, plan, monthIndex) {
  const r = loan.rate / 100 / 12;
  const interest = loan.balance * r;
  if (plan.type === 'amortizing') {
    // 고정 원리금. 잔액보다 크면 잔액+이자
    return Math.min(plan.fixedPay, loan.balance + interest);
  }
  if (plan.type === 'principal') {
    const principal = Math.min(plan.fixedPrincipal, loan.balance);
    return principal + interest;
  }
  // bullet: 만기 전엔 이자만, 만기달엔 원금+이자
  if (monthIndex >= plan.maturity) return loan.balance + interest;
  return interest;
}

/**
 * 시뮬레이션
 * @param loans [{name, bal, rate, months, method}]
 * @param extra 매달 추가로 더 넣는 돈(만원)
 * @param strategy 'avalanche' | 'snowball'
 * @returns {months, totalInterest, order, schedule, trajectory}
 */
function runSimulation(loans, extra, strategy, lumpSum) {
  lumpSum = lumpSum || 0;
  const L = loans.map(l => ({
    name: l.name, rate: l.rate, method: l.method,
    balance: l.bal, months: l.months,
    plan: null, paidMonth: 0
  }));
  L.forEach(l => { l.plan = baseMonthlyPrincipalAndInterest({ bal: l.balance, rate: l.rate, months: l.months, method: l.method }); });

  let month = 0, totalInterest = 0;
  const order = [];
  const schedule = [];
  const trajectory = [L.reduce((s, l) => s + l.balance, 0)];

  const pickTarget = strategy === 'avalanche'
    ? (rem) => rem.reduce((a, b) => b.rate > a.rate ? b : a)
    : (rem) => rem.reduce((a, b) => b.balance < a.balance ? b : a);

  while (L.some(l => l.balance > 0.0001)) {
    month++;
    if (month > 600) return null;

    const rows = [];
    // 첫 달에 일회성 목돈을 추가금에 합산
    let extraCash = extra + (month === 1 ? lumpSum : 0);

    // 1) 각 대출 최소 납입 처리 (이자 발생 + 최소 상환)
    L.forEach(l => {
      if (l.balance <= 0.0001) return;
      const r = l.rate / 100 / 12;
      const interest = l.balance * r;
      totalInterest += interest;
      let pay = minPaymentThisMonth(l, l.plan, month);
      pay = Math.min(pay, l.balance + interest);
      const principal = pay - interest;
      l.balance = Math.max(0, l.balance + interest - pay);
      rows.push({ name: l.name, pay, interest, principal, _ref: l });
    });

    // 2) 여윳돈(추가금)을 전략 타겟에 집중
    while (extraCash > 0.0001) {
      const rem = L.filter(l => l.balance > 0.0001);
      if (!rem.length) break;
      const t = pickTarget(rem);
      const add = Math.min(extraCash, t.balance);
      t.balance -= add;
      extraCash -= add;
      const row = rows.find(x => x._ref === t);
      if (row) { row.pay += add; row.principal += add; }
    }

    // 3) 완제 체크 + 행 정리
    rows.forEach(row => {
      const l = row._ref;
      row.balAfter = l.balance;
      delete row._ref;
      if (l.balance <= 0.0001 && !l.paidMonth) {
        l.paidMonth = month;
        order.push({ name: l.name, rate: l.rate, month });
      }
    });

    const total = rows.reduce((s, r) => s + r.pay, 0);
    const totalBalAfter = L.reduce((s, l) => s + l.balance, 0);
    schedule.push({ month, rows, total, totalBalAfter });
    trajectory.push(Math.max(0, totalBalAfter));
  }

  return { months: month, totalInterest, order, schedule, trajectory };
}
