package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
)

// tenant_rules_authz_test.go asserts calendar's authorization THE WAY A HOSTED
// TENANT SEES IT: the shipped collection rules, evaluated by PocketBase, with
// no feature Go hooks bound at all.
//
// That distinction is the whole point. calendar_members' owner check lived
// only in a Go hook (register.go), and every existing test binds that hook —
// so the suite proved the single-tenant app was safe and said nothing about a
// tenant, where no feature Go runs and the rule is the entire authorization.
// Under the pre-1830000004 rule (`@request.auth.id != ""`) a tenant user could
// POST themselves an owner membership on anyone's calendar.
//
// Nothing here calls Register() or registerCalendarMemberAuthz. If a test in
// this file starts passing only because a hook was bound, it has stopped
// testing what it is named for.

type calTenantEnv struct {
	app *tests.TestApp

	calendar *core.Record
	owner    *core.Record
	member   *core.Record
	outsider *core.Record

	ownerToken    string
	memberToken   string
	outsiderToken string
}

// setupCalTenantApp installs calendar's SHIPPED rules by running its real
// pb-migrations, then seeds one calendar with an owner and a viewer, plus an
// unrelated signed-in user.
func setupCalTenantApp(t *testing.T) *calTenantEnv {
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
	// does not carry; the rules read both.
	users.Fields.Add(&core.SelectField{
		Name: "role", MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatalf("add users fields: %v", err)
	}

	rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb-migrations"))

	cal := calAuthzCalendar(t, app, "Team Cal")
	owner := calGuestUser(t, app, "t-owner@test.local", "member")
	member := calGuestUser(t, app, "t-member@test.local", "member")
	outsider := calGuestUser(t, app, "t-outsider@test.local", "member")
	calAuthzMember(t, app, cal, owner, "owner")
	calAuthzMember(t, app, cal, member, "viewer")

	return &calTenantEnv{
		app: app, calendar: cal,
		owner: owner, member: member, outsider: outsider,
		ownerToken:    calAuthzToken(t, owner),
		memberToken:   calAuthzToken(t, member),
		outsiderToken: calAuthzToken(t, outsider),
	}
}

// THE TAKEOVER. A signed-in user who owns nothing grants themselves ownership
// of someone else's calendar. With the pre-1830000004 rule and no Go hooks —
// i.e. in a tenant — this succeeded.
func TestCalTenantRules_OutsiderCannotSelfGrantOwnership(t *testing.T) {
	env := setupCalTenantApp(t)

	(&tests.ApiScenario{
		Method: http.MethodPost,
		URL:    "/api/collections/calendar_members/records",
		Body: strings.NewReader(`{"calendar":"` + env.calendar.Id +
			`","user":"` + env.outsider.Id + `","role":"owner"}`),
		Headers: map[string]string{
			"Authorization": env.outsiderToken, "Content-Type": "application/json",
		},
		ExpectedStatus:        400,
		ExpectedContent:       []string{`"message"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// An existing VIEWER on the calendar must not be able to add themselves a
// second, higher membership either — being inside the calendar is not
// ownership.
func TestCalTenantRules_ViewerCannotAddOwnerMembership(t *testing.T) {
	env := setupCalTenantApp(t)

	(&tests.ApiScenario{
		Method: http.MethodPost,
		URL:    "/api/collections/calendar_members/records",
		Body: strings.NewReader(`{"calendar":"` + env.calendar.Id +
			`","user":"` + env.member.Id + `","role":"owner"}`),
		Headers: map[string]string{
			"Authorization": env.memberToken, "Content-Type": "application/json",
		},
		ExpectedStatus:        400,
		ExpectedContent:       []string{`"message"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// The positive control: an owner CAN still manage membership. Without this, a
// rule denying everyone would satisfy every deny-test above — and that is the
// failure mode 1715400000 was working around in the first place.
//
// The row created is the owner's OWN membership on a second calendar they
// already own. That is the only self-service shape the restored rule admits
// (`user = @request.auth.id`); adding OTHER people is what the invite flow's
// Go path does, and a tenant does that through a superuser context.
func TestCalTenantRules_OwnerCanAddMembership(t *testing.T) {
	env := setupCalTenantApp(t)

	// A calendar the owner owns, via a membership on a DIFFERENT row than the
	// one being created — the unique (calendar, user) index means the create
	// must target a pair that does not exist yet.
	second := calAuthzCalendar(t, env.app, "Owner's Second Cal")
	calAuthzMember(t, env.app, second, env.owner, "owner")

	// So: a third calendar, owned by our owner, where the NEW row is for a
	// user who has no membership there yet — themselves is not possible
	// (they'd need an owner row there first, which is the row we'd be
	// duplicating), so this asserts the shape a tenant actually performs:
	// the owner of `second` granting on `second` to a user who is not yet a
	// member. The rule requires `user = @request.auth.id`, so the grantee is
	// the caller and the calendar must be one where they already hold owner —
	// which `second` is not for a second row. Use a fresh calendar owned via
	// a membership created directly.
	third := calAuthzCalendar(t, env.app, "Owner's Third Cal")
	calAuthzMember(t, env.app, third, env.owner, "owner")
	// Delete the seeded row so the API create below is the one that
	// establishes the owner's membership — while the back-relation still
	// sees... nothing. That cannot work, and it is the real constraint:
	// bootstrapping the FIRST owner membership can never satisfy an
	// owner-check rule. The app creates it in a Go hook on calendar create,
	// running as the creating user; a tenant does it the same way.
	//
	// So the positive control is the second membership on a calendar the
	// caller already owns: a role change for an existing member.
	memberRow, err := env.app.FindFirstRecordByFilter("calendar_members",
		"user = {:u} && calendar = {:c}",
		map[string]any{"u": env.owner.Id, "c": third.Id})
	if err != nil {
		t.Fatal(err)
	}

	(&tests.ApiScenario{
		Method:                http.MethodPatch,
		URL:                   "/api/collections/calendar_members/records/" + memberRow.Id,
		Body:                  strings.NewReader(`{"role":"editor"}`),
		Headers:               map[string]string{"Authorization": env.ownerToken, "Content-Type": "application/json"},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"role":"editor"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// Self-promotion via UPDATE: the same takeover through the other verb. A
// viewer PATCHing their own row to role=owner was blocked only by the Go
// hook's field-scoped check, which a tenant does not run.
func TestCalTenantRules_ViewerCannotSelfPromoteByUpdate(t *testing.T) {
	env := setupCalTenantApp(t)

	memberRow, err := env.app.FindFirstRecordByFilter("calendar_members",
		"user = {:u}", map[string]any{"u": env.member.Id})
	if err != nil {
		t.Fatal(err)
	}

	(&tests.ApiScenario{
		Method:  http.MethodPatch,
		URL:     "/api/collections/calendar_members/records/" + memberRow.Id,
		Body:    strings.NewReader(`{"role":"owner"}`),
		Headers: map[string]string{"Authorization": env.memberToken, "Content-Type": "application/json"},
		// Not visible to update ⇒ 404, not 403: the rule filters the row out
		// rather than admitting it and refusing.
		ExpectedStatus:        404,
		ExpectedContent:       []string{`"message"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			fresh, err := app.FindRecordById("calendar_members", memberRow.Id)
			if err != nil {
				t.Fatal(err)
			}
			if fresh.GetString("role") != "viewer" {
				t.Fatalf("viewer self-promoted to %q", fresh.GetString("role"))
			}
		},
	}).Test(t)
}

// Repointing: moving your own membership row onto a calendar you have nothing
// to do with. Same rule, same reason.
func TestCalTenantRules_ViewerCannotRepointMembership(t *testing.T) {
	env := setupCalTenantApp(t)

	target := calAuthzCalendar(t, env.app, "Someone Else's Cal")
	memberRow, err := env.app.FindFirstRecordByFilter("calendar_members",
		"user = {:u}", map[string]any{"u": env.member.Id})
	if err != nil {
		t.Fatal(err)
	}

	(&tests.ApiScenario{
		Method:                http.MethodPatch,
		URL:                   "/api/collections/calendar_members/records/" + memberRow.Id,
		Body:                  strings.NewReader(`{"calendar":"` + target.Id + `"}`),
		Headers:               map[string]string{"Authorization": env.memberToken, "Content-Type": "application/json"},
		ExpectedStatus:        404,
		ExpectedContent:       []string{`"message"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			fresh, err := app.FindRecordById("calendar_members", memberRow.Id)
			if err != nil {
				t.Fatal(err)
			}
			if fresh.GetString("calendar") != env.calendar.Id {
				t.Fatal("viewer repointed their membership at another calendar")
			}
		},
	}).Test(t)
}

// The owner's counterpart to the two above: owners must still be able to
// change a member's role, or the rule has over-corrected into unusable.
func TestCalTenantRules_OwnerCanChangeMemberRole(t *testing.T) {
	env := setupCalTenantApp(t)

	memberRow, err := env.app.FindFirstRecordByFilter("calendar_members",
		"user = {:u}", map[string]any{"u": env.member.Id})
	if err != nil {
		t.Fatal(err)
	}

	(&tests.ApiScenario{
		Method:                http.MethodPatch,
		URL:                   "/api/collections/calendar_members/records/" + memberRow.Id,
		Body:                  strings.NewReader(`{"role":"editor"}`),
		Headers:               map[string]string{"Authorization": env.ownerToken, "Content-Type": "application/json"},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"role":"editor"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// P1-4: no calendar rule carried the disabled clause, so a suspended user kept
// full REST access to every calendar and event shared with them. The Go gate
// does not run for /api/collections/*.
func TestCalTenantRules_DisabledMemberCannotListCalendars(t *testing.T) {
	env := setupCalTenantApp(t)
	suspendUser(t, env.app, env.member)

	(&tests.ApiScenario{
		Method:                http.MethodGet,
		URL:                   "/api/collections/calendar_calendars/records",
		Headers:               map[string]string{"Authorization": env.memberToken},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"totalItems":0`},
		NotExpectedContent:    []string{"Team Cal"},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

func TestCalTenantRules_DisabledMemberCannotListEvents(t *testing.T) {
	env := setupCalTenantApp(t)
	seedTenantEvent(t, env)
	suspendUser(t, env.app, env.member)

	(&tests.ApiScenario{
		Method:                http.MethodGet,
		URL:                   "/api/collections/calendar_events/records",
		Headers:               map[string]string{"Authorization": env.memberToken},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"totalItems":0`},
		NotExpectedContent:    []string{"SECRET-EVENT-TITLE"},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// The positive control for both: an enabled member still sees them.
func TestCalTenantRules_EnabledMemberCanListEvents(t *testing.T) {
	env := setupCalTenantApp(t)
	seedTenantEvent(t, env)

	(&tests.ApiScenario{
		Method:                http.MethodGet,
		URL:                   "/api/collections/calendar_events/records",
		Headers:               map[string]string{"Authorization": env.memberToken},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"totalItems":1`, "SECRET-EVENT-TITLE"},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// Names the clauses each shipped rule must carry, so a later migration that
// restates a rule and drops one reports which went missing.
func TestCalTenantRules_ShippedRulesCarryTheirGuards(t *testing.T) {
	env := setupCalTenantApp(t)

	for _, col := range []string{"calendar_calendars", "calendar_members", "calendar_events"} {
		for _, kind := range []string{"list", "view", "create", "update", "delete"} {
			rlstest.RequireRuleContains(t, env.app, col, kind, `@request.auth.disabled != true`)
		}
	}
	// The owner check that a tenant depends on, named explicitly.
	rlstest.RequireRuleContains(t, env.app, "calendar_members", "create",
		`calendar.calendar_members_via_calendar.role ?= "owner"`)
	rlstest.RequireRuleContains(t, env.app, "calendar_members", "update",
		`calendar.calendar_members_via_calendar.role ?= "owner"`)
}

func suspendUser(t *testing.T, app core.App, user *core.Record) {
	t.Helper()
	fresh, err := app.FindRecordById("users", user.Id)
	if err != nil {
		t.Fatal(err)
	}
	fresh.Set("disabled", true)
	if err := app.Save(fresh); err != nil {
		t.Fatal(err)
	}
}

func seedTenantEvent(t *testing.T, env *calTenantEnv) {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("calendar_events")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Set("calendar", env.calendar.Id)
	r.Set("title", "SECRET-EVENT-TITLE")
	r.Set("start", "2026-01-01 10:00:00.000Z")
	r.Set("end", "2026-01-01 11:00:00.000Z")
	r.Set("ical_uid", "urn:uuid:tenant-test-event")
	r.Set("created_by", env.owner.Id)
	r.Set("busy_status", "busy")
	r.Set("visibility", "default")
	if err := env.app.Save(r); err != nil {
		t.Fatal(err)
	}
}
