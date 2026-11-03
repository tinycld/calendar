package calendar

import "testing"

// The colour field is free text since 1830000011, so a palette name such as
// "blue" saves without error but the client cannot render it.
func TestHandleUserCreated_PersonalCalendarHasHexColor(t *testing.T) {
	env := setupCalGuestApp(t)
	member := calGuestUser(t, env.app, "hex-member@test.local", "member")

	handleUserCreated(env.app, member)

	members, err := env.app.FindRecordsByFilter(
		"calendar_members", "user = {:user}", "", 0, 0,
		map[string]any{"user": member.Id},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 1 {
		t.Fatalf("member should have 1 calendar membership, got %d", len(members))
	}

	cal, err := env.app.FindRecordById("calendar_calendars", members[0].GetString("calendar"))
	if err != nil {
		t.Fatal(err)
	}
	color := cal.GetString("color")
	if !hexColorRe.MatchString(color) {
		t.Fatalf("personal calendar colour must be #RRGGBB, got %q", color)
	}
	if color != defaultCalendarColor {
		t.Fatalf("personal calendar colour = %q, want %q", color, defaultCalendarColor)
	}
}
