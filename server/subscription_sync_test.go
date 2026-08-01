package calendar

import (
	"io"
	"strings"
	"testing"

	"github.com/emersion/go-ical"
	"github.com/pocketbase/pocketbase/core"
)

// These tests drive applyFeed — the seam between fetching a subscription feed
// and writing its events — against the SHIPPED migrations (setupCalTenantApp
// applies them via rlstest), because both bugs under test live in the schema's
// interaction with the sync: the ical_uid unique index and the required
// selects with no schema default. fetchICS is deliberately not involved; it
// rejects loopback by design, and the SSRF suite covers it.

func parseFeed(t *testing.T, ics string) []ical.Event {
	t.Helper()
	dec := ical.NewDecoder(strings.NewReader(ics))
	var events []ical.Event
	for {
		cal, err := dec.Decode()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("parse feed: %v", err)
		}
		events = append(events, cal.Events()...)
	}
	return events
}

func feedWith(t *testing.T, uids ...string) []ical.Event {
	t.Helper()
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n")
	for _, uid := range uids {
		b.WriteString("BEGIN:VEVENT\r\n")
		b.WriteString("UID:" + uid + "\r\n")
		b.WriteString("DTSTAMP:20990101T000000Z\r\n")
		b.WriteString("DTSTART:20260801T100000Z\r\n")
		b.WriteString("DTEND:20260801T110000Z\r\n")
		b.WriteString("SUMMARY:Feed event " + uid + "\r\n")
		b.WriteString("END:VEVENT\r\n")
	}
	b.WriteString("END:VCALENDAR\r\n")
	return parseFeed(t, b.String())
}

// seedUIEvent creates an event the way the web UI does: a validated save,
// with the ical_uid the create hook would generate.
func seedUIEvent(t *testing.T, app core.App, calID, ownerID, title string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("calendar_events")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("calendar", calID)
	r.Set("created_by", ownerID)
	r.Set("title", title)
	r.Set("start", "2026-08-15 09:00:00.000Z")
	r.Set("end", "2026-08-15 10:00:00.000Z")
	r.Set("busy_status", "busy")
	r.Set("visibility", "default")
	r.Set("ical_uid", "urn:uuid:local-"+title)
	if err := app.Save(r); err != nil {
		t.Fatalf("seed UI event: %v", err)
	}
	return r
}

func eventUIDs(t *testing.T, app core.App, calID string) map[string]bool {
	t.Helper()
	records, err := app.FindRecordsByFilter("calendar_events",
		"calendar = {:c}", "", 0, 0, map[string]any{"c": calID})
	if err != nil {
		t.Fatal(err)
	}
	uids := make(map[string]bool, len(records))
	for _, r := range records {
		uids[r.GetString("ical_uid")] = true
	}
	return uids
}

// Subscribing a populated calendar must not delete the user's own events.
// The prune step used to remove every event whose ical_uid was absent from
// the feed — and UI-created events all carry generated UIDs, so pointing a
// populated calendar at any feed silently destroyed its contents.
func TestApplyFeed_PreservesLocalEvents(t *testing.T) {
	env := setupCalTenantApp(t)
	local := seedUIEvent(t, env.app, env.calendar.Id, env.owner.Id, "mine")

	if err := applyFeed(env.app, env.calendar, feedWith(t, "feed-1@example.com")); err != nil {
		t.Fatalf("applyFeed: %v", err)
	}

	uids := eventUIDs(t, env.app, env.calendar.Id)
	if !uids[local.GetString("ical_uid")] {
		t.Fatalf("sync deleted the user's own event; remaining uids: %v", uids)
	}
	if !uids["feed-1@example.com"] {
		t.Fatalf("feed event was not imported; uids: %v", uids)
	}
}

// Events the SYNC created must still be pruned when they leave the feed —
// the guard against overcorrecting the preservation fix into never pruning.
func TestApplyFeed_PrunesDepartedFeedEvents(t *testing.T) {
	env := setupCalTenantApp(t)

	if err := applyFeed(env.app, env.calendar, feedWith(t, "a@example.com", "b@example.com")); err != nil {
		t.Fatalf("first sync: %v", err)
	}
	if err := applyFeed(env.app, env.calendar, feedWith(t, "a@example.com")); err != nil {
		t.Fatalf("second sync: %v", err)
	}

	uids := eventUIDs(t, env.app, env.calendar.Id)
	if uids["b@example.com"] {
		t.Fatal("event that left the feed was not pruned")
	}
	if !uids["a@example.com"] {
		t.Fatal("event still in the feed was pruned")
	}
}

// Two calendars may subscribe to the same feed. The ical_uid unique index was
// global while the contract (Source.Event comments) is per-calendar, so the
// second calendar's inserts violated the index, the error was swallowed, and
// the calendar silently stayed empty while the sync reported success.
func TestApplyFeed_TwoCalendarsShareAFeed(t *testing.T) {
	env := setupCalTenantApp(t)
	cal2 := calAuthzCalendar(t, env.app, "Second Cal")
	calAuthzMember(t, env.app, cal2, env.owner, "owner")

	feed := feedWith(t, "shared@example.com")
	if err := applyFeed(env.app, env.calendar, feed); err != nil {
		t.Fatalf("first calendar: %v", err)
	}
	if err := applyFeed(env.app, cal2, feed); err != nil {
		t.Fatalf("second calendar sync errored: %v", err)
	}

	if !eventUIDs(t, env.app, env.calendar.Id)["shared@example.com"] {
		t.Fatal("first calendar missing the feed event")
	}
	if !eventUIDs(t, env.app, cal2.Id)["shared@example.com"] {
		t.Fatal("second calendar silently stayed empty — the ical_uid index is not per-calendar")
	}
}

// A synced create must stamp Source.Event.Defaults the way a CalDAV PUT does.
// SaveNoValidate persisted visibility="" / busy_status="", which a later
// validated save (a user editing the event) rejects on fields they never
// touched.
func TestApplyFeed_AppliesEventDefaults(t *testing.T) {
	env := setupCalTenantApp(t)

	if err := applyFeed(env.app, env.calendar, feedWith(t, "min@example.com")); err != nil {
		t.Fatalf("applyFeed: %v", err)
	}

	evt, err := env.app.FindFirstRecordByFilter("calendar_events",
		"ical_uid = {:u}", map[string]any{"u": "min@example.com"})
	if err != nil {
		t.Fatalf("imported event not found: %v", err)
	}
	if got := evt.GetString("busy_status"); got != "busy" {
		t.Fatalf("busy_status = %q, want the busy default", got)
	}
	if got := evt.GetString("visibility"); got != "default" {
		t.Fatalf("visibility = %q, want the default default", got)
	}
	// A user editing the imported event goes through a validated save; it
	// must not be rejected on fields the sync should have defaulted.
	evt.Set("title", "edited")
	if err := env.app.Save(evt); err != nil {
		t.Fatalf("validated save of an imported event failed: %v", err)
	}
}
