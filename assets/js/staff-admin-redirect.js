(function () {
  function redirect() {
    if (['#attendance', '#reservations'].includes(location.hash)) location.replace(`./staff-admin.html${location.hash}`);
  }
  redirect();
  window.addEventListener('hashchange', redirect);
})();
