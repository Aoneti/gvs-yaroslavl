'use strict';
(function () {
  try {
    if (localStorage.getItem('theme') !== 'dark') {
      document.documentElement.classList.add('light');
    }
  } catch (e) {
  }
}());