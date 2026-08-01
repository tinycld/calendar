package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
)

// member_repoint_rls_test.go proves calendar_members' updateRule pins a PATCH
// to the row's STORED calendar — against the real rule engine, with no Go
// hooks bound, which is exactly a hosted tenant's configuration.
//
// The gap: `viaOwner` evaluates the back-relation against the row's stored
// calendar, so an owner of ANY calendar could PATCH their own membership row
// with {"calendar": <victim>} — the rule checks ownership of the OLD calendar,
// the write lands on the victim's, and the row's role: "owner" comes along.
// The Go field-guard blocks this in the single-tenant app, but a tenant runs
// no feature Go: the rule is the entire authorization (see
// tenant_rules_authz_test.go), so the rule itself must carry the pin.
//
// These run against the SHIPPED migrations (rlstest), not a rule constant
// declared here, so a later migration that restates the rule without the pin
// turns them red.

type calRepointEnv struct {
	app           *tests.TestApp
	attackerCal   *core.Record
	victimCal     *core.Record
	attackerRow   *core.Record // attacker's own membership row (owner of attackerCal)
	attackerToken string
}

func setupCalRepointApp(t *testing.T) *calRepointEnv {
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

	attacker := calGuestUser(t, app, "repoint-attacker@test.local", "member")
	victim := calGuestUser(t, app, "repoint-victim@test.local", "member")

	attackerCal := calAuthzCalendar(t, app, "Attacker Cal")
	victimCal := calAuthzCalendar(t, app, "Victim Cal")
	attackerRow := calAuthzMember(t, app, attackerCal, attacker, "owner")
	calAuthzMember(t, app, victimCal, victim, "owner")

	return &calRepointEnv{
		app:           app,
		attackerCal:   attackerCal,
		victimCal:     victimCal,
		attackerRow:   attackerRow,
		attackerToken: calAuthzToken(t, attacker),
	}
}

func patchMembership(t *testing.T, env *calRepointEnv, rowID, body string, want int, content ...string) {
	t.Helper()
	expected := content
	if len(expected) == 0 {
		expected = []string{`"message"`}
	}
	(&tests.ApiScenario{
		Name:                  "PATCH calendar_members",
		Method:                http.MethodPatch,
		URL:                   "/api/collections/calendar_members/records/" + rowID,
		Body:                  strings.NewReader(body),
		Headers:               map[string]string{"Authorization": env.attackerToken, "Content-Type": "application/json"},
		ExpectedStatus:        want,
		ExpectedContent:       expected,
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// The pin the deny-test below depends on must be present in the SHIPPED rule.
func TestCalRepointRLS_ShippedUpdateRuleCarriesCalendarPin(t *testing.T) {
	env := setupCalRepointApp(t)
	rlstest.RequireRuleContains(t, env.app, "calendar_members", "update",
		`@request.body.calendar:isset = false || @request.body.calendar = calendar`)
}

// THE ATTACK. An owner of their own calendar repoints their membership row —
// role: "owner" intact — onto a victim's calendar. The rule engine must refuse
// with the same not-found it gives a row the caller cannot update at all.
func TestCalRepointRLS_OwnerCannotRepointOntoVictimCalendar(t *testing.T) {
	env := setupCalRepointApp(t)
	patchMembership(t, env, env.attackerRow.Id,
		`{"calendar":"`+env.victimCal.Id+`"}`, http.StatusNotFound)

	got, err := env.app.FindRecordById("calendar_members", env.attackerRow.Id)
	if err != nil {
		t.Fatal(err)
	}
	if cal := got.GetString("calendar"); cal != env.attackerCal.Id {
		t.Fatalf("membership repointed to %q, want %q", cal, env.attackerCal.Id)
	}
}

// An update that leaves the calendar out of the body is untouched by the pin.
func TestCalRepointRLS_OwnerCanStillUpdateWithoutCalendarField(t *testing.T) {
	env := setupCalRepointApp(t)
	patchMembership(t, env, env.attackerRow.Id,
		`{"color":"grape"}`, http.StatusOK, `"color":"grape"`)
}

// An update that restates the stored calendar verbatim also passes — clients
// commonly echo the full record back on PATCH.
func TestCalRepointRLS_OwnerCanRestateStoredCalendar(t *testing.T) {
	env := setupCalRepointApp(t)
	patchMembership(t, env, env.attackerRow.Id,
		`{"calendar":"`+env.attackerCal.Id+`","color":"green"}`, http.StatusOK, `"color":"green"`)
}
