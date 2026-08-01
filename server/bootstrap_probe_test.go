package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// Does restoring the owner-check createRule leave a tenant unable to create a
// USABLE calendar?
//
// The concern: the rule admits a membership only when the caller already owns
// the calendar, so the FIRST owner membership has no prior owner to check
// against. In the app a Go hook writes that first row with app.Save (which
// bypasses rules); a tenant runs no feature Go.
//
// Answered by measurement rather than argument. One ApiScenario per app:
// ApiScenario.Test re-triggers OnServe, so two in one test panic on duplicate
// route registration.

// Step 1: a tenant user CAN create a calendar — createRule is
// `authed && !guest && enabled`. It also records how many membership rows
// exist afterwards, which is the number that matters.
func TestBootstrapProbe_TenantCanCreateCalendarButGetsNoMembership(t *testing.T) {
	env := setupCalTenantApp(t)
	fresh := calGuestUser(t, env.app, "fresh@test.local", "member")
	token := calAuthzToken(t, fresh)

	(&tests.ApiScenario{
		Name:                  "tenant user creates a calendar",
		Method:                http.MethodPost,
		URL:                   "/api/collections/calendar_calendars/records",
		Body:                  strings.NewReader(`{"name":"My New Cal","color":"blue"}`),
		Headers:               map[string]string{"Authorization": token, "Content-Type": "application/json"},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"name":"My New Cal"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)

	calRec, err := env.app.FindFirstRecordByFilter("calendar_calendars",
		"name = {:n}", map[string]any{"n": "My New Cal"})
	if err != nil {
		t.Fatalf("the calendar was not created: %v", err)
	}
	rows, err := env.app.FindRecordsByFilter("calendar_members",
		"calendar = {:c}", "", 0, 0, map[string]any{"c": calRec.Id})
	if err != nil {
		t.Fatal(err)
	}

	// This is the finding: with no feature Go bound, nothing creates the
	// owner membership, so the calendar has no members at all.
	if len(rows) != 0 {
		t.Fatalf("expected 0 auto-created memberships without feature Go, got %d", len(rows))
	}
}

// Step 2: and the creator cannot give it to themselves either, because the
// restored rule requires an owner membership that does not exist yet. A
// calendar with no members can be managed by nobody.
func TestBootstrapProbe_CreatorCannotSelfGrantFirstOwnership(t *testing.T) {
	env := setupCalTenantApp(t)
	fresh := calGuestUser(t, env.app, "fresh2@test.local", "member")
	token := calAuthzToken(t, fresh)

	// Create the calendar directly (step 1 already proved the API path works);
	// this test is about the membership that follows.
	col, err := env.app.FindCollectionByNameOrId("calendar_calendars")
	if err != nil {
		t.Fatal(err)
	}
	cal := newCalendarRecord(t, env, col, "Memberless Cal")

	(&tests.ApiScenario{
		Name:   "creator self-grants the first owner membership",
		Method: http.MethodPost,
		URL:    "/api/collections/calendar_members/records",
		Body: strings.NewReader(`{"calendar":"` + cal.Id +
			`","user":"` + fresh.Id + `","role":"owner"}`),
		Headers: map[string]string{"Authorization": token, "Content-Type": "application/json"},
		// 400: the owner-check rule cannot be satisfied for the first row.
		ExpectedStatus:        400,
		ExpectedContent:       []string{`"message"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

func newCalendarRecord(t *testing.T, env *calTenantEnv, col *core.Collection, name string) *core.Record {
	t.Helper()
	r := core.NewRecord(col)
	r.Set("name", name)
	r.Set("color", "blue")
	if err := env.app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}
