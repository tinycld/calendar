package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
)

// For a request with no login, PocketBase resolves @request.auth.id to NULL,
// and its filter compiler turns `x = NULL` into `(x = '' OR x IS NULL)`. The
// back-relation `calendar_members_via_calendar.user ?= @request.auth.id` is a
// LEFT JOIN, so a calendar with ZERO member rows yields NULL there and matches
// the anonymous caller. `@request.auth.disabled != true` does not help: it is
// TRUE for an anonymous caller.
//
// A calendar loses its last member when that member deletes their account
// (the cascade removes the membership, not the calendar). Before 1830000010
// an anonymous caller could then list and view that calendar and every event
// on it, private events included, over REST and realtime.
//
// These run against the SHIPPED migrations (rlstest), so a later migration
// that restates a rule without the login guard turns them red.

type calAnonEnv struct {
	*calTenantEnv
	orphanCal   *core.Record
	orphanEvent *core.Record
}

func setupCalAnonApp(t *testing.T) *calAnonEnv {
	t.Helper()
	env := setupCalTenantApp(t)
	seedTenantEvent(t, env)

	orphanCal := calAuthzCalendar(t, env.app, "ORPHAN-CALENDAR")
	orphanEvent := seedAnonEvent(t, env, orphanCal, "ORPHAN-PRIVATE-EVENT", "private")

	return &calAnonEnv{calTenantEnv: env, orphanCal: orphanCal, orphanEvent: orphanEvent}
}

func seedAnonEvent(t *testing.T, env *calTenantEnv, cal *core.Record, title, visibility string) *core.Record {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("calendar_events")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("calendar", cal.Id)
	r.Set("title", title)
	r.Set("start", "2026-02-01 10:00:00.000Z")
	r.Set("end", "2026-02-01 11:00:00.000Z")
	r.Set("ical_uid", "urn:uuid:anon-test-"+cal.Id)
	r.Set("created_by", env.owner.Id)
	r.Set("busy_status", "busy")
	r.Set("visibility", visibility)
	if err := env.app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func anonScenario(env *calAnonEnv, method, url, token, body string, status int, expected, notExpected []string) *tests.ApiScenario {
	headers := map[string]string{"Content-Type": "application/json"}
	if token != "" {
		headers["Authorization"] = token
	}
	s := &tests.ApiScenario{
		Name:                  method + " " + url,
		Method:                method,
		URL:                   url,
		Headers:               headers,
		ExpectedStatus:        status,
		ExpectedContent:       expected,
		NotExpectedContent:    notExpected,
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	if body != "" {
		s.Body = strings.NewReader(body)
	}
	return s
}

func TestCalAnonRLS_AnonymousCannotListOrphanCalendar(t *testing.T) {
	env := setupCalAnonApp(t)
	anonScenario(env, http.MethodGet, "/api/collections/calendar_calendars/records", "", "",
		http.StatusOK, []string{`"totalItems":0`}, []string{"ORPHAN-CALENDAR", "Team Cal"}).Test(t)
}

func TestCalAnonRLS_AnonymousCannotViewOrphanCalendar(t *testing.T) {
	env := setupCalAnonApp(t)
	anonScenario(env, http.MethodGet, "/api/collections/calendar_calendars/records/"+env.orphanCal.Id, "", "",
		http.StatusNotFound, []string{`"data":{}`}, []string{"ORPHAN-CALENDAR"}).Test(t)
}

func TestCalAnonRLS_AnonymousCannotListOrphanEvents(t *testing.T) {
	env := setupCalAnonApp(t)
	anonScenario(env, http.MethodGet, "/api/collections/calendar_events/records", "", "",
		http.StatusOK, []string{`"totalItems":0`}, []string{"ORPHAN-PRIVATE-EVENT", "SECRET-EVENT-TITLE"}).Test(t)
}

func TestCalAnonRLS_AnonymousCannotViewOrphanEvent(t *testing.T) {
	env := setupCalAnonApp(t)
	anonScenario(env, http.MethodGet, "/api/collections/calendar_events/records/"+env.orphanEvent.Id, "", "",
		http.StatusNotFound, []string{`"data":{}`}, []string{"ORPHAN-PRIVATE-EVENT"}).Test(t)
}

// Positive controls: the guard must not cost a signed-in member their access.
// One scenario per test: an ApiScenario rebuilds the app's router, and a
// second one on the same app registers the routes twice.
func TestCalAnonRLS_MemberCanListOwnCalendar(t *testing.T) {
	env := setupCalAnonApp(t)
	anonScenario(env, http.MethodGet, "/api/collections/calendar_calendars/records", env.memberToken, "",
		http.StatusOK, []string{`"totalItems":1`, "Team Cal"}, []string{"ORPHAN-CALENDAR"}).Test(t)
}

func TestCalAnonRLS_MemberCanViewOwnCalendar(t *testing.T) {
	env := setupCalAnonApp(t)
	anonScenario(env, http.MethodGet, "/api/collections/calendar_calendars/records/"+env.calendar.Id, env.memberToken, "",
		http.StatusOK, []string{"Team Cal"}, nil).Test(t)
}

func TestCalAnonRLS_MemberCanListOwnEvents(t *testing.T) {
	env := setupCalAnonApp(t)
	seedAnonEvent(t, env.calTenantEnv, env.calendar, "OWN-PRIVATE-EVENT", "private")
	anonScenario(env, http.MethodGet, "/api/collections/calendar_events/records", env.memberToken, "",
		http.StatusOK, []string{`"totalItems":2`, "SECRET-EVENT-TITLE", "OWN-PRIVATE-EVENT"},
		[]string{"ORPHAN-PRIVATE-EVENT"}).Test(t)
}

func TestCalAnonRLS_MemberCanViewOwnEvent(t *testing.T) {
	env := setupCalAnonApp(t)
	own := seedAnonEvent(t, env.calTenantEnv, env.calendar, "OWN-PRIVATE-EVENT", "private")
	anonScenario(env, http.MethodGet, "/api/collections/calendar_events/records/"+own.Id, env.memberToken, "",
		http.StatusOK, []string{"OWN-PRIVATE-EVENT"}, nil).Test(t)
}

// Writes were already denied by the role checks (role ?= … is NULL for an
// orphan). Pin that so the read fix is not read as the only barrier.
func TestCalAnonRLS_AnonymousWritesDenied(t *testing.T) {
	cases := []struct {
		name   string
		method string
		url    func(env *calAnonEnv) string
		body   func(env *calAnonEnv) string
		status int
	}{
		{
			name: "create calendar", method: http.MethodPost,
			url:    func(*calAnonEnv) string { return "/api/collections/calendar_calendars/records" },
			body:   func(*calAnonEnv) string { return `{"name":"anon-cal","color":"blue"}` },
			status: http.StatusBadRequest,
		},
		{
			name: "update orphan calendar", method: http.MethodPatch,
			url: func(env *calAnonEnv) string {
				return "/api/collections/calendar_calendars/records/" + env.orphanCal.Id
			},
			body:   func(*calAnonEnv) string { return `{"name":"hijacked"}` },
			status: http.StatusNotFound,
		},
		{
			name: "delete orphan calendar", method: http.MethodDelete,
			url: func(env *calAnonEnv) string {
				return "/api/collections/calendar_calendars/records/" + env.orphanCal.Id
			},
			body:   func(*calAnonEnv) string { return "" },
			status: http.StatusNotFound,
		},
		{
			name: "claim orphan calendar as owner", method: http.MethodPost,
			url: func(*calAnonEnv) string { return "/api/collections/calendar_members/records" },
			body: func(env *calAnonEnv) string {
				return `{"calendar":"` + env.orphanCal.Id + `","user":"` + env.outsider.Id + `","role":"owner"}`
			},
			status: http.StatusBadRequest,
		},
		{
			name: "create event on orphan calendar", method: http.MethodPost,
			url: func(*calAnonEnv) string { return "/api/collections/calendar_events/records" },
			body: func(env *calAnonEnv) string {
				return `{"calendar":"` + env.orphanCal.Id + `","title":"anon",` +
					`"start":"2026-03-01 10:00:00.000Z","end":"2026-03-01 11:00:00.000Z",` +
					`"ical_uid":"urn:uuid:anon-write","created_by":"` + env.outsider.Id + `",` +
					`"busy_status":"busy","visibility":"default"}`
			},
			status: http.StatusBadRequest,
		},
		{
			name: "update orphan event", method: http.MethodPatch,
			url: func(env *calAnonEnv) string {
				return "/api/collections/calendar_events/records/" + env.orphanEvent.Id
			},
			body:   func(*calAnonEnv) string { return `{"title":"hijacked"}` },
			status: http.StatusNotFound,
		},
		{
			name: "delete orphan event", method: http.MethodDelete,
			url: func(env *calAnonEnv) string {
				return "/api/collections/calendar_events/records/" + env.orphanEvent.Id
			},
			body:   func(*calAnonEnv) string { return "" },
			status: http.StatusNotFound,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := setupCalAnonApp(t)
			anonScenario(env, tc.method, tc.url(env), "", tc.body(env), tc.status, []string{`"data":{}`}, nil).Test(t)

			stored, err := env.app.FindRecordById("calendar_events", env.orphanEvent.Id)
			if err != nil {
				t.Fatalf("orphan event gone after anonymous write: %v", err)
			}
			if stored.GetString("title") != "ORPHAN-PRIVATE-EVENT" {
				t.Fatalf("orphan event changed by anonymous write: %q", stored.GetString("title"))
			}
			if _, err := env.app.FindRecordById("calendar_calendars", env.orphanCal.Id); err != nil {
				t.Fatalf("orphan calendar gone after anonymous write: %v", err)
			}
		})
	}
}

// Every rule on every calendar collection must LEAD with the login guard, so
// no disjunct inside it can match a NULL @request.auth.id. A negative check
// such as `@request.auth.disabled != true` or `@request.auth.role != "guest"`
// is TRUE for an anonymous caller and is not a guard.
func TestCalAnonRLS_ShippedRulesLeadWithLoginGuard(t *testing.T) {
	env := setupCalTenantApp(t)
	const guard = `@request.auth.id != "" && `

	for _, col := range []string{"calendar_calendars", "calendar_members", "calendar_events"} {
		for _, kind := range []string{"list", "view", "create", "update", "delete"} {
			rule, ok := rlstest.Rule(t, env.app, col, kind)
			if !ok {
				continue
			}
			if !strings.HasPrefix(rule, guard) {
				t.Errorf("%s.%sRule does not lead with the login guard: %s", col, kind, rule)
			}
		}
	}
}
