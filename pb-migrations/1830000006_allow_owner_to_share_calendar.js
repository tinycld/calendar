/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
// Restore calendar sharing: drop the `user = @request.auth.id` conjunct from
// calendar_members.createRule.
//
// 1830000004 moved member authorization out of Go and into rules (correct, and
// required for tenants — see that file's header). But it conjoined the
// owner check with `user = @request.auth.id`, which reads as "the row's user
// must be the caller". That makes the ONLY creatable membership your own, so
// an owner adding a teammate — the entire sharing feature, and what
// AddMemberDialog posts — was denied with a bare 400 "Failed to create
// record" and the dialog silently stayed open.
//
// The self-clause was defending against the takeover shape 1830000004's header
// names: POST {calendar: <any>, user: <self>, role: "owner"}. `viaOwner`
// already blocks that on its own — it requires the CALLER to hold an owner
// membership on the target calendar, which an attacker aiming at someone
// else's calendar does not have. So the clause added no protection against the
// threat it was written for while removing the feature.
//
// What still holds after this change:
//   - Only a calendar OWNER may create a membership on it (viaOwner).
//   - A user who owns nothing cannot mint a membership anywhere, whether
//     aimed at themselves or a third party.
//   - The suspended-user exclusion is unchanged.
//
// Covered by server/member_share_rls_test.go, which reads the SHIPPED rule
// (rlstest) and pairs the owner-adds-another-user positive with both outsider
// denials — so reintroducing the self-clause turns the feature test red
// instead of silently re-breaking sharing.
//
// Do NOT edit 1830000004 — it has shipped.
migrate(
    app => {
        const enabled = '@request.auth.disabled != true'
        const viaOwner =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar.calendar_members_via_calendar.role ?= "owner"'

        const members = app.findCollectionByNameOrId('calendar_members')
        members.createRule = `${enabled} && ${viaOwner}`
        app.save(members)
    },
    app => {
        const enabled = '@request.auth.disabled != true'
        const viaOwner =
            'calendar.calendar_members_via_calendar.user ?= @request.auth.id && ' +
            'calendar.calendar_members_via_calendar.role ?= "owner"'

        const members = app.findCollectionByNameOrId('calendar_members')
        members.createRule = `${enabled} && user = @request.auth.id && ${viaOwner}`
        app.save(members)
    }
)
