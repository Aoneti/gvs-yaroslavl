'use strict';
// Счётчик на кнопке «Аварии и отключения» на главной: подгружает incidents.json
// и показывает, сколько записей сейчас в работе.
// Если файла нет, он устарел или битый — счётчик просто не показывается, кнопка остаётся рабочей.
(function () {
  const btn   = document.getElementById('incidentsBtn');
  const badge = document.getElementById('incidentsCount');
  if (!btn || !badge) return;

  const cfg     = window.GVS_CONFIG || {};
  const url     = cfg.INCIDENTS_URL || 'incidents.json';   // без ведущего «/»: сайт живёт в подпапке
  const staleMs = (cfg.INCIDENTS_STALE_HOURS || 30) * 36e5;

  fetch(url, { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
    .then((d) => {
      const total = Number(d && d.total);
      const fresh = Date.now() - Date.parse(d && d.fetchedAt) < staleMs;
      if (!(total > 0) || !fresh) return;               // 0 или устарело — лучше промолчать, чем показать неверное число

      badge.textContent = total;
      badge.hidden = false;
      // aria-label заменяет видимый текст кнопки, поэтому повторяем в нём и название
      btn.setAttribute('aria-label',
        'Аварии и отключения: сейчас в работе ' + total + ', из них аварий ' + (Number(d.emergency) || 0));
    })
    .catch(() => {});
}());
