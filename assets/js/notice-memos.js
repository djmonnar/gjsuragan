// ════════════════════════════════════════
// 배송관리 공지메모
// ════════════════════════════════════════
(function(){
  const COLLECTION = 'deliveryNoticeMemos';
  const CATEGORY_LABELS = {
    delivery_change:'배송일 변경',
    direct:'직배송',
    courier:'택배',
    customer:'고객요청',
    etc:'기타',
  };

  let noticeMemos = [];
  let noticeUnsub = null;
  let noticePopupShown = false;

  function $(id){ return document.getElementById(id); }

  function esc(value){
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function tsMs(value){
    if(!value) return 0;
    if(typeof value.toDate === 'function') return value.toDate().getTime();
    if(value instanceof Date) return value.getTime();
    if(typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function formatDateTime(value){
    const ms = tsMs(value);
    if(!ms) return '-';
    const d = new Date(ms);
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function sortedMemos(){
    return noticeMemos.slice().sort((a,b)=>{
      const activeDiff = Number(b.active !== false) - Number(a.active !== false);
      if(activeDiff) return activeDiff;
      return tsMs(b.updatedAt || b.createdAt) - tsMs(a.updatedAt || a.createdAt);
    });
  }

  function activeMemos(){
    return sortedMemos().filter(m => m.active !== false);
  }

  function renderNoticeBadge(){
    const badge = $('noticeMemoBadge');
    const dashboardBadge = document.querySelector('.dashboard-notice-memo-count');
    const count = activeMemos().length;
    if(badge){
      badge.textContent = String(count);
      badge.style.display = count ? '' : 'none';
    }
    if(dashboardBadge) dashboardBadge.textContent = `${count}건`;
  }

  function renderNoticeCard(m){
    const active = m.active !== false;
    const category = CATEGORY_LABELS[m.category] || '기타';
    const targetDate = m.targetDate ? `<span class="notice-pill date">${esc(m.targetDate)}</span>` : '';
    return `
      <div class="notice-card ${active ? 'is-active' : 'is-inactive'}">
        <div class="notice-card-top">
          <div>
            <div class="notice-card-title">${esc(m.title || '제목 없음')}</div>
            <div class="notice-card-meta">
              <span class="notice-pill">${esc(category)}</span>
              ${targetDate}
              <span class="notice-pill ${active ? 'active' : 'off'}">${active ? '팝업 표시' : '팝업 꺼짐'}</span>
            </div>
          </div>
        </div>
        <div class="notice-body">${esc(m.body || '-')}</div>
        <div class="notice-card-foot">
          <div class="notice-updated">수정 ${esc(formatDateTime(m.updatedAt || m.createdAt))}</div>
          <div class="notice-actions">
            <button class="btn btn-g sm" onclick="editNoticeMemo('${esc(m.id)}')">수정</button>
            <button class="btn btn-s sm" onclick="toggleNoticeMemoActive('${esc(m.id)}')">${active ? '팝업 끄기' : '다시 띄우기'}</button>
            <button class="btn btn-d sm" onclick="deleteNoticeMemo('${esc(m.id)}')">삭제</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderNoticeMemos(){
    renderNoticeBadge();

    const summary = $('noticeMemoSummary');
    const list = $('noticeMemoList');
    if(!summary || !list) return;

    const activeCount = activeMemos().length;
    const total = noticeMemos.length;
    summary.textContent = `활성 공지 ${activeCount}건 / 전체 ${total}건`;

    if(!total){
      list.innerHTML = '<div class="notice-empty">등록된 공지메모가 없습니다. 배송일 변경, 보류 요청, 택배 특이사항을 여기에 남겨두세요.</div>';
      return;
    }

    list.innerHTML = sortedMemos().map(renderNoticeCard).join('');
  }

  function renderNoticePopup(items){
    const list = $('noticePopupList');
    if(!list) return;
    list.innerHTML = items.map(m => {
      const category = CATEGORY_LABELS[m.category] || '기타';
      const targetDate = m.targetDate ? `<span class="notice-pill date">${esc(m.targetDate)}</span>` : '';
      return `
        <div class="notice-popup-item">
          <div class="notice-popup-title">${esc(m.title || '제목 없음')}</div>
          <div class="notice-popup-meta">
            <span class="notice-pill active">${esc(category)}</span>
            ${targetDate}
          </div>
          <div class="notice-body">${esc(m.body || '-')}</div>
        </div>
      `;
    }).join('');
  }

  function maybeShowNoticePopup(){
    if(noticePopupShown) return;
    const app = $('app');
    if(!app || app.style.display === 'none'){
      setTimeout(maybeShowNoticePopup, 250);
      return;
    }

    const items = activeMemos();
    if(!items.length) return;

    noticePopupShown = true;
    renderNoticePopup(items);
    if(typeof openM === 'function') openM('noticePopupM');
  }

  function subscribeNoticeMemos(){
    if(noticeUnsub || !window.__DB) return;

    noticeUnsub = window.__DB.collection(COLLECTION)
      .orderBy('updatedAt', 'desc')
      .limit(120)
      .onSnapshot(
        snap => {
          noticeMemos = snap.docs.map(d => ({ id:d.id, ...d.data() }));
          renderNoticeMemos();
          maybeShowNoticePopup();
        },
        err => {
          const summary = $('noticeMemoSummary');
          if(summary) summary.textContent = '공지메모를 불러오지 못했습니다. Firestore rules 배포 여부를 확인해주세요.';
          if(typeof toast === 'function') toast('공지메모 읽기 오류: ' + err.message, 'er');
          console.warn('deliveryNoticeMemos 오류:', err);
        }
      );
  }

  function stopNoticeMemos(){
    if(typeof noticeUnsub === 'function') noticeUnsub();
    noticeUnsub = null;
    noticeMemos = [];
    noticePopupShown = false;
    renderNoticeMemos();
  }

  function resetNoticeMemoForm(){
    if($('noticeMemoId')) $('noticeMemoId').value = '';
    if($('noticeMemoTitle')) $('noticeMemoTitle').value = '';
    if($('noticeMemoCategory')) $('noticeMemoCategory').value = 'delivery_change';
    if($('noticeMemoDate')) $('noticeMemoDate').value = '';
    if($('noticeMemoBody')) $('noticeMemoBody').value = '';
    if($('noticeMemoActive')) $('noticeMemoActive').checked = true;
    if($('noticeMemoFormTitle')) $('noticeMemoFormTitle').textContent = '공지메모 등록';
  }

  async function saveNoticeMemo(){
    if(!window.__DB) return;
    const id = $('noticeMemoId')?.value || '';
    const title = $('noticeMemoTitle')?.value.trim() || '';
    const body = $('noticeMemoBody')?.value.trim() || '';
    const category = $('noticeMemoCategory')?.value || 'etc';
    const targetDate = $('noticeMemoDate')?.value || '';
    const active = $('noticeMemoActive')?.checked !== false;

    if(!title || !body){
      if(typeof toast === 'function') toast('제목과 내용을 입력해주세요', 'er');
      return;
    }

    const now = firebase.firestore.FieldValue.serverTimestamp();
    const payload = { title, body, category, active, updatedAt:now };
    if(targetDate) payload.targetDate = targetDate;
    else if(id) payload.targetDate = firebase.firestore.FieldValue.delete();
    else payload.targetDate = '';

    try{
      if(id){
        await window.__DB.collection(COLLECTION).doc(id).update(payload);
        if(typeof toast === 'function') toast('공지메모 수정 완료', 'ok');
      } else {
        await window.__DB.collection(COLLECTION).add({
          ...payload,
          createdAt:now,
        });
        if(typeof toast === 'function') toast('공지메모 등록 완료', 'ok');
      }
      resetNoticeMemoForm();
    } catch(e){
      if(typeof toast === 'function') toast('공지메모 저장 오류: ' + e.message, 'er');
    }
  }

  function editNoticeMemo(id){
    const m = noticeMemos.find(x => x.id === id);
    if(!m) return;
    if($('noticeMemoId')) $('noticeMemoId').value = m.id;
    if($('noticeMemoTitle')) $('noticeMemoTitle').value = m.title || '';
    if($('noticeMemoCategory')) $('noticeMemoCategory').value = m.category || 'etc';
    if($('noticeMemoDate')) $('noticeMemoDate').value = m.targetDate || '';
    if($('noticeMemoBody')) $('noticeMemoBody').value = m.body || '';
    if($('noticeMemoActive')) $('noticeMemoActive').checked = m.active !== false;
    if($('noticeMemoFormTitle')) $('noticeMemoFormTitle').textContent = '공지메모 수정';
    $('noticeMemoTitle')?.scrollIntoView({ behavior:'smooth', block:'center' });
  }

  async function toggleNoticeMemoActive(id){
    const m = noticeMemos.find(x => x.id === id);
    if(!m || !window.__DB) return;
    try{
      await window.__DB.collection(COLLECTION).doc(id).update({
        active:!(m.active !== false),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch(e){
      if(typeof toast === 'function') toast('팝업 상태 변경 오류: ' + e.message, 'er');
    }
  }

  async function deleteNoticeMemo(id){
    const m = noticeMemos.find(x => x.id === id);
    if(!m || !window.__DB) return;
    if(!confirm(`공지메모를 삭제할까요?\n\n${m.title || '제목 없음'}`)) return;
    try{
      await window.__DB.collection(COLLECTION).doc(id).delete();
      if($('noticeMemoId')?.value === id) resetNoticeMemoForm();
      if(typeof toast === 'function') toast('공지메모 삭제 완료', 'ok');
    } catch(e){
      if(typeof toast === 'function') toast('공지메모 삭제 오류: ' + e.message, 'er');
    }
  }

  function closeNoticeMemoPopup(){
    if(typeof closeM === 'function') closeM('noticePopupM');
  }

  function openNoticeMemoTabFromPopup(){
    closeNoticeMemoPopup();
    if(typeof goTab === 'function') goTab('notice');
  }

  function isAllowedUser(user){
    if(!user) return false;
    const adminEmail = typeof DELIVERY_ADMIN_EMAIL !== 'undefined' ? DELIVERY_ADMIN_EMAIL : 'sun1562@naver.com';
    return user.email === adminEmail;
  }

  function bindAuth(){
    if(!window.__AUTH) return;
    window.__AUTH.onAuthStateChanged(user => {
      if(isAllowedUser(user)) subscribeNoticeMemos();
      else stopNoticeMemos();
    });
  }

  function bindDashboardLinks(){
    document.querySelectorAll('[data-dashboard-notice-link]').forEach(el => {
      el.addEventListener('click', () => {
        if(typeof goTab === 'function') goTab('notice');
      });
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => {
      bindDashboardLinks();
      bindAuth();
    }, { once:true });
  } else {
    bindDashboardLinks();
    bindAuth();
  }

  window.renderNoticeMemos = renderNoticeMemos;
  window.resetNoticeMemoForm = resetNoticeMemoForm;
  window.saveNoticeMemo = saveNoticeMemo;
  window.editNoticeMemo = editNoticeMemo;
  window.toggleNoticeMemoActive = toggleNoticeMemoActive;
  window.deleteNoticeMemo = deleteNoticeMemo;
  window.closeNoticeMemoPopup = closeNoticeMemoPopup;
  window.openNoticeMemoTabFromPopup = openNoticeMemoTabFromPopup;
})();
