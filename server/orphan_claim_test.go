package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// A calendar loses its last member when that member's users row is deleted:
// the calendar_members.user cascade removes the membership, not the calendar.
// 1830000010 closed the anonymous read of such a calendar. The question here
// is the signed-in one: can a regular (non-guest) user make themselves a
// member of a calendar that has no members, and so take its events?
//
// The shipped createRule is owner-check only (1830000004, restated in
// 1830000010). With zero member rows, the back-relation is NULL, and NULL does
// not equal a real auth id, so no path admits the first membership except the
// Go bootstrap on calendar create, which writes only the CREATOR's row.
//
// Each case runs the SHIPPED rules plus the bootstrap hook, so the hook is
// shown not to open a way in. One ApiScenario per app (see bootstrap_probe_test.go).

type orphanClaimEnv struct {
	*calTenantEnv
	orphan *core.Record
	// ownerRow is the owner's membership on their OWN calendar (env.calendar).
	ownerRow *core.Record
}

func setupOrphanClaimApp(t *testing.T) *orphanClaimEnv {
	t.Helper()
	env := setupCalTenantApp(t)
	registerOwnerMembershipBootstrap(env.app)
	orphan := calAuthzCalendar(t, env.app, "ORPHAN-CLAIM")
	seedAnonEvent(t, env, orphan, "ORPHAN-CLAIM-EVENT", "private")
	ownerRow, err := env.app.FindFirstRecordByFilter("calendar_members",
		"calendar = {:c} && user = {:u}",
		map[string]any{"c": env.calendar.Id, "u": env.owner.Id})
	if err != nil {
		t.Fatal(err)
	}
	return &orphanClaimEnv{calTenantEnv: env, orphan: orphan, ownerRow: ownerRow}
}

func requireStillOrphan(t *testing.T, env *orphanClaimEnv) {
	t.Helper()
	rows, err := env.app.FindRecordsByFilter("calendar_members",
		"calendar = {:c}", "", 0, 0, map[string]any{"c": env.orphan.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("orphan calendar gained %d membership(s); first: user=%s role=%s",
			len(rows), rows[0].GetString("user"), rows[0].GetString("role"))
	}
}

func TestOrphanClaim_SignedInUserCannotJoinMemberlessCalendar(t *testing.T) {
	cases := []struct {
		name   string
		method string
		url    func(env *orphanClaimEnv) string
		token  func(env *orphanClaimEnv) string
		body   func(env *orphanClaimEnv) string
		status int
	}{
		{
			name: "outsider claims owner", method: http.MethodPost,
			url:   func(*orphanClaimEnv) string { return "/api/collections/calendar_members/records" },
			token: func(env *orphanClaimEnv) string { return env.outsiderToken },
			body: func(env *orphanClaimEnv) string {
				return `{"calendar":"` + env.orphan.Id + `","user":"` + env.outsider.Id + `","role":"owner"}`
			},
			status: http.StatusBadRequest,
		},
		{
			name: "outsider claims viewer", method: http.MethodPost,
			url:   func(*orphanClaimEnv) string { return "/api/collections/calendar_members/records" },
			token: func(env *orphanClaimEnv) string { return env.outsiderToken },
			body: func(env *orphanClaimEnv) string {
				return `{"calendar":"` + env.orphan.Id + `","user":"` + env.outsider.Id + `","role":"viewer"}`
			},
			status: http.StatusBadRequest,
		},
		{
			// An owner of ANOTHER calendar passes the owner half of the rule on
			// their own row; the calendar pin must still stop the repoint.
			name: "owner of another calendar repoints their membership", method: http.MethodPatch,
			url: func(env *orphanClaimEnv) string {
				return "/api/collections/calendar_members/records/" + env.ownerRow.Id
			},
			token:  func(env *orphanClaimEnv) string { return env.ownerToken },
			body:   func(env *orphanClaimEnv) string { return `{"calendar":"` + env.orphan.Id + `"}` },
			status: http.StatusNotFound,
		},
		{
			// The bootstrap hook grants the creator ownership of the calendar it
			// just created. Reusing the orphan's id must fail the create, so the
			// hook never runs for it.
			name: "outsider re-creates the orphan id to trigger the bootstrap", method: http.MethodPost,
			url:   func(*orphanClaimEnv) string { return "/api/collections/calendar_calendars/records" },
			token: func(env *orphanClaimEnv) string { return env.outsiderToken },
			body: func(env *orphanClaimEnv) string {
				return `{"id":"` + env.orphan.Id + `","name":"mine now","color":"blue"}`
			},
			status: http.StatusBadRequest,
		},
		{
			name: "outsider updates the orphan calendar", method: http.MethodPatch,
			url: func(env *orphanClaimEnv) string {
				return "/api/collections/calendar_calendars/records/" + env.orphan.Id
			},
			token:  func(env *orphanClaimEnv) string { return env.outsiderToken },
			body:   func(*orphanClaimEnv) string { return `{"name":"hijacked"}` },
			status: http.StatusNotFound,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := setupOrphanClaimApp(t)
			(&tests.ApiScenario{
				Name:   tc.name,
				Method: tc.method,
				URL:    tc.url(env),
				Body:   strings.NewReader(tc.body(env)),
				Headers: map[string]string{
					"Authorization": tc.token(env), "Content-Type": "application/json",
				},
				ExpectedStatus:        tc.status,
				ExpectedContent:       []string{`"message"`},
				TestAppFactory:        func(testing.TB) *tests.TestApp { return env.app },
				DisableTestAppCleanup: true,
			}).Test(t)

			requireStillOrphan(t, env)
			stored, err := env.app.FindRecordById("calendar_calendars", env.orphan.Id)
			if err != nil {
				t.Fatalf("orphan calendar gone: %v", err)
			}
			if stored.GetString("name") != "ORPHAN-CLAIM" {
				t.Fatalf("orphan calendar changed: %q", stored.GetString("name"))
			}
		})
	}
}

// The legitimate path the owner-check rule must keep open: a fresh calendar
// gets its creator as owner through the bootstrap, in the same app that denies
// the claims above.
func TestOrphanClaim_CreateBootstrapStillGrantsCreatorOwnership(t *testing.T) {
	env := setupOrphanClaimApp(t)

	(&tests.ApiScenario{
		Name:   "outsider creates their own calendar",
		Method: http.MethodPost,
		URL:    "/api/collections/calendar_calendars/records",
		Body:   strings.NewReader(`{"name":"Outsider Own","color":"blue"}`),
		Headers: map[string]string{
			"Authorization": env.outsiderToken, "Content-Type": "application/json",
		},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"name":"Outsider Own"`},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)

	cal, err := env.app.FindFirstRecordByFilter("calendar_calendars",
		"name = {:n}", map[string]any{"n": "Outsider Own"})
	if err != nil {
		t.Fatalf("calendar not created: %v", err)
	}
	owned, err := userIsOwner(env.app, cal.Id, env.outsider.Id)
	if err != nil {
		t.Fatal(err)
	}
	if !owned {
		t.Fatal("creator is not the owner of the calendar they created")
	}
	requireStillOrphan(t, env)
}
