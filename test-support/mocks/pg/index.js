'use strict';
class Pool {
  constructor() { throw new Error('Der Admin-HTTP-Test darf keine Datenbank öffnen.'); }
}
module.exports = { Pool };
