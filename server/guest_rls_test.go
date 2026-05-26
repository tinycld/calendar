package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// guest_rls_test.go proves calendar_calendars' tightened createRule against
// PocketBase's REAL rule engine: a role='guest' member of an org must NOT be
// able to create calendars, while a real member still can.
//
// Background: a guest share-link visitor gets a real users record + a user_org
// row with role='guest' in the owner's org. calendar_calendars' createRule was
// a pure-membership predicate (`org.user_org_via_org.user ?= @request.auth.id`,
// set in 1715000000) — the OnRecordCreateRequest hook for calendar_calendars
// only auto-creates the owner membership AFTER e.Next(); it does NOT block the
// create — so a guest membership row let the visitor create calendars.
//
// (calendar_members create is deliberately NOT tightened here: its PB rule is
// `@request.auth.id != ""` with the real owner-check enforced by the
// userIsOwner Go hook in register.go — a guest is never a calendar owner, so
// the hook already blocks them; re-introducing a back-relation PB rule would
// hit the documented PB-evaluation bug that motivated 1715400000.)
//
// Each scenario builds a FRESH TestApp (ApiScenario.Test re-triggers OnServe;
// reusing one app panics on duplicate route registration under PB v0.38.1).

// calCalendarsGuestCreateRule mirrors the 1715500000 migration verbatim.
const calCalendarsGuestCreateRule = `org.user_org_via_org.user ?= @request.auth.id && ` +
	`org.user_org_via_org.role ?!= "guest"`

type calGuestEnv struct {
	app         *tests.TestApp
	org         *core.Record
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

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	orgs := core.NewBaseCollection("orgs")
	orgs.Id = "pbc_orgs_00001"
	orgs.Fields.Add(&core.TextField{Name: "name", Required: true})
	orgs.Fields.Add(&core.TextField{Name: "slug", Required: true})
	if err := app.Save(orgs); err != nil {
		t.Fatal(err)
	}

	userOrg := core.NewBaseCollection("user_org")
	userOrg.Id = "pbc_user_org_01"
	userOrg.Fields.Add(&core.RelationField{
		Name: "org", Required: true, CollectionId: orgs.Id,
		CascadeDelete: true, MaxSelect: 1,
	})
	userOrg.Fields.Add(&core.RelationField{
		Name: "user", Required: true, CollectionId: users.Id,
		CascadeDelete: true, MaxSelect: 1,
	})
	userOrg.Fields.Add(&core.SelectField{
		Name: "role", Required: true, MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	if err := app.Save(userOrg); err != nil {
		t.Fatal(err)
	}

	calendars := core.NewBaseCollection("calendar_calendars")
	calendars.Fields.Add(&core.RelationField{
		Name: "org", Required: true, CollectionId: orgs.Id,
		CascadeDelete: true, MaxSelect: 1,
	})
	calendars.Fields.Add(&core.TextField{Name: "name", Required: true})
	calendars.Fields.Add(&core.SelectField{
		Name: "color", Required: true, MaxSelect: 1,
		Values: []string{"blue", "green", "red", "teal", "purple", "orange"},
	})
	if err := app.Save(calendars); err != nil {
		t.Fatal(err)
	}

	org := core.NewRecord(orgs)
	org.Set("name", "Acme")
	org.Set("slug", "acme")
	if err := app.Save(org); err != nil {
		t.Fatal(err)
	}

	member := calGuestUser(t, app, "member@test.local")
	guest := calGuestUser(t, app, "guest@test.local")
	calGuestMembership(t, app, member, org, "member")
	calGuestMembership(t, app, guest, org, "guest")

	memberToken, err := member.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	guestToken, err := guest.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	return &calGuestEnv{app: app, org: org, memberToken: memberToken, guestToken: guestToken}
}

func calGuestUser(t *testing.T, app core.App, email string) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("users")
	r := core.NewRecord(col)
	r.SetEmail(email)
	r.Set("name", "Test")
	r.SetVerified(true)
	r.SetPassword("Password123!")
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func calGuestMembership(t *testing.T, app core.App, user, org *core.Record, role string) {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("user_org")
	r := core.NewRecord(col)
	r.Set("user", user.Id)
	r.Set("org", org.Id)
	r.Set("role", role)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
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
		Body:                  strings.NewReader(`{"org":"` + env.org.Id + `","name":"Guest Cal","color":"blue"}`),
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
		Body:                  strings.NewReader(`{"org":"` + env.org.Id + `","name":"Team Cal","color":"green"}`),
		Headers:               map[string]string{"Authorization": env.memberToken, "Content-Type": "application/json"},
		ExpectedStatus:        http.StatusOK,
		ExpectedContent:       []string{`"name":"Team Cal"`},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}
