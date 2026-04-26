'use strict';
(function () {
  try {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === null) {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        document.documentElement.classList.add('light');
      }
    } else if (savedTheme !== 'dark') {
      document.documentElement.classList.add('light');
    }
  } catch (e) {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      document.documentElement.classList.add('light');
    }
  }
}());
