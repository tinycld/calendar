/// <reference path="../../../server/pb_data/types.d.ts" />
// SECURITY: exclude the 'guest' role from calendar_calendars create.
//
// A guest share-link visitor gets a real users record with role='guest'.
// calendar_calendars' createRule was relaxed to a pure authenticated check
// (`@request.auth.id != ""`, set in 1715000000). The
// OnRecordCreateRequest("calendar_calendars") hook only auto-creates the owner
// membership AFTER e.Next() — it does NOT block the create — so an authenticated
// guest could create calendars.
//
// The caller's role now lives on the users auth collection, so the gate is a
// direct check against @request.auth.role.
//
// calendar_members create is intentionally NOT changed: its PB rule is
// `@request.auth.id != ""` with the real owner-check enforced by the
// userIsOwner Go hook in register.go (a guest is never a calendar owner, so
// it's already blocked). Re-introducing a back-relation PB rule would hit the
// PB-evaluation bug that motivated 1715400000.
//
// The down-migration restores the prior authenticated-only createRule.
migrate(
    app => {
        const guestExcludedRule = '@request.auth.role != "guest"'

        const calendars = app.findCollectionByNameOrId('calendar_calendars')
        calendars.createRule = guestExcludedRule
        app.save(calendars)
    },
    app => {
        const authedRule = '@request.auth.id != ""'

        const calendars = app.findCollectionByNameOrId('calendar_calendars')
        calendars.createRule = authedRule
        app.save(calendars)
    }
)
