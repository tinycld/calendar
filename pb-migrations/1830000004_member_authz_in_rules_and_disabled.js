/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
// Move calendar's member authorization out of Go hooks and into collection
// rules, and exclude suspended users everywhere.
//
// WHY THIS IS NOT OPTIONAL. A hosted tenant runs no feature Go — only
// PocketBase and the collection rules. calendar_members.createRule was relaxed
// to a bare `@request.auth.id != ""` by 1715400000, with the owner check moved
// into a Go hook. In a tenant that hook does not exist, so any signed-in user
// could POST {calendar: <any id>, user: <self>, role: "owner"} and take over
// any calendar in the deployment — including over its CalDAV.
//
// WHY IT IS POSSIBLE NOW. 1715400000 relaxed the rule because PocketBase v0.36
// evaluated the original back-relation rule inconsistently: an owner's own
// POST 400'd. The tree runs a v0.39.8 fork, and that is fixed — proven by
// server/member_create_rule_probe_test.go, which drives an owner-authored
// create through the rule engine with no hooks bound. So the original rule
// comes back.
//
// The Go hooks stay where they are as defence in depth for the single-tenant
// app. They were never the problem; they were just never sufficient alone.
//
// WHAT MOVES, AND WHAT CANNOT:
//
//   1. Owner-only member create — restored as a rule. Done.
//   2. No self-promotion / repointing — see updateRule below. PB rules cannot
//      constrain WHICH fields a write touches, so this is expressed by
//      narrowing who may update at all.
//   3. Last-owner protection — NOT expressible as a rule. A rule sees one row;
//      it cannot count the remaining owners of a calendar after the write.
//      This is a RECORDED DECISION, not an oversight: in a tenant, an owner
//      can orphan their own calendar by removing the last owner membership.
//      The blast radius is small (a calendar whose members can no longer be
//      managed, recoverable by a superuser) and is bounded to calendars that
//      user already owns — unlike self-promotion, which reaches everyone
//      else's. The Go hook still prevents it in the single-tenant app.
//
// Also: no calendar rule carried `@request.auth.disabled != true`, so a
// suspended user kept full REST access to every calendar and event shared with
// them. The Go gate does not run for /api/collections/*, so the rule is the
// only thing there is.
migrate(
    app => {
        const enabled = '@request.auth.disabled != true'
        const authed = '@request.auth.id != ""'
        const notGuest = '@request.auth.role != "guest"'

        // Membership predicates, from the calendar's own back-relation.
        const isMember = 'calendar_members_via_calendar.user ?= @request.auth.id'
        const isOwner =
            'calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar_members_via_calendar.role ?= "owner"'

        // Same, one relation out, for rows that point AT a calendar.
        const viaMember = 'calendar.calendar_members_via_calendar.user ?= @request.auth.id'
        const viaOwner =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar.calendar_members_via_calendar.role ?= "owner"'
        // Name the roles that may WRITE rather than excluding one. `?!=
        // "viewer"` admits every role that is not viewer, so it silently grants
        // write to each new role added later — the mistake drive's
        // `commentor` walked into.
        const viaWriter =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            '(calendar.calendar_members_via_calendar.role ?= "owner" || ' +
            'calendar.calendar_members_via_calendar.role ?= "editor")'

        const calendars = app.findCollectionByNameOrId('calendar_calendars')
        calendars.listRule = `${enabled} && ${isMember}`
        calendars.viewRule = `${enabled} && ${isMember}`
        calendars.createRule = `${authed} && ${notGuest} && ${enabled}`
        calendars.updateRule = `${enabled} && ${isOwner}`
        calendars.deleteRule = `${enabled} && ${isOwner}`
        app.save(calendars)

        const members = app.findCollectionByNameOrId('calendar_members')
        members.listRule = `${enabled} && user = @request.auth.id`
        members.viewRule = `${enabled} && user = @request.auth.id`
        // (1) Owner-only create, restored. `user = @request.auth.id` keeps a
        // caller from minting memberships for other people.
        members.createRule =
            `${enabled} && user = @request.auth.id && ${viaOwner}`
        // (2) Only a calendar OWNER may update a membership row.
        //
        // The previous rule also allowed `user = @request.auth.id` so a member
        // could set their personal colour, and relied on a Go hook to stop
        // them from using that same opening to write {"role":"owner"} or
        // repoint the row at another calendar. A rule cannot say "only the
        // colour field": the only tenant-safe expression of "no
        // self-promotion" is to drop the self-update clause entirely.
        //
        // The cost is real and deliberate: a non-owner member can no longer
        // change their own colour through plain REST. That is a cosmetic
        // preference; self-promotion is a takeover.
        members.updateRule = `${enabled} && ${viaOwner}`
        // Delete stays self-service (leaving a calendar) or owner-driven.
        // (3) Last-owner protection is NOT here — a rule cannot count the
        // owners that would remain. See the header.
        members.deleteRule = `${enabled} && (user = @request.auth.id || ${viaOwner})`
        app.save(members)

        const events = app.findCollectionByNameOrId('calendar_events')
        events.listRule = `${enabled} && ${viaMember}`
        events.viewRule = `${enabled} && ${viaMember}`
        events.createRule = `${enabled} && ${viaWriter}`
        events.updateRule = `${enabled} && ${viaWriter}`
        events.deleteRule = `${enabled} && ${viaWriter}`
        app.save(events)
    },
    app => {
        // Down: restore the rules as they stood after 1830000003 — the relaxed
        // member createRule and no disabled clause anywhere. A down migration
        // reproduces the previous state; it is not the place to keep a fix.
        const isMember = 'calendar_members_via_calendar.user ?= @request.auth.id'
        const isOwner =
            'calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar_members_via_calendar.role ?= "owner"'
        const viaMember = 'calendar.calendar_members_via_calendar.user ?= @request.auth.id'
        const viaEditor =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar.calendar_members_via_calendar.role ?!= "viewer"'

        const calendars = app.findCollectionByNameOrId('calendar_calendars')
        calendars.listRule = isMember
        calendars.viewRule = isMember
        calendars.createRule = '@request.auth.id != "" && @request.auth.role != "guest"'
        calendars.updateRule = isOwner
        calendars.deleteRule = isOwner
        app.save(calendars)

        const members = app.findCollectionByNameOrId('calendar_members')
        members.listRule = 'user = @request.auth.id'
        members.viewRule = 'user = @request.auth.id'
        members.createRule = '@request.auth.id != ""'
        members.updateRule =
            '(calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar.calendar_members_via_calendar.role ?= "owner") || (user = @request.auth.id)'
        members.deleteRule = 'user = @request.auth.id'
        app.save(members)

        const events = app.findCollectionByNameOrId('calendar_events')
        events.listRule = viaMember
        events.viewRule = viaMember
        events.createRule = viaEditor
        events.updateRule = viaEditor
        events.deleteRule = viaEditor
        app.save(events)
    }
)
