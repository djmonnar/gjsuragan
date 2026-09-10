(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  // Reuse the existing admin Auth app identity, without loading the order admin app.
  const app = firebase.initializeApp({ apiKey: 'AIzaSyCWXHJfMLW2Cf7pjI2u6X5QVKeGW6oC_3A', authDomain: 'gjsuragan-60505.firebaseapp.com', projectId: 'gjsuragan-60505' }, 'gjsuragan-admin');
  const auth = app.auth();
  const allowed = user => user?.email === 'sun1562@naver.com';
  let activePanel = '', signedIn = false;
  window.AttendanceSession = {
    async getToken() {
      if (!allowed(auth.currentUser)) throw new Error('관리자 로그인이 필요합니다.');
      return auth.currentUser.getIdToken();
    },
    isActive(panel) { return signedIn && activePanel === panel; }
  };
  function dispose() {
    window.AttendanceAdmin.dispose(); window.AttendanceReservations.dispose();
    document.querySelectorAll('dialog.att-dialog').forEach(el => el.close());
    activePanel = '';
  }
  function showPanel() {
    if (!signedIn) return;
    const panel = location.hash === '#reservations' ? 'reservations' : 'attendance';
    if (activePanel === panel) return;
    dispose(); activePanel = panel;
    $('staff-attendance-panel').hidden = panel !== 'attendance';
    $('staff-reservations-panel').hidden = panel !== 'reservations';
    document.querySelectorAll('[data-panel]').forEach(link => {
      if (link.dataset.panel === panel) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = `${panel === 'reservations' ? '돌담명가 예약' : '직원 · 근태'} · 매장 관리`;
    if (panel === 'attendance') window.AttendanceAdmin.init();
    else window.AttendanceReservations.init();
  }
  auth.onAuthStateChanged(user => {
    signedIn = allowed(user);
    $('staff-loading').hidden = true;
    $('staff-login').hidden = signedIn;
    $('staff-main').hidden = !signedIn;
    $('staff-password').value = '';
    if (signedIn) { $('staff-auth-error').textContent = ''; showPanel(); }
    else { dispose(); if (user) $('staff-auth-error').textContent = '관리자 계정으로 로그인해 주세요.'; }
  }, () => {
    signedIn = false; dispose(); $('staff-loading').hidden = true; $('staff-main').hidden = true; $('staff-login').hidden = false;
    $('staff-auth-error').textContent = '로그인 상태를 확인하지 못했습니다. 연결을 확인한 뒤 새로고침해 주세요.';
  });
  $('staff-login-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    if (button.disabled) return;
    button.disabled = true; button.textContent = '로그인 중…'; $('staff-auth-error').textContent = '';
    try { await auth.signInWithEmailAndPassword('sun1562@naver.com', $('staff-password').value); }
    catch (_) { $('staff-auth-error').textContent = '관리자 비밀번호와 인터넷 연결을 확인해 주세요.'; }
    finally { $('staff-password').value = ''; button.disabled = false; button.textContent = '관리 페이지 열기 →'; }
  };
  $('staff-logout').onclick = async () => {
    $('staff-session-error').textContent = '';
    try { await auth.signOut(); }
    catch (_) { $('staff-session-error').textContent = '로그아웃하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.'; }
  };
  window.addEventListener('hashchange', showPanel);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
