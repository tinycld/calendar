package calendar

import (
	"github.com/pocketbase/pocketbase/core"
)

// handleUserCreated auto-creates a personal calendar for a new user.
//
// Single-org: the deployment IS the org, so this fires on users-create rather
// than on the old user_org junction. There is no matching delete handler —
// account teardown is core's job (offboard.OffboardUser), which reassigns or
// deletes a departing user's content through the reassignable-FK registry that
// Register populates. A second cleanup path here would race it.
func handleUserCreated(app core.App, user *core.Record) {
	// A share-link guest is a real users row, but must not be provisioned a
	// personal calendar: the auto-minted owner membership would contradict the
	// guest-exclusion createRule (1830000003) shipped in this same branch.
	if user.GetString("role") == "guest" {
		return
	}

	// Idempotency: a user who already owns a calendar keeps it. Re-running must
	// not mint a second personal calendar.
	existing, err := app.FindRecordsByFilter(
		"calendar_members",
		"user = {:user} && role = 'owner'",
		"",
		1,
		0,
		map[string]any{"user": user.Id},
	)
	if err == nil && len(existing) > 0 {
		return
	}

	calCollection, err := app.FindCollectionByNameOrId("calendar_calendars")
	if err != nil {
		app.Logger().Warn("calendar lifecycle: calendar_calendars collection not found", "error", err)
		return
	}

	userName := user.GetString("name")
	if userName == "" {
		userName = user.GetString("email")
	}

	cal := core.NewRecord(calCollection)
	cal.Set("name", userName)
	cal.Set("description", "")
	cal.Set("color", "blue")
	if err := app.Save(cal); err != nil {
		app.Logger().Warn("calendar lifecycle: failed to create personal calendar",
			"user", user.Id, "error", err)
		return
	}

	memberCollection, err := app.FindCollectionByNameOrId("calendar_members")
	if err != nil {
		app.Logger().Warn("calendar lifecycle: calendar_members collection not found", "error", err)
		return
	}

	member := core.NewRecord(memberCollection)
	member.Set("calendar", cal.Id)
	member.Set("user", user.Id)
	member.Set("role", "owner")
	if err := app.Save(member); err != nil {
		app.Logger().Warn("calendar lifecycle: failed to create calendar member",
			"calendar", cal.Id, "error", err)
	}
}
