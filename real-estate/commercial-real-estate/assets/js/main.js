// Cornerstone Commercial Realty — shared template behavior (vanilla JS, no build step)

document.addEventListener('DOMContentLoaded', function () {
  // Mobile nav toggle
  var toggle = document.querySelector('.navbar__toggle');
  var navbar = document.querySelector('.navbar');
  if (toggle && navbar) {
    toggle.addEventListener('click', function () {
      navbar.classList.toggle('is-open');
    });
  }

  // FAQ accordion
  document.querySelectorAll('.faq-item__question').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.faq-item');
      var wasOpen = item.classList.contains('is-open');
      document.querySelectorAll('.faq-item').forEach(function (i) { i.classList.remove('is-open'); });
      if (!wasOpen) item.classList.add('is-open');
    });
  });

  // Property gallery: click a thumbnail to swap the main image
  var mainImg = document.querySelector('.gallery__main img');
  document.querySelectorAll('.gallery__side img').forEach(function (thumb) {
    thumb.addEventListener('click', function () {
      if (!mainImg) return;
      var tmp = mainImg.src;
      mainImg.src = thumb.src;
      thumb.src = tmp;
    });
  });

  // Forms in this template are static demos — prevent navigation on submit
  document.querySelectorAll('form[data-demo-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = form.querySelector('.form-note');
      if (note) note.textContent = 'Thanks! This is a template demo — connect a backend to receive submissions.';
    });
  });
});
