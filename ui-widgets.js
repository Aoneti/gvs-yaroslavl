'use strict';
(function () {
  const tracker   = document.getElementById('tracker-widget');
  const social    = document.getElementById('social-widget');
  const mini      = document.getElementById('social-mini');
  const TRACKER_KEY = 'gvs_tracker_hidden_v1';
  const SOCIAL_KEY  = 'gvs_social_hidden_v1';
  const LS = {
    get(key)        { try { return localStorage.getItem(key); }  catch (e) { return null; } },
    set(key, val)   { try { localStorage.setItem(key, val); }    catch (e) {} },
    remove(key)     { try { localStorage.removeItem(key); }      catch (e) {} },
  };

  function updatePositions() {
    if (window.innerWidth <= 640) return;

    const trackerVisible = tracker.style.display !== 'none';
    const gap  = 12;
    const base = 20;

    if (trackerVisible) {
      const trackerH = tracker.offsetHeight;
      social.style.bottom = (base + trackerH + gap) + 'px';
      mini.style.bottom   = (base + trackerH + gap) + 'px';
    } else {
      social.style.bottom = base + 'px';
      mini.style.bottom   = base + 'px';
    }
  }

  function showTracker() {
    if (LS.get(TRACKER_KEY) === 'hidden') return;
    tracker.style.display = 'block';
    requestAnimationFrame(() => {
      updatePositions();
      tracker.classList.add('show');
      tracker.setAttribute('aria-hidden', 'false');
    });
  }

  function showSocial() {
    if (LS.get(SOCIAL_KEY) === 'hidden') { showMini(); return; }
    updatePositions();
    social.style.display = 'block';
    requestAnimationFrame(() => {
      social.classList.add('show');
      social.setAttribute('aria-hidden', 'false');
    });
  }

  function showMini() {
    mini.style.display = 'flex';
    updatePositions();
  }

  function hideMini() {
    mini.style.opacity = '0';
    setTimeout(() => {
      mini.style.display  = 'none';
      mini.style.opacity  = '1';
    }, 220);
  }

  function trackerOk() {
    tracker.classList.remove('show');
    tracker.style.display = 'none';
    tracker.setAttribute('aria-hidden', 'true');
    LS.set(TRACKER_KEY, 'hidden');
    updatePositions();
  }

  function trackerLearn() {
    window.open(
      'https://yandex.ru/legal/metrica_termsofuse/ru/#5-personalnye-dannye-i-konfidencialnost',
      '_blank',
      'noopener,noreferrer'
    );
  }

  function socialMinimize() {
    social.classList.remove('show');
    social.style.display = 'none';
    social.setAttribute('aria-hidden', 'true');
    LS.set(SOCIAL_KEY, 'hidden');
    showMini();
  }

  function socialRestore() {
    LS.remove(SOCIAL_KEY);
    hideMini();
    updatePositions();
    social.style.display = 'block';
    requestAnimationFrame(() => {
      social.classList.add('show');
      social.setAttribute('aria-hidden', 'false');
    });
  }

  document.getElementById('tracker-minimize-btn').addEventListener('click', trackerOk);
  document.getElementById('tracker-learn-btn').addEventListener('click', trackerLearn);
  document.getElementById('tracker-ok-btn').addEventListener('click', trackerOk);
  document.getElementById('social-minimize-btn').addEventListener('click', socialMinimize);
  mini.addEventListener('click', socialRestore);

  window.addEventListener('load', () => {
    const trackerHidden = LS.get(TRACKER_KEY) === 'hidden';
    const socialHidden  = LS.get(SOCIAL_KEY)  === 'hidden';

    // Promise-based sequencing для предотвращения race conditions
    const showTrackerPromise = !trackerHidden 
      ? new Promise(resolve => setTimeout(() => { showTracker(); resolve(); }, GVS_CONFIG.WIDGET_TRACKER_DELAY))
      : Promise.resolve();
    
    const showSocialPromise = showTrackerPromise.then(() => {
      if (!trackerHidden) {
        return new Promise(resolve => setTimeout(() => { showSocial(); resolve(); }, GVS_CONFIG.WIDGET_SOCIAL_DELAY - GVS_CONFIG.WIDGET_TRACKER_DELAY));
      } else {
        return new Promise(resolve => setTimeout(() => { showSocial(); resolve(); }, GVS_CONFIG.WIDGET_TRACKER_DELAY));
      }
    });
    
    if (socialHidden) {
      showSocialPromise.then(() => {
        setTimeout(showMini, trackerHidden ? GVS_CONFIG.WIDGET_TRACKER_DELAY : GVS_CONFIG.WIDGET_SOCIAL_DELAY + 500);
      });
    }
  });

  window.addEventListener('resize', updatePositions);
}());
