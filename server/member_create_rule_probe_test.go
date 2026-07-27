package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// This file answers one question, and the answer decides how calendar's
// member authorization can be written at all.
//
// calendar_members.createRule was relaxed to a bare `@request.auth.id != ""`
// by migration 1715400000, which recorded the reason: under PocketBase v0.36
// the original owner-check rule
//
//	calendar.calendar_members_via_calendar.user ?= @request.auth.id
//	    && calendar.calendar_members_via_calendar.role ?= "owner"
//
// evaluated inconsistently — a non-superuser POST 400'd even when the caller
// genuinely was an owner. The owner check moved into a Go hook instead.
//
// That is fine for the single-tenant app, where the Go always runs. It is not
// fine for a hosted tenant, which runs no feature Go at all: there, the rule
// IS the authorization, and `@request.auth.id != ""` means any signed-in user
// can POST {calendar: <any id>, user: <self>, role: "owner"} and take over any
// calendar in the deployment — including over its CalDAV.
//
// The tree now runs a v0.39.8 fork. So: does the original rule work today?
//
// If TestMemberCreateRule_OwnerCanCreateUnderBackRelationRule passes, the
// blocker is gone and the tenant-safe fix is to restore the rule.
// If it fails, a tenant-safe calendar needs a schema change (e.g. a
// denormalized owner column a hook maintains and the rule compares directly),
// which is a different size of job — and this test is where that is
// discovered rather than assumed.

// calMembersOwnerCreateRule is the original rule from 1715000000, verbatim.
const calMembersOwnerCreateRule = `user = @request.auth.id && ` +
	`calendar.calendar_members_via_calendar.user ?= @request.auth.id && ` +
	`calendar.calendar_members_via_calendar.role ?= "owner"`

// setupMemberCreateRuleApp builds calendars + members with the ORIGINAL
// owner-check createRule, one calendar owner, and one unrelated signed-in
// user. No Go hooks are bound: this measures the rule engine alone, which is
// exactly what a tenant runs.
func setupMemberCreateRuleApp(t *testing.T) (*tests.TestApp, *core.Record, *core.Record, string, string) {
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
		t.Fatal(err)
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
	rule := calMembersOwnerCreateRule
	members.CreateRule = &rule
	if err := app.Save(members); err != nil {
		t.Fatalf("save calendar_members with the original owner rule: %v", err)
	}

	cal := calAuthzCalendar(t, app, "Team Cal")
	owner := calGuestUser(t, app, "cal-owner@test.local", "member")
	outsider := calGuestUser(t, app, "outsider@test.local", "member")
	calAuthzMember(t, app, cal, owner, "owner")

	return app, cal, outsider, calAuthzToken(t, owner), calAuthzToken(t, outsider)
}

// THE PROBE. An owner adding a member under the original back-relation rule.
// Under v0.36 this 400'd, which is why the rule was relaxed.
func TestMemberCreateRule_OwnerCanCreateUnderBackRelationRule(t *testing.T) {
	app, _, _, ownerToken, _ := setupMemberCreateRuleApp(t)

	// The owner already owns `other`, and adds a second row for themselves on
	// it — the shape the rule must admit: `user = @request.auth.id` satisfied,
	// and the back-relation walk finding their existing owner membership.
	other := calAuthzCalendar(t, app, "Second Cal")
	ownerUser, err := app.FindAuthRecordByEmail("users", "cal-owner@test.local")
	if err != nil {
		t.Fatal(err)
	}
	calAuthzMember(t, app, other, ownerUser, "owner")

	(&tests.ApiScenario{
		Name:   "calendar owner adds a member under the original rule",
		Method: http.MethodPost,
		URL:    "/api/collections/calendar_members/records",
		Body: strings.NewReader(`{"calendar":"` + other.Id +
			`","user":"` + ownerUser.Id + `","role":"editor"}`),
		Headers: map[string]string{
			"Authorization": ownerToken, "Content-Type": "application/json",
		},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"role":"editor"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// The deny half, and the whole reason the rule matters: a signed-in user who
// owns nothing must not be able to grant themselves ownership of someone
// else's calendar. Under the shipped `@request.auth.id != ""` rule, with no
// feature Go running, this SUCCEEDS — which is the tenant takeover.
func TestMemberCreateRule_OutsiderCannotSelfGrantOwnership(t *testing.T) {
	app, cal, outsider, _, outsiderToken := setupMemberCreateRuleApp(t)

	(&tests.ApiScenario{
		Name:   "outsider self-grants ownership of another user's calendar",
		Method: http.MethodPost,
		URL:    "/api/collections/calendar_members/records",
		Body: strings.NewReader(`{"calendar":"` + cal.Id +
			`","user":"` + outsider.Id + `","role":"owner"}`),
		Headers: map[string]string{
			"Authorization": outsiderToken, "Content-Type": "application/json",
		},
		ExpectedStatus:        400,
		ExpectedContent:       []string{`"message"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}).Test(t)
}
