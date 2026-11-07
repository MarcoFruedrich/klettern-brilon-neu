(() => {
  'use strict';
  const logo = document.querySelector('.site-header .brand-logo');
  if (!logo) return;

  const ns = 'http://www.w3.org/2000/svg';
  const overlay = document.createElementNS(ns, 'svg');
  overlay.setAttribute('viewBox', '0 0 440 168');
  overlay.setAttribute('preserveAspectRatio', 'none');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.classList.add('logo-celestial-overlay');
  overlay.innerHTML =
    '<g class="logo-celestial logo-sun">' +
      '<circle cx="0" cy="0" r="8.5" fill="#f8c33b" stroke="#fff" stroke-width="1.3"/>' +
      '<g stroke="#f8c33b" stroke-width="2.4" stroke-linecap="round">' +
        '<path d="M0 -13v-4M0 13v4M-13 0h-4M13 0h4M-9.2 -9.2l-2.8-2.8M9.2 9.2l2.8 2.8M9.2 -9.2l2.8-2.8M-9.2 9.2l-2.8 2.8"/>' +
      '</g>' +
    '</g>' +
    '<g class="logo-celestial logo-moon">' +
      '<path d="M8.8-12.2A13.5 13.5 0 1 0 12.2 8.8 10.5 10.5 0 0 1 8.8-12.2Z" fill="#f7d878" stroke="#fff" stroke-width="1"/>' +
    '</g>';
  logo.appendChild(overlay);

  const style = document.createElement('style');
  style.textContent =
    '.site-header .brand-logo{isolation:isolate}' +
    '.logo-celestial-overlay{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:3}' +
    '.logo-celestial{opacity:0;transition:transform 1.2s ease,opacity 1s ease;filter:drop-shadow(0 1px 2px #163e3550)}' +
    '@media(prefers-reduced-motion:reduce){.logo-celestial{transition:none}}';
  document.head.appendChild(style);

  const zone = 'Europe/Berlin';
  const lat = 51.394;
  const lon = 8.58;
  const dayMs = 86400000;
  const partsFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });

  function dateParts(date) {
    const out = {};
    for (const item of partsFormatter.formatToParts(date)) {
      if (item.type !== 'literal') out[item.type] = Number(item.value);
    }
    return out;
  }

  function offsetMinutes(date) {
    const p = dateParts(date);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()) / 60000);
  }

  function localDateTime(y, m, d, minutes) {
    const whole = Math.round(minutes);
    const base = Date.UTC(y, m - 1, d, Math.floor(whole / 60), whole % 60);
    let stamp = base;
    for (let i = 0; i < 3; i++) stamp = base - offsetMinutes(new Date(stamp)) * 60000;
    return stamp;
  }

  function shiftedDate(y, m, d, shift) {
    const date = new Date(Date.UTC(y, m - 1, d + shift));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  function solarTimes(y, m, d) {
    const day = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / dayMs) + 1;
    const yearLength = new Date(Date.UTC(y + 1, 0, 1)).getTime() - new Date(Date.UTC(y, 0, 1)).getTime() > 365 * dayMs ? 366 : 365;
    const gamma = 2 * Math.PI / yearLength * (day - 1);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
      - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
    const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
      - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
      - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
    const latitude = lat * Math.PI / 180;
    const cosHourAngle = (Math.cos(90.833 * Math.PI / 180) - Math.sin(latitude) * Math.sin(decl))
      / (Math.cos(latitude) * Math.cos(decl));
    const angle = Math.acos(Math.max(-1, Math.min(1, cosHourAngle))) * 180 / Math.PI;
    const riseUtc = 720 - 4 * (lon + angle) - eq;
    const setUtc = 720 - 4 * (lon - angle) - eq;
    const noon = localDateTime(y, m, d, 720);
    const offset = offsetMinutes(new Date(noon));
    return {
      rise: localDateTime(y, m, d, riseUtc + offset),
      set: localDateTime(y, m, d, setUtc + offset)
    };
  }

  function place(group, x, y, visible) {
    group.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
    group.style.opacity = visible ? '1' : '0';
  }

  function update() {
    const now = Date.now();
    const p = dateParts(new Date(now));
    const today = solarTimes(p.year, p.month, p.day);
    const progress = (now - today.rise) / (today.set - today.rise);
    const isDay = progress >= 0 && progress < 1;
    if (isDay) {
      const t = Math.max(0, Math.min(1, progress));
      place(overlay.querySelector('.logo-sun'), 58 + 324 * t, 54 - 36 * Math.sin(Math.PI * t), true);
      place(overlay.querySelector('.logo-moon'), 0, 0, false);
      return;
    }
    let moonProgress;
    if (now >= today.set) {
      const nextDate = shiftedDate(p.year, p.month, p.day, 1);
      const next = solarTimes(nextDate.year, nextDate.month, nextDate.day);
      moonProgress = (now - today.set) / (next.rise - today.set);
    } else {
      const previousDate = shiftedDate(p.year, p.month, p.day, -1);
      const previous = solarTimes(previousDate.year, previousDate.month, previousDate.day);
      moonProgress = (now - previous.set) / (today.rise - previous.set);
    }
    const t = Math.max(0, Math.min(1, moonProgress));
    place(overlay.querySelector('.logo-sun'), 0, 0, false);
    place(overlay.querySelector('.logo-moon'), 382 - 324 * t, 54 - 36 * Math.sin(Math.PI * t), true);
  }

  update();
  window.setInterval(update, 60000);
})();