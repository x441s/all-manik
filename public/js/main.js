// Menu navigasi beranda (burger) untuk mobile
(function () {
  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('siteNav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // Tutup menu saat link diklik (mobile)
  nav.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => nav.classList.remove('open'))
  );
})();
