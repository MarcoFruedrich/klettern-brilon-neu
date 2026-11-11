# Teamerbase calendar integration

The admin calendar imports Teamerbase events over CalDAV. The importer keeps only the event UID, summary, location, start/end, all-day state and cancellation state. It does not persist descriptions, attendees, trainers, customers, or contact details, and it sends no notifications.

## Initial setup

### Required Teamerbase access scope

Do not use a staff member's personal Teamerbase login. The CalDAV URL must point to a shared calendar that contains all relevant Bredelon appointments, not only the assigned staff member's personal calendar. Use a dedicated service account with read-only access limited to that calendar. It must not be able to edit or cancel events and must not be granted access to staff assignments, customer or booking details, contact lists, or messages. If Teamerbase cannot provide this scope through CalDAV, do not configure the integration with a personal account; ask Teamerbase for a restricted calendar feed or service account first.

The CalDAV request explicitly asks the server to return only UID, timestamp, title, location, start/end, status, and recurrence-instance ID. Other event properties, including descriptions and attendee lists, are not requested. The importer stores only event UID, title, location, start/end date and time, all-day state, and cancellation state; it does not save employee assignments, customers, or contact details. CalDAV credentials belong only in Render's server-side secret settings and must never be committed or pasted into chat.

1. Apply only `db/migrations/2026-11-11-teamerbase-calendar.sql` to the production database after reviewing it. Alternatively, set the dedicated `RUN_TEAMERBASE_CALENDAR_MIGRATION=true` flag for one server start; it applies only these additive calendar tables and does not enable the broader schema migration. Remove the flag after the migration completes.
2. In Render, add the restricted service account's `TEAMERBASE_CALDAV_URL`, `TEAMERBASE_CALDAV_USER`, and `TEAMERBASE_CALDAV_PASSWORD` to the `klettern-brilon-neu` service. These values must stay in Render's server-side environment and must not be placed in source files or browser JavaScript.
3. Set `TEAMERBASE_LOCATION_FILTER` to the site name used in the Teamerbase event title or location, for example `Brilon`.
4. Restart/redeploy the service, then use **Programme → Teamerbase-Kalenderprogramme → Jetzt mit Teamerbase abgleichen** once and review the import in the admin calendar.

## Refresh behavior

An admin calendar request checks whether the last successful sync is at least 72 hours old. The running service also checks hourly and performs a sync only when due. Render free web services can sleep during inactivity, so a sleeping service resumes this check on its next request. A separate always-running scheduled service would have an additional cost and is not part of this implementation.

New program titles are added with the tower rule **Noch prüfen**. The administration can rename the display label, set **Benötigt Kletterturm** or **Kein Kletterturm**, and remove a program from the management list. Removed mappings are retained as hidden records so the next sync does not recreate them automatically.
