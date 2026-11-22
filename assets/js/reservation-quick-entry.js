(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReservationQuickEntry = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // 예약장 「한 줄로 빠르게 입력」.
  // 「홍길동 12월18일 금요일 6시 20~24명 1층 소고기 010-0000-0000」 같은 한 줄을 예약 칸으로 나눈다.
  // 저장은 하지 않는다. 화면이 칸을 채우고, 직원이 보고 등록을 누른다.
  //
  // 오전·오후가 없는 시간은 식당 시간으로 읽는다: 1~9시는 저녁(6시 → 18:00), 10·11·12시는 그대로.
  const EVENING_UP_TO = 9;
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const MENUS = ['소(명품)', '소(진품)', '명품', '진품', '소고기', '한우', '돼지갈비', '돼지', '차돌쌈밥', '쌈밥', '고기',
    '식사권', '식사', '정식', '코스', '갈비탕', '갈비', '냉면', '밥'];
  // 남은 말 중 예약자명·비고로 쓰지 않을 말.
  const FILLER = new Set(['정도', '쯤', '약', '예약', '예약요', '예약합니다', '예약해주세요', '부탁', '부탁드립니다', '부탁드려요', '입니다',
    '이요', '요', '에', '으로', '로', '및', '그리고', '님', '손님', '고객', '인원', '시간', '날짜', '메뉴', '연락처', '전번', '번호', '명', '+@', '@', '이상', '좌석']);

  const pad = n => String(n).padStart(2, '0');
  const isDate = value => {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const addDays = (date, n) => { const v = new Date(`${date}T00:00:00Z`); v.setUTCDate(v.getUTCDate() + n); return v.toISOString().slice(0, 10); };
  const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const label = date => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일(${WD[weekday(date)]})`;
  // 연도 없는 날짜는 다가오는 날짜로 본다. 이미 1주일 넘게 지났으면 내년.
  function upcoming(today, month, day) {
    const year = Number(today.slice(0, 4));
    for (const y of [year, year + 1]) {
      const date = `${y}-${pad(month)}-${pad(day)}`;
      if (isDate(date) && daysBetween(today, date) >= -7) return date;
    }
    return '';
  }
  function hourOf(qualifier, hour) {
    if (hour > 23) return null;
    if (['오후', '저녁', '밤'].includes(qualifier)) return hour < 12 ? hour + 12 : hour;
    if (['오전', '아침'].includes(qualifier)) return hour === 12 ? 0 : hour;
    if (['점심', '낮'].includes(qualifier)) return hour >= 1 && hour <= 4 ? hour + 12 : hour;
    return hour >= 1 && hour <= EVENING_UP_TO ? hour + 12 : hour;
  }

  function parse(text, { today, menus = [] } = {}) {
    if (!isDate(today)) throw new Error('today 가 필요합니다.');
    let masked = String(text || '').replace(/\r\n?|\n/g, ' ').replace(/[\t ]+/g, ' ').trim();
    const original = masked;
    const fields = {}, notes = [], warnings = [];
    let firstAt = Infinity;
    // 찾은 자리는 같은 길이의 빈칸으로 지워, 뒤에 찾는 규칙이 같은 글자를 다시 쓰지 않게 한다.
    function take(pattern, use) {
      const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      let found = false;
      masked = masked.replace(re, (...args) => {
        const match = args[0], offset = args[args.length - 2];
        if (use(args.slice(0, -2)) === false) return match;
        found = true;
        firstAt = Math.min(firstAt, offset);
        return ' '.repeat(match.length);
      });
      return found;
    }

    // 연락처
    take(/(?<!\d)(01[016789])[-.\s]?(\d{3,4})[-.\s]?(\d{4})(?!\d)/, ([, a, b, c]) => { if (fields.phone) return false; fields.phone = `${a}-${b}-${c}`; });
    take(/(?<!\d)(0\d{1,2})[-.\s](\d{3,4})[-.\s](\d{4})(?!\d)/, ([, a, b, c]) => { if (fields.phone) return false; fields.phone = `${a}-${b}-${c}`; });
    take(/(?<![\d.:/~-])(\d{4})[-.\s]?(\d{4})(?![\d~명인분])/, ([, a, b]) => { if (fields.phone) return false; fields.phone = `${a}-${b}`; });

    // 룸 (날짜보다 먼저: 「12-13R」을 12월 13일로 읽지 않게)
    const rooms = [];
    take(/(\d+(?:\s*[-~]\s*\d+)?)\s*[Rr](?![A-Za-z])/, ([, r]) => { rooms.push(`${r.replace(/\s+/g, '')}R`); });
    take(/(\d)\s*층/, ([, f]) => { rooms.push(`${f}층`); });
    take(/(\d{1,2})\s*번\s*(방|룸)/, ([, n, kind]) => { rooms.push(`${n}번${kind}`); });
    take(/(^|\s)(단체석|단체룸|룸|홀|좌식|입식)(?=\s|$)/, ([, , r]) => { rooms.push(r); });
    if (rooms.length) fields.room = rooms.join(' ');

    // 날짜
    let named = null;
    take(/(20\d{2})\s*[년./-]\s*(\d{1,2})\s*[월./-]\s*(\d{1,2})\s*일?/, ([, y, m, d]) => {
      const date = `${y}-${pad(m)}-${pad(d)}`; if (fields.date || !isDate(date)) return false; fields.date = date;
    });
    take(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/, ([, m, d]) => { if (fields.date) return false; const date = upcoming(today, Number(m), Number(d)); if (!date) return false; fields.date = date; });
    take(/(?<![\d:])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d:])\s*일?/, ([, m, d]) => {
      if (fields.date || Number(m) > 12) return false; const date = upcoming(today, Number(m), Number(d)); if (!date) return false; fields.date = date;
    });
    take(/(오늘|내일|낼|모레|글피)/, ([, w]) => { if (fields.date) return false; fields.date = addDays(today, { 오늘: 0, 내일: 1, 낼: 1, 모레: 2, 글피: 3 }[w]); });
    take(/(이번\s*주|다음\s*주|담주|다다음\s*주)\s*([일월화수목금토])(?:요일|욜)?/, ([, which, w]) => {
      if (fields.date) return false;
      // 「이번주 토요일」은 다가오는 토요일(일요일에 말해도 어제가 아니다). 「다음주」는 월요일부터 세는 다음 주.
      if (/이번/.test(which)) { fields.date = addDays(today, (WD.indexOf(w) - weekday(today) + 7) % 7); return; }
      const monday = addDays(today, -((weekday(today) + 6) % 7));
      fields.date = addDays(monday, (/다다음/.test(which) ? 2 : 1) * 7 + (WD.indexOf(w) + 6) % 7);
    });
    take(/([일월화수목금토])(?:요일|욜)/, ([, w]) => { named = WD.indexOf(w); });
    take(/(?<![\d월])(\d{1,2})\s*일(?![\d])/, ([, d]) => {
      if (fields.date) return false;
      const day = Number(d), month = Number(today.slice(5, 7));
      let date = `${today.slice(0, 7)}-${pad(day)}`;
      if (!isDate(date) || date < today) date = upcoming(today, month === 12 ? 1 : month + 1, day);
      if (!date) return false; fields.date = date;
    });
    if (named !== null) {
      if (!fields.date) {
        const ahead = (named - weekday(today) + 7) % 7;
        fields.date = addDays(today, ahead);
      } else if (weekday(fields.date) !== named) {
        warnings.push(`${label(fields.date)}은 ${WD[weekday(fields.date)]}요일입니다. 적은 요일(${WD[named]}요일)과 다르니 날짜를 확인하세요.`);
      }
    }

    // 시간
    take(/(오전|오후|아침|점심|낮|저녁|밤)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?/, ([, q, h, m, half]) => {
      if (fields.time) return false;
      const hour = hourOf(q, Number(h)), minute = half ? 30 : Number(m || 0);
      if (hour === null || minute > 59) return false;
      fields.time = `${pad(hour)}:${pad(minute)}`;
    });
    take(/(오전|오후|아침|점심|낮|저녁|밤)?\s*(?<!\d)(\d{1,2}):(\d{2})(?!\d)/, ([, q, h, m]) => {
      if (fields.time) return false;
      const hour = hourOf(q, Number(h));
      if (hour === null || Number(m) > 59) return false;
      fields.time = `${pad(hour)}:${m}`;
    });
    take(/(점심|낮|저녁|밤)/, ([, q]) => { if (fields.time || fields.meal) return false; fields.meal = ['점심', '낮'].includes(q) ? 'lunch' : 'dinner'; });

    // 인원
    take(/(\d{1,3})\s*[~∼-]\s*(\d{1,3})\s*(?:명|인(?!분)|분)\s*(정도|쯤|이상)?/, ([, a, b, about]) => {
      if (fields.people) return false;
      fields.people = Math.max(Number(a), Number(b));
      notes.push(`인원 ${a}~${b}명${about ? ` ${about}` : ''}`);
    });
    let adults = null, kids = null;
    take(/(어른|성인|대인)\s*(\d{1,3})\s*명?/, ([, , n]) => { adults = Number(n); });
    take(/(아이|어린이|아동|유아|소아|애기|아기)\s*(\d{1,3})\s*명?/, ([, , n]) => { kids = Number(n); });
    if (!fields.people && (adults !== null || kids !== null)) {
      fields.people = (adults || 0) + (kids || 0);
      notes.push([adults !== null ? `어른 ${adults}` : '', kids !== null ? `아이 ${kids}` : ''].filter(Boolean).join(' · '));
    }
    take(/(\d{1,3})\s*(?:명|인(?!분)|분)\s*(\+\s*@|\+|이상|정도|쯤)?/, ([, n, more]) => {
      if (fields.people) return false;
      fields.people = Number(n);
      if (more && /\+|이상/.test(more)) notes.push(`인원 ${n}명 이상`);
    });
    if (fields.people !== undefined && (fields.people < 1 || fields.people > 999)) delete fields.people;

    // 예약경로
    take(/(네이버|방문|워크인|전화)(?:로|으로)?(?:예약)?/, ([, r]) => { if (fields.route) return false; fields.route = r === '워크인' ? '방문' : r; });

    // 메뉴: 긴 말부터 찾는다(「소고기」를 「고기」로 자르지 않게).
    const menuWords = [...new Set([...menus, ...MENUS].map(m => String(m || '').trim()).filter(m => m.length >= 1))].sort((a, b) => b.length - a.length);
    const found = [];
    // 「돼지+식사권」처럼 +로 묶은 메뉴는 통째로 하나다.
    take(/([^\s+]+)\s*\+\s*([^\s+@]+)/, ([match, left, right]) => {
      if (!menuWords.some(word => left.includes(word) || right.includes(word))) return false;
      found.push({ at: original.indexOf(match), text: match.replace(/\s+/g, '') });
    });
    for (const word of menuWords) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 메뉴 바로 뒤 숫자는 그 메뉴의 수량이다(「소고기 2 돼지 3」).
      take(new RegExp(`${escaped}(?:\\s*\\d{1,3}(?:인분|개|접시)?(?![\\d명인분시월일:/.~-]))?`), ([match]) => {
        found.push({ at: original.indexOf(match), text: match.replace(/\s+/g, ' ').trim() });
      });
    }
    if (found.length) fields.menu = found.sort((a, b) => a.at - b.at).map(f => f.text).join(', ');

    // 남은 말: 처음 찾은 정보보다 앞에 있던 말이 예약자명, 나머지는 비고.
    const words = [];
    masked.replace(/[^\s,]+/g, (word, at) => { words.push({ word: word.replace(/^[(\[]+|[)\],.]+$/g, ''), at }); return word; });
    const useful = words.filter(w => w.word && !FILLER.has(w.word));
    const nameLike = w => !/^[\d+@~.\-]+$/.test(w.word);
    let nameWords = useful.filter(w => w.at < firstAt && nameLike(w));
    if (!nameWords.length) nameWords = useful.filter(nameLike).slice(0, 1);
    const name = nameWords.map(w => w.word).join(' ').replace(/(님|씨)$/, '').trim();
    if (name) fields.name = name.slice(0, 40);
    const rest = useful.filter(w => !nameWords.includes(w)).map(w => w.word).join(' ');
    const memo = [...notes, rest].filter(Boolean).join('\n');
    if (memo) fields.memo = memo;

    if (!fields.name) warnings.push('예약자명을 찾지 못했습니다. 직접 적어 주세요.');
    if (!fields.date) warnings.push('날짜를 찾지 못했습니다. 12월18일, 12/18, 내일, 다음주 금요일처럼 적어 주세요.');
    else if (fields.date < today) warnings.push(`${label(fields.date)}은 지난 날짜입니다.`);
    if (!fields.time) warnings.push('시간을 찾지 못했습니다.');
    return { fields, warnings };
  }

  // 등록할 때 비어 있으면 한 번 물어보는 칸. 비워 둔 채 저장해도 된다(이름이 비면 NO_NAME 으로 저장).
  const ASK_IF_EMPTY = [['name', '예약자명'], ['time', '시간'], ['people', '인원'], ['phone', '연락처'], ['menu', '메뉴']];
  const NO_NAME = '이름 미정';
  function missingFields(values) {
    return ASK_IF_EMPTY.filter(([key]) => String(values?.[key] ?? '').trim() === '').map(([key, label]) => ({ key, label }));
  }

  return { parse, missingFields, EVENING_UP_TO, MENUS, ASK_IF_EMPTY, NO_NAME };
});
