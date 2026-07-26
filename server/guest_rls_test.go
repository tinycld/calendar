package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// guest_rls_test.go proves calendar_calendars' createRule against PocketBase's
// REAL rule engine: a role='guest' user must NOT be able to create calendars,
// while an ordinary member still can.
//
// Why the rule exists: a share-link visitor gets a real users record with
// role='guest'. calendar_calendars' createRule started as a bare authenticated
// check, and the OnRecordCreateRequest hook only auto-creates the owner
// membership AFTER e.Next() — it does not block the create — so an
// authenticated guest could mint calendars.
//
// Single-org: role lives on the users auth record, so the gate is a direct
// check against @request.auth.role. There is no org and no user_org junction.
//
// (calendar_members create is deliberately NOT gated by a PB rule: its rule is
// `@request.auth.id != ""` with the real owner-check enforced by the userIsOwner
// Go hook in register.go — a guest is never a calendar owner, so the hook
// already blocks them. Re-introducing a back-relation PB rule would hit the
// PB-evaluation bug that motivated migration 1715400000.)
//
// Each scenario builds a FRESH TestApp (ApiScenario.Test re-triggers OnServe;
// reusing one app panics on duplicate route registration).

// calCalendarsGuestCreateRule mirrors migration 1830000003 verbatim. Verified by
// neutering: replace it with an authenticated-only check and
// TestCalGuestRLS_GuestCannotCreateCalendar goes red.
const calCalendarsGuestCreateRule = `@request.auth.role != "guest"`

type calGuestEnv struct {
	app         *tests.TestApp
	memberToken string
	guestToken  string
}

func setupCalGuestApp(t *testing.T) *calGuestEnv {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	// role on the users auth collection is what the rule reads. The stock test
	// users collection has no such field, so add it here the way core's
	// migration does.
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	users.Fields.Add(&core.SelectField{
		Name: "role", MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	if err := app.Save(users); err != nil {
		t.Fatalf("add users.role: %v", err)
	}

	calendars := core.NewBaseCollection("calendar_calendars")
	calendars.Fields.Add(&core.TextField{Name: "name", Required: true})
	calendars.Fields.Add(&core.SelectField{
		Name: "color", Required: true, MaxSelect: 1,
		Values: []string{"blue", "green", "red", "teal", "purple", "orange"},
	})
	if err := app.Save(calendars); err != nil {
		t.Fatal(err)
	}

	member := calGuestUser(t, app, "member@test.local", "member")
	guest := calGuestUser(t, app, "guest@test.local", "guest")

	memberToken, err := member.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	guestToken, err := guest.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	return &calGuestEnv{app: app, memberToken: memberToken, guestToken: guestToken}
}

func calGuestUser(t *testing.T, app core.App, email, role string) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("users")
	r := core.NewRecord(col)
	r.SetEmail(email)
	r.Set("name", "Test")
	r.Set("role", role)
	r.SetVerified(true)
	r.SetPassword("Password123!")
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func setCalCreateRule(t *testing.T, app core.App) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("calendar_calendars")
	if err != nil {
		t.Fatal(err)
	}
	rule := calCalendarsGuestCreateRule
	col.CreateRule = &rule
	if err := app.Save(col); err != nil {
		t.Fatalf("set calendar_calendars createRule: %v", err)
	}
}

func TestCalGuestRLS_GuestCannotCreateCalendar(t *testing.T) {
	env := setupCalGuestApp(t)
	setCalCreateRule(t, env.app)

	scenario := &tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/collections/calendar_calendars/records",
		Body:                  strings.NewReader(`{"name":"Guest Cal","color":"blue"}`),
		Headers:               map[string]string{"Authorization": env.guestToken, "Content-Type": "application/json"},
		ExpectedStatus:        http.StatusBadRequest,
		ExpectedContent:       []string{`"message"`},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

func TestCalGuestRLS_MemberCanCreateCalendar(t *testing.T) {
	env := setupCalGuestApp(t)
	setCalCreateRule(t, env.app)

	scenario := &tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/collections/calendar_calendars/records",
		Body:                  strings.NewReader(`{"name":"Team Cal","color":"green"}`),
		Headers:               map[string]string{"Authorization": env.memberToken, "Content-Type": "application/json"},
		ExpectedStatus:        http.StatusOK,
		ExpectedContent:       []string{`"name":"Team Cal"`},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}
