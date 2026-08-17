package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// stamp renders a time the way the fake stores and filters on it — the same
// layout the CLI sends — so fixtures and filters cannot disagree.
func stamp(t time.Time) string {
	return t.UTC().Format(pbTimeLayout)
}

// book builds the standard fixture: two calendars the caller belongs to, with
// the caller an OWNER of Work and a VIEWER of Team.
//
//	Work  (calWork, owner)  — "Standup" tomorrow, "Retro" in 3 days
//	Team  (calTeam, viewer) — "All hands" in 2 days
//	                          "Last month" — outside every default window
func book(t *testing.T) *fakeCalendar {
	f := newFakeCalendar(t)
	f.addCalendar("calWork", "Work")
	f.addCalendar("calTeam", "Team")
	f.addMember("mbrW", "calWork", "owner")
	f.addMember("mbrT", "calTeam", "viewer")

	now := time.Now()
	f.addEvent("evtStandup", "calWork", "Standup", stamp(now.AddDate(0, 0, 1)))
	f.addEvent("evtRetro", "calWork", "Retro", stamp(now.AddDate(0, 0, 3)))
	f.addEvent("evtAllHands", "calTeam", "All hands", stamp(now.AddDate(0, 0, 2)))
	f.addEvent("evtOld", "calWork", "Last month", stamp(now.AddDate(0, 0, -30)))
	return f
}

func TestAgendaShowsUpcomingAcrossCalendars(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calendar", "agenda")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Standup", "Retro", "All hands"} {
		if !strings.Contains(out, want) {
			t.Errorf("agenda missing %q:\n%s", want, out)
		}
	}
	// The calendar name, not its id, is what identifies a row to a reader.
	if !strings.Contains(out, "Work") || !strings.Contains(out, "Team") {
		t.Errorf("agenda must name each event's calendar:\n%s", out)
	}
}

// An agenda is a forward window. A past event appearing in it is the failure
// that makes the command useless.
func TestAgendaExcludesPastAndBeyondWindow(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calendar", "agenda", "--days", "2")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "Last month") {
		t.Errorf("agenda included a past event:\n%s", out)
	}
	if strings.Contains(out, "Retro") {
		t.Errorf("--days 2 must exclude an event 3 days out:\n%s", out)
	}
	if !strings.Contains(out, "Standup") {
		t.Errorf("agenda dropped an event inside the window:\n%s", out)
	}
}

func TestAgendaScopedToOneCalendar(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calendar", "agenda", "--calendar", "Work")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "All hands") {
		t.Errorf("--calendar Work leaked an event from Team:\n%s", out)
	}
	if !strings.Contains(out, "Standup") {
		t.Errorf("--calendar Work dropped its own event:\n%s", out)
	}
}

// A calendar resolves by id OR name — the sidebar shows names, never ids, so
// requiring an id would mean opening the app to use the CLI.
func TestCalendarResolvesByIDAndName(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	for _, ref := range []string{"calWork", "Work", "work"} {
		out, _, err := runCmd(t, c, "calendar", "agenda", "--calendar", ref)
		if err != nil {
			t.Fatalf("--calendar %q: %v", ref, err)
		}
		if !strings.Contains(out, "Standup") {
			t.Errorf("--calendar %q resolved to the wrong calendar:\n%s", ref, out)
		}
	}
}

func TestUnknownCalendarFailsWithGuidance(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	_, _, err := runCmd(t, c, "calendar", "agenda", "--calendar", "Nope")
	if err == nil {
		t.Fatal("an unknown calendar must fail rather than silently listing everything")
	}
	if !strings.Contains(err.Error(), "calendar list") {
		t.Errorf("the error should point at `calendar list`, got: %v", err)
	}
}

// The caller's role decides whether writes will be accepted, so `list` shows
// it rather than letting a viewer discover it from a failed `add`.
func TestListShowsRole(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calendar", "list")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "owner") || !strings.Contains(out, "viewer") {
		t.Errorf("list must show the caller's role per calendar:\n%s", out)
	}
}

func TestListMarksSubscriptions(t *testing.T) {
	f := book(t)
	f.calendars["calTeam"].SubscriptionURL = "https://example.com/feed.ics"
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calendar", "list")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "subscription") {
		t.Errorf("a subscribed calendar must be marked as such:\n%s", out)
	}
}

func TestEventsUsesExplicitRange(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	// A window in the past must find the old event — which `agenda` cannot.
	from := time.Now().AddDate(0, 0, -60).Format("2006-01-02")
	to := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	out, _, err := runCmd(t, c, "calendar", "events", "--from", from, "--to", to)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Last month") {
		t.Errorf("an explicit past range must find a past event:\n%s", out)
	}
	if strings.Contains(out, "Standup") {
		t.Errorf("a past range must not include future events:\n%s", out)
	}
}

// An inverted range would come back empty, which reads as "nothing scheduled"
// rather than as the typo it is.
func TestEventsRejectsInvertedRange(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	_, _, err := runCmd(t, c, "calendar", "events", "--from", "2026-09-01", "--to", "2026-08-01")
	if err == nil {
		t.Fatal("--to before --from must fail rather than return an empty list")
	}
}

func TestShow(t *testing.T) {
	f := book(t)
	f.events["evtStandup"].Location = "Room 4"
	f.events["evtStandup"].Description = "Daily sync"
	f.events["evtStandup"].Guests = []guest{
		{Name: "Ada", Email: "ada@example.com", RSVP: "accepted", Role: "attendee"},
	}
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calendar", "show", "evtStandup")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Standup", "Room 4", "Daily sync", "ada@example.com", "accepted", "Work"} {
		if !strings.Contains(out, want) {
			t.Errorf("show missing %q:\n%s", want, out)
		}
	}
}

func TestAddRoundTripsFlags(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	_, _, err := runCmd(t, c, "calendar", "add",
		"--calendar", "Work", "--title", "Planning",
		"--start", "2026-09-01 14:30", "--end", "2026-09-01 16:00",
		"--location", "Room 2", "--description", "Q4 planning",
		"--guest", "ada@example.com", "--guest", "grace@example.com",
		"--recurrence", "weekly", "--reminder", "15", "--busy", "free")
	if err != nil {
		t.Fatal(err)
	}

	for key, want := range map[string]any{
		"calendar": "calWork", "title": "Planning", "location": "Room 2",
		"description": "Q4 planning", "recurrence": "weekly", "busy_status": "free",
		// Required selects with no schema default — omitting either is
		// rejected server-side as "cannot be blank".
		"visibility": "default",
		// A required relation the create rule does not default.
		"created_by": "user1",
	} {
		if got := f.lastCreate[key]; got != want {
			t.Errorf("create[%q] = %v, want %v", key, got, want)
		}
	}
	if got := f.lastCreate["reminder"]; got != float64(15) {
		t.Errorf("create[reminder] = %v, want 15", got)
	}

	guests, ok := f.lastCreate["guests"].([]any)
	if !ok || len(guests) != 2 {
		t.Fatalf("create[guests] = %v, want 2 guests", f.lastCreate["guests"])
	}
	first, _ := guests[0].(map[string]any)
	if first["email"] != "ada@example.com" || first["rsvp"] != "pending" {
		t.Errorf("a new guest must start pending, got %v", first)
	}
}

// Without --end an event lasts an hour, so a user does not have to compute one.
func TestAddDefaultsEndToOneHour(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calendar", "add",
		"--calendar", "Work", "--title", "Quick sync", "--start", "2026-09-01 09:00"); err != nil {
		t.Fatal(err)
	}
	start, _ := parseEventTime(str(f.lastCreate["start"]))
	end, _ := parseEventTime(str(f.lastCreate["end"]))
	if got := end.Sub(start); got != time.Hour {
		t.Errorf("default duration = %v, want 1h", got)
	}
}

// An all-day event runs to the next midnight, matching how the app stores one.
func TestAddAllDaySpansTheDay(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calendar", "add",
		"--calendar", "Work", "--title", "Offsite", "--start", "2026-09-01", "--all-day"); err != nil {
		t.Fatal(err)
	}
	if f.lastCreate["all_day"] != true {
		t.Errorf("all_day = %v, want true", f.lastCreate["all_day"])
	}
	start, _ := parseEventTime(str(f.lastCreate["start"]))
	end, _ := parseEventTime(str(f.lastCreate["end"]))
	if got := end.Sub(start); got != 24*time.Hour {
		t.Errorf("all-day duration = %v, want 24h", got)
	}
}

func TestAddValidatesFlags(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	cases := [][]string{
		{"calendar", "add", "--title", "No calendar", "--start", "2026-09-01"},
		{"calendar", "add", "--calendar", "Work", "--start", "2026-09-01"},
		{"calendar", "add", "--calendar", "Work", "--title", "No start"},
		{"calendar", "add", "--calendar", "Work", "--title", "Bad recurrence", "--start", "2026-09-01", "--recurrence", "fortnightly"},
		{"calendar", "add", "--calendar", "Work", "--title", "Bad busy", "--start", "2026-09-01", "--busy", "perhaps"},
		{"calendar", "add", "--calendar", "Work", "--title", "Bad time", "--start", "next tuesday"},
		{"calendar", "add", "--calendar", "Work", "--title", "Backwards", "--start", "2026-09-02", "--end", "2026-09-01"},
	}
	for _, args := range cases {
		if _, _, err := runCmd(t, c, args...); err == nil {
			t.Errorf("expected a failure for %v", args)
		}
	}
}

func TestRmDeletesAfterConfirmation(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calendar", "rm", "evtStandup", "--yes"); err != nil {
		t.Fatal(err)
	}
	if len(f.deleted) != 1 || f.deleted[0] != "evtStandup" {
		t.Fatalf("deleted = %v, want [evtStandup]", f.deleted)
	}
}

// Without --yes on a non-TTY the command must refuse rather than hang or
// silently proceed. Events have no trash, so this is the only guard.
func TestRmWithoutYesRefuses(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calendar", "rm", "evtStandup"); err == nil {
		t.Fatal("rm without --yes on a non-TTY must refuse")
	}
	if len(f.deleted) != 0 {
		t.Errorf("a refused rm still deleted %v", f.deleted)
	}
}

func TestRSVPUpdatesOnlyMyEntry(t *testing.T) {
	f := book(t)
	f.events["evtStandup"].Guests = []guest{
		{Email: "ada@example.com", RSVP: "accepted", Role: "attendee"},
		{Email: "user1@example.com", RSVP: "pending", Role: "attendee"},
	}
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calendar", "rsvp", "evtStandup", "yes"); err != nil {
		t.Fatal(err)
	}

	guests := f.events["evtStandup"].Guests
	if len(guests) != 2 {
		t.Fatalf("rsvp changed the guest count: %v", guests)
	}
	if guests[0].RSVP != "accepted" || guests[0].Email != "ada@example.com" {
		t.Errorf("rsvp modified another guest's answer: %v", guests[0])
	}
	if guests[1].RSVP != "accepted" {
		t.Errorf("my rsvp = %q, want accepted", guests[1].RSVP)
	}
}

// "maybe" is the word people type; "tentative" is what the schema stores.
func TestRSVPMapsAnswers(t *testing.T) {
	for answer, want := range map[string]string{
		"yes": "accepted", "no": "declined", "maybe": "tentative",
	} {
		f := book(t)
		f.events["evtStandup"].Guests = []guest{{Email: "user1@example.com", RSVP: "pending"}}
		_, c := f.serve()

		if _, _, err := runCmd(t, c, "calendar", "rsvp", "evtStandup", answer); err != nil {
			t.Fatalf("rsvp %s: %v", answer, err)
		}
		if got := f.events["evtStandup"].Guests[0].RSVP; got != want {
			t.Errorf("rsvp %s stored %q, want %q", answer, got, want)
		}
	}
}

func TestRSVPRejectsUnknownAnswer(t *testing.T) {
	f := book(t)
	_, c := f.serve()
	if _, _, err := runCmd(t, c, "calendar", "rsvp", "evtStandup", "probably"); err == nil {
		t.Fatal("an unknown answer must fail")
	}
}

// Silently adding the caller to the guest list would be a different action
// from answering an invitation — say so instead.
func TestRSVPWhenNotInvitedFails(t *testing.T) {
	f := book(t)
	f.events["evtStandup"].Guests = []guest{{Email: "ada@example.com", RSVP: "pending"}}
	_, c := f.serve()

	_, _, err := runCmd(t, c, "calendar", "rsvp", "evtStandup", "yes")
	if err == nil {
		t.Fatal("rsvp on an event you are not invited to must fail")
	}
	if f.lastPatch != nil {
		t.Errorf("a refused rsvp still sent a patch: %v", f.lastPatch)
	}
}

func TestExportWritesFile(t *testing.T) {
	f := book(t)
	_, c := f.serve()
	dest := filepath.Join(t.TempDir(), "work.ics")

	if _, _, err := runCmd(t, c, "calendar", "export", "--calendar", "Work", "--out", dest); err != nil {
		t.Fatal(err)
	}
	if got := f.exportQuery.Get("calendar"); got != "calWork" {
		t.Errorf("export sent calendar=%q, want the resolved id calWork", got)
	}
	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("export --out wrote no file: %v", err)
	}
	body := string(data)
	if !strings.Contains(body, "BEGIN:VCALENDAR") || !strings.Contains(body, "Standup") {
		t.Errorf("exported file is not the served payload:\n%s", body)
	}
	if strings.Contains(body, "All hands") {
		t.Errorf("export leaked an event from another calendar:\n%s", body)
	}
}

func TestExportWithoutOutWritesStdout(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calendar", "export", "--calendar", "Work")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "BEGIN:VCALENDAR") {
		t.Errorf("export without --out must stream to stdout:\n%s", out)
	}
}

func TestExportRequiresCalendar(t *testing.T) {
	f := book(t)
	_, c := f.serve()
	if _, _, err := runCmd(t, c, "calendar", "export"); err == nil {
		t.Fatal("export without --calendar must fail rather than guess one")
	}
}

// The uploaded bytes must be the file's bytes. An iCalendar document is
// line-oriented and CRLF-delimited; a transport that re-encoded it would
// import garbage.
func TestImportUploadsFileVerbatim(t *testing.T) {
	f := book(t)
	f.importResp = icsImportResult{Created: 1, Updated: 2}
	_, c := f.serve()

	ics := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:u1\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
	src := filepath.Join(t.TempDir(), "in.ics")
	if err := os.WriteFile(src, []byte(ics), 0o600); err != nil {
		t.Fatal(err)
	}

	_, errOut, err := runCmd(t, c, "calendar", "import", "--calendar", "Work", src)
	if err != nil {
		t.Fatal(err)
	}
	if f.importBody != ics {
		t.Errorf("uploaded body = %q, want the file verbatim %q", f.importBody, ics)
	}
	if got := f.importQuery.Get("calendar"); got != "calWork" {
		t.Errorf("import sent calendar=%q, want the resolved id calWork", got)
	}
	if !strings.Contains(errOut, "1") || !strings.Contains(errOut, "2") {
		t.Errorf("import must report created/updated counts, got: %s", errOut)
	}
}

// A partial import must say so. Reporting only a count would let a user
// believe a file imported cleanly when half of it did not.
func TestImportReportsPerEventFailures(t *testing.T) {
	f := book(t)
	f.importResp = icsImportResult{
		Created: 1, Failed: 1,
		Errors: []string{"document 1, event Broken: malformed iCalendar"},
	}
	_, c := f.serve()

	src := filepath.Join(t.TempDir(), "in.ics")
	if err := os.WriteFile(src, []byte("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, errOut, err := runCmd(t, c, "calendar", "import", "--calendar", "Work", src)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(errOut, "malformed iCalendar") {
		t.Errorf("a skipped event must be named, got: %s", errOut)
	}
}

func TestImportMissingFileFails(t *testing.T) {
	f := book(t)
	_, c := f.serve()
	missing := filepath.Join(t.TempDir(), "nope.ics")
	if _, _, err := runCmd(t, c, "calendar", "import", "--calendar", "Work", missing); err == nil {
		t.Fatal("import of a missing file must fail")
	}
}

func TestJSONOutputIsStable(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calendar", "list", "--json")
	if err != nil {
		t.Fatal(err)
	}
	var calendars []calendar
	if err := json.Unmarshal([]byte(out), &calendars); err != nil {
		t.Fatalf("--json output is not a stable JSON array: %v\n%s", err, out)
	}
	if len(calendars) != 2 {
		t.Errorf("--json returned %d calendars, want 2", len(calendars))
	}
}

// Every column the table renders must be reachable from --json.
//
// ROLE and KIND are joined/derived at render time, so they live on the row
// wrapper rather than the record. Without them a script cannot answer "which
// calendars may I write to" at all — it would have to parse the table, and the
// live smoke test had to do exactly that. `o.Write` takes the headers and the
// JSON payload as separate arguments, so nothing but a test keeps them in step.
func TestListJSONCarriesRoleAndKind(t *testing.T) {
	f := book(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calendar", "list", "--json")
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Role string `json:"role"`
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal([]byte(out), &rows); err != nil {
		t.Fatalf("--json is not a stable array: %v\n%s", err, out)
	}
	for _, r := range rows {
		if r.Role == "" {
			t.Errorf("calendar %q carries no role in --json; the table has a ROLE column", r.Name)
		}
		if r.Kind == "" {
			t.Errorf("calendar %q carries no kind in --json; the table has a KIND column", r.Name)
		}
		// The record's own fields must survive the wrapper.
		if r.ID == "" || r.Name == "" {
			t.Errorf("the row wrapper dropped a record field: %+v", r)
		}
	}
}

// Same contract for the event listings and `show`: the CALENDAR column renders
// a name resolved from a separate lookup, while the record holds only the id.
func TestEventJSONCarriesCalendarName(t *testing.T) {
	for _, args := range [][]string{
		{"calendar", "agenda", "--days", "3650", "--json"},
		{"calendar", "events", "--from", "2020-01-01", "--to", "2030-01-01", "--json"},
	} {
		t.Run(args[1], func(t *testing.T) {
			f := book(t)
			_, c := f.serve()

			out, _, err := runCmd(t, c, args...)
			if err != nil {
				t.Fatal(err)
			}
			var rows []struct {
				ID           string `json:"id"`
				Calendar     string `json:"calendar"`
				CalendarName string `json:"calendar_name"`
			}
			if err := json.Unmarshal([]byte(out), &rows); err != nil {
				t.Fatalf("--json is not a stable array: %v\n%s", err, out)
			}
			if len(rows) == 0 {
				t.Fatal("no events returned; the fixture should carry some")
			}
			for _, r := range rows {
				if r.CalendarName == "" {
					t.Errorf("event %q carries no calendar_name; the table has a CALENDAR column", r.ID)
				}
				if r.Calendar == "" {
					t.Errorf("the row wrapper dropped the calendar id: %+v", r)
				}
			}
		})
	}
}
