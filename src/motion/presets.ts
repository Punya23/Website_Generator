export const MOTION_PRESETS = [
  "fade-up",
  "stagger",
  "scale-in",
  "slide-left",
  "parallax-hero",
  "none",
] as const;

export type MotionPreset = (typeof MOTION_PRESETS)[number];

export function resolveMotionPreset(
  preset?: string | null,
  motionStyle?: string | null
): MotionPreset {
  if (preset && (MOTION_PRESETS as readonly string[]).includes(preset)) {
    return preset as MotionPreset;
  }
  const style = (motionStyle ?? "").toLowerCase();
  if (style.includes("bold") || style.includes("dramatic")) return "scale-in";
  if (style.includes("slide") || style.includes("horizontal")) return "slide-left";
  if (style.includes("parallax") || style.includes("cinematic")) return "parallax-hero";
  if (style.includes("stagger") || style.includes("cascade")) return "stagger";
  if (style.includes("minimal") || style.includes("none") || style.includes("subtle")) return "fade-up";
  return "stagger";
}

export function motionPresetCss(preset: MotionPreset): string {
  const base = `
.reveal {
  opacity: 0;
  transition: opacity 0.7s var(--ease-out), transform 0.7s var(--ease-out);
}
.reveal.visible { opacity: 1; transform: none; }
`;

  const variants: Record<MotionPreset, string> = {
    "fade-up": `.reveal { transform: translateY(24px); }`,
    stagger: `.reveal { transform: translateY(20px); }`,
    "scale-in": `.reveal { transform: scale(0.96); }`,
    "slide-left": `.reveal { transform: translateX(32px); }`,
    "parallax-hero": `.reveal { transform: translateY(16px); }`,
    none: `.reveal { opacity: 1; transform: none; transition: none; }`,
  };

  return base + (variants[preset] ?? variants["fade-up"]);
}

export function buildMotionScript(preset: MotionPreset): string {
  if (preset === "none") {
    return `<script>
(function(){ document.querySelectorAll('.reveal').forEach(function(el){ el.classList.add('visible'); }); })();
</script>`;
  }

  const staggerDelay = preset === "stagger" ? "0.09" : preset === "scale-in" ? "0.07" : "0.06";
  const parallax = preset === "parallax-hero";

  return `<script>
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

  document.querySelectorAll('.layout-grid, .layout-row, .layout-bento, .layout-stack').forEach(function(container) {
    var items = container.querySelectorAll(':scope > .reveal');
    items.forEach(function(el, i) {
      el.style.transitionDelay = (i * ${staggerDelay}) + 's';
      observer.observe(el);
    });
  });

  reveals.forEach(function(el) {
    if (!el.classList.contains('visible') && !el._observed) {
      el._observed = true;
      observer.observe(el);
    }
  });

  ${parallax ? `
  var hero = document.querySelector('.block-hero, .block-split-hero');
  if (hero && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    window.addEventListener('scroll', function() {
      var y = Math.min(window.scrollY * 0.25, 80);
      var img = hero.querySelector('img');
      if (img) img.style.transform = 'translateY(' + y + 'px)';
      else hero.style.backgroundPosition = 'center ' + y + 'px';
    }, { passive: true });
  }` : ""}
})();
</script>`;
}
