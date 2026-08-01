package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// calendar_members_authz_test.go proves the OnRecordUpdateRequest guard in
// register.go against the REAL request/hook pipeline. The guard is
// DEFENCE-IN-DEPTH: since 1830000004 the SHIPPED updateRule is owner-only
// (no self-update clause), so on a stock DB a non-owner's PATCH dies at the
// rule and never reaches the guard. To exercise the guard at all, this suite
// deliberately applies the SUPERSEDED permissive rule below — the shape that
// shipped before 1830000004, and the one the guard was written to
// field-scope. That is a fixture choice, not a mirror claim: shipped-rule
// coverage lives in tenant_rules_authz_test.go (which also pins the ABSENCE
// of the self-update clause) and member_share_rls_test.go, both reading the
// real migrations via rlstest (P3-1/R4).
//
// These scenarios drive updates through the records API (POST-authorized PATCH),
// which is the only path that fires OnRecordUpdateRequest — a bare app.Save
// bypasses request hooks entirely. registerCalendarMemberAuthz (the exact guard
// binder Register() calls) is bound against the TestApp so the ACTUAL guard code
// runs — not a copy. We bind only that guard, not the whole Register(): the
// audit/notify/scheduler hooks Register() also installs spawn fire-and-forget
// goroutines that race the test app's teardown on a closed DB, and they're
// irrelevant to the authorization behavior under test. Each scenario builds a
// FRESH TestApp: ApiScenario.Test re-triggers OnServe, and reusing one app
// panics on duplicate route registration.

// permissiveSelfUpdateRule is the PRE-1830000004 rule: owners may update any
// member row, and any member may update their OWN row. Shipped code no longer
// carries the self clause; it is applied here so the guard has something to
// field-scope. If the rule ever regresses to this shape in a migration,
// tenant_rules_authz_test.go goes red — and this suite is what proves the
// second line still holds.
const permissiveSelfUpdateRule = `(calendar.calendar_members_via_calendar.user ?= @request.auth.id && ` +
	`calendar.calendar_members_via_calendar.role ?= "owner") || (user = @request.auth.id)`

const calMemberColors = `blue,green,red,teal,purple,orange,tomato,flamingo,tangerine,banana,sage,basil,peacock,blueberry,lavender,grape,graphite`

type calAuthzEnv struct {
	app *tests.TestApp

	ownerToken  string
	editorToken string
	viewerToken string

	calendar      *core.Record
	otherCalendar *core.Record

	ownerMember  *core.Record
	editorMember *core.Record
	viewerMember *core.Record
}

// setupCalAuthzApp mirrors setupCalGuestApp but adds calendar_members (with the
// color field + self-service updateRule) and binds the calendar member authz
// guard so it runs against request-scoped updates.
func setupCalAuthzApp(t *testing.T) *calAuthzEnv {
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
	if err := app.Save(users); err != nil {
		t.Fatalf("add users.role: %v", err)
	}

	calendars := core.NewBaseCollection("calendar_calendars")
	calendars.Id = "pbc_cal_calendars_01"
	calendars.Fields.Add(&core.TextField{Name: "name", Required: true})
	calendars.Fields.Add(&core.SelectField{
		Name: "color", Required: true, MaxSelect: 1,
		Values: strings.Split(calMemberColors, ","),
	})
	if err := app.Save(calendars); err != nil {
		t.Fatal(err)
	}

	members := core.NewBaseCollection("calendar_members")
	members.Id = "pbc_cal_members_01"
	members.Fields.Add(&core.RelationField{
		Name: "calendar", Required: true, CollectionId: calendars.Id,
		CascadeDelete: true, MaxSelect: 1,
	})
	members.Fields.Add(&core.RelationField{
		Name: "user", Required: true, CollectionId: users.Id,
		CascadeDelete: true, MaxSelect: 1,
	})
	members.Fields.Add(&core.SelectField{
		Name: "role", Required: true, MaxSelect: 1,
		Values: []string{"owner", "editor", "viewer"},
	})
	members.Fields.Add(&core.SelectField{
		Name: "color", Required: false, MaxSelect: 1,
		Values: strings.Split(calMemberColors, ","),
	})
	updateRule := permissiveSelfUpdateRule
	members.UpdateRule = &updateRule
	if err := app.Save(members); err != nil {
		t.Fatal(err)
	}

	// Bind the actual guard (the same function Register() calls) against the
	// test app, so request-scoped updates run the real authorization code.
	registerCalendarMemberAuthz(app)

	cal := calAuthzCalendar(t, app, "Team Cal")
	otherCal := calAuthzCalendar(t, app, "Other Cal")

	ownerUser := calGuestUser(t, app, "owner@test.local", "member")
	editorUser := calGuestUser(t, app, "editor@test.local", "member")
	viewerUser := calGuestUser(t, app, "viewer@test.local", "member")

	env := &calAuthzEnv{
		app:           app,
		calendar:      cal,
		otherCalendar: otherCal,
		ownerMember:   calAuthzMember(t, app, cal, ownerUser, "owner"),
		editorMember:  calAuthzMember(t, app, cal, editorUser, "editor"),
		viewerMember:  calAuthzMember(t, app, cal, viewerUser, "viewer"),
	}
	// Give the owner an owner membership on the OTHER calendar too, so an
	// owner-driven re-point to it is authorized by the ownsTarget branch.
	calAuthzMember(t, app, otherCal, ownerUser, "owner")

	env.ownerToken = calAuthzToken(t, ownerUser)
	env.editorToken = calAuthzToken(t, editorUser)
	env.viewerToken = calAuthzToken(t, viewerUser)

	return env
}

func calAuthzCalendar(t *testing.T, app core.App, name string) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("calendar_calendars")
	r := core.NewRecord(col)
	r.Set("name", name)
	r.Set("color", "blue")
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func calAuthzMember(t *testing.T, app core.App, cal, user *core.Record, role string) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("calendar_members")
	r := core.NewRecord(col)
	r.Set("calendar", cal.Id)
	r.Set("user", user.Id)
	r.Set("role", role)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func calAuthzToken(t *testing.T, user *core.Record) string {
	t.Helper()
	token, err := user.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func calAuthzScenario(env *calAuthzEnv, memberID, token, body string, status int, content ...string) *tests.ApiScenario {
	expected := content
	if len(expected) == 0 {
		expected = []string{`"message"`}
	}
	return &tests.ApiScenario{
		Method:                http.MethodPatch,
		URL:                   "/api/collections/calendar_members/records/" + memberID,
		Body:                  strings.NewReader(body),
		Headers:               map[string]string{"Authorization": token, "Content-Type": "application/json"},
		ExpectedStatus:        status,
		ExpectedContent:       expected,
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
}

// TestCalMembersAuthz_ViewerCannotSelfPromote is THE regression test: a viewer
// PATCHing {"role":"owner"} on their OWN membership row must be REJECTED. The
// PB updateRule authorizes the self-PATCH (user = auth.id), so a 403
// here proves the Go guard — not the rule — is blocking the privilege escalation.
func TestCalMembersAuthz_ViewerCannotSelfPromote(t *testing.T) {
	env := setupCalAuthzApp(t)
	scenario := calAuthzScenario(env, env.viewerMember.Id, env.viewerToken,
		`{"role":"owner"}`, http.StatusForbidden,
		"Only calendar owners can change member roles or calendars.")
	scenario.Test(t)

	// Belt-and-suspenders: the persisted role must still be "viewer".
	got, err := env.app.FindRecordById("calendar_members", env.viewerMember.Id)
	if err != nil {
		t.Fatal(err)
	}
	if role := got.GetString("role"); role != "viewer" {
		t.Fatalf("viewer self-promote leaked through: role is now %q, want \"viewer\"", role)
	}
}

// TestCalMembersAuthz_ViewerCannotRepointCalendar: a viewer must not be able to
// move their own membership onto another calendar (the calendar-relation half
// of the same guard).
func TestCalMembersAuthz_ViewerCannotRepointCalendar(t *testing.T) {
	env := setupCalAuthzApp(t)
	scenario := calAuthzScenario(env, env.viewerMember.Id, env.viewerToken,
		`{"calendar":"`+env.otherCalendar.Id+`"}`, http.StatusForbidden,
		"Only calendar owners can change member roles or calendars.")
	scenario.Test(t)

	got, err := env.app.FindRecordById("calendar_members", env.viewerMember.Id)
	if err != nil {
		t.Fatal(err)
	}
	if cal := got.GetString("calendar"); cal != env.calendar.Id {
		t.Fatalf("viewer repointed calendar to %q, want %q", cal, env.calendar.Id)
	}
}

// TestCalMembersAuthz_ViewerCanChangeOwnColor proves the guard is field-scoped:
// a viewer self-PATCHing only a benign field (color) is still ALLOWED, so
// personal-color self-service keeps working.
func TestCalMembersAuthz_ViewerCanChangeOwnColor(t *testing.T) {
	env := setupCalAuthzApp(t)
	scenario := calAuthzScenario(env, env.viewerMember.Id, env.viewerToken,
		`{"color":"grape"}`, http.StatusOK, `"color":"grape"`)
	scenario.Test(t)
}

// TestCalMembersAuthz_OwnerCanChangeMemberRole: an actual calendar owner
// promoting another member's role is ALLOWED — the guard blocks non-owners,
// not owners.
func TestCalMembersAuthz_OwnerCanChangeMemberRole(t *testing.T) {
	env := setupCalAuthzApp(t)
	scenario := calAuthzScenario(env, env.viewerMember.Id, env.ownerToken,
		`{"role":"editor"}`, http.StatusOK, `"role":"editor"`)
	scenario.Test(t)
}

// TestCalMembersAuthz_LastOwnerDemotionBlocked: the pre-existing last-owner
// guard still fires — demoting the only owner is rejected even when the actor
// is that owner.
func TestCalMembersAuthz_LastOwnerDemotionBlocked(t *testing.T) {
	env := setupCalAuthzApp(t)
	scenario := calAuthzScenario(env, env.ownerMember.Id, env.ownerToken,
		`{"role":"editor"}`, http.StatusBadRequest,
		"A calendar must have at least one owner.")
	scenario.Test(t)
}
