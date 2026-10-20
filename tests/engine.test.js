#!/usr/bin/env node
// 계산 테스트 — index.html의 '세금 엔진' 블록(fin-income-tax · etf-vs-direct 공통)을 꺼내 node(vm)로 실행해 기대값과 맞춘다.
//   node tests/engine.test.js        (실패가 하나라도 있으면 종료 코드 1 — rules-guard 자동 검사가 부름)
// 공용 제도 상수(rules.js)·공용 계산 엔진(calc-v1.js)은 페이지의 <script src>에서 버전을 읽어
// 허브 clone(위쪽 폴더의 ttokjaetv.github.io — 자동 검사에서는 저장소 안에 받아 둠)을 먼저 찾고, 없으면 고정 주소에서 받는다.
//
// 기대값 등급: A = 법령 손계산(식은 이름 옆에), S = 화면 밖 특수값에서 전(엔진 전환 전) 동작 유지, D = 회귀값(2026-10-20 전환 전 코드 출력, 정답 아님, 정확히 같아야 함)
//   D 중 '5월 신고 때 돌려받는 몫(표준세액공제)'을 반영하면서 바뀐 값은 그 줄에 전 값과 손계산 근거를 적어 둠(2026-10-20)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

function loadHub(rel) {
  let src = null;
  for (let d = __dirname, i = 0; i < 6 && src === null; i++, d = path.dirname(d)) {
    const f = path.join(d, 'ttokjaetv.github.io', rel);
    if (fs.existsSync(f)) src = fs.readFileSync(f, 'utf8');
  }
  if (src === null) src = require('child_process').execFileSync(process.execPath, ['-e',
    `fetch('https://ttokjaetv.github.io/${rel}').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(t => process.stdout.write(t))`]).toString();
  const m = { exports: {} };
  new Function('module', 'exports', src)(m, m.exports);
  return m.exports;
}
const R = loadHub(PAGE.match(/rules\/v[\d.]+\/rules\.js/)[0]);
const CALC = loadHub(PAGE.match(/rules\/calc-v\d+\.js/)[0]);

// 페이지에서 시작 줄 ~ 끝 줄(포함)을 꺼냄
function section(start, end) {
  const lines = PAGE.split('\n');
  const a = lines.findIndex(l => l.startsWith(start)), b = lines.findIndex((l, k) => k > a && l.startsWith(end));
  if (a < 0 || b < 0) throw new Error('index.html에서 못 찾음: ' + start);
  return lines.slice(a, b + 1).join('\n');
}
const BLOCK = section('// ============== 세금 엔진 (fin-income-tax', '// ============== 세금 엔진 끝');
const ctx = { TTOKJAE_RULES: R, TTOKJAE_CALC: CALC };
vm.createContext(ctx);
vm.runInContext(BLOCK, ctx, { filename: 'index.html#세금엔진' });
const E = vm.runInContext('({ RULE, FIN_CALC, propPoints, basicTax, marginalRate, finTax, nhFinCounted, nhPremium, nhisCalc, hasWageIncome, finImpact, zeroTaxLimit })', ctx);

let pass = 0, fail = 0;
// tol 0 = Object.is로 정확히 같음(-0·NaN 구분), 아니면 |차이| ≤ tol
function eq(name, got, exp, tol = 0) {
  const ok = tol === 0 ? Object.is(got, exp) : Math.abs(got - exp) <= tol;
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `  got=${got} exp=${exp}${tol ? ' tol=' + tol : ''}`));
}
const M = 1e4;   // 만원

// ---------- 구조 ----------
eq('구조: rules 버전 v2026.2 이상(calc-v1 bind 가능)', typeof E.FIN_CALC, 'object');
eq('구조: FIN_CALC = TTOKJAE_CALC.bind(TTOKJAE_RULES)', E.FIN_CALC, CALC.bind(R));
eq('구조: 화면 설명용 그로스업 비율 = 계산에 쓰는 기준 연도 값 (RULE.grossUp = grossUpByYear[RULE.year])', E.RULE.grossUp, R.FIN_INCOME.grossUpByYear[E.RULE.year]);
for (const n of ['propPoints', 'basicTax', 'marginalRate', 'finTax', 'nhFinCounted', 'nhPremium', 'nhisCalc', 'hasWageIncome', 'finImpact', 'zeroTaxLimit']) eq('구조: 옛 함수 이름 ' + n, typeof E[n], 'function');

// ---------- A. 종합소득세 기본세율 ----------
eq('A basicTax 1,400만 = 1,400만×6% = 84만', E.basicTax(1400 * M), 840000);
eq('A basicTax 5,000만 = ×15% − 126만 = 624만', E.basicTax(5000 * M), 6240000);
eq('A basicTax 8,800만 = ×24% − 576만 = 1,536만', E.basicTax(8800 * M), 15360000);
eq('A basicTax 1억5천만 = ×35% − 1,544만 = 3,706만', E.basicTax(15000 * M), 37060000);
eq('A basicTax 0 이하·NaN = 0', E.basicTax(-5) + E.basicTax(0) + E.basicTax(NaN), 0);
eq('A marginalRate 1,400만 = 6%', E.marginalRate(1400 * M), 0.06);
eq('A marginalRate 1,400만+1원 = 15%', E.marginalRate(1400 * M + 1), 0.15);
eq('A marginalRate 10억 초과 = 45%', E.marginalRate(2e9), 0.45);

// ---------- A. 금융소득종합과세 ----------
{ // 지역가입자·다른 소득 0·이자 1억: 과표 = 1억 − 150만 = 9,850만, A = 2,000만×14% + 기본세율(7,850만) = 280만 + (1,884만 − 576만) = 1,588만,
  // B = 1억×14% = 1,400만 → A, 표준세액공제 7만 → 결정 1,581만, 원천징수 1,400만 → 추가 국세 181만, 지방세 포함 199.1만
  const r = E.finImpact({ interest: 1e8, type: 'regional', nh: {} });
  eq('A 지역·다른 소득 0·이자 1억: A = 1,588만', r.t.A, 15880000);
  eq('A 지역·다른 소득 0·이자 1억: 비교과세 A 선택', r.t.pick, 'A');
  eq('A 지역·다른 소득 0·이자 1억: 표준세액공제 7만', r.t.stdc, 70000);
  eq('A 지역·다른 소득 0·이자 1억: 추가 국세 181만', r.t.extra, 1810000, 1e-6);
  eq('A 지역·다른 소득 0·이자 1억: 늘어나는 세금 1,991,000 (지방세 포함)', r.t.extraTotal, 1991000, 1e-6);
  // 건보: 소득월액 1억/12 = 8,333,333 → ×7.19% = 599,166 → 10원 버림 599,160, 장기요양 599,160×0.9448/7.19 = 78,732 → 78,730
  // 금융소득 0이면 하한 20,160 + 2,640 → 늘어나는 건보료 (677,890 − 22,800)×12 = 7,861,080
  eq('A 지역·이자 1억: 월 건강보험료 599,160', r.nhW.health, 599160);
  eq('A 지역·이자 1억: 월 장기요양 78,730', r.nhW.ltc, 78730);
  eq('A 지역·이자 1억: 금융소득 0원이면 하한(20,160 + 2,640)', r.nhO.monthly, 22800);
  eq('A 지역·이자 1억: 늘어나는 건보료 연 7,861,080', r.dNh, 7861080);
  eq('A 지역·이자 1억: 늘어나는 돈 합계 9,852,080', r.total, 9852080, 1e-6);
}
{ // 표준세액공제 상쇄: 그 밖의 배당 3,000만, 다른 소득 0 → 과표 2,850만, A = 280만 + 850만×6% = 331만, B = 3,000만×14% = 420만 → B,
  // 근로소득 없으면 표준세액공제 7만 → 결정 413만 < 원천징수 420만 → 추가 0원(신고 때 7만 환급 몫 = extraRaw −7만)
  const t = E.finTax({ divOther: 3000 * M });
  eq('A 표준세액공제 상쇄: B 420만 선택', t.pick + ' ' + t.calc, 'B 4200000');
  eq('A 표준세액공제 상쇄: 표준세액공제 7만', t.stdc, 70000);
  eq('A 표준세액공제 상쇄: extraRaw = −7만', t.extraRaw, -70000);
  eq('A 표준세액공제 상쇄: 추가 세금 0원', t.extraTotal, 0);
  const w = E.finTax({ divOther: 3000 * M, hasWage: true });
  eq('A 근로소득 있으면 표준세액공제 없음: stdc 0 · extraRaw 0', w.stdc + w.extraRaw, 0);
}
// ---------- A. 5월 신고 때 돌려받는 돈 (근로소득 없는 종합소득자의 표준세액공제 > 다른 소득만 있을 때 뺄 수 있는 몫) ----------
{ // 지역·다른 소득 0·이자 3,000만: 과표 2,850만, A = 280만 + 850만×6% = 331만 < B = 3,000만×14% = 420만 → 산출세액 420만
  // 결정세액 = 420만 − 표준세액공제 7만 = 413만 < 원천징수 420만 → 돌려받는 국세 7만 + 지방세 7천 = 7.7만
  // 건보: 3,000만 ÷ 12 = 250만 × 7.19% = 179,750, 장기요양 179,750 × 0.9448/7.19 = 23,620 → 월 203,370, 금융소득 0원이면 하한 22,800 → 연 (203,370 − 22,800) × 12 = 2,166,840
  const r = E.finImpact({ interest: 3000 * M, type: 'regional', nh: {} });
  eq('A 환급: 지역·다른 소득 0·이자 3,000만 결정세액 413만', r.t.decided, 4130000);
  eq('A 환급: 지역·이자 3,000만 엔진 추가 세금은 0원(자름)', r.t.extraTotal, 0);
  eq('A 환급: 지역·이자 3,000만 돌려받는 국세 7만', r.refund, 70000);
  eq('A 환급: 지역·이자 3,000만 돌려받는 지방소득세 7천', r.refundLocal, 7000);
  eq('A 환급: 지역·이자 3,000만 돌려받는 돈 7.7만(지방세 포함)', r.refundTotal, 77000);
  eq('A 환급: 지역·이자 3,000만 늘어나는 세금 −7.7만', r.tax, -77000);
  eq('A 환급: 지역·이자 3,000만 늘어나는 건보료 연 2,166,840', r.dNh, 2166840);
  eq('A 환급: 지역·이자 3,000만 늘어나는 돈 합계 = 2,166,840 − 77,000 = 2,089,840', r.total, 2089840);
}
{ // 지역·다른 소득 0·이자 8,155만: 과표 8,005만, A = 280만 + 6,005만×24% − 576만 = 1,145.2만, B = 8,155만×14% = 1,141.7만 → A
  // 결정세액 = 1,145.2만 − 7만 = 1,138.2만, 원천징수 1,141.7만 → 돌려받는 국세 3.5만, 지방세 포함 3.85만 (A − B = 3.5만만큼 공제 몫이 덜 남음)
  const r = E.finImpact({ interest: 8155 * M, type: 'regional', nh: {} });
  eq('A 환급: 이자 8,155만 → 비교과세 A', r.t.pick, 'A');
  eq('A 환급: 이자 8,155만 돌려받는 국세 3.5만', r.refund, 35000, 1e-6);
  eq('A 환급: 이자 8,155만 돌려받는 돈 3.85만(지방세 포함)', r.refundTotal, 38500, 1e-6);
}
{ // 다른 과세표준 50만(지역): 다른 소득만 세금 = 50만×6% = 3만 − 표준세액공제 3만(산출세액 한도) = 0
  // 이자 3,000만 → 과표 3,050만, A = 280만 + 기본세율(1,050만) 63만 = 343만 < B = 420만 + 3만 = 423만 → 결정 416만 − 0 − 420만 = −4만 → 돌려받는 돈 4만 + 4천 = 4.4만(= 7만 − 3만 몫)
  const r = E.finImpact({ interest: 3000 * M, otherBase: 50 * M, type: 'regional', nh: { other: 50 * M } });
  eq('A 환급: 다른 과표 50만·이자 3,000만 돌려받는 국세 4만(7만 − 3만)', r.refund, 40000);
  eq('A 환급: 다른 과표 50만·이자 3,000만 돌려받는 돈 4.4만', r.refundTotal, 44000);
  // 다른 과표 5,000만이면 표준세액공제 7만이 양쪽에서 다 빠져 상쇄 → 돌려받는 몫 없음, 늘어나는 세금 = 엔진 추가 세금 그대로
  const c = E.finImpact({ interest: 3000 * M, otherBase: 5000 * M, type: 'regional', nh: { other: 5000 * M } });
  eq('A 환급 없음: 다른 과표 5,000만 → 상쇄, refund 0', c.refund, 0);
  eq('A 환급 없음: 늘어나는 세금 = 엔진 추가 세금(110만) 그대로', c.tax, c.t.extraTotal);
}
{ // 근로소득 있으면(직장가입자) 표준세액공제 없음 → 결정 420만 = 원천징수 → 돌려받는 몫 0
  const r = E.finImpact({ interest: 3000 * M, type: 'work', nh: {} });
  eq('A 환급 없음: 직장가입자 이자 3,000만 refund 0 · tax 0', r.refund + ' ' + r.tax, '0 0');
}
{ // 국내주식 배당 1억(지역·다른 소득 0): 그로스업 800만, A = 1,780만 > B = 1,400만 → 배당세액공제 min(800만, 380만) = 380만
  // 결정 = 1,780만 − 380만 − 7만 = 1,393만 < 원천징수 1,400만 → 돌려받는 국세 7만
  const r = E.finImpact({ divGU: 1e8, type: 'regional', nh: {} });
  eq('A 환급: 국내주식 배당 1억 → 배당세액공제로 B까지 내려와 돌려받는 국세 7만', r.refund, 70000, 1e-6);
}
{ // 건보료가 이미 상한(사업소득 10억)이면 건보료 증가 0 → 늘어나는 돈 합계 = −7.7만(오히려 돌려받음)
  const r = E.finImpact({ interest: 3000 * M, type: 'regional', nh: { biz: 1e9 } });
  eq('A 환급: 건보료 상한·이자 3,000만 → 늘어나는 돈 합계 −77,000', r.total, -77000);
}
{ // 엔진 추가 세금이 1원 미만 음수(계산 오차)면 돌려받는 몫 0 — 다른 과표 116.7만 이상 B 선택 구간은 상쇄돼 결과 0원 근처
  const r = E.finImpact({ divOther: 2500 * M, otherBase: 300 * M, type: 'regional', nh: { other: 300 * M } });
  eq('A 상쇄 구간(다른 과표 300만·배당 2,500만): refund 0', r.refund, 0);
}
{ // 그로스업: 국내주식 배당 3,000만 + 다른 과세표준 1억 + 근로소득 있음
  // gu = min(3,000만, 3,000만 − 2,000만)×10% = 100만, 금융소득금액 3,100만, 과표 1억3,100만
  // A = 280만 + 기본세율(1억1,100만) = 280만 + (3,885만 − 1,544만) = 2,621만, B = 420만 + 기본세율(1억) = 420만 + 1,956만 = 2,376만
  // 배당세액공제 = min(100만, 2,621만 − 2,376만) = 100만 → 결정 2,521만 − 다른 소득 세금 1,956만 − 원천 420만 = 145만, 지방세 포함 159.5만
  const t = E.finTax({ divGU: 3000 * M, otherBase: 1e8, hasWage: true });
  eq('A 그로스업 100만', t.gu, 1000000);
  eq('A 금융소득금액 3,100만', t.finAmt, 31000000);
  eq('A 그로스업 사례 A = 2,621만 (A 선택)', t.A, 26210000);
  eq('A 배당세액공제 100만', t.dc, 1000000);
  eq('A 그로스업 사례 추가 세금 159.5만', t.extraTotal, 1595000, 1e-6);
  eq('A 건보료 반영 금융소득 = 그로스업 포함 3,100만', E.nhFinCounted(t), 31000000);
}
{ // 2,000만 "초과"부터 종합과세
  const a = E.finTax({ interest: 2000 * M }), b = E.finTax({ interest: 2000 * M + 1 });
  eq('A 금융소득 2,000만 = 분리과세(원천징수 15.4% 308만으로 끝)', String(a.comp) + ' ' + a.extraTotal, 'false 0');
  eq('A 금융소득 2,000만 원천징수 지방세 포함 308만', a.prepaidTotal, 3080000, 1e-6);
  eq('A 금융소득 2,000만+1원 = 종합과세 대상', b.comp, true);
}
// 다른 소득 0: 금융소득 F가 7,150만~1억950만 구간이면 A = 280만 + (F − 2,150만)×24% − 576만, B = F×14%
// 추가 세금 = A − 7만 − B = F×10% − 819만 > 0.5원 → F > 8,190만 0.5원 / 근로소득 있으면(7만 없음) F > 8,120만
eq('A 추가 세금 0원 상한(다른 소득 0, 근로소득 없음) ≈ 8,190만', E.zeroTaxLimit(0, false), 81900005, 1);
eq('A 추가 세금 0원 상한(다른 소득 0, 근로소득 있음) ≈ 8,120만', E.zeroTaxLimit(0, true), 81200005, 1);

// ---------- A. 건강보험료 (하한·상한·10원 버림) ----------
const P = (m, rg) => E.nhPremium(m, rg);
eq('A 지역 소득월액 28만 이하 → 하한 20,160', P(280000, true).health, 20160);
eq('A 지역 소득월액 28만 → 하한 표시', P(280000, true).atFloor, true);
eq('A 하한 장기요양 20,160×0.9448/7.19 = 2,649 → 2,640', P(280000, true).ltc, 2640);
eq('A 지역 소득월액 280,389 → 20,159.97 < 하한 → 하한', P(280389, true).atFloor, true);
eq('A 지역 소득월액 280,390 → 20,160.04 → 하한 아님, 10원 버림 20,160', P(280390, true).atFloor + ' ' + P(280390, true).health, 'false 20160');
eq('A 직장(하한 없음) 소득월액 28만 → 20,132 → 10원 버림 20,130', P(280000, false).health, 20130);
eq('A 소득월액 1,000,005 → 71,900.36 → 71,900', P(1000005, false).health, 71900);
eq('A 소득월액 100만 장기요양 9,448 → 10원 버림 9,440', P(1e6, false).ltc, 9440);
eq('A 소득월액 63,862,865 → 4,591,739.99 → 상한 아님 4,591,730', P(63862865, false).health, 4591730);
eq('A 소득월액 63,862,866 → 상한 4,591,740', P(63862866, false).health, 4591740);
eq('A 상한 표시', P(63862866, true).atCap, true);
eq('A 상한 장기요양 4,591,740×0.9448/7.19 = 603,377 → 603,370', P(63862866, true).ltc, 603370);
eq('A 직장 소득월액 0 → 0원', P(0, false).monthly, 0);

// ---------- A. 직장가입자 보수 외 소득 ----------
{ // 배당 3,000만(직장 → 근로소득 있음) → 건보 반영 3,000만, 보수 외 소득 3,000만 − 2,000만 = 1,000만 ÷ 12 = 833,333 → 59,916 → 59,910, 장기요양 7,872 → 7,870
  const r = E.finImpact({ divOther: 3000 * M, type: 'work', nh: {} });
  eq('A 직장 배당 3,000만: 월 59,910 + 7,870', r.nhW.health + ' ' + r.nhW.ltc, '59910 7870');
  eq('A 직장 배당 3,000만: 늘어나는 건보료 연 813,360', r.dNh, 813360);
  eq('A 직장 보수 외 소득 정확히 2,000만 → 0원', E.nhisCalc('work', 2000 * M, {}).annual, 0);
}

// ---------- A. 재산 점수·피부양자 ----------
eq('A 재산 과표 1억(공제 1억) → 0점', E.propPoints(1e8), 0);
eq('A 재산 과표 1억+1원 → 첫 등급 22점', E.propPoints(1e8 + 1), 22);
eq('A 재산 과표 9억+1원 → (8억 = 8만 만원) 82,400만 이하 등급 961점', E.propPoints(9e8 + 1), 961);
const D = (fin, o) => E.nhisCalc('dep', fin, o);
eq('A 피부양자 공적연금 2,000만 → 유지', D(0, { pension: 2000 * M }).eligible, true);
{ const r = D(0, { pension: 2000 * M + 1 });   // 탈락 → 지역: 50% 반영 10,000,000.5 ÷ 12 → 59,916 → 59,910, 장기요양 7,870
  eq('A 피부양자 공적연금 2,000만+1원 → 탈락', r.eligible, false);
  eq('A 피부양자 탈락 월 보험료 67,780', r.monthly, 67780); }
eq('A 피부양자 사업소득 500만(사업자등록 없음) → 유지', D(0, { biz: 500 * M }).eligible, true);
eq('A 피부양자 사업소득 500만+1원 → 사업소득 요건 탈락', D(0, { biz: 500 * M + 1 }).cBiz, false);
eq('A 피부양자 사업자등록 + 사업소득 1원 → 탈락(하한 22,800)', D(0, { biz: 1, bizReg: true }).monthly, 22800);
eq('A 피부양자 재산 9억 + 소득 1,000만 → 유지', D(0, { pension: 1000 * M, prop: 9e8 }).eligible, true);
{ const r = D(0, { pension: 1000 * M, prop: 9e8 + 1 });   // 재산 961점×211.5 = 203,251.5 → 203,250 + 소득 29,950 = 233,200, 장기요양 30,643 → 30,640
  eq('A 피부양자 재산 9억+1원 → 재산 요건 탈락', r.cProp, false);
  eq('A 탈락 후 재산 보험료 203,250', r.propHealth, 203250);
  eq('A 탈락 후 건강보험료 233,200 · 장기요양 30,640', r.health + ' ' + r.ltc, '233200 30640'); }
eq('A 피부양자 재산 7억 + 소득 1,000만+1원 → 재산 요건 탈락', D(0, { pension: 1000 * M + 1, prop: 7e8 }).cProp, false);
eq('A 피부양자 재산 5.4억+1원 + 소득 1,000만 → 유지', D(0, { pension: 1000 * M, prop: 5.4e8 + 1 }).eligible, true);
{ // 금융소득 1,000만 절벽: 공적연금 1,500만 + 배당 1,000만 → 건보 반영 0 → 유지 / 1,000만+1원 → 전액 반영, 소득 2,500만 → 탈락
  const a = E.finImpact({ divOther: 1000 * M, type: 'dep', nh: { pension: 1500 * M } });
  const b = E.finImpact({ divOther: 1000 * M + 1, type: 'dep', nh: { pension: 1500 * M } });
  eq('A 피부양자 금융소득 1,000만 → 건보료 0원', a.total, 0);
  eq('A 피부양자 금융소득 1,000만+1원 → 탈락', b.nhW.eligible, false);
  eq('A 피부양자 금융소득 1,000만+1원 → 연 1,423,440 (17,500,001 ÷ 12 → 104,850 + 13,770)', b.dNh, 1423440);
}

// ---------- S. 화면 밖 특수값 — 엔진 전환 전 동작 유지 ----------
eq('S 직장 금융소득 NaN → 합계 NaN · 보험료 0원(전 동작)', E.nhisCalc('work', NaN, { wage: 3e7 }).annual, 0);
eq('S 직장 금융소득 NaN → S NaN', E.nhisCalc('work', NaN, {}).S, NaN);
eq('S 피부양자 금융소득 NaN → 소득 요건 탈락(전 동작)', E.nhisCalc('dep', NaN, {}).cIncome, false);
eq('S 피부양자 금융소득 NaN → 보험료 NaN', E.nhisCalc('dep', NaN, { prop: 9e8 + 1 }).ltc, NaN);
eq('S 금융소득 합계 NaN → 반영액 NaN(전 식)', E.nhFinCounted({ F: NaN, comp: false }), NaN);
eq('S 지역 반영 소득 음수 → 하한', E.nhisCalc('regional', -5e6, {}).health, 20160);
eq('S 피부양자 음수 소득은 그대로 더함(Y)', E.nhisCalc('dep', 0, { pension: -3e6, wage: 1e6 }).Y, -2e6);
eq('S 금융소득 음수 입력 → 0원으로', E.finTax({ interest: -1e7 }).I, 0);
eq('S finTax의 year 필드는 쓰지 않음(기준 연도 그로스업)', E.finTax({ divGU: 3e7, year: 2027 }).gu, E.finTax({ divGU: 3e7 }).gu);

// ---------- D. 회귀값 (전환 전 HEAD 코드 + rules v2026.1 출력 — 정확히 같아야 함) ----------
const REG = [
  [{ interest: 32000000, divGU: 15000000, divOther: 8000000, otherBase: 45000000, type: 'regional', nh: { biz: 20000000, wage: 10000000, pension: 12000000 } }, [2100999.999999999, 4596240, 6697239.999999999]],
  // 2: 합계 2,712,720 → 2,635,720 (돌려받는 몫 반영). 금융소득 3,334.6만·다른 소득 0·근로 없음 → B 선택, 결정 = B − 7만 → 돌려받는 국세 7만 + 지방세 7천 = 7.7만
  [{ interest: 12345670, divGU: 0, divOther: 21000000, otherBase: 0, type: 'dep', nh: { pension: 11000000, wage: 0, other: 0, biz: 3000000, bizReg: false, prop: 620000000 } }, [0, 2712720, 2635720]],
  [{ interest: 5000000, divGU: 40000000, divOther: 0, otherBase: 160000000, type: 'work', nh: { biz: 5000000, wage: 0, pension: 0 } }, [4894999.999999999, 2643600, 7538599.999999999]],
  [{ interest: 0, divGU: 0, divOther: 20000001, otherBase: 14000000, type: 'regional', nh: { biz: 0, wage: 0, pension: 24000000 } }, [0.011000000266358256, 1626960, 1626960.0110000002]],
  [{ interest: 75000000, divGU: 250000000, divOther: 10000000, otherBase: 600000000, type: 'work', nh: { biz: 100000000, wage: 50000000, pension: 0 } }, [81070000, 29093880, 110163880]],
  [{ interest: 15000000, divGU: 0, divOther: 0, otherBase: 20000000, type: 'dep', nh: { pension: 0, wage: 0, other: 20000000, biz: 0, bizReg: true, prop: 950000000 } }, [0, 1220160, 1220160]],
];
REG.forEach(([x, [tax, nh, total]], i) => {
  const r = E.finImpact(x);
  eq(`D finImpact 회귀 ${i + 1} (${x.type}) 추가 세금`, r.t.extraTotal, tax);
  eq(`D finImpact 회귀 ${i + 1} (${x.type}) 건보료 증가`, r.dNh, nh);
  eq(`D finImpact 회귀 ${i + 1} (${x.type}) 합계`, r.total, total);
});
eq('D zeroTaxLimit(4,500만, 근로소득 없음) = 2,000만', E.zeroTaxLimit(4.5e7, false), 20000000);

console.log(`\n${fail ? 'FAIL' : 'ALL PASS'} — ${pass + fail}건 (통과 ${pass} · 실패 ${fail}) · rules v${R.meta.version} · ${CALC.version}`);
process.exit(fail ? 1 : 0);
