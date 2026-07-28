package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
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
// The rules under test are NOT restated here. They are applied by running
// calendar's real pb-migrations (rlstest), so a later migration that restates
// the createRule and drops the guest clause turns these tests red instead of
// leaving them validating a stale copy — the drift class that bit drive.
//
// Each scenario builds a FRESH TestApp (ApiScenario.Test re-triggers OnServe;
// reusing one app panics on duplicate route registration).

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

	// `role` and `disabled` belong to core's users schema, which this module
	// does not carry; the shipped rules read both.
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	users.Fields.Add(&core.SelectField{
		Name: "role", MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatalf("add users fields: %v", err)
	}

	rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb-migrations"))

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

// The clause the deny-test below depends on must be present in the SHIPPED
// rule — this names the predicate when a future migration restates the rule
// without it.
func TestCalGuestRLS_ShippedCreateRuleCarriesGuestClause(t *testing.T) {
	env := setupCalGuestApp(t)
	rlstest.RequireRuleContains(t, env.app, "calendar_calendars", "create",
		`@request.auth.role != "guest"`)
}

func TestCalGuestRLS_GuestCannotCreateCalendar(t *testing.T) {
	env := setupCalGuestApp(t)

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
