package calendar

import (
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/automation"
)

// automation_test.go covers calendar's two registrations:
//
//   - eventOwnerResolver, which resolves an event to every member of its
//     calendar rather than just created_by — the difference that makes a
//     shared calendar's rules fire for colleagues, not only the author;
//   - actionCreateEvent's date math (the reason the action is native at all)
//     and its calendar resolution, which doubles as the access check since a
//     native handler runs unGated with a superuser app.

func setupAutomationApp(t *testing.T) (*tests.TestApp, string, string) {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	calendars := core.NewBaseCollection("calendar_calendars")
	calendars.Id = "pbc_cal_calendars_01"
	calendars.Fields.Add(&core.TextField{Name: "name", Required: true})
	calendars.Fields.Add(&core.TextField{Name: "description"})
	calendars.Fields.Add(&core.TextField{Name: "color"})
	if err := app.Save(calendars); err != nil {
		t.Fatal(err)
	}

	members := core.NewBaseCollection("calendar_members")
	members.Fields.Add(&core.RelationField{
		Name: "calendar", Required: true, CollectionId: calendars.Id, MaxSelect: 1,
	})
	members.Fields.Add(&core.RelationField{
		Name: "user", Required: true, CollectionId: users.Id, MaxSelect: 1,
	})
	members.Fields.Add(&core.TextField{Name: "role"})
	if err := app.Save(members); err != nil {
		t.Fatal(err)
	}

	events := core.NewBaseCollection("calendar_events")
	events.Fields.Add(&core.RelationField{
		Name: "calendar", Required: true, CollectionId: calendars.Id, MaxSelect: 1,
	})
	events.Fields.Add(&core.RelationField{
		Name: "created_by", CollectionId: users.Id, MaxSelect: 1,
	})
	events.Fields.Add(&core.TextField{Name: "title", Required: true})
	events.Fields.Add(&core.TextField{Name: "description"})
	events.Fields.Add(&core.TextField{Name: "start"})
	events.Fields.Add(&core.TextField{Name: "end"})
	events.Fields.Add(&core.BoolField{Name: "all_day"})
	events.Fields.Add(&core.JSONField{Name: "guests", MaxSize: 100000})
	events.Fields.Add(&core.NumberField{Name: "reminder"})
	events.Fields.Add(&core.SelectField{Name: "busy_status", Values: []string{"busy", "free"}, MaxSelect: 1})
	events.Fields.Add(&core.SelectField{
		Name: "visibility", Values: []string{"default", "public", "private"}, MaxSelect: 1,
	})
	if err := app.Save(events); err != nil {
		t.Fatal(err)
	}

	// Two real users so membership fan-out is observable.
	existing, err := app.FindRecordsByFilter("users", "id != ''", "", 2, 0, nil)
	if err != nil || len(existing) < 2 {
		t.Fatalf("need two seeded users, got %d (err %v)", len(existing), err)
	}
	return app, existing[0].Id, existing[1].Id
}

func newCalendar(t *testing.T, app core.App, name string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("calendar_calendars")
	if err != nil {
		t.Fatal(err)
	}
	cal := core.NewRecord(col)
	cal.Set("name", name)
	if err := app.Save(cal); err != nil {
		t.Fatalf("save calendar: %v", err)
	}
	return cal
}

func addMember(t *testing.T, app core.App, calendarID, userID, role string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("calendar_members")
	if err != nil {
		t.Fatal(err)
	}
	m := core.NewRecord(col)
	m.Set("calendar", calendarID)
	m.Set("user", userID)
	m.Set("role", role)
	if err := app.Save(m); err != nil {
		t.Fatalf("save member: %v", err)
	}
}

func newEvent(t *testing.T, app core.App, calendarID, createdBy, title string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("calendar_events")
	if err != nil {
		t.Fatal(err)
	}
	e := core.NewRecord(col)
	e.Set("calendar", calendarID)
	e.Set("created_by", createdBy)
	e.Set("title", title)
	e.Set("guests", []any{})
	if err := app.Save(e); err != nil {
		t.Fatalf("save event: %v", err)
	}
	return e
}

func TestEventOwnerResolver_FansOutOverCalendarMembers(t *testing.T) {
	app, alice, bob := setupAutomationApp(t)
	cal := newCalendar(t, app, "Team")
	addMember(t, app, cal.Id, alice, "owner")
	addMember(t, app, cal.Id, bob, "editor")

	// Created by alice, but bob is a member — the whole point of resolving
	// through membership rather than created_by.
	event := newEvent(t, app, cal.Id, alice, "standup")

	owners := eventOwnerResolver(app, event)
	if len(owners) != 2 {
		t.Fatalf("owners = %v, want both members", owners)
	}
	seen := map[string]bool{owners[0]: true, owners[1]: true}
	if !seen[alice] || !seen[bob] {
		t.Fatalf("owners = %v, want alice and bob", owners)
	}
}

func TestEventOwnerResolver_NoMembersResolvesNil(t *testing.T) {
	app, alice, _ := setupAutomationApp(t)
	cal := newCalendar(t, app, "Orphan")
	event := newEvent(t, app, cal.Id, alice, "lonely")

	// A calendar with no membership rows has no personal owner. Returning nil
	// (not an error) keeps org-scoped rules firing.
	if owners := eventOwnerResolver(app, event); owners != nil {
		t.Fatalf("owners = %v, want nil", owners)
	}
}

func TestOwnedCalendarFor_PrefersTheOwnedCalendar(t *testing.T) {
	app, alice, bob := setupAutomationApp(t)
	shared := newCalendar(t, app, "Shared")
	own := newCalendar(t, app, "Mine")
	// Membership on the shared calendar is created first, so a naive "first
	// row wins" would pick it.
	addMember(t, app, shared.Id, alice, "editor")
	addMember(t, app, own.Id, alice, "owner")
	addMember(t, app, shared.Id, bob, "owner")

	got, err := ownedCalendarFor(app, alice)
	if err != nil {
		t.Fatalf("ownedCalendarFor: %v", err)
	}
	if got != own.Id {
		t.Fatalf("calendar = %s, want the owned one (%s)", got, own.Id)
	}
}

func TestOwnedCalendarFor_FallsBackToAWritableMembership(t *testing.T) {
	app, alice, _ := setupAutomationApp(t)
	shared := newCalendar(t, app, "Shared only")
	addMember(t, app, shared.Id, alice, "editor")

	got, err := ownedCalendarFor(app, alice)
	if err != nil {
		t.Fatalf("ownedCalendarFor: %v", err)
	}
	if got != shared.Id {
		t.Fatalf("calendar = %s, want %s", got, shared.Id)
	}
}

// A viewer membership is read-only. Falling back to it put rule-created events
// onto someone else's calendar — the engine saves as superuser, so
// calendar_events' own create rule (which excludes viewers) never runs.
func TestOwnedCalendarFor_RefusesAViewerOnlyMembership(t *testing.T) {
	app, alice, bob := setupAutomationApp(t)
	shared := newCalendar(t, app, "Bob's calendar")
	addMember(t, app, shared.Id, bob, "owner")
	addMember(t, app, shared.Id, alice, "viewer")

	if _, err := ownedCalendarFor(app, alice); err == nil {
		t.Fatal("a viewer-only membership must not receive rule-created events")
	}
}

// A viewer membership must not shadow a writable one, whichever row comes
// back first.
func TestOwnedCalendarFor_SkipsViewerRowsToFindAWritableOne(t *testing.T) {
	app, alice, bob := setupAutomationApp(t)
	readOnly := newCalendar(t, app, "Read only")
	writable := newCalendar(t, app, "Writable")
	addMember(t, app, readOnly.Id, bob, "owner")
	// Created first, so a naive "first row wins" would pick the viewer one.
	addMember(t, app, readOnly.Id, alice, "viewer")
	addMember(t, app, writable.Id, alice, "editor")

	got, err := ownedCalendarFor(app, alice)
	if err != nil {
		t.Fatalf("ownedCalendarFor: %v", err)
	}
	if got != writable.Id {
		t.Fatalf("calendar = %s, want the writable one (%s)", got, writable.Id)
	}
}

func TestOwnedCalendarFor_NonMemberIsAnError(t *testing.T) {
	app, _, bob := setupAutomationApp(t)
	// bob belongs to nothing. A native handler is not pkgaccess-gated, so this
	// failure IS the access check: no membership, no place to write.
	if _, err := ownedCalendarFor(app, bob); err == nil {
		t.Fatal("expected an error for a user with no calendar membership")
	}
}

func TestActionCreateEvent_DateMath(t *testing.T) {
	tests := []struct {
		name            string
		params          map[string]string
		wantDaysAhead   int
		wantDurationMin int
		wantAllDay      bool
		wantReminder    int
	}{
		{
			name:            "defaults when unset",
			params:          map[string]string{"title": "x"},
			wantDaysAhead:   0,
			wantDurationMin: defaultEventDurationMinutes,
		},
		{
			name: "explicit offset and duration",
			params: map[string]string{
				"title": "x", "starts_in_days": "3", "duration_minutes": "90",
			},
			wantDaysAhead:   3,
			wantDurationMin: 90,
		},
		{
			name: "all day anchors to midnight",
			params: map[string]string{
				"title": "x", "starts_in_days": "1", "all_day": "true", "duration_minutes": "60",
			},
			wantDaysAhead:   1,
			wantDurationMin: 60,
			wantAllDay:      true,
		},
		{
			name: "reminder is carried through for the scheduler",
			params: map[string]string{
				"title": "x", "reminder_minutes": "15",
			},
			wantDurationMin: defaultEventDurationMinutes,
			wantReminder:    15,
		},
		{
			// A template that resolved to a non-number shouldn't fail the whole
			// action — defaulting beats losing the event.
			name: "unparseable numbers fall back to defaults",
			params: map[string]string{
				"title": "x", "starts_in_days": "{{subject}}", "duration_minutes": "oops",
			},
			wantDurationMin: defaultEventDurationMinutes,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app, alice, _ := setupAutomationApp(t)
			cal := newCalendar(t, app, "Mine")
			addMember(t, app, cal.Id, alice, "owner")

			before := time.Now().UTC()
			err := actionCreateEvent(app, automation.ActionRequest{
				OwnerID: alice, Params: tc.params,
			})
			if err != nil {
				t.Fatalf("actionCreateEvent: %v", err)
			}

			events, err := app.FindRecordsByFilter("calendar_events", "title = 'x'", "", 1, 0, nil)
			if err != nil || len(events) == 0 {
				t.Fatalf("event not created (err %v)", err)
			}
			got := events[0]

			if got.GetString("calendar") != cal.Id {
				t.Errorf("calendar = %q, want %q", got.GetString("calendar"), cal.Id)
			}
			if got.GetString("created_by") != alice {
				t.Errorf("created_by = %q, want %q", got.GetString("created_by"), alice)
			}
			if got.GetBool("all_day") != tc.wantAllDay {
				t.Errorf("all_day = %v, want %v", got.GetBool("all_day"), tc.wantAllDay)
			}
			if reminder := got.GetInt("reminder"); reminder != tc.wantReminder {
				t.Errorf("reminder = %d, want %d", reminder, tc.wantReminder)
			}

			start, err := time.Parse(pbTimeFormat, got.GetString("start"))
			if err != nil {
				t.Fatalf("unparseable start %q: %v", got.GetString("start"), err)
			}
			end, err := time.Parse(pbTimeFormat, got.GetString("end"))
			if err != nil {
				t.Fatalf("unparseable end %q: %v", got.GetString("end"), err)
			}

			if gotMin := int(end.Sub(start).Minutes()); gotMin != tc.wantDurationMin {
				t.Errorf("duration = %d min, want %d", gotMin, tc.wantDurationMin)
			}

			wantDay := before.AddDate(0, 0, tc.wantDaysAhead)
			if start.YearDay() != wantDay.YearDay() || start.Year() != wantDay.Year() {
				t.Errorf("start %s is not %d day(s) ahead of %s", start, tc.wantDaysAhead, before)
			}
			if tc.wantAllDay {
				if start.Hour() != 0 || start.Minute() != 0 || start.Second() != 0 {
					t.Errorf("all-day start %s is not anchored to midnight", start)
				}
			}
		})
	}
}

func TestActionCreateEvent_RequiresAnOwnerWithACalendar(t *testing.T) {
	app, _, bob := setupAutomationApp(t)

	// No owner at all.
	if err := actionCreateEvent(app, automation.ActionRequest{
		Params: map[string]string{"title": "x"},
	}); err == nil {
		t.Error("expected an error with no rule owner")
	}

	// An owner who belongs to no calendar has nowhere to write.
	err := actionCreateEvent(app, automation.ActionRequest{
		OwnerID: bob, Params: map[string]string{"title": "x"},
	})
	if err == nil {
		t.Fatal("expected an error for an owner with no calendar")
	}
	if !strings.Contains(err.Error(), "calendar") {
		t.Errorf("error %q should name the missing calendar", err)
	}
}

func TestActionCreateEvent_UntitledFallback(t *testing.T) {
	app, alice, _ := setupAutomationApp(t)
	cal := newCalendar(t, app, "Mine")
	addMember(t, app, cal.Id, alice, "owner")

	// title is schema-required, so an empty template result must not produce
	// a save error — the event is more useful than the failure.
	if err := actionCreateEvent(app, automation.ActionRequest{
		OwnerID: alice, Params: map[string]string{"title": "   "},
	}); err != nil {
		t.Fatalf("actionCreateEvent: %v", err)
	}

	events, err := app.FindRecordsByFilter("calendar_events", "title = '(untitled)'", "", 1, 0, nil)
	if err != nil || len(events) == 0 {
		t.Fatalf("expected an (untitled) event (err %v)", err)
	}
}

// calendar_calendars carries no owner column of any kind, so this resolver is
// the ONLY thing that makes personal rules on feed failures possible.
func TestCalendarOwnerResolver_ResolvesMembers(t *testing.T) {
	app, alice, bob := setupAutomationApp(t)
	cal := newCalendar(t, app, "Team")
	addMember(t, app, cal.Id, alice, "owner")
	addMember(t, app, cal.Id, bob, "viewer")

	owners := calendarOwnerResolver(app, cal)
	if len(owners) != 2 {
		t.Fatalf("owners = %v, want both members", owners)
	}
	seen := map[string]bool{owners[0]: true, owners[1]: true}
	if !seen[alice] || !seen[bob] {
		t.Fatalf("owners = %v, want alice and bob", owners)
	}

	if owners := calendarOwnerResolver(app, nil); owners != nil {
		t.Errorf("nil record: got %v, want nil", owners)
	}
}

func TestCalendarOwnerResolver_NoMembersResolvesNil(t *testing.T) {
	app, _, _ := setupAutomationApp(t)
	cal := newCalendar(t, app, "Orphan")

	if owners := calendarOwnerResolver(app, cal); owners != nil {
		t.Fatalf("owners = %v, want nil for a calendar with no members", owners)
	}
}

// subscription_error changes in BOTH directions — the sync path clears it on
// every success — so a rule meant for failures must not fire on recovery.
func TestCalendarSyncFailed_OnlyFiresOnAnActualError(t *testing.T) {
	app, _, _ := setupAutomationApp(t)
	cal := newCalendar(t, app, "Feed")

	cal.Set("subscription_error", "HTTP 404 fetching feed")
	if err := app.Save(cal); err != nil {
		t.Fatalf("save: %v", err)
	}
	if !calendarSyncFailed(app, cal) {
		t.Error("a non-empty subscription_error must be admitted")
	}

	// The success path writes "" back; whitespace is treated the same way so
	// a provider echoing a blank line doesn't read as a failure.
	for _, cleared := range []string{"", "   "} {
		cal.Set("subscription_error", cleared)
		if err := app.Save(cal); err != nil {
			t.Fatalf("save: %v", err)
		}
		if calendarSyncFailed(app, cal) {
			t.Errorf("subscription_error %q must NOT be treated as a failure", cleared)
		}
	}

	if calendarSyncFailed(app, nil) {
		t.Error("a nil record must not be treated as a failure")
	}
}
