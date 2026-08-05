// Sidebar dashboard: off-canvas di mobile, statis di tablet/desktop
(function () {
  const sidebar = document.getElementById('dashSidebar');
  const scrim = document.getElementById('dashScrim');
  const toggle = document.getElementById('dashToggle');

  const open = () => {
    sidebar && sidebar.classList.add('open');
    scrim && scrim.classList.add('show');
  };
  const close = () => {
    sidebar && sidebar.classList.remove('open');
    scrim && scrim.classList.remove('show');
  };

  toggle && toggle.addEventListener('click', open);
  scrim && scrim.addEventListener('click', close);

  // Tutup otomatis saat link menu diklik (mobile)
  sidebar && sidebar.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', close)
  );

  // Reset bila layar diperbesar melewati breakpoint mobile
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 720) close();
  });
})();
