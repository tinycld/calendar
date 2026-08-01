package calendar

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// guest_lifecycle_test.go proves the users-create hook does not auto-provision
// a personal calendar for share-link guests.
//
// Core's invite flow creates guests as real `users` rows, and the users-create
// hook fires for every row. Without a role check, a guest silently receives an
// auto-minted personal calendar with an owner membership — contradicting the
// guest-exclusion createRule shipped by 1830000003 in this same branch.

func countCalendarMemberships(t *testing.T, app core.App, userID string) int {
	t.Helper()
	rows, err := app.FindRecordsByFilter(
		"calendar_members", "user = {:user}", "", 0, 0,
		map[string]any{"user": userID},
	)
	if err != nil {
		t.Fatal(err)
	}
	return len(rows)
}

func TestHandleUserCreated_GuestGetsNoCalendar(t *testing.T) {
	env := setupCalGuestApp(t)

	member := calGuestUser(t, env.app, "life-member@test.local", "member")
	guest := calGuestUser(t, env.app, "life-guest@test.local", "guest")

	// Positive control: a real member is provisioned, so the guest assertion
	// below fails only on the role check and not on a broken fixture.
	handleUserCreated(env.app, member)
	if n := countCalendarMemberships(t, env.app, member.Id); n != 1 {
		t.Fatalf("member should have 1 calendar membership, got %d", n)
	}

	handleUserCreated(env.app, guest)
	if n := countCalendarMemberships(t, env.app, guest.Id); n != 0 {
		t.Fatalf("guest must have no calendar membership, got %d", n)
	}
}
