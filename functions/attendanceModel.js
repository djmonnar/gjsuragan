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

// Records created before floor separation belong to the first floor.
function floor(value = 1) {
  return integer(value, '근무 층', 1, 2);
}

function workDate(ms) {
  return new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
}

function monthRange(value) {
  if (typeof value !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) fail('조회할 월을 확인해 주세요.');
  const [year, month] = value.split('-').map(Number);
  return { start: `${value}-01`, end: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10) };
}

function employeeInput(input) {
  if (!['hourly', 'salaried'].includes(input.payType)) fail('급여 유형을 선택해 주세요.');
  if (typeof input.active !== 'boolean') fail('재직 상태를 확인해 주세요.');
  return {
    name: text(input.name, '이름', 40, true),
    role: text(input.role, '담당 업무', 40),
    floor: floor(input.floor),
    payType: input.payType,
    hourlyRate: input.payType === 'hourly' ? integer(input.hourlyRate, '시급', 1, 1000000) : 0,
    monthlySalary: input.payType === 'salaried' && input.monthlySalary !== undefined
      ? integer(input.monthlySalary, '월급', 1, 100000000) : null,
    breakMinutes: integer(input.breakMinutes, '무급 휴게시간', 0, 720),
    active: input.active,
    note: text(input.note, '메모', 500)
  };
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
    note: text(input.note, '메모', 500)
  };
}

function totals(shift) {
  if (shift.voided || shift.checkOutAt === null) return { workedMinutes: 0, payableMinutes: 0, amount: 0 };
  const workedMinutes = Math.floor((shift.checkOutAt - shift.checkInAt) / MINUTE);
  const payableMinutes = Math.max(0, workedMinutes - shift.breakMinutes);
  const amount = shift.payType === 'hourly' ? Math.round(payableMinutes * shift.hourlyRate / 60) : 0;
  return { workedMinutes, payableMinutes, amount };
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

module.exports = { MINUTE, MAX_SHIFT_MS, fail, text, integer, id, floor, workDate, monthRange, employeeInput, shiftInput, totals, overlaps, kioskEmployee };
