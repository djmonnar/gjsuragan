(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root){
    root.deliveryStatePatch = api.deliveryStatePatch;
    root.runDeliveryTransaction = api.runDeliveryTransaction;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function cleanDeliveryDates(value){
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  }

  function deliveryStatePatch(record, dateStr, action, options){
    const current = record || {};
    const opts = options || {};
    const deliveredDates = cleanDeliveryDates(current.deliveredDates);
    const hasDate = deliveredDates.includes(dateStr);
    const rawRemain = Number(current.remain);
    if(!Number.isFinite(rawRemain)) throw new Error('배송 잔여 횟수를 확인해주세요.');
    const remain = Math.max(0, rawRemain);

    if(action === 'complete'){
      if(hasDate) return { changed:false, reason:'already_completed', patch:null };
      if(remain <= 0) return { changed:false, reason:'no_remaining', patch:null };
      const nextRemain = opts.completeAll ? 0 : Math.max(0, remain - 1);
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
      return {
        changed:true,
        reason:'cancelled',
        patch:{
          remain:remain + 1,
          deliveredDates:deliveredDates.filter(date => date !== dateStr),
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
      result = deliveryStatePatch(current, dateStr, action, {
        completeAll: action === 'complete'
          && options?.completeAllForOnce === true
          && current.orderType === 'once'
      });
      if(!result.changed) return;
      const patch = {
        ...result.patch,
        ...(action === 'complete' && extraPatch ? extraPatch : {})
      };
      tx.update(ref, patch);
      result.patch = patch;
    });
    return result;
  }

  return { cleanDeliveryDates, deliveryStatePatch, runDeliveryTransaction };
});
