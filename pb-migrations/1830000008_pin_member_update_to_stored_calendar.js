/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
// Pin calendar_members updates to the row's STORED calendar.
//
// 1830000004's updateRule (`viaOwner`) evaluates the ownership back-relation
// against the row's stored calendar and never constrains the incoming body. So
// an owner of ANY calendar could PATCH their own membership row with
// {"calendar": <victim>}: the rule checks ownership of the OLD calendar, the
// write lands on the victim's, and the row's role: "owner" comes along — a
// takeover of a calendar the caller holds no membership on.
//
// The Go field-guard blocks this in the single-tenant app, but a hosted tenant
// runs no feature Go — the rule is the entire authorization (see
// tenant_rules_authz_test.go), which is exactly the composition drift
// FINDING-tenant-composition-gap.md documents. The pin belongs in the rule.
//
// `@request.body.calendar:isset = false` keeps ordinary PATCHes (role, color)
// working; `@request.body.calendar = calendar` admits clients that echo the
// stored record back. Only a body that CHANGES the calendar is refused.
//
// Covered by server/member_repoint_rls_test.go, which reads the SHIPPED rule
// (rlstest) and pairs the repoint denial with both allowed shapes.
//
// Do NOT edit 1830000004 — it has shipped.
migrate(
    app => {
        const enabled = '@request.auth.disabled != true'
        const viaOwner =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar.calendar_members_via_calendar.role ?= "owner"'
        const pinned =
            '(@request.body.calendar:isset = false || @request.body.calendar = calendar)'

        const members = app.findCollectionByNameOrId('calendar_members')
        members.updateRule = `${enabled} && ${viaOwner} && ${pinned}`
        app.save(members)
    },
    app => {
        const enabled = '@request.auth.disabled != true'
        const viaOwner =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar.calendar_members_via_calendar.role ?= "owner"'

        const members = app.findCollectionByNameOrId('calendar_members')
        members.updateRule = `${enabled} && ${viaOwner}`
        app.save(members)
    }
)
