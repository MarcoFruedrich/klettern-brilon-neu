'use strict';

// CI installiert echte Abhängigkeiten. Nur speziell markierte HTTP-Testkinder
// sollen trotzdem die isolierten PostgreSQL-/Supabase-Doubles benutzen.
if (process.env.MOCK_PG === '1') {
  const Module = require('node:module');
  const path = require('node:path');
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'pg')
      return originalLoad.call(this, path.join(__dirname, 'pg'), parent, isMain);
    if (request === '@supabase/supabase-js')
      return originalLoad.call(this, path.join(__dirname, '@supabase', 'supabase-js'), parent, isMain);
    return originalLoad.call(this, request, parent, isMain);
  };
}
