'use strict';
(function () {
  try {
    const savedTheme = localStorage.getItem('theme');
    // Если тема не сохранена, используем prefers-color-scheme как fallback
    if (savedTheme === null) {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        document.documentElement.classList.add('light');
      }
    } else if (savedTheme !== 'dark') {
      document.documentElement.classList.add('light');
    }
  } catch (e) {
    // localStorage недоступен — пробуем prefers-color-scheme
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      document.documentElement.classList.add('light');
    }
  }
}());