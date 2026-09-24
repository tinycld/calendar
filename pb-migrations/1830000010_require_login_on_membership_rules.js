/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
// Lead every calendar rule that matches through @request.auth with the login
// guard `@request.auth.id != ""`.
//
// WHY. For a request with no login, PocketBase resolves @request.auth.id to
// NULL, and its filter compiler turns `x = NULL` into `(x = '' OR x IS NULL)`.
// A back-relation such as `calendar_members_via_calendar.user ?= @request.auth.id`
// is a LEFT JOIN, so a calendar with ZERO member rows gives NULL there and
// MATCHES the anonymous caller. `@request.auth.disabled != true` does not stop
// it: that negative check is TRUE when there is no auth record.
//
// A calendar has no members when its only member deletes their account: the
// cascade removes the membership, not the calendar. From then on an anonymous
// caller could list and view that calendar and every event on it, private
// events included, over REST and over realtime. Writes stayed closed only
// because each needs `role ?= …`, which is NULL for an orphan — an accident of
// the rule shape, not a guard. So the guard goes on EVERY rule of the three
// collections, not only on list/view.
//
// calendar_calendars.createRule already leads with the guard (1830000004) and
// is not changed.
//
// Rules are restated in full from named predicates, as 1830000004 does, so the
// down migration restores the exact previous strings.
//
// Covered by server/anon_rls_test.go, which reads the SHIPPED rules (rlstest):
// anonymous list/view of a memberless calendar and its events, the member
// positive controls, anonymous writes, and a literal check that every rule
// leads with the guard.
//
// Do NOT edit 1830000004, 1830000006, 1830000007 or 1830000008 — they have
// shipped.
migrate(
    app => {
        const authed = '@request.auth.id != ""'
        const enabled = '@request.auth.disabled != true'
        const guard = `${authed} && ${enabled}`

        const isMember = 'calendar_members_via_calendar.user ?= @request.auth.id'
        const isOwner =
            'calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar_members_via_calendar.role ?= "owner"'
        const viaMember = 'calendar.calendar_members_via_calendar.user ?= @request.auth.id'
        const viaOwner =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar.calendar_members_via_calendar.role ?= "owner"'
        const viaWriter =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            '(calendar.calendar_members_via_calendar.role ?= "owner" || ' +
            'calendar.calendar_members_via_calendar.role ?= "editor")'
        const pinned =
            '(@request.body.calendar:isset = false || @request.body.calendar = calendar)'

        const calendars = app.findCollectionByNameOrId('calendar_calendars')
        calendars.listRule = `${guard} && ${isMember}`
        calendars.viewRule = `${guard} && ${isMember}`
        calendars.updateRule = `${guard} && ${isOwner}`
        calendars.deleteRule = `${guard} && ${isOwner}`
        app.save(calendars)

        const members = app.findCollectionByNameOrId('calendar_members')
        members.listRule = `${guard} && ${viaMember}`
        members.viewRule = `${guard} && ${viaMember}`
        members.createRule = `${guard} && ${viaOwner}`
        members.updateRule = `${guard} && ${viaOwner} && ${pinned}`
        members.deleteRule = `${guard} && (user = @request.auth.id || ${viaOwner})`
        app.save(members)

        const events = app.findCollectionByNameOrId('calendar_events')
        events.listRule = `${guard} && ${viaMember}`
        events.viewRule = `${guard} && ${viaMember}`
        events.createRule = `${guard} && ${viaWriter}`
        events.updateRule = `${guard} && ${viaWriter}`
        events.deleteRule = `${guard} && ${viaWriter}`
        app.save(events)
    },
    app => {
        // Down: the rules as they stood after 1830000008.
        const enabled = '@request.auth.disabled != true'

        const isMember = 'calendar_members_via_calendar.user ?= @request.auth.id'
        const isOwner =
            'calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar_members_via_calendar.role ?= "owner"'
        const viaMember = 'calendar.calendar_members_via_calendar.user ?= @request.auth.id'
        const viaOwner =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar.calendar_members_via_calendar.role ?= "owner"'
        const viaWriter =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            '(calendar.calendar_members_via_calendar.role ?= "owner" || ' +
            'calendar.calendar_members_via_calendar.role ?= "editor")'
        const pinned =
            '(@request.body.calendar:isset = false || @request.body.calendar = calendar)'

        const calendars = app.findCollectionByNameOrId('calendar_calendars')
        calendars.listRule = `${enabled} && ${isMember}`
        calendars.viewRule = `${enabled} && ${isMember}`
        calendars.updateRule = `${enabled} && ${isOwner}`
        calendars.deleteRule = `${enabled} && ${isOwner}`
        app.save(calendars)

        const members = app.findCollectionByNameOrId('calendar_members')
        members.listRule = `${enabled} && ${viaMember}`
        members.viewRule = `${enabled} && ${viaMember}`
        members.createRule = `${enabled} && ${viaOwner}`
        members.updateRule = `${enabled} && ${viaOwner} && ${pinned}`
        members.deleteRule = `${enabled} && (user = @request.auth.id || ${viaOwner})`
        app.save(members)

        const events = app.findCollectionByNameOrId('calendar_events')
        events.listRule = `${enabled} && ${viaMember}`
        events.viewRule = `${enabled} && ${viaMember}`
        events.createRule = `${enabled} && ${viaWriter}`
        events.updateRule = `${enabled} && ${viaWriter}`
        events.deleteRule = `${enabled} && ${viaWriter}`
        app.save(events)
    }
)
