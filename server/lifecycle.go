package calendar

import (
	"fmt"

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

	userName := user.GetString("name")
	if userName == "" {
		userName = user.GetString("email")
	}

	// Calendar + owner membership in one transaction. Two reasons: a calendar
	// with no owner row is unusable and unreachable by the RLS rules, so the
	// pair must be atomic; and automation's owner resolution for calendar
	// triggers reads calendar_members, so a calendar visible to a rule before
	// its membership exists would resolve to no owner (see
	// tinycld/docs/automation.md).
	err = app.RunInTransaction(func(txApp core.App) error {
		calCollection, err := txApp.FindCollectionByNameOrId("calendar_calendars")
		if err != nil {
			return fmt.Errorf("calendar_calendars collection not found: %w", err)
		}

		cal := core.NewRecord(calCollection)
		cal.Set("name", userName)
		cal.Set("description", "")
		cal.Set("color", "blue")
		if err := txApp.Save(cal); err != nil {
			return fmt.Errorf("create personal calendar: %w", err)
		}

		memberCollection, err := txApp.FindCollectionByNameOrId("calendar_members")
		if err != nil {
			return fmt.Errorf("calendar_members collection not found: %w", err)
		}

		member := core.NewRecord(memberCollection)
		member.Set("calendar", cal.Id)
		member.Set("user", user.Id)
		member.Set("role", "owner")
		if err := txApp.Save(member); err != nil {
			return fmt.Errorf("create calendar member: %w", err)
		}
		return nil
	})
	if err != nil {
		app.Logger().Warn("calendar lifecycle: failed to provision personal calendar",
			"user", user.Id, "error", err)
	}
}
