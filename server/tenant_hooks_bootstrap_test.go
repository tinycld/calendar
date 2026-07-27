package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
)

// The tenant configuration, end to end: shipped migrations + the package's
// real pb-hooks, and NO feature Go.
//
// This is what a hosted tenant actually runs, and until now nothing tested it.
// The existing suites bind the Go hooks (so they prove the single-tenant app
// is safe and say nothing about a tenant), while tenant_rules_authz_test.go
// binds nothing (so it proves the rules deny, but cannot show the feature
// still works).
//
// The specific question here: calendar_members' restored owner-check
// createRule cannot admit the FIRST membership on a new calendar — there is no
// owner yet to check against. Something privileged must write it, and in a
// tenant that something can only be a pb-hook.
func setupCalTenantWithHooks(t *testing.T) (*tests.TestApp, *core.Record, string) {
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
	users.Fields.Add(&core.SelectField{
		Name: "role", MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatal(err)
	}

	rlstest.ApplyWithHooks(t, app,
		rlstest.MigrationsDir(t, "../pb-hooks"),
		rlstest.MigrationsDir(t, "../pb-migrations"),
	)

	user := calGuestUser(t, app, "tenant-creator@test.local", "member")
	return app, user, calAuthzToken(t, user)
}

// A tenant user creates a calendar and ends up OWNING it — the property the
// restored rule breaks on its own and the pb-hook restores.
//
// Without the hook this calendar comes out with zero members: owned by nobody,
// manageable by nobody (proven by bootstrap_probe_test.go).
func TestCalTenantHooks_CalendarCreatorGetsOwnerMembership(t *testing.T) {
	app, user, token := setupCalTenantWithHooks(t)

	(&tests.ApiScenario{
		Name:                  "tenant user creates a calendar",
		Method:                http.MethodPost,
		URL:                   "/api/collections/calendar_calendars/records",
		Body:                  strings.NewReader(`{"name":"Hooked Cal","color":"blue"}`),
		Headers:               map[string]string{"Authorization": token, "Content-Type": "application/json"},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"name":"Hooked Cal"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			cal, err := app.FindFirstRecordByFilter("calendar_calendars",
				"name = {:n}", map[string]any{"n": "Hooked Cal"})
			if err != nil {
				t.Fatalf("calendar not created: %v", err)
			}
			rows, err := app.FindRecordsByFilter("calendar_members",
				"calendar = {:c}", "", 0, 0, map[string]any{"c": cal.Id})
			if err != nil {
				t.Fatal(err)
			}
			if len(rows) != 1 {
				t.Fatalf("expected exactly 1 owner membership, got %d — "+
					"a tenant calendar with no members is manageable by nobody", len(rows))
			}
			if got := rows[0].GetString("user"); got != user.Id {
				t.Fatalf("membership belongs to %q, want the creator %q", got, user.Id)
			}
			if got := rows[0].GetString("role"); got != "owner" {
				t.Fatalf("membership role = %q, want owner", got)
			}
		},
	}).Test(t)
}

// And the hook must not become a new way in. It bootstraps the CREATOR's own
// membership only; the takeover the rule exists to stop stays stopped.
func TestCalTenantHooks_OutsiderStillCannotSelfGrantOwnership(t *testing.T) {
	app, _, _ := setupCalTenantWithHooks(t)

	victim := calGuestUser(t, app, "victim@test.local", "member")
	attacker := calGuestUser(t, app, "attacker@test.local", "member")
	attackerToken := calAuthzToken(t, attacker)

	col, err := app.FindCollectionByNameOrId("calendar_calendars")
	if err != nil {
		t.Fatal(err)
	}
	cal := core.NewRecord(col)
	cal.Set("name", "Victim Cal")
	cal.Set("color", "blue")
	if err := app.Save(cal); err != nil {
		t.Fatal(err)
	}
	calAuthzMember(t, app, cal, victim, "owner")

	(&tests.ApiScenario{
		Name:   "attacker self-grants ownership with hooks loaded",
		Method: http.MethodPost,
		URL:    "/api/collections/calendar_members/records",
		Body: strings.NewReader(`{"calendar":"` + cal.Id +
			`","user":"` + attacker.Id + `","role":"owner"}`),
		Headers:               map[string]string{"Authorization": attackerToken, "Content-Type": "application/json"},
		ExpectedStatus:        400,
		ExpectedContent:       []string{`"message"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			rows, err := app.FindRecordsByFilter("calendar_members",
				"calendar = {:c} && user = {:u}", "", 0, 0,
				map[string]any{"c": cal.Id, "u": attacker.Id})
			if err != nil {
				t.Fatal(err)
			}
			if len(rows) != 0 {
				t.Fatal("attacker obtained a membership on someone else's calendar")
			}
		},
	}).Test(t)
}
