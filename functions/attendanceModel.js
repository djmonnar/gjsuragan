'use strict';

const MINUTE = 60000;
const MAX_SHIFT_MS = 36 * 60 * MINUTE;

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    fail(`${label}을(를) 확인해 주세요.`);
  }
  return value.trim();
}

function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}을(를) 확인해 주세요.`);
  return value;
}

function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('잘못된 항목입니다.');
  return value;
}

// Legacy floor IDs remain stable: 1 = Doldam, 2 = Suragan. No record migration is needed.
function floor(value = 1) {
  return integer(value, '근무 매장', 1, 2);
}

function workDate(ms) {
  return new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
}

function monthRange(value) {
  if (typeof value !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) fail('조회할 월을 확인해 주세요.');
  const [year, month] = value.split('-').map(Number);
  return { start: `${value}-01`, end: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10) };
}

// 월급 직원의 통상시급과 하루치를 내려면 소정근로시간·일수가 있어야 한다.
// 209시간은 주 40시간에 주휴를 더한 통상적인 기준값이다.
const DEFAULT_MONTHLY_WORK_HOURS = 209;
const DEFAULT_MONTHLY_WORK_DAYS = 22;

// 배율은 정수 퍼센트로 둔다(150 = 1.5배). 금액을 소수로 들고 다니면 원 단위가 어긋난다.
const BASE_PERCENT = 100;
const PAY_TYPE_SCOPES = ['hourly', 'salaried', 'both'];

// 일일근무자(daily)는 사람이 아니라 '자리'다.
// 누가 올지 모르는 하루 일손을 위해 태블릿에 미리 띄워두는 칸이고,
// 한 자리를 여러 사람이 같은 날 같이 쓴다. 그래서 출퇴근 기록마다 따로 떨어져야 한다.
// 이름은 나중에 정산할 때 기록별로 적는다.
const PAY_TYPES = ['hourly', 'salaried', 'daily'];

// 일당이 덮는 근무시간과, 그 뒤로 얼마마다 얼마를 더 줄지.
// 기본은 '8시간까지가 일당, 넘고 나서 30분마다 추가'다.
const DEFAULT_DAILY_BASE_MINUTES = 480;
const DEFAULT_OVERTIME_UNIT_MINUTES = 30;

// 원천징수 3.3% (소득세 3% + 지방소득세 0.3%).
// 천분율 정수로 둔다. 0.033 같은 소수를 곱하면 원 단위가 어긋난다.
const WITHHOLDING_PER_MILLE = 33;

// 떼는 금액. 원 단위로 버린다 — 덜 떼는 쪽이 받는 사람에게 유리하고,
// 더 떼서 모자라게 주는 것보다 낫다.
function withholdingTax(amount) {
  const gross = Number(amount);
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return Math.floor(gross * WITHHOLDING_PER_MILLE / 1000);
}

// 실제로 건네줄 금액.
function netPay(amount, withhold) {
  const gross = Math.max(0, Number(amount) || 0);
  return withhold ? gross - withholdingTax(gross) : gross;
}

// 기준을 넘긴 뒤 추가 급여가 몇 번 붙는지.
// 30분 단위면 20분 초과는 0번, 35분 초과는 1번, 70분 초과는 2번이다.
// '30분을 넘었을 때부터' 주는 것이라 모자란 자투리는 세지 않는다.
function overtimeUnits(payableMinutes, baseMinutes, unitMinutes) {
  const unit = Number(unitMinutes) > 0 ? Number(unitMinutes) : DEFAULT_OVERTIME_UNIT_MINUTES;
  const base = Number(baseMinutes) > 0 ? Number(baseMinutes) : DEFAULT_DAILY_BASE_MINUTES;
  const over = Number(payableMinutes) - base;
  if (!Number.isFinite(over) || over < unit) return 0;
  return Math.floor(over / unit);
}
function isSharedSlot(employee = {}) {
  return employee.payType === 'daily';
}

// 비었거나 0 이면 기본값. 그 밖의 값은 손대지 않고 넘겨서 검증을 받게 한다.
function unsetTo(value, fallback) {
  return value === undefined || value === null || value === 0 ? fallback : value;
}

function workDateString(value, label = '날짜') {
  if (typeof value !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    fail(`${label}을(를) 확인해 주세요.`);
  }
  return value;
}

function employeeInput(input) {
  if (!PAY_TYPES.includes(input.payType)) fail('급여 유형을 선택해 주세요.');
  if (typeof input.active !== 'boolean') fail('재직 상태를 확인해 주세요.');
  const salaried = input.payType === 'salaried';
  return {
    name: text(input.name, '이름', 40, true),
    role: text(input.role, '담당 업무', 40),
    floor: floor(input.floor),
    payType: input.payType,
    hourlyRate: input.payType === 'hourly' ? integer(input.hourlyRate, '시급', 1, 1000000) : 0,
    monthlySalary: salaried && input.monthlySalary !== undefined
      ? integer(input.monthlySalary, '월급', 1, 100000000) : null,
    // 비워두면 통상 기준값을 쓴다. 기존 직원은 이 값이 없으므로 여기서 기본값이 채워진다.
    // 시급 직원에게는 0 으로 저장되는데, 그 직원을 월급으로 바꾸면 화면이 그 0 을
    // 그대로 되돌려 보낸다. 0 은 '설정 안 함'으로 보고 기본값을 쓴다 —
    // 0시간·0일은 뜻이 없는 값이고, 이것 때문에 급여 유형 변경이 막히면 안 된다.
    // 음수나 범위를 벗어난 값은 그대로 거부한다.
    monthlyWorkHours: salaried
      ? integer(unsetTo(input.monthlyWorkHours, DEFAULT_MONTHLY_WORK_HOURS), '월 소정근로시간', 1, 744) : 0,
    monthlyWorkDays: salaried
      ? integer(unsetTo(input.monthlyWorkDays, DEFAULT_MONTHLY_WORK_DAYS), '월 소정근로일수', 1, 31) : 0,
    // 일일근무자 자리의 기본 일당. 기록마다 관리자가 고칠 수 있는 '기본값'이다.
    // 명절이나 흥정한 금액은 정산할 때 그 기록에서 바꾼다.
    dailyPay: input.payType === 'daily' ? integer(input.dailyPay, '일당', 1, 10000000) : 0,
    // 일당이 덮는 근무시간. 이 시간을 넘겨야 추가 급여가 붙는다.
    dailyBaseMinutes: input.payType === 'daily'
      ? integer(unsetTo(input.dailyBaseMinutes, DEFAULT_DAILY_BASE_MINUTES), '기준 근무시간', 1, 1440) : 0,
    overtimeUnitMinutes: input.payType === 'daily'
      ? integer(unsetTo(input.overtimeUnitMinutes, DEFAULT_OVERTIME_UNIT_MINUTES), '추가 급여 단위', 1, 1440) : 0,
    // 0 이면 추가 급여를 아예 주지 않는다. 안 쓰는 자리가 실수로 돈이 붙으면 안 된다.
    overtimePay: input.payType === 'daily' ? integer(input.overtimePay ?? 0, '추가 급여', 0, 10000000) : 0,
    // 급여에서 3.3% 를 떼고 줄지. 급여 유형과 상관없이 사람마다 정한다.
    withholding: Boolean(input.withholding),
    breakMinutes: integer(input.breakMinutes, '무급 휴게시간', 0, 720),
    active: input.active,
    note: text(input.note, '메모', 500)
  };
}

// 월급 직원의 통상시급. 특수일 가산과 결근 공제의 기준이 된다.
function ordinaryHourlyRate(employee = {}) {
  if (employee.payType !== 'salaried') return 0;
  const salary = Number(employee.monthlySalary);
  if (!Number.isSafeInteger(salary) || salary <= 0) return 0;
  const hours = Number(employee.monthlyWorkHours) > 0 ? Number(employee.monthlyWorkHours) : DEFAULT_MONTHLY_WORK_HOURS;
  return Math.round(salary / hours);
}

// 결근 하루치 공제액.
function dailyDeduction(employee = {}) {
  if (employee.payType !== 'salaried') return 0;
  const salary = Number(employee.monthlySalary);
  if (!Number.isSafeInteger(salary) || salary <= 0) return 0;
  const days = Number(employee.monthlyWorkDays) > 0 ? Number(employee.monthlyWorkDays) : DEFAULT_MONTHLY_WORK_DAYS;
  return Math.round(salary / days);
}

// 명절·특수일. 날짜별로 배율과 적용 대상을 관리자가 정한다.
function specialDayInput(input) {
  if (!PAY_TYPE_SCOPES.includes(input.appliesTo)) fail('적용 대상을 선택해 주세요.');
  return {
    workDate: workDateString(input.workDate, '날짜'),
    label: text(input.label, '이름', 40, true),
    // 0.5배(가산분만)부터 5배까지. 1배는 특수일로 둘 이유가 없다.
    multiplierPercent: integer(input.multiplierPercent, '배율', 50, 500),
    appliesTo: input.appliesTo,
    note: text(input.note, '메모', 500)
  };
}

// 결근. 관리자가 직접 표시한 날만 결근으로 본다.
// 출근 기록이 없다고 결근으로 보면 휴무·연차까지 급여가 깎인다.
function absenceInput(input) {
  return {
    employeeId: id(input.employeeId),
    workDate: workDateString(input.workDate, '결근일'),
    note: text(input.note, '사유', 500)
  };
}

// 이 근무에 적용할 배율(퍼센트). 해당 없으면 100.
function shiftMultiplierPercent(specialDay, payType) {
  if (!specialDay || payType === 'daily') return BASE_PERCENT;
  const scope = specialDay.appliesTo;
  if (scope !== 'both' && scope !== payType) return BASE_PERCENT;
  const percent = Number(specialDay.multiplierPercent);
  return Number.isSafeInteger(percent) && percent > 0 ? percent : BASE_PERCENT;
}

function shiftInput(input, now) {
  const checkInAt = integer(input.checkInAt, '출근 시간', Date.UTC(2020, 0, 1), now);
  const checkOutAt = input.checkOutAt === null ? null : integer(input.checkOutAt, '퇴근 시간', checkInAt + 1, now);
  const breakMinutes = integer(input.breakMinutes, '무급 휴게시간', 0, 720);
  if (checkOutAt !== null) {
    if (checkOutAt - checkInAt > MAX_SHIFT_MS) fail('한 근무 기록은 36시간 이내로 입력해 주세요.');
    if (breakMinutes > Math.floor((checkOutAt - checkInAt) / MINUTE)) fail('휴게시간이 전체 근무시간보다 깁니다.');
  }
  if (!PAY_TYPES.includes(input.payType)) fail('급여 유형을 확인해 주세요.');
  return {
    checkInAt, checkOutAt, breakMinutes,
    workDate: workDate(checkInAt),
    payType: input.payType,
    hourlyRate: input.payType === 'hourly' ? integer(input.hourlyRate, '시급', 1, 1000000) : 0,
    // 월급 직원의 특수일 가산은 당시 통상시급으로 계산한다. 시급과 같은 원칙이다 —
    // 나중에 월급이 바뀌어도 지난 근무의 금액은 그대로 남는다.
    ordinaryHourlyRate: input.payType === 'salaried'
      ? integer(input.ordinaryHourlyRate ?? 0, '통상시급', 0, 1000000) : 0,
    // 일일근무자는 시간이 아니라 하루 단위로 준다. 기록마다 금액을 따로 들고 있어야
    // 같은 자리에 온 사람마다 다른 금액을 줄 수 있다.
    dailyPay: input.payType === 'daily' ? integer(input.dailyPay ?? 0, '일당', 0, 10000000) : 0,
    // 초과 급여 조건도 기록마다 들고 있다. 사람마다 다르게 정할 수 있어야 하고,
    // 나중에 자리 설정이 바뀌어도 지난 기록의 금액은 그대로여야 한다.
    dailyBaseMinutes: input.payType === 'daily'
      ? integer(unsetTo(input.dailyBaseMinutes, DEFAULT_DAILY_BASE_MINUTES), '기준 근무시간', 1, 1440) : 0,
    overtimeUnitMinutes: input.payType === 'daily'
      ? integer(unsetTo(input.overtimeUnitMinutes, DEFAULT_OVERTIME_UNIT_MINUTES), '추가 급여 단위', 1, 1440) : 0,
    overtimePay: input.payType === 'daily' ? integer(input.overtimePay ?? 0, '추가 급여', 0, 10000000) : 0,
    // 기록마다 정한다. 같은 자리에 와도 3.3% 를 떼는 사람과 아닌 사람이 있다.
    withholding: input.payType === 'daily' ? Boolean(input.withholding) : false,
    // 누가 왔는지는 나중에 적는다. 미리 알 수 없으니 비어 있어도 저장된다.
    workerName: input.payType === 'daily' ? text(input.workerName ?? '', '일한 사람', 40) : '',
    workerNote: input.payType === 'daily' ? text(input.workerNote ?? '', '지급 메모', 200) : '',
    note: text(input.note, '메모', 500)
  };
}

// specialDay 는 그 날짜의 특수일 설정(없으면 null).
// 배율은 저장된 값이 아니라 계산할 때 찾는다. 명절을 나중에 등록해도 지난 기록에
// 바로 반영돼야 한다. 관리자가 달력을 뒤늦게 채우는 것이 정상적인 사용이다.
function totals(shift, specialDay = null) {
  const empty = { workedMinutes: 0, payableMinutes: 0, amount: 0, baseAmount: 0, extraAmount: 0, overtimeUnits: 0, multiplierPercent: BASE_PERCENT };
  if (shift.voided || shift.checkOutAt === null) return empty;
  const workedMinutes = Math.floor((shift.checkOutAt - shift.checkInAt) / MINUTE);
  const payableMinutes = Math.max(0, workedMinutes - shift.breakMinutes);
  const multiplierPercent = shiftMultiplierPercent(specialDay, shift.payType);
  if (shift.payType === 'hourly') {
    // 총액을 먼저 반올림하고 기본급을 빼서 가산분을 낸다.
    // 따로 반올림하면 기본급 + 가산분이 총액과 1원씩 어긋난다.
    const amount = Math.round(payableMinutes * shift.hourlyRate * multiplierPercent / (60 * BASE_PERCENT));
    const baseAmount = Math.round(payableMinutes * shift.hourlyRate / 60);
    return { workedMinutes, payableMinutes, amount, baseAmount, extraAmount: amount - baseAmount, multiplierPercent };
  }
  if (shift.payType === 'daily') {
    // 일당은 시간이 아니라 하루 단위다. 특수일 배율은 붙이지 않는다 —
    // 명절에 더 드릴 금액은 그 기록의 일당을 직접 고쳐서 정한다.
    const baseAmount = Math.max(0, Number(shift.dailyPay) || 0);
    // 기준 근무시간을 넘겨 일한 만큼만 따로 더한다.
    // 추가 급여가 0 이면 아예 계산하지 않는다.
    const unitPay = Math.max(0, Number(shift.overtimePay) || 0);
    const units = unitPay > 0 ? overtimeUnits(payableMinutes, shift.dailyBaseMinutes, shift.overtimeUnitMinutes) : 0;
    const extraAmount = units * unitPay;
    return { workedMinutes, payableMinutes, amount: baseAmount + extraAmount, baseAmount, extraAmount,
      overtimeUnits: units, multiplierPercent: BASE_PERCENT };
  }
  // 월급 직원의 소정근로는 월급에 이미 들어 있다. 특수일 근무분만 따로 얹는다.
  const rate = Number(shift.ordinaryHourlyRate) > 0 ? Number(shift.ordinaryHourlyRate) : 0;
  const extraAmount = multiplierPercent === BASE_PERCENT || rate === 0
    ? 0 : Math.round(payableMinutes * rate * multiplierPercent / (60 * BASE_PERCENT));
  return { workedMinutes, payableMinutes, amount: extraAmount, baseAmount: 0, extraAmount, multiplierPercent };
}

function overlaps(a, b) {
  return !b.voided && a.checkInAt < (b.checkOutAt ?? Infinity) && b.checkInAt < (a.checkOutAt ?? Infinity);
}

function kioskEmployee(employee) {
  return {
    id: employee.id, name: employee.name, role: employee.role, payType: employee.payType,
    currentShiftId: employee.currentShiftId || null,
    lastShift: employee.lastShift || null
  };
}

module.exports = {
  MINUTE, MAX_SHIFT_MS, BASE_PERCENT, DEFAULT_MONTHLY_WORK_HOURS, DEFAULT_MONTHLY_WORK_DAYS, PAY_TYPES, isSharedSlot,
  DEFAULT_DAILY_BASE_MINUTES, DEFAULT_OVERTIME_UNIT_MINUTES, overtimeUnits,
  WITHHOLDING_PER_MILLE, withholdingTax, netPay,
  fail, text, integer, id, floor, workDate, workDateString, monthRange,
  employeeInput, shiftInput, totals, overlaps, kioskEmployee,
  ordinaryHourlyRate, dailyDeduction, specialDayInput, absenceInput, shiftMultiplierPercent
};
