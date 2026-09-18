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

function workDateString(value, label = '날짜') {
  if (typeof value !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    fail(`${label}을(를) 확인해 주세요.`);
  }
  return value;
}

function employeeInput(input) {
  if (!['hourly', 'salaried'].includes(input.payType)) fail('급여 유형을 선택해 주세요.');
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
    monthlyWorkHours: salaried
      ? integer(input.monthlyWorkHours ?? DEFAULT_MONTHLY_WORK_HOURS, '월 소정근로시간', 1, 744) : 0,
    monthlyWorkDays: salaried
      ? integer(input.monthlyWorkDays ?? DEFAULT_MONTHLY_WORK_DAYS, '월 소정근로일수', 1, 31) : 0,
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
  if (!specialDay) return BASE_PERCENT;
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
  if (!['hourly', 'salaried'].includes(input.payType)) fail('급여 유형을 확인해 주세요.');
  return {
    checkInAt, checkOutAt, breakMinutes,
    workDate: workDate(checkInAt),
    payType: input.payType,
    hourlyRate: input.payType === 'hourly' ? integer(input.hourlyRate, '시급', 1, 1000000) : 0,
    // 월급 직원의 특수일 가산은 당시 통상시급으로 계산한다. 시급과 같은 원칙이다 —
    // 나중에 월급이 바뀌어도 지난 근무의 금액은 그대로 남는다.
    ordinaryHourlyRate: input.payType === 'salaried'
      ? integer(input.ordinaryHourlyRate ?? 0, '통상시급', 0, 1000000) : 0,
    note: text(input.note, '메모', 500)
  };
}

// specialDay 는 그 날짜의 특수일 설정(없으면 null).
// 배율은 저장된 값이 아니라 계산할 때 찾는다. 명절을 나중에 등록해도 지난 기록에
// 바로 반영돼야 한다. 관리자가 달력을 뒤늦게 채우는 것이 정상적인 사용이다.
function totals(shift, specialDay = null) {
  const empty = { workedMinutes: 0, payableMinutes: 0, amount: 0, baseAmount: 0, extraAmount: 0, multiplierPercent: BASE_PERCENT };
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
    id: employee.id, name: employee.name, role: employee.role,
    currentShiftId: employee.currentShiftId || null,
    lastShift: employee.lastShift || null
  };
}

module.exports = {
  MINUTE, MAX_SHIFT_MS, BASE_PERCENT, DEFAULT_MONTHLY_WORK_HOURS, DEFAULT_MONTHLY_WORK_DAYS,
  fail, text, integer, id, floor, workDate, workDateString, monthRange,
  employeeInput, shiftInput, totals, overlaps, kioskEmployee,
  ordinaryHourlyRate, dailyDeduction, specialDayInput, absenceInput, shiftMultiplierPercent
};
