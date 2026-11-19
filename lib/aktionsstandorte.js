'use strict';

function aktionsstandorte(action) {
  if (!action || typeof action !== 'object') return [];
  const selected = Array.isArray(action.veranstaltungsorte) && action.veranstaltungsorte.length
    ? action.veranstaltungsorte : [action.veranstaltungsort].filter(Boolean);
  return [...new Set(selected.filter(value => typeof value === 'string' && value.trim()))];
}

function aktionAmStandortFreigegeben(action, standort) {
  return typeof standort === 'string' && Boolean(standort) && aktionsstandorte(action).includes(standort);
}

module.exports = { aktionsstandorte, aktionAmStandortFreigegeben };
