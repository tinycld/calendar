/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
// Make membership rows visible to the calendar's members (D4 / R1).
//
// 1830000004 set calendar_members list/view to the self-only
// `user = @request.auth.id`, a faithful translation of main's semantics — but
// it leaves the "Shared with" UI unable to show anyone except the caller. An
// owner who adds a teammate sees the new row only optimistically (the local
// insert); after a reload the row is gone from their list, and there is no
// row to remove the teammate from. 1830000006 restored sharing's CREATE; this
// restores its READ half.
//
// D4: membership rows are visible to every member of that calendar. Owners
// need the full list to manage sharing; co-members seeing who else has access
// is the standard product shape, and a row reveals only
// (calendar, user, role, color). The predicate is the same back-relation
// shape 1830000006 settled on for create — one membership row held by the
// caller on the row's calendar — which the v0.39.8 fork evaluates correctly
// (re-verified for P1-5).
//
// Covered by server/member_share_rls_test.go's listing block, which reads the
// SHIPPED rules (rlstest): owner-lists-added-member and member-lists-co-members
// go red if the self-only clause comes back; outsider-lists-nothing pins the
// cross-calendar boundary.
//
// Do NOT edit 1830000004 — it has shipped.
migrate(
    app => {
        const enabled = '@request.auth.disabled != true'
        const viaMember = 'calendar.calendar_members_via_calendar.user ?= @request.auth.id'

        const members = app.findCollectionByNameOrId('calendar_members')
        members.listRule = `${enabled} && ${viaMember}`
        members.viewRule = `${enabled} && ${viaMember}`
        app.save(members)
    },
    app => {
        const enabled = '@request.auth.disabled != true'

        const members = app.findCollectionByNameOrId('calendar_members')
        members.listRule = `${enabled} && user = @request.auth.id`
        members.viewRule = `${enabled} && user = @request.auth.id`
        app.save(members)
    }
)
