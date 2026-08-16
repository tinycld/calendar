package calendar

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"tinycld.org/core/rlstest"
)

// ics_endpoints_test.go covers GET /api/calendar/export and
// POST /api/calendar/import.
//
// These are RAW routes: PocketBase evaluates collection rules for
// /api/collections/... but not for anything bound on e.Router, so the rules
// proven by tenant_rules_authz_test.go do NOT apply here. Every access
// decision on these two endpoints is made by the Go in ics_endpoints.go, and
// these tests are the only thing holding it.
//
// Calendar's authorization is materially harder than contacts':
//
//   - Read is MEMBERSHIP (any role), write is OWNER-OR-EDITOR. A viewer who
//     may export a calendar must not be able to import into it. Contacts has
//     no such split — one `owner` field decides everything — so the contacts
//     endpoints are not a template for this half.
//   - calDAVSource carries NO ListFilter to copy. Its header says why: the
//     collection rules are the single definition, evaluated with
//     CanAccessRecord. These handlers do the same rather than re-deriving a
//     membership predicate in Go, which is the drift that header exists to
//     prevent.
//
// The app is built from the SHIPPED pb-migrations (rlstest) rather than a
// hand-declared schema, so a later migration that changes a rule turns these
// red instead of leaving them green against a stale local copy.

type icsEnv struct {
	app    *tests.TestApp
	router http.Handler

	calendar *core.Record
	other    *core.Record // a calendar the caller is not a member of

	owner    *core.Record
	editor   *core.Record
	viewer   *core.Record
	outsider *core.Record

	ownerToken    string
	editorToken   string
	viewerToken   string
	outsiderToken string
}

func setupICSApp(t *testing.T) *icsEnv {
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
	// `role` and `disabled` belong to core's users schema, which this module
	// does not carry; the shipped rules and the endpoints read both.
	users.Fields.Add(&core.SelectField{
		Name: "role", MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatalf("add users fields: %v", err)
	}

	rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb-migrations"))

	env := &icsEnv{app: app}
	env.calendar = calAuthzCalendar(t, app, "Team Cal")
	env.other = calAuthzCalendar(t, app, "Private Cal")

	env.owner = calGuestUser(t, app, "ics-owner@test.local", "member")
	env.editor = calGuestUser(t, app, "ics-editor@test.local", "member")
	env.viewer = calGuestUser(t, app, "ics-viewer@test.local", "member")
	env.outsider = calGuestUser(t, app, "ics-outsider@test.local", "member")

	calAuthzMember(t, app, env.calendar, env.owner, "owner")
	calAuthzMember(t, app, env.calendar, env.editor, "editor")
	calAuthzMember(t, app, env.calendar, env.viewer, "viewer")
	// The outsider owns an unrelated calendar, so "has no access" is proven
	// against a real user rather than one with no memberships at all.
	calAuthzMember(t, app, env.other, env.outsider, "owner")

	env.ownerToken = calAuthzToken(t, env.owner)
	env.editorToken = calAuthzToken(t, env.editor)
	env.viewerToken = calAuthzToken(t, env.viewer)
	env.outsiderToken = calAuthzToken(t, env.outsider)

	// Bind the real ical_uid hook rather than stamping UIDs by hand: the
	// export/import identity matches on that field, so a fixture that faked it
	// would hide a regression in the very thing the feature depends on.
	bindICalUIDHook(app)

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		bindICSEndpoints(app, e)
		return e.Next()
	})

	return env
}

// seedICSEvent writes a calendar_events row through the app, so the ical_uid
// create hook runs exactly as it does for a UI-created event.
func seedICSEvent(t *testing.T, env *icsEnv, cal *core.Record, title string, start time.Time) *core.Record {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("calendar_events")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("calendar", cal.Id)
	r.Set("created_by", env.owner.Id)
	r.Set("title", title)
	r.Set("start", start.UTC().Format("2006-01-02 15:04:05.000Z"))
	r.Set("end", start.Add(time.Hour).UTC().Format("2006-01-02 15:04:05.000Z"))
	r.Set("busy_status", "busy")
	r.Set("visibility", "default")
	if err := env.app.Save(r); err != nil {
		t.Fatalf("seed event %q: %v", title, err)
	}
	return r
}

// do performs an HTTP roundtrip against the test app's router. The router is
// built lazily and cached, mirroring the production lifecycle: built once,
// after every OnServe binder has registered.
func (env *icsEnv) do(t *testing.T, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	if env.router == nil {
		router, err := apis.NewRouter(env.app)
		if err != nil {
			t.Fatalf("apis.NewRouter: %v", err)
		}
		serveEvent := new(core.ServeEvent)
		serveEvent.App = env.app
		serveEvent.Router = router
		if err := env.app.OnServe().Trigger(serveEvent); err != nil {
			t.Fatalf("OnServe.Trigger: %v", err)
		}
		mux, err := router.BuildMux()
		if err != nil {
			t.Fatalf("BuildMux: %v", err)
		}
		env.router = mux
	}
	rec := httptest.NewRecorder()
	env.router.ServeHTTP(rec, req)
	return rec
}

func (env *icsEnv) exportReq(t *testing.T, token, calendarID string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/api/calendar/export"
	if calendarID != "" {
		url += "?calendar=" + calendarID
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	return env.do(t, req)
}

func (env *icsEnv) importReq(t *testing.T, token, calendarID, body string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if calendarID != "" {
		if err := mw.WriteField("calendar", calendarID); err != nil {
			t.Fatal(err)
		}
	}
	part, err := mw.CreateFormFile("file", "events.ics")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(body)); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/calendar/import", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	return env.do(t, req)
}

func decodeICSImport(t *testing.T, rec *httptest.ResponseRecorder) icsImportResult {
	t.Helper()
	var out icsImportResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode import response %q: %v", rec.Body.String(), err)
	}
	return out
}

// icsDoc builds a minimal but valid VCALENDAR carrying one VEVENT. Distinct
// from subscription_fetch_test.go's `vevent`, which builds a bare VEVENT for
// embedding in a larger document.
func icsDoc(uid, summary string) string {
	return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n" +
		"BEGIN:VEVENT\r\nUID:" + uid + "\r\n" +
		"DTSTAMP:20260801T090000Z\r\nDTSTART:20260801T100000Z\r\nDTEND:20260801T110000Z\r\n" +
		"SUMMARY:" + summary + "\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
}

// --- export ----------------------------------------------------------------

func TestICSExport_ReturnsCalendarWithEvents(t *testing.T) {
	env := setupICSApp(t)
	seedICSEvent(t, env, env.calendar, "Standup", time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC))
	seedICSEvent(t, env, env.calendar, "Retro", time.Date(2026, 8, 2, 10, 0, 0, 0, time.UTC))

	rec := env.exportReq(t, env.ownerToken, env.calendar.Id)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/calendar") {
		t.Errorf("Content-Type = %q, want text/calendar", ct)
	}
	body := rec.Body.String()
	for _, want := range []string{"BEGIN:VCALENDAR", "Standup", "Retro", "END:VCALENDAR"} {
		if !strings.Contains(body, want) {
			t.Errorf("export missing %q:\n%s", want, body)
		}
	}
	// One VCALENDAR wrapper, not one per event — a client parses the first
	// document and would silently drop the rest.
	if n := strings.Count(body, "BEGIN:VCALENDAR"); n != 1 {
		t.Errorf("export contains %d VCALENDAR blocks, want 1", n)
	}
	if n := strings.Count(body, "BEGIN:VEVENT"); n != 2 {
		t.Errorf("export contains %d VEVENTs, want 2", n)
	}
}

// A VIEWER may export: read access is membership, any role.
func TestICSExport_ViewerMayExport(t *testing.T) {
	env := setupICSApp(t)
	seedICSEvent(t, env, env.calendar, "Standup", time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC))

	rec := env.exportReq(t, env.viewerToken, env.calendar.Id)
	if rec.Code != http.StatusOK {
		t.Fatalf("a viewer must be able to export: status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Standup") {
		t.Error("viewer export returned no events")
	}
}

// THE SECURITY CASE. A calendar the caller is not a member of must not export,
// even though they are a perfectly valid signed-in user who owns other
// calendars.
func TestICSExport_NonMemberIsRefused(t *testing.T) {
	env := setupICSApp(t)
	seedICSEvent(t, env, env.calendar, "Secret Planning", time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC))

	rec := env.exportReq(t, env.outsiderToken, env.calendar.Id)
	if rec.Code == http.StatusOK {
		t.Fatalf("a non-member exported someone else's calendar: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "Secret Planning") {
		t.Fatal("a refused export leaked event data in its error body")
	}
}

func TestICSExport_AnonymousIsRefused(t *testing.T) {
	env := setupICSApp(t)
	seedICSEvent(t, env, env.calendar, "Standup", time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC))

	rec := env.exportReq(t, "", env.calendar.Id)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body %s", rec.Code, rec.Body.String())
	}
}

// A token minted before the account was disabled keeps working until it
// expires — coreserver's guard blocks issuance, not use. A raw route has no
// rule engine, so it must re-check the flag on the live record.
func TestICSExport_DisabledUserIsRefused(t *testing.T) {
	env := setupICSApp(t)
	seedICSEvent(t, env, env.calendar, "Standup", time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC))

	env.owner.Set("disabled", true)
	if err := env.app.Save(env.owner); err != nil {
		t.Fatal(err)
	}

	rec := env.exportReq(t, env.ownerToken, env.calendar.Id)
	if rec.Code == http.StatusOK {
		t.Fatalf("a disabled user exported: %s", rec.Body.String())
	}
}

func TestICSExport_UnknownCalendarIsRefused(t *testing.T) {
	env := setupICSApp(t)
	rec := env.exportReq(t, env.ownerToken, "does-not-exist")
	if rec.Code == http.StatusOK {
		t.Fatalf("unknown calendar exported 200: %s", rec.Body.String())
	}
}

func TestICSExport_RequiresCalendarParam(t *testing.T) {
	env := setupICSApp(t)
	rec := env.exportReq(t, env.ownerToken, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 without ?calendar=; body %s", rec.Code, rec.Body.String())
	}
}

// --- import ----------------------------------------------------------------

func TestICSImport_CreatesEvent(t *testing.T) {
	env := setupICSApp(t)

	rec := env.importReq(t, env.ownerToken, env.calendar.Id,
		icsDoc("urn:uuid:aaa-111", "Imported Meeting"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	result := decodeICSImport(t, rec)
	if result.Created != 1 || result.Failed != 0 {
		t.Fatalf("result = %+v, want 1 created", result)
	}

	events, err := env.app.FindRecordsByFilter("calendar_events",
		"calendar = {:c}", "", 0, 0, map[string]any{"c": env.calendar.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].GetString("title") != "Imported Meeting" {
		t.Fatalf("import did not create the event: %+v", events)
	}
}

// Re-importing your own export must not duplicate every event.
func TestICSImport_KnownUIDUpdatesRatherThanDuplicates(t *testing.T) {
	env := setupICSApp(t)

	first := env.importReq(t, env.ownerToken, env.calendar.Id, icsDoc("urn:uuid:bbb-222", "Original"))
	if r := decodeICSImport(t, first); r.Created != 1 {
		t.Fatalf("first import: %+v", r)
	}

	second := env.importReq(t, env.ownerToken, env.calendar.Id, icsDoc("urn:uuid:bbb-222", "Renamed"))
	result := decodeICSImport(t, second)
	if result.Updated != 1 || result.Created != 0 {
		t.Fatalf("re-import = %+v, want 1 updated / 0 created", result)
	}

	events, err := env.app.FindRecordsByFilter("calendar_events",
		"calendar = {:c}", "", 0, 0, map[string]any{"c": env.calendar.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("re-import duplicated: %d events", len(events))
	}
	if got := events[0].GetString("title"); got != "Renamed" {
		t.Errorf("title = %q, want the updated value", got)
	}
}

// THE WRITE-SIDE SECURITY CASE, and the one that makes calendar different from
// contacts: read is membership but write is owner-or-editor, so a VIEWER who
// may export must NOT be able to import.
func TestICSImport_ViewerIsRefused(t *testing.T) {
	env := setupICSApp(t)

	rec := env.importReq(t, env.viewerToken, env.calendar.Id, icsDoc("urn:uuid:ccc-333", "Sneaky"))
	if rec.Code == http.StatusOK {
		t.Fatalf("a viewer imported into a calendar they may only read: %s", rec.Body.String())
	}
	count, err := env.app.CountRecords("calendar_events")
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("a refused import still wrote %d event(s)", count)
	}
}

func TestICSImport_EditorMayImport(t *testing.T) {
	env := setupICSApp(t)

	rec := env.importReq(t, env.editorToken, env.calendar.Id, icsDoc("urn:uuid:ddd-444", "Editor Event"))
	if rec.Code != http.StatusOK {
		t.Fatalf("an editor must be able to import: status %d, body %s", rec.Code, rec.Body.String())
	}
	if r := decodeICSImport(t, rec); r.Created != 1 {
		t.Fatalf("result = %+v, want 1 created", r)
	}
}

func TestICSImport_NonMemberIsRefused(t *testing.T) {
	env := setupICSApp(t)

	rec := env.importReq(t, env.outsiderToken, env.calendar.Id, icsDoc("urn:uuid:eee-555", "Intrusion"))
	if rec.Code == http.StatusOK {
		t.Fatalf("a non-member imported: %s", rec.Body.String())
	}
}

func TestICSImport_DisabledUserIsRefused(t *testing.T) {
	env := setupICSApp(t)
	env.owner.Set("disabled", true)
	if err := env.app.Save(env.owner); err != nil {
		t.Fatal(err)
	}

	rec := env.importReq(t, env.ownerToken, env.calendar.Id, icsDoc("urn:uuid:fff-666", "Nope"))
	if rec.Code == http.StatusOK {
		t.Fatalf("a disabled user imported: %s", rec.Body.String())
	}
}

// idx_cal_events_ical_uid is GLOBALLY unique, but iCalendar UIDs are only
// unique within a calendar — two people are routinely sent the same invite.
// Keeping the UID would fail the save, letting whoever imported an event first
// permanently block everyone else from importing it. (This is the same defect
// the contacts vCard import had to fix.)
func TestICSImport_UIDHeldByAnotherCalendarStillImports(t *testing.T) {
	env := setupICSApp(t)

	// The outsider owns `other`, and imports an event there first.
	if r := decodeICSImport(t, env.importReq(t, env.outsiderToken, env.other.Id,
		icsDoc("urn:uuid:shared-777", "Their Copy"))); r.Created != 1 {
		t.Fatalf("seed import into the other calendar: %+v", r)
	}

	rec := env.importReq(t, env.ownerToken, env.calendar.Id,
		icsDoc("urn:uuid:shared-777", "My Copy"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	result := decodeICSImport(t, rec)
	if result.Created != 1 || result.Failed != 0 {
		t.Fatalf("result = %+v — a UID held by another calendar must not block the import", result)
	}

	mine, err := env.app.FindRecordsByFilter("calendar_events",
		"calendar = {:c}", "", 0, 0, map[string]any{"c": env.calendar.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(mine) != 1 || mine[0].GetString("title") != "My Copy" {
		t.Fatalf("the event did not land on my calendar: %+v", mine)
	}
	// And theirs must be untouched — a cross-calendar UID match would have
	// overwritten another calendar's event.
	theirs, err := env.app.FindRecordsByFilter("calendar_events",
		"calendar = {:c}", "", 0, 0, map[string]any{"c": env.other.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(theirs) != 1 || theirs[0].GetString("title") != "Their Copy" {
		t.Fatalf("the other calendar's event was modified: %+v", theirs)
	}
}

func TestICSImport_MalformedIsReportedNotFatal(t *testing.T) {
	env := setupICSApp(t)

	body := icsDoc("urn:uuid:ggg-888", "Good One") + "BEGIN:VCALENDAR\r\nnot an ical document\r\n"
	rec := env.importReq(t, env.ownerToken, env.calendar.Id, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("a malformed tail must not fail the request: status %d, body %s",
			rec.Code, rec.Body.String())
	}
	result := decodeICSImport(t, rec)
	if result.Created != 1 {
		t.Errorf("the valid event should still have imported: %+v", result)
	}
	if result.Failed == 0 || len(result.Errors) == 0 {
		t.Errorf("a malformed card must be reported, not silently dropped: %+v", result)
	}
}

func TestICSImport_RequiresCalendarParam(t *testing.T) {
	env := setupICSApp(t)
	rec := env.importReq(t, env.ownerToken, "", icsDoc("urn:uuid:hhh-999", "Homeless"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 without a calendar; body %s", rec.Code, rec.Body.String())
	}
}

func TestICSImport_MultipleEventsInOneDocument(t *testing.T) {
	env := setupICSApp(t)

	body := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n"
	for i := range 3 {
		body += fmt.Sprintf(
			"BEGIN:VEVENT\r\nUID:urn:uuid:multi-%d\r\nDTSTAMP:20260801T090000Z\r\n"+
				"DTSTART:2026080%dT100000Z\r\nDTEND:2026080%dT110000Z\r\nSUMMARY:Event %d\r\nEND:VEVENT\r\n",
			i, i+1, i+1, i)
	}
	body += "END:VCALENDAR\r\n"

	rec := env.importReq(t, env.ownerToken, env.calendar.Id, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	if r := decodeICSImport(t, rec); r.Created != 3 {
		t.Fatalf("result = %+v, want 3 created — every VEVENT in the document must import", r)
	}
}
