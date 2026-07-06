const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function parseMealPlanOcr(input = {}) {
  const fields = Array.isArray(input.fields) ? input.fields : [];
  const baseDate = normalizeDate(input.baseDate) || todayDate();
  const fallbackYear = Number(String(baseDate).slice(0, 4)) || new Date().getFullYear();
  const warnings = [];
  const units = fieldsToUnits(fields);
  const rawText = String(input.text || units.map(unit => unit.text).join('\n')).trim();

  let rows = [];
  if (units.length) {
    rows = parseByLayout(units, fallbackYear, warnings);
  }
  if (!rows.length && rawText) {
    rows = parseByText(rawText, fallbackYear, warnings);
  }

  const normalizedRows = normalizeRows(rows, warnings);
  return {
    rows: normalizedRows,
    warnings: unique(warnings.filter(Boolean)),
    rawText,
    stats: {
      days: normalizedRows.length,
      meals: normalizedRows.reduce((sum, row) => sum + (row.lunchItems.length ? 1 : 0) + (row.saladItems.length ? 1 : 0), 0)
    }
  };
}

function fieldsToUnits(fields) {
  return fields
    .map((field, index) => {
      const text = cleanText(field.inferText || field.text || field.value || '');
      if (!text) return null;
      const vertices = field.boundingPoly?.vertices || field.boundingPoly?.boundingVertices || [];
      const xs = vertices.map(point => Number(point.x)).filter(Number.isFinite);
      const ys = vertices.map(point => Number(point.y)).filter(Number.isFinite);
      const minX = xs.length ? Math.min(...xs) : 0;
      const maxX = xs.length ? Math.max(...xs) : 0;
      const minY = ys.length ? Math.min(...ys) : 0;
      const maxY = ys.length ? Math.max(...ys) : 0;
      return {
        index,
        text,
        confidence: Number(field.inferConfidence ?? field.confidence ?? 0) || 0,
        minX,
        maxX,
        minY,
        maxY,
        centerX: xs.length ? (minX + maxX) / 2 : index,
        centerY: ys.length ? (minY + maxY) / 2 : index,
        height: Math.max(1, maxY - minY)
      };
    })
    .filter(Boolean);
}

function parseByLayout(units, fallbackYear, warnings) {
  const lineGroups = groupUnitsByLine(units);
  const anchors = findDateAnchors(lineGroups, fallbackYear, warnings);
  if (!anchors.length) return [];

  const orderedAnchors = anchors.sort((a, b) => a.centerX - b.centerX || a.centerY - b.centerY);
  const columns = orderedAnchors.map((anchor, index) => {
    const previous = orderedAnchors[index - 1];
    const next = orderedAnchors[index + 1];
    return {
      anchor,
      date: anchor.date,
      dayOfWeek: anchor.dayOfWeek,
      left: previous ? (previous.centerX + anchor.centerX) / 2 : -Infinity,
      right: next ? (anchor.centerX + next.centerX) / 2 : Infinity,
      top: anchor.centerY + 28
    };
  });

  return columns.map(column => {
    const columnUnits = units.filter(unit =>
      unit.centerX >= column.left &&
      unit.centerX < column.right &&
      unit.centerY > column.top &&
      !parseDateText(unit.text, fallbackYear)
    );
    const lines = groupUnitsByLine(columnUnits)
      .map(group => ({ text: cleanText(group.text), centerY: group.centerY, height: group.height }))
      .filter(line => line.text && !isNoiseLine(line.text));
    const split = splitMenuLines(lines);
    return {
      date: column.date,
      dayOfWeek: column.dayOfWeek,
      lunchItems: split.lunchItems,
      saladItems: split.saladItems,
      note: split.note,
      warnings: split.warnings
    };
  });
}

function parseByText(text, fallbackYear, warnings) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(cleanText)
    .filter(Boolean);
  const rows = [];
  let current = null;

  lines.forEach(line => {
    const parsedDate = parseDateText(line, fallbackYear);
    if (parsedDate) {
      if (current) rows.push(current);
      current = {
        date: parsedDate.date,
        dayOfWeek: parsedDate.dayOfWeek,
        lines: []
      };
      if (parsedDate.warning) warnings.push(parsedDate.warning);
      return;
    }
    if (current && !isNoiseLine(line)) {
      current.lines.push({ text: line, centerY: current.lines.length, height: 16 });
    }
  });
  if (current) rows.push(current);

  return rows.map(row => {
    const split = splitMenuLines(row.lines);
    return {
      date: row.date,
      dayOfWeek: row.dayOfWeek,
      lunchItems: split.lunchItems,
      saladItems: split.saladItems,
      note: split.note,
      warnings: split.warnings
    };
  });
}

function groupUnitsByLine(units) {
  const sorted = [...units].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);
  const groups = [];
  sorted.forEach(unit => {
    const last = groups[groups.length - 1];
    const threshold = Math.max(14, Math.min(28, unit.height * 0.9));
    if (last && Math.abs(last.centerY - unit.centerY) <= threshold) {
      last.units.push(unit);
      last.centerY = average(last.units.map(item => item.centerY));
      last.centerX = average(last.units.map(item => item.centerX));
      last.height = average(last.units.map(item => item.height));
    } else {
      groups.push({ units: [unit], centerY: unit.centerY, centerX: unit.centerX, height: unit.height });
    }
  });

  return groups.map(group => {
    const ordered = group.units.sort((a, b) => a.centerX - b.centerX);
    return {
      units: ordered,
      text: ordered.map(unit => unit.text).join(' '),
      centerX: average(ordered.map(unit => unit.centerX)),
      centerY: average(ordered.map(unit => unit.centerY)),
      height: average(ordered.map(unit => unit.height)),
      minX: Math.min(...ordered.map(unit => unit.minX)),
      maxX: Math.max(...ordered.map(unit => unit.maxX))
    };
  });
}

function findDateAnchors(lineGroups, fallbackYear, warnings) {
  const anchors = [];

  lineGroups.forEach(group => {
    const groupDates = parseAllDateTexts(group.text, fallbackYear);
    if (groupDates.length === 1) {
      const parsed = groupDates[0];
      if (parsed.warning) warnings.push(parsed.warning);
      anchors.push({
        date: parsed.date,
        dayOfWeek: parsed.dayOfWeek,
        centerX: group.centerX,
        centerY: group.centerY
      });
    }

    group.units.forEach(unit => {
      const parsed = parseDateText(unit.text, fallbackYear);
      if (!parsed) return;
      if (parsed.warning) warnings.push(parsed.warning);
      anchors.push({
        date: parsed.date,
        dayOfWeek: parsed.dayOfWeek,
        centerX: unit.centerX,
        centerY: unit.centerY
      });
    });

    anchors.push(...findSplitDateAnchors(group.units, fallbackYear, warnings));
  });

  return uniqueDateAnchors(anchors)
    .filter(anchor => !isNoiseDateAnchor(anchor, lineGroups));
}

function findSplitDateAnchors(units, fallbackYear, warnings) {
  const anchors = [];
  const ordered = [...units].sort((a, b) => a.centerX - b.centerX);
  for (let i = 0; i < ordered.length; i++) {
    const monthMatch = cleanText(ordered[i].text).match(/^(\d{1,2})\s*월$/);
    if (!monthMatch) continue;
    const dayUnit = ordered.slice(i + 1, i + 4).find(unit =>
      unit.centerX > ordered[i].centerX &&
      unit.centerX - ordered[i].centerX < 160 &&
      /^\d{1,2}\s*일$/.test(cleanText(unit.text))
    );
    if (!dayUnit) continue;
    const dayMatch = cleanText(dayUnit.text).match(/^(\d{1,2})\s*일$/);
    const dowUnit = ordered.slice(i + 1, i + 5).find(unit =>
      unit.centerX > dayUnit.centerX &&
      unit.centerX - dayUnit.centerX < 120 &&
      /^\(?\s*[월화수목금토일]\s*\)?$/.test(cleanText(unit.text))
    );
    const month = Number(monthMatch[1]);
    const day = Number(dayMatch[1]);
    const date = buildDate(fallbackYear, month, day);
    if (!date) continue;
    const dayOfWeek = dowUnit ? cleanText(dowUnit.text).replace(/[()\s]/g, '') : actualDayOfWeek(date);
    const warning = dayOfWeek && dayOfWeek !== actualDayOfWeek(date)
      ? `${date} 요일 확인 필요: OCR은 ${dayOfWeek}, 실제는 ${actualDayOfWeek(date)}`
      : '';
    if (warning) warnings.push(warning);
    const parts = [ordered[i], dayUnit, dowUnit].filter(Boolean);
    anchors.push({
      date,
      dayOfWeek: dayOfWeek || actualDayOfWeek(date),
      centerX: average(parts.map(part => part.centerX)),
      centerY: average(parts.map(part => part.centerY))
    });
  }
  return anchors;
}

function uniqueDateAnchors(anchors) {
  const bestByDate = new Map();
  anchors.forEach(anchor => {
    if (!anchor?.date) return;
    const existing = bestByDate.get(anchor.date);
    if (!existing || anchor.centerY < existing.centerY) {
      bestByDate.set(anchor.date, anchor);
    }
  });
  return [...bestByDate.values()];
}

function isNoiseDateAnchor(anchor, lineGroups) {
  const nearest = lineGroups
    .map(group => ({ group, distance: Math.abs(group.centerY - anchor.centerY) + Math.abs(group.centerX - anchor.centerX) / 8 }))
    .sort((a, b) => a.distance - b.distance)[0]?.group;
  return nearest ? /식단표|궁중수라간/.test(nearest.text) && !/\d{1,2}\s*일/.test(nearest.text) : false;
}

function splitMenuLines(lines) {
  const warnings = [];
  const meaningful = lines
    .map(line => ({ ...line, text: cleanText(line.text) }))
    .filter(line => line.text && !isNoiseLine(line.text));

  const holiday = meaningful.find(line => isHolidayLine(line.text));
  const foodLines = meaningful
    .filter(line => !isHolidayLine(line.text))
    .sort((a, b) => a.centerY - b.centerY);

  if (!foodLines.length) {
    return { lunchItems: [], saladItems: [], note: holiday ? cleanHolidayText(holiday.text) : '', warnings };
  }

  let saladStartIndex = foodLines.findIndex(line => isSaladLine(line.text));
  if (saladStartIndex < 0 && foodLines.length >= 2) {
    let largestGap = 0;
    let gapIndex = -1;
    for (let i = 1; i < foodLines.length; i++) {
      const gap = foodLines[i].centerY - foodLines[i - 1].centerY;
      if (gap > largestGap) {
        largestGap = gap;
        gapIndex = i;
      }
    }
    const avgHeight = average(foodLines.map(line => Math.max(12, line.height || 12)));
    if (gapIndex > 0 && largestGap > Math.max(52, avgHeight * 2.8)) {
      saladStartIndex = gapIndex;
    }
  }

  const lunchSource = saladStartIndex >= 0 ? foodLines.slice(0, saladStartIndex) : foodLines;
  const saladSource = saladStartIndex >= 0 ? foodLines.slice(saladStartIndex) : [];
  const lunchItems = normalizeMenuItems(lunchSource.map(line => line.text));
  const saladItems = normalizeMenuItems(saladSource.map(line => line.text));

  if (!lunchItems.length && !saladItems.length && meaningful.length && !holiday) {
    warnings.push('메뉴로 저장할 줄을 찾지 못했습니다.');
  }

  return { lunchItems, saladItems, note: holiday ? cleanHolidayText(holiday.text) : '', warnings };
}

function normalizeRows(rows, warnings) {
  const merged = new Map();
  rows.forEach(row => {
    const date = normalizeDate(row.date);
    if (!date) return;
    const lunchItems = normalizeMenuItems(row.lunchItems || []);
    const saladItems = normalizeMenuItems(row.saladItems || []);
    const note = cleanText(row.note || '');
    if (!lunchItems.length && !saladItems.length && !note) return;
    const existing = merged.get(date) || {
      date,
      dayOfWeek: actualDayOfWeek(date),
      lunchItems: [],
      saladItems: [],
      note: '',
      warnings: []
    };
    if (row.dayOfWeek && existing.dayOfWeek !== row.dayOfWeek) {
      existing.warnings.push(`${date} 요일이 OCR(${row.dayOfWeek})과 달라 확인이 필요합니다.`);
    }
    existing.lunchItems = unique(existing.lunchItems.concat(lunchItems));
    existing.saladItems = unique(existing.saladItems.concat(saladItems));
    existing.note = existing.note || note;
    existing.warnings = unique(existing.warnings.concat(row.warnings || []));
    merged.set(date, existing);
  });

  const result = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  const duplicateDates = rows
    .map(row => normalizeDate(row.date))
    .filter(Boolean)
    .filter((date, index, list) => list.indexOf(date) !== index);
  unique(duplicateDates).forEach(date => warnings.push(`${date} 식단이 중복되어 하나로 합쳤습니다.`));
  return result;
}

function parseAllDateTexts(text, fallbackYear) {
  const normalized = cleanText(text).replace(/\s+/g, ' ');
  const pattern = /(?:(20\d{2})\s*(?:년|[.\-/])\s*)?(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})\s*(?:일)?\s*(?:\(?\s*([월화수목금토일])\s*\)?)?/g;
  const matches = [];
  let match;
  while ((match = pattern.exec(normalized))) {
    const parsed = buildParsedDate(match, fallbackYear);
    if (parsed) matches.push(parsed);
  }
  return matches;
}

function parseDateText(text, fallbackYear) {
  const normalized = cleanText(text).replace(/\s+/g, ' ');
  const match = normalized.match(/(?:(20\d{2})\s*(?:년|[.\-/])\s*)?(\d{1,2})\s*(?:월|[.\-/])\s*(\d{1,2})\s*(?:일)?\s*(?:\(?\s*([월화수목금토일])\s*\)?)?/);
  if (!match) return null;
  return buildParsedDate(match, fallbackYear);
}

function buildParsedDate(match, fallbackYear) {
  const year = Number(match[1] || fallbackYear);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const expectedDow = match[4] || '';
  const date = buildDate(year, month, day);
  if (!date) return null;
  const actualDow = actualDayOfWeek(date);
  return {
    date,
    dayOfWeek: expectedDow || actualDow,
    warning: expectedDow && expectedDow !== actualDow
      ? `${date} 요일 확인 필요: OCR은 ${expectedDow}, 실제는 ${actualDow}`
      : ''
  };
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (match) return buildDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return null;
}

function buildDate(year, month, day) {
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function actualDayOfWeek(date) {
  const match = String(date || '').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] || '';
}

function normalizeMenuItems(items) {
  return unique(
    (Array.isArray(items) ? items : String(items || '').split(/\r?\n/))
      .flatMap(item => String(item || '').split(/[,·•ㆍ]/))
      .map(item => cleanMenuItem(item))
      .filter(item => item && item !== '&' && !isNoiseLine(item) && !isHolidayLine(item))
  );
}

function cleanMenuItem(value) {
  return cleanText(value)
    .replace(/^[-*ㆍ·•\s]+/, '')
    .replace(/[<>]/g, '')
    .replace(/\s*&\s*/g, ' & ')
    .trim();
}

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNoiseLine(text) {
  const value = cleanText(text);
  if (!value) return true;
  if (/궁중수라간|식단표|보다\s*신선한|재료상황|유동적으로|샐러드주문|변경은|전날|부탁드립니다|^\d{1,2}\s*월$|^[<>\-_\s=&]+$/.test(value)) return true;
  return false;
}

function isSaladLine(text) {
  const value = cleanText(text);
  return /샐러드|드레싱|D\s*드레싱/.test(value);
}

function isHolidayLine(text) {
  return /휴무|공휴일|부처님|어린이날|광복절|개천절|한글날|설날|추석|신정|성탄|크리스마스/.test(cleanText(text));
}

function cleanHolidayText(text) {
  return cleanText(text).replace(/[<>]/g, '');
}

function unique(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function todayDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

module.exports = {
  parseMealPlanOcr,
  normalizeMenuItems,
  parseDateText
};
