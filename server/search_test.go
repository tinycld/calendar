package calendar

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"tinycld.org/core/search"
)

// setupEventSearchApp builds the minimal schema fts.Search reads for calendar:
// users with a `disabled` flag (the disabled-account check queries it),
// calendar_calendars, calendar_members, calendar_events, and the FTS virtual
// table. Mirrors cards' setupSearchApp — the two packages share the membership
// scope shape, so they need the same fixture skeleton.
func setupEventSearchApp(t *testing.T) *tests.TestApp {
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
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatalf("add users.disabled: %v", err)
	}

	calendars := core.NewBaseCollection("calendar_calendars")
	calendars.Id = "pbc_cal_calendars_01"
	calendars.Fields.Add(&core.TextField{Name: "name", Required: true})
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
	if err := app.Save(members); err != nil {
		t.Fatal(err)
	}

	events := core.NewBaseCollection("calendar_events")
	events.Fields.Add(&core.RelationField{
		Name: "calendar", Required: true, CollectionId: calendars.Id, MaxSelect: 1,
	})
	events.Fields.Add(&core.TextField{Name: "title", Required: true})
	events.Fields.Add(&core.TextField{Name: "description"})
	events.Fields.Add(&core.TextField{Name: "location"})
	events.Fields.Add(&core.TextField{Name: "start"})
	if err := app.Save(events); err != nil {
		t.Fatal(err)
	}

	if _, err := app.DB().NewQuery(`
		CREATE VIRTUAL TABLE IF NOT EXISTS fts_calendar_events USING fts5(
			record_id UNINDEXED, title, description, location,
			tokenize='porter unicode61'
		)
	`).Execute(); err != nil {
		t.Fatal(err)
	}

	return app
}

// seedEvent creates a calendar with one member and one indexed event, plus a
// second user who is NOT a member. Returns (member, outsider, eventID).
func seedEvent(t *testing.T, app *tests.TestApp, title, description, location string) (string, string, string) {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	newUser := func(email string) string {
		u := core.NewRecord(users)
		u.Set("email", email)
		u.Set("password", "1234567890")
		if err := app.Save(u); err != nil {
			t.Fatal(err)
		}
		return u.Id
	}
	member := newUser("member@example.com")
	outsider := newUser("outsider@example.com")

	calendars, err := app.FindCollectionByNameOrId("calendar_calendars")
	if err != nil {
		t.Fatal(err)
	}
	cal := core.NewRecord(calendars)
	cal.Set("name", "Team")
	if err := app.Save(cal); err != nil {
		t.Fatal(err)
	}

	membersColl, err := app.FindCollectionByNameOrId("calendar_members")
	if err != nil {
		t.Fatal(err)
	}
	m := core.NewRecord(membersColl)
	m.Set("calendar", cal.Id)
	m.Set("user", member)
	if err := app.Save(m); err != nil {
		t.Fatal(err)
	}

	events, err := app.FindCollectionByNameOrId("calendar_events")
	if err != nil {
		t.Fatal(err)
	}
	ev := core.NewRecord(events)
	ev.Set("calendar", cal.Id)
	ev.Set("title", title)
	ev.Set("description", description)
	ev.Set("location", location)
	ev.Set("start", "2026-09-01 15:00:00Z")
	if err := app.Save(ev); err != nil {
		t.Fatal(err)
	}

	if _, err := app.DB().NewQuery(`
		INSERT INTO fts_calendar_events (record_id, title, description, location)
		VALUES ({:id}, {:t}, {:d}, {:l})
	`).Bind(map[string]any{"id": ev.Id, "t": title, "d": description, "l": location}).
		Execute(); err != nil {
		t.Fatal(err)
	}

	return member, outsider, ev.Id
}

func TestSearchEventsMapsHitsToRows(t *testing.T) {
	app := setupEventSearchApp(t)
	member, _, eventID := seedEvent(t, app, "Quarterly review", "budget walkthrough", "Room 4")

	result, err := searchEvents(app, member, search.Query{Include: []string{"quarterly"}, Limit: 25})
	if err != nil {
		t.Fatalf("searchEvents: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("rows = %+v, want one", result.Rows)
	}
	row := result.Rows[0]
	if row.ID != eventID {
		t.Errorf("id = %q, want %q", row.ID, eventID)
	}
	if row.Title != "Quarterly review" {
		t.Errorf("title = %q", row.Title)
	}
	// When an event happens is what distinguishes it from the other four
	// standups with the same name.
	if row.Meta != "2026-09-01 15:00:00Z" {
		t.Errorf("meta = %q, want the start time", row.Meta)
	}
	if row.Subtitle != "Room 4" {
		t.Errorf("subtitle = %q, want the location", row.Subtitle)
	}
	if result.Total != 1 {
		t.Errorf("total = %d", result.Total)
	}
}

func TestSearchEventsMatchesDescriptionAndLocation(t *testing.T) {
	// Location is indexed because "where" is often the only thing anyone
	// remembers about a meeting; description because agendas are searchable.
	app := setupEventSearchApp(t)
	member, _, _ := seedEvent(t, app, "Standup", "discuss the migration", "Basement")

	for _, term := range []string{"migration", "basement"} {
		result, err := searchEvents(app, member, search.Query{Include: []string{term}, Limit: 25})
		if err != nil {
			t.Fatalf("searchEvents(%q): %v", term, err)
		}
		if len(result.Rows) != 1 {
			t.Errorf("%q matched %d rows, want 1", term, len(result.Rows))
		}
	}
}

func TestSearchEventsRespectsCalendarMembership(t *testing.T) {
	// The aggregator hands the source a user id and trusts it to scope. A
	// non-member must see nothing.
	app := setupEventSearchApp(t)
	_, outsider, _ := seedEvent(t, app, "Quarterly review", "", "")

	result, err := searchEvents(app, outsider, search.Query{Include: []string{"quarterly"}, Limit: 25})
	if err != nil {
		t.Fatalf("searchEvents: %v", err)
	}
	if len(result.Rows) != 0 {
		t.Fatalf("a non-member got %+v, want nothing", result.Rows)
	}
}

func TestSearchEventsExcludesTerms(t *testing.T) {
	app := setupEventSearchApp(t)
	member, _, _ := seedEvent(t, app, "Quarterly review", "budget walkthrough", "")

	result, err := searchEvents(app, member, search.Query{
		Include: []string{"quarterly"}, Exclude: []string{"budget"}, Limit: 25,
	})
	if err != nil {
		t.Fatalf("searchEvents: %v", err)
	}
	if len(result.Rows) != 0 {
		t.Fatalf("rows = %+v, want none once a matching term is excluded", result.Rows)
	}
}

func TestSearchEventsTitlesATitlelessRow(t *testing.T) {
	// calendar_events.title is `required, min: 1`, so no validated write can
	// produce an empty one — unlike cards, whose title is optional. What IS
	// reachable is an event whose stored title went missing: a direct SQL write
	// or a partially-failed migration. The placeholder covers that, because a
	// blank row would be unreadable and unclickable in both the palette and the
	// CLI.
	app := setupEventSearchApp(t)
	member, _, eventID := seedEvent(t, app, "Quarterly review", "budget walkthrough", "")

	if _, err := app.DB().NewQuery(
		`UPDATE calendar_events SET title = '' WHERE id = {:id}`,
	).Bind(map[string]any{"id": eventID}).Execute(); err != nil {
		t.Fatal(err)
	}

	result, err := searchEvents(app, member, search.Query{Include: []string{"budget"}, Limit: 25})
	if err != nil {
		t.Fatalf("searchEvents: %v", err)
	}
	if len(result.Rows) != 1 || result.Rows[0].Title != "Untitled event" {
		t.Fatalf("rows = %+v, want the placeholder title", result.Rows)
	}
}

func TestSearchSourceDeclaresItsRegistration(t *testing.T) {
	// The slug labels rows and the scope gates OAuth callers; a typo in either
	// is invisible until an integration silently sees nothing.
	src := searchSource()
	if src.Slug != "calendar" {
		t.Errorf("slug = %q", src.Slug)
	}
	if src.Search == nil {
		t.Error("a source with no Search cannot produce rows")
	}
	if len(src.Scopes) != 1 || src.Scopes[0] != "calendar:read" {
		t.Errorf("scopes = %v, want [calendar:read]", src.Scopes)
	}
}
