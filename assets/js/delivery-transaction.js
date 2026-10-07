(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root){
    root.deliveryStatePatch = api.deliveryStatePatch;
    root.runDeliveryTransaction = api.runDeliveryTransaction;
    root.deliveryDateKind = api.deliveryDateKind;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function cleanDeliveryDates(value){
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  }

  // 완료 처리하려는 날짜가 오늘 기준으로 언제인지. 'YYYY-MM-DD' 는 글자 순서가 곧 날짜 순서다.
  // 날짜 칸이 다른 날인 채로 전체 완료를 눌러 주문 14건이 20일 뒤 날짜로 완료된 적이 있다 (2026-10-06).
  function deliveryDateKind(dateStr, today){
    const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    if(!valid(dateStr) || !valid(today)) return 'invalid';
    return dateStr > today ? 'future' : dateStr < today ? 'past' : 'today';
  }

  // 완료를 취소했을 때 돌려줄 잔여 횟수.
  // 선택주문(once)은 완료하면 한 번에 끝난다(잔여 → 0). 1만 돌려주면 수량 2개짜리 주문이
  // 1개로 남는다. 남은 완료 이력 수로 원래 잔여를 다시 낸다 — 예전에 하루에 한 회씩 차감된
  // 기록에서는 +1 과 같은 값이 나온다. 정기배송은 늘 +1 이다.
  function restoredRemain(current, remain, nextDates){
    const total = Number(current.total);
    if(current.orderType === 'once' && Number.isFinite(total) && total > 0){
      return Math.max(remain + 1, total - nextDates.length);
    }
    return remain + 1;
  }

  function deliveryStatePatch(record, dateStr, action){
    const current = record || {};
    const deliveredDates = cleanDeliveryDates(current.deliveredDates);
    const hasDate = deliveredDates.includes(dateStr);
    const rawRemain = Number(current.remain);
    if(!Number.isFinite(rawRemain)) throw new Error('배송 잔여 횟수를 확인해주세요.');
    const remain = Math.max(0, rawRemain);

    if(action === 'complete'){
      if(hasDate) return { changed:false, reason:'already_completed', patch:null };
      if(remain <= 0) return { changed:false, reason:'no_remaining', patch:null };
      // 선택주문(once)은 수량이 몇 개든 한 날짜에 한 번 나가는 배송이라, 완료하면 주문이 끝난다.
      // 화면마다 따로 정했을 때는 1개씩 차감하는 경로가 남아 있었다(배송지도, 2026년 4월 무렵의 배송 관리 화면).
      // 그렇게 완료된 수량 2개 주문은 남은 1개가 어느 날짜 목록에도 다시 나오지 않아 '진행중·잔여 1'로 남는다.
      const nextRemain = current.orderType === 'once' ? 0 : Math.max(0, remain - 1);
      return {
        changed:true,
        reason:'completed',
        patch:{
          remain:nextRemain,
          deliveredDates:[...deliveredDates, dateStr],
          status:nextRemain === 0 ? 'end' : (current.status || 'active')
        }
      };
    }

    if(action === 'cancel'){
      if(!hasDate) return { changed:false, reason:'not_completed', patch:null };
      const nextDates = deliveredDates.filter(date => date !== dateStr);
      return {
        changed:true,
        reason:'cancelled',
        patch:{
          remain:restoredRemain(current, remain, nextDates),
          deliveredDates:nextDates,
          status:current.status === 'end' ? 'active' : (current.status || 'active')
        }
      };
    }

    throw new Error('지원하지 않는 배송 처리입니다.');
  }

  async function runDeliveryTransaction(db, customerId, dateStr, action, extraPatch, options){
    if(!db || !customerId || !dateStr) throw new Error('배송 처리 정보가 부족합니다.');
    const ref = db.collection('customers').doc(customerId);
    let result = null;
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if(!snap.exists) throw new Error('해당 주문을 찾지 못했습니다. 새로고침 후 다시 시도해주세요.');
      const current = snap.data() || {};
      result = deliveryStatePatch(current, dateStr, action);
      if(!result.changed) return;
      const patch = {
        ...result.patch,
        ...(action === 'complete' && extraPatch ? extraPatch : {}),
        // 완료 때 같이 적어 둔 값(최근 배송일 등)을 취소할 때 맞춰 되돌린다. 부르는 쪽이 정한다.
        ...(action === 'cancel' && typeof options?.cancelPatch === 'function'
          ? options.cancelPatch(current, result.patch) : {})
      };
      tx.update(ref, patch);
      result.patch = patch;
    });
    return result;
  }

  return { cleanDeliveryDates, deliveryDateKind, deliveryStatePatch, runDeliveryTransaction };
});
