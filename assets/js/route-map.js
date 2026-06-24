const ROUTE_NAVER_CLIENT_ID = 'd4sg126q46';
const ROUTE_KAKAO_JS_KEY = '8dd270cf2311e687a085b2db5157b1f7';
const ROUTE_ORIGIN_ADDRESS = '경상남도 진주시 동진로107번길 8 돌담';
let routeNaverLoaded = false;
let routeNaverLoading = null;
let routeKakaoLoaded = false;
let routeKakaoLoading = null;
let routeMapInstance = null;
let routeMapMarkers = [];
let routeKakaoMapInstance = null;
let routeKakaoMarkers = [];
let routeMapToken = 0;
let routeMapTouchTimer = null;
let routeOptimizedDate = '';
let routeOptimizedIds = [];

function routeEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function routePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function routeDateValue() {
  const el = document.getElementById('routeDate');
  if (!el) return typeof todayStr === 'function' ? todayStr() : '';
  if (!el.value && typeof todayStr === 'function') el.value = todayStr();
  return el.value;
}

function updateRouteDateDisp() {
  const ds = routeDateValue();
  const el = document.getElementById('routeDateDisp');
  if (!el || !ds) return;
  const label = typeof dateLabel === 'function' ? dateLabel(ds) : ds;
  el.textContent = label + (typeof todayStr === 'function' && ds === todayStr() ? ' · 오늘' : '');
}

function moveRouteDate(delta) {
  const el = document.getElementById('routeDate');
  if (!el || typeof addDays !== 'function') return;
  el.value = addDays(routeDateValue(), delta);
  renderRouteMap();
}

function resetRouteDate() {
  const el = document.getElementById('routeDate');
  if (!el || typeof todayStr !== 'function') return;
  el.value = todayStr();
  renderRouteMap();
}

function routeIsDone(customer, ds) {
  return Array.isArray(customer?.deliveredDates) && customer.deliveredDates.includes(ds);
}

function routeDirectList(ds) {
  const byId = new Map();
  if (typeof listFor === 'function') {
    listFor(ds).filter(c => c && c.isDirect).forEach(c => byId.set(c.id, c));
  }
  if (Array.isArray(custs)) {
    custs
      .filter(c => c && c.isDirect && routeIsDone(c, ds))
      .forEach(c => byId.set(c.id, c));
  }
  return Array.from(byId.values()).sort((a, b) => {
    const ad = routeIsDone(a, ds) ? 1 : 0;
    const bd = routeIsDone(b, ds) ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
}

function routeQtyLabel(c) {
  const parts = [];
  const qty = Number(c.qty || c.total || 0);
  if (qty > 1) parts.push(`${qty}개`);
  parts.push(productLabel(c.productId || c.set));
  if (c.orderType) parts.push(c.orderType === 'once' ? '선택주문' : '정기배송');
  if (Number(c.remain || 0) > 0) parts.push(`잔여 ${Number(c.remain || 0)}회`);
  return parts.filter(Boolean).join(' · ');
}

function routeNaverSearchUrl(address) {
  return `https://map.naver.com/v5/search/${encodeURIComponent(address || '')}`;
}

function routeKakaoSearchUrl(address) {
  return `https://map.kakao.com/link/search/${encodeURIComponent(address || '')}`;
}

function routeDistanceKm(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const rad = Math.PI / 180;
  const lat1 = Number(a.lat) * rad;
  const lat2 = Number(b.lat) * rad;
  const dLat = (Number(b.lat) - Number(a.lat)) * rad;
  const dLng = (Number(b.lng) - Number(a.lng)) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeApplyOptimizedOrder(list, ds) {
  if (routeOptimizedDate !== ds || !routeOptimizedIds.length) return list;
  const rank = new Map(routeOptimizedIds.map((id, idx) => [id, idx]));
  return [...list].sort((a, b) => {
    const ar = rank.has(a.id) ? rank.get(a.id) : 9999;
    const br = rank.has(b.id) ? rank.get(b.id) : 9999;
    if (ar !== br) return ar - br;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
}

function routeNearestOrder(items, origin) {
  const remaining = [...items];
  const ordered = [];
  let current = origin;
  while (remaining.length) {
    let bestIdx = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const d = routeDistanceKm(current, remaining[i].coords);
      if (d < bestDistance) {
        bestDistance = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    current = next.coords;
  }
  return ordered;
}

function setRouteMapTouchEnabled(enabled) {
  const shell = document.getElementById('routeMapShell');
  const btn = document.getElementById('routeMapTouchBtn');
  if (!shell) return;
  shell.classList.toggle('map-touch-on', !!enabled);
  if (btn) btn.textContent = enabled ? '지도 조작 중' : '지도 조작';
}

function enableRouteMapTouch(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const shell = document.getElementById('routeMapShell');
  const enabled = !shell?.classList.contains('map-touch-on');
  setRouteMapTouchEnabled(enabled);
  if (routeMapTouchTimer) clearTimeout(routeMapTouchTimer);
  if (enabled) {
    routeMapTouchTimer = setTimeout(() => setRouteMapTouchEnabled(false), 20000);
  }
}

async function copyRouteText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message || '복사했습니다.', 'ok');
  } catch(e) {
    toast('복사 실패: ' + e.message, 'er');
  }
}

function copyRouteAddress(id) {
  const c = custs.find(x => x.id === id);
  if (!c) return;
  copyRouteText(c.addr || '', `${c.name || '배송지'} 주소를 복사했습니다.`);
}

function copyRouteAddresses() {
  const ds = routeDateValue();
  const list = routeDirectList(ds).filter(c => !document.getElementById('routeHideDone')?.checked || !routeIsDone(c, ds));
  if (!list.length) {
    toast('복사할 직배송 주소가 없습니다.', 'er');
    return;
  }
  const text = list.map((c, i) => [
    `${i + 1}. ${c.name || '-'}`,
    `연락처: ${c.phone || '-'}`,
    `주소: ${c.addr || '-'}`,
    c.door ? `현관: ${c.door}` : '',
    c.request ? `요청: ${c.request}` : ''
  ].filter(Boolean).join('\n')).join('\n\n');
  copyRouteText(text, '직배송 주소 목록을 복사했습니다.');
}

async function routeToggleDone(id, ds, checked) {
  const c = custs.find(x => x.id === id);
  if (!c) return;
  const alreadyDone = routeIsDone(c, ds);
  try {
    if (checked && !alreadyDone) {
      await markDone(id, ds);
    } else if (!checked && alreadyDone) {
      await undoMarkDone(id, ds);
    }
  } finally {
    setTimeout(() => renderRouteMap(false, false), 250);
  }
}

function focusRouteCard(id) {
  document.querySelectorAll('.route-card').forEach(el => el.classList.remove('active'));
  const card = document.getElementById(`route-card-${id}`);
  if (card) {
    card.classList.add('active');
    if (card.tagName === 'DETAILS') card.open = true;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function routeCardHtml(c, ds, index) {
  const done = routeIsDone(c, ds);
  const phone = routePhoneDigits(c.phone);
  const address = c.addr || '';
  return `
    <details class="route-card ${done ? 'done' : ''}" id="route-card-${routeEsc(c.id)}">
      <summary class="route-card-summary">
        <div class="route-card-top">
          <div>
            <div class="route-card-name">
              <span>${index + 1}. ${routeEsc(c.name || '-')}</span>
              ${deliveryProductBadgeHtml(c)}
              ${lastBoxDeliveryBadge(c)}
            </div>
            <div class="route-address-preview">${routeEsc(address || '주소 미입력')}</div>
          </div>
          <label class="route-done-check" onclick="event.stopPropagation()">
            <input type="checkbox" ${done ? 'checked' : ''} onchange="routeToggleDone('${routeEsc(c.id)}','${routeEsc(ds)}',this.checked)">
            갔다
          </label>
        </div>
        <div class="route-card-more">상세 보기</div>
      </summary>
      <div class="route-card-detail">
        <div>
          <div class="route-card-meta">${routeEsc(routeQtyLabel(c))}</div>
        </div>
        <div class="route-address" onclick="copyRouteAddress('${routeEsc(c.id)}')">
          ${routeEsc(address || '주소 미입력')}
        </div>
        <div class="route-info-grid">
          <div class="route-info"><strong>연락처</strong>${routeEsc(c.phone || '-')}</div>
          <div class="route-info"><strong>현관번호</strong>${routeEsc(c.door || '-')}</div>
          <div class="route-info"><strong>배송일정</strong>${routeEsc(scheduleDisp(c) || c.scheduleName || '-')}</div>
          <div class="route-info"><strong>요청사항</strong>${routeEsc(c.request || '-')}</div>
        </div>
        <div class="route-actions">
          <a class="btn btn-s sm" href="${phone ? `tel:${phone}` : '#'}">전화</a>
          <a class="btn btn-g sm" href="${routeNaverSearchUrl(address)}" target="_blank" rel="noopener">네이버</a>
          <a class="btn btn-g sm" href="${routeKakaoSearchUrl(address)}" target="_blank" rel="noopener">카카오</a>
          <button class="btn btn-g sm" onclick="copyRouteAddress('${routeEsc(c.id)}')">주소복사</button>
        </div>
      </div>
    </details>`;
}

function renderRouteList(list, ds) {
  const hideDone = !!document.getElementById('routeHideDone')?.checked;
  const visible = hideDone ? list.filter(c => !routeIsDone(c, ds)) : list;
  const box = document.getElementById('routeList');
  if (!box) return;
  if (!visible.length) {
    box.innerHTML = `<div class="empty"><div class="ei empty-mark">직</div><div>${list.length ? '미완료 직배송이 없습니다.' : '직배송 대상이 없습니다.'}</div></div>`;
    return;
  }
  box.innerHTML = visible.map((c, i) => routeCardHtml(c, ds, i)).join('');
}

function renderRouteSummary(list, ds) {
  const total = list.length;
  const done = list.filter(c => routeIsDone(c, ds)).length;
  const summary = document.getElementById('routeSummary');
  if (!summary) return;
  summary.innerHTML = `
    <div class="route-stat"><span>직배송</span><b>${total}</b></div>
    <div class="route-stat"><span>완료</span><b>${done}</b></div>
    <div class="route-stat"><span>남음</span><b>${Math.max(total - done, 0)}</b></div>`;
}

async function optimizeRouteOrder(forceRefresh = false) {
  const ds = routeDateValue();
  const status = document.getElementById('routeMapStatus');
  const list = routeDirectList(ds).filter(c => !routeIsDone(c, ds) && c.addr);
  if (list.length < 2) {
    toast('추천 순서를 계산할 배송지가 2곳 이상 필요합니다.', 'info');
    return;
  }
  try {
    if (status) status.textContent = '돌담 출발 기준 추천 순서를 계산하는 중...';
    const origin = await routeCoordsForAddress('__route_origin_doldam', ROUTE_ORIGIN_ADDRESS, forceRefresh, 'auto');
    if (!origin) throw new Error('출발지 좌표를 찾지 못했습니다.');

    const items = [];
    const failed = [];
    for (const c of list) {
      const coords = await routeCoordsFor(c, forceRefresh, 'auto');
      if (coords) items.push({ customer: c, coords });
      else failed.push(c);
    }
    if (items.length < 2) throw new Error('좌표를 찾은 배송지가 부족합니다.');

    const ordered = routeNearestOrder(items, origin);
    routeOptimizedDate = ds;
    routeOptimizedIds = [
      ...ordered.map(item => item.customer.id),
      ...failed.map(c => c.id)
    ];
    renderRouteMap(false, false);
    const preview = ordered.slice(0, 4).map(item => item.customer.name || '-').join(' → ');
    toast(`추천 순서 적용: 돌담 → ${preview}${ordered.length > 4 ? ' ...' : ''}`, 'ok');
    if (status) status.textContent = `추천 순서 적용됨 · 돌담 출발 · 좌표 ${items.length}곳${failed.length ? ` · 주소 실패 ${failed.length}곳` : ''}`;
  } catch(e) {
    toast('추천 순서 계산 실패: ' + (e.message || e), 'er');
    if (status) status.textContent = '추천 순서 계산 실패: ' + (e.message || e);
  }
}

function loadRouteNaverScript() {
  if (routeNaverLoaded && window.naver?.maps?.Map) return Promise.resolve();
  if (routeNaverLoading) return routeNaverLoading;
  routeNaverLoading = new Promise((resolve, reject) => {
    const cleanup = () => {
      try { delete window.__gjsRouteNaverReady; } catch(e) { window.__gjsRouteNaverReady = undefined; }
    };
    window.__gjsRouteNaverReady = () => {
      if (!window.naver?.maps?.Map || !window.naver?.maps?.LatLng) {
        cleanup();
        routeNaverLoading = null;
        reject(new Error('네이버 지도 SDK 초기화 실패'));
        return;
      }
      cleanup();
      routeNaverLoaded = true;
      resolve();
    };
    window.navermap_authFailure = () => {
      cleanup();
      routeNaverLoaded = false;
      routeNaverLoading = null;
      reject(new Error('네이버 지도 인증 실패'));
    };
    const existing = document.getElementById('route-naver-map-sdk');
    if (existing) existing.remove();
    const script = document.createElement('script');
    script.id = 'route-naver-map-sdk';
    script.async = true;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${ROUTE_NAVER_CLIENT_ID}&submodules=geocoder&callback=__gjsRouteNaverReady`;
    script.onerror = () => {
      cleanup();
      routeNaverLoading = null;
      reject(new Error('네이버 지도 스크립트를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });
  return routeNaverLoading;
}

function loadRouteKakaoScript() {
  if (routeKakaoLoaded && window.kakao?.maps?.Map && window.kakao?.maps?.services?.Geocoder) {
    return Promise.resolve();
  }
  if (routeKakaoLoading) return routeKakaoLoading;
  routeKakaoLoading = new Promise((resolve, reject) => {
    const existing = document.getElementById('route-kakao-map-sdk');
    if (existing) existing.remove();
    const script = document.createElement('script');
    script.id = 'route-kakao-map-sdk';
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${ROUTE_KAKAO_JS_KEY}&libraries=services&autoload=false`;
    script.onload = () => {
      if (!window.kakao?.maps?.load) {
        routeKakaoLoading = null;
        reject(new Error('카카오 지도 SDK 초기화 실패'));
        return;
      }
      window.kakao.maps.load(() => {
        if (!window.kakao?.maps?.Map || !window.kakao?.maps?.services?.Geocoder) {
          routeKakaoLoading = null;
          reject(new Error('카카오 지도 services 초기화 실패'));
          return;
        }
        routeKakaoLoaded = true;
        resolve();
      });
    };
    script.onerror = () => {
      routeKakaoLoading = null;
      reject(new Error('카카오 지도 스크립트를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });
  return routeKakaoLoading;
}

function routeGeocode(address) {
  return new Promise(resolve => {
    if (!address || !window.naver?.maps?.Service?.geocode) {
      resolve(null);
      return;
    }
    naver.maps.Service.geocode({ query: address }, (status, response) => {
      const addresses = response?.v2?.addresses || [];
      if (status !== naver.maps.Service.Status.OK || !addresses.length) {
        resolve(null);
        return;
      }
      resolve({ lat: parseFloat(addresses[0].y), lng: parseFloat(addresses[0].x) });
    });
  });
}

function routeKakaoGeocode(address) {
  return new Promise(resolve => {
    if (!address || !window.kakao?.maps?.services?.Geocoder) {
      resolve(null);
      return;
    }
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.addressSearch(address, (result, status) => {
      if (status !== window.kakao.maps.services.Status.OK || !Array.isArray(result) || !result.length) {
        resolve(null);
        return;
      }
      resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
    });
  });
}

async function routeGeocodeWithFallback(address) {
  let coords = null;
  try {
    await loadRouteNaverScript();
    coords = await routeGeocode(address);
  } catch(e) {}
  if (coords) return coords;
  try {
    await loadRouteKakaoScript();
    coords = await routeKakaoGeocode(address);
  } catch(e) {}
  return coords;
}

async function routeCoordsForAddress(cacheId, address, forceRefresh = false, provider = 'auto') {
  if (!address) return null;
  const docId = String(cacheId || address).replace(/[\/#?]/g, '_').slice(0, 120);
  if (!forceRefresh && window.__DB) {
    try {
      const snap = await window.__DB.collection('deliveryCoords').doc(docId).get();
      if (snap.exists) {
        const data = snap.data() || {};
        if (data.address === address && data.lat && data.lng) {
          return { lat: data.lat, lng: data.lng };
        }
      }
    } catch(e) {}
  }
  const coords = provider === 'kakao'
    ? await routeKakaoGeocode(address)
    : provider === 'naver'
      ? await routeGeocode(address)
      : await routeGeocodeWithFallback(address);
  if (coords && window.__DB) {
    window.__DB.collection('deliveryCoords').doc(docId).set({
      lat: coords.lat,
      lng: coords.lng,
      address,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
  }
  return coords;
}

async function routeCoordsFor(c, forceRefresh, provider = 'naver') {
  const address = c.addr || '';
  return routeCoordsForAddress(c.id, address, forceRefresh, provider);
}

async function renderRouteNaverMap(list, ds, forceRefresh) {
  const token = ++routeMapToken;
  const status = document.getElementById('routeMapStatus');
  if (status) status.textContent = '지도를 불러오는 중...';
  await loadRouteNaverScript();
  if (token !== routeMapToken) return;

  if (!routeMapInstance) {
    routeMapInstance = new naver.maps.Map('routeMap', {
      center: new naver.maps.LatLng(35.1950, 128.0910),
      zoom: 13
    });
  }

  routeMapMarkers.forEach(marker => marker.setMap(null));
  routeMapMarkers = [];

  const targets = list.filter(c => c.addr);
  if (!targets.length) {
    if (status) status.textContent = '지도에 표시할 주소가 없습니다.';
    return;
  }

  let mapped = 0;
  let failed = 0;
  const bounds = new naver.maps.LatLngBounds();
  for (const c of targets) {
    const coords = await routeCoordsFor(c, forceRefresh);
    if (token !== routeMapToken) return;
    if (!coords) {
      failed++;
      continue;
    }
    const done = routeIsDone(c, ds);
    const pos = new naver.maps.LatLng(coords.lat, coords.lng);
    const marker = new naver.maps.Marker({
      position: pos,
      map: routeMapInstance,
      icon: {
        content: `<div style="min-width:24px;height:24px;border-radius:999px;background:${done ? '#98a2b3' : '#c020b0'};color:#fff;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900">${mapped + 1}</div>`,
        anchor: new naver.maps.Point(12, 12)
      }
    });
    const info = new naver.maps.InfoWindow({
      content: `<div class="map-info-window"><div class="iw-name">${routeEsc(c.name || '-')}</div><div class="iw-addr">${routeEsc(c.addr || '-')}</div><div class="iw-qty">${routeEsc(routeQtyLabel(c))}</div></div>`,
      borderWidth: 1,
      borderColor: '#d0d5dd',
      backgroundColor: '#fff'
    });
    naver.maps.Event.addListener(marker, 'click', () => {
      focusRouteCard(c.id);
      if (info.getMap()) info.close();
      else info.open(routeMapInstance, marker);
    });
    routeMapMarkers.push(marker);
    bounds.extend(pos);
    mapped++;
    if (status) status.textContent = `지도 표시 중... ${mapped}/${targets.length}`;
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  if (mapped > 1) routeMapInstance.fitBounds(bounds);
  else if (routeMapMarkers[0]) routeMapInstance.setCenter(routeMapMarkers[0].getPosition());
  if (status) status.textContent = `지도 표시 ${mapped}곳${failed ? ` · 주소 실패 ${failed}곳` : ''}`;
}

async function renderRouteKakaoMap(list, ds, forceRefresh) {
  const token = ++routeMapToken;
  const status = document.getElementById('routeMapStatus');
  const mapEl = document.getElementById('routeMap');
  if (status) status.textContent = '카카오 지도를 불러오는 중...';
  if (mapEl) {
    mapEl.innerHTML = '';
    routeKakaoMapInstance = null;
  }
  await loadRouteKakaoScript();
  if (token !== routeMapToken) return;

  if (!mapEl) return;
  if (!routeKakaoMapInstance) {
    routeKakaoMapInstance = new window.kakao.maps.Map(mapEl, {
      center: new window.kakao.maps.LatLng(35.1950, 128.0910),
      level: 6
    });
  }

  routeKakaoMarkers.forEach(marker => marker.setMap(null));
  routeKakaoMarkers = [];

  const targets = list.filter(c => c.addr);
  if (!targets.length) {
    if (status) status.textContent = '지도에 표시할 주소가 없습니다.';
    return;
  }

  let mapped = 0;
  let failed = 0;
  let firstPos = null;
  const bounds = new window.kakao.maps.LatLngBounds();
  for (const c of targets) {
    const coords = await routeCoordsFor(c, forceRefresh, 'kakao');
    if (token !== routeMapToken) return;
    if (!coords) {
      failed++;
      continue;
    }
    const done = routeIsDone(c, ds);
    const pos = new window.kakao.maps.LatLng(coords.lat, coords.lng);
    const marker = new window.kakao.maps.Marker({
      position: pos,
      map: routeKakaoMapInstance
    });
    const info = new window.kakao.maps.InfoWindow({
      content: `<div class="map-info-window"><div class="iw-name">${routeEsc(c.name || '-')}</div><div class="iw-addr">${routeEsc(c.addr || '-')}</div><div class="iw-qty">${routeEsc(routeQtyLabel(c))}</div>${done ? '<div class="iw-qty">방문 완료</div>' : ''}</div>`
    });
    window.kakao.maps.event.addListener(marker, 'click', () => {
      focusRouteCard(c.id);
      info.open(routeKakaoMapInstance, marker);
    });
    routeKakaoMarkers.push(marker);
    bounds.extend(pos);
    if (!firstPos) firstPos = pos;
    mapped++;
    if (status) status.textContent = `카카오 지도 표시 중... ${mapped}/${targets.length}`;
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  if (mapped > 1) routeKakaoMapInstance.setBounds(bounds);
  else if (firstPos) routeKakaoMapInstance.setCenter(firstPos);
  if (status) status.textContent = `카카오 지도 표시 ${mapped}곳${failed ? ` · 주소 실패 ${failed}곳` : ''}`;
}

function renderRouteMapFallback(message) {
  const status = document.getElementById('routeMapStatus');
  const map = document.getElementById('routeMap');
  if (status) status.textContent = message || '지도 로드 실패';
  if (map) {
    map.innerHTML = `<div class="route-map-fallback">네이버 지도 서버가 응답하지 않아 지도는 잠시 사용할 수 없습니다. 아래 배송카드의 네이버/카카오 버튼과 전화, 완료 체크는 그대로 사용할 수 있습니다.</div>`;
  }
}

function renderRouteMap(forceRefresh = false, skipMap = false) {
  const ds = routeDateValue();
  updateRouteDateDisp();
  const list = routeApplyOptimizedOrder(routeDirectList(ds), ds);
  renderRouteSummary(list, ds);
  renderRouteList(list, ds);
  if (skipMap) return;
  const map = document.getElementById('routeMap');
  if (map && !routeMapInstance) map.innerHTML = '';
  if (!list.length) {
    const status = document.getElementById('routeMapStatus');
    if (status) status.textContent = '직배송 대상이 없습니다.';
    if (map) map.innerHTML = '';
    return;
  }
  renderRouteNaverMap(list, ds, forceRefresh).catch(naverError => {
    console.warn('배송지도 네이버 로드 실패:', naverError);
    const status = document.getElementById('routeMapStatus');
    if (status) status.textContent = '네이버 지도 실패. 카카오 지도로 전환 중...';
    if (map) {
      routeMapMarkers.forEach(marker => marker.setMap(null));
      routeMapMarkers = [];
      routeMapInstance = null;
      map.innerHTML = '';
    }
    renderRouteKakaoMap(list, ds, forceRefresh).catch(kakaoError => {
      console.warn('배송지도 카카오 로드 실패:', kakaoError);
      renderRouteMapFallback(`지도 로드 실패: 네이버(${naverError.message}) / 카카오(${kakaoError.message})`);
    });
  });
}
