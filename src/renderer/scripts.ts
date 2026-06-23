export const PAGE_SCRIPTS = `
<script>
(function() {
  var nav = document.querySelector('.site-nav');
  if (nav) {
    window.addEventListener('scroll', function() {
      nav.classList.toggle('scrolled', window.scrollY > 16);
    }, { passive: true });
  }

  var reveals = document.querySelectorAll('.reveal');
  if (!reveals.length) return;

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

  document.querySelectorAll('.layout-grid, .layout-row, .layout-stack').forEach(function(container) {
    var items = container.querySelectorAll(':scope > .reveal');
    items.forEach(function(el, i) {
      el.style.transitionDelay = (i * 0.09) + 's';
      observer.observe(el);
    });
  });

  reveals.forEach(function(el) {
    if (!el.classList.contains('visible') && !el._observed) {
      el._observed = true;
      observer.observe(el);
    }
  });

  var hero = document.querySelector('.block-hero');
  if (hero && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    window.addEventListener('scroll', function() {
      var y = Math.min(window.scrollY * 0.25, 80);
      hero.style.backgroundPosition = 'center ' + y + 'px';
    }, { passive: true });
  }
})();
</script>`;
