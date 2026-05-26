/// <reference path="../../../server/pb_data/types.d.ts" />
// SECURITY: exclude the 'guest' role from calendar_calendars create.
//
// A guest share-link visitor gets a real users record + a user_org row with
// role='guest' in the owner's org. calendar_calendars' createRule was a pure-
// membership predicate (orgMemberRule, set in 1715000000). The
// OnRecordCreateRequest("calendar_calendars") hook only auto-creates the owner
// membership AFTER e.Next() — it does NOT block the create — so a guest
// membership row let the visitor create calendars in the org.
//
// The role pin shares the exact same relation-path prefix as the user pin, so
// PocketBase applies both to the SAME joined user_org row (the CALLER's own
// membership must be non-guest — verified against the real rule engine in
// calendar/server/guest_rls_test.go).
//
// calendar_members create is intentionally NOT changed: its PB rule is
// `@request.auth.id != ""` with the real owner-check enforced by the
// userIsOwner Go hook in register.go (a guest is never a calendar owner, so
// it's already blocked). Re-introducing a back-relation PB rule would hit the
// PB-evaluation bug that motivated 1715400000.
//
// The down-migration restores the EXACT prior createRule (orgMemberRule).
migrate(
    app => {
        const guestExcludedRule =
            'org.user_org_via_org.user ?= @request.auth.id && ' +
            'org.user_org_via_org.role ?!= "guest"'

        const calendars = app.findCollectionByNameOrId('calendar_calendars')
        calendars.createRule = guestExcludedRule
        app.save(calendars)
    },
    app => {
        const orgMemberRule = 'org.user_org_via_org.user ?= @request.auth.id'

        const calendars = app.findCollectionByNameOrId('calendar_calendars')
        calendars.createRule = orgMemberRule
        app.save(calendars)
    }
)
