/// <reference path="../../tinycld/server/pb_data/types.d.ts" />

// Calendar server-side TS hooks (runs on the sobek jsvm alongside the package's Go).
//
// This is the customization seam for package authors and downstream integrators.
// The calendar feature's core behavior — CalDAV, the ICS subscription poller, the
// reminder scheduler, audit logging, the owner-membership guards — lives in the
// package's Go server (server/register.go) and runs REGARDLESS of this file. Add
// TS here to layer extra behavior on top without forking the Go.
//
// What you can do here:
//   - Bind onRecordCreate/onRecordUpdate/onRecordDelete('calendar_events') (or
//     'calendar_calendars' / 'calendar_members') to react to the same events the
//     Go server does — derive a field, call a webhook, enforce a house rule.
//   - Register CalDAV interception points with caldavHook({...}); see
//     help/caldav-hooks.md for the full contract. Four points are available:
//     beforeWrite, beforeDelete, canRead and filterList.
//
// Two things that bite:
//
//  1. The fork's TS→JS transpile wraps each callback, so top-level module
//     bindings (a `const` or `function` declared outside a callback) are NOT in
//     scope at request time. Keep everything a hook needs inside its own body.
//     This applies to caldavHook handlers too — each is recompiled standalone
//     and closes over nothing.
//
//  2. A hook point may RESTRICT a decision, never widen one. Go authorizes
//     first; canRead is consulted only for events already granted, and any UID
//     filterList returns that Go did not authorize is discarded.
//
// Example: a no-op create hook, live so this file transpiles to real JS (an
// all-comment .pb.ts compiles to an empty module, which the loader rejects with
// "sourcemap: mappings are empty"). Replace the body to add real behavior.
onRecordCreate((e) => {
    e.next()
}, 'calendar_events')

// Example CalDAV interception, commented out. Uncomment and edit to make
// /caldav enforce something the schema cannot express.
//
// caldavHook({
//     // Refuse writes to a frozen calendar. A thrown error rejects the PUT.
//     beforeWrite(e) {
//         if (e.calendarId === 'some-frozen-calendar-id') {
//             throw new Error('This calendar is read-only')
//         }
//     },
//     // Hide events from a listing. Return a subset of e.items (iCal UIDs);
//     // anything not already authorized by Go is dropped.
//     filterList(e) {
//         return e.items.filter((uid) => !uid.startsWith('urn:uuid:private-'))
//     },
// })

// Bootstrap the creator's owner membership.
//
// calendar_members.createRule (migration 1830000004) admits a membership only
// when the caller ALREADY owns the calendar — which the very first membership
// on a new calendar cannot satisfy. Something privileged has to write that
// first row, and it must be something a hosted tenant runs.
//
// The package's Go server does this too (server/register.go), but a tenant
// links no feature Go: there, PocketBase plus these hooks are the entire
// server. Without this hook a tenant user creates a calendar and it comes out
// with zero members — owned by nobody, manageable by nobody.
//
// $app.save() is the model layer, not the request layer: collection rules are
// evaluated by apis/, so this write is not subject to the owner check it is
// bootstrapping. That is the point.
//
// Idempotent against the Go: when both run (the single-tenant app), the second
// write loses to the unique (calendar, user) index and is ignored.
//
// INTERIM. This duplicates logic the package's Go already has
// (server/register.go), and it exists only because `serve-org` links no
// feature package today. If that changes — see
// multi-org/docs/SCOPE-tenant-feature-go.md — the Go hook covers tenants too
// and this whole block should be deleted rather than left to drift.
onRecordCreateRequest((e) => {
    e.next()

    if (!e.auth) {
        return
    }
    const members = $app.findCollectionByNameOrId('calendar_members')
    const member = new Record(members)
    member.set('calendar', e.record.id)
    member.set('user', e.auth.id)
    member.set('role', 'owner')
    try {
        $app.save(member)
    } catch {
        // Already present (the Go hook won the race) — nothing to do.
    }
}, 'calendar_calendars')
