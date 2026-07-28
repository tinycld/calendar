package calendar

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
)

// Sharing a calendar means an owner adds SOMEONE ELSE. Every existing member
// test only ever creates a membership whose `user` IS the caller — including
// member_create_rule_probe_test.go's "owner adds a member" case, which adds
// the owner to a second calendar they already own. So the one shape the
// feature actually uses had no coverage, and 1830000004's
// `user = @request.auth.id` conjunct made it impossible: the AddMemberDialog's
// POST 400'd with a bare "Failed to create record" and the dialog sat open.
//
// These run against the SHIPPED migrations (rlstest), not a rule constant
// declared here, so a later migration that reintroduces the self-clause turns
// them red instead of silently re-breaking sharing.

type calShareEnv struct {
	app         *tests.TestApp
	cal         *core.Record
	owner       *core.Record
	invitee     *core.Record
	outsider    *core.Record
	ownerToken  string
	outsidToken string
}

func setupCalShareApp(t *testing.T) *calShareEnv {
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

	owner := calGuestUser(t, app, "share-owner@test.local", "member")
	invitee := calGuestUser(t, app, "share-invitee@test.local", "member")
	outsider := calGuestUser(t, app, "share-outsider@test.local", "member")

	cal := calAuthzCalendar(t, app, "Shared Cal")
	calAuthzMember(t, app, cal, owner, "owner")

	ownerToken, err := owner.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	outsidToken, err := outsider.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	return &calShareEnv{
		app: app, cal: cal, owner: owner, invitee: invitee, outsider: outsider,
		ownerToken: ownerToken, outsidToken: outsidToken,
	}
}

func postMembership(t *testing.T, env *calShareEnv, token, userID, role string, want int, content ...string) {
	t.Helper()
	(&tests.ApiScenario{
		Name:   "POST calendar_members",
		Method: http.MethodPost,
		URL:    "/api/collections/calendar_members/records",
		Body: strings.NewReader(`{"calendar":"` + env.cal.Id +
			`","user":"` + userID + `","role":"` + role + `"}`),
		Headers: map[string]string{
			"Authorization": token, "Content-Type": "application/json",
		},
		ExpectedStatus:        want,
		ExpectedContent:       content,
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// THE FEATURE. An owner shares their calendar with another user. This is what
// the sharing UI does and what the e2e's cross-tier CalDAV assertion needs.
func TestCalShareRLS_OwnerCanAddAnotherUser(t *testing.T) {
	env := setupCalShareApp(t)
	postMembership(t, env, env.ownerToken, env.invitee.Id, "viewer", http.StatusOK,
		`"role":"viewer"`, `"user":"`+env.invitee.Id+`"`)
}

// The deny half that `viaOwner` — not the self-clause — is responsible for:
// a signed-in user who owns nothing cannot mint a membership on someone
// else's calendar, whether they aim it at themselves (takeover) or at a
// third party.
func TestCalShareRLS_OutsiderCannotGrantThemselvesOwnership(t *testing.T) {
	env := setupCalShareApp(t)
	postMembership(t, env, env.outsidToken, env.outsider.Id, "owner", http.StatusBadRequest,
		`"message":"Failed to create record."`)
}

func TestCalShareRLS_OutsiderCannotAddAThirdParty(t *testing.T) {
	env := setupCalShareApp(t)
	postMembership(t, env, env.outsidToken, env.invitee.Id, "viewer", http.StatusBadRequest,
		`"message":"Failed to create record."`)
}

// A non-owner MEMBER is a different principal from an outsider: they hold a
// membership row on this calendar, just not an owner one. So it is
// viaOwner's `role ?= "owner"` — not the mere existence of a membership —
// that must stop them re-sharing someone else's calendar, or promoting
// themselves by adding a second row.
func TestCalShareRLS_ViewerCannotReshareTheCalendar(t *testing.T) {
	env := setupCalShareApp(t)
	viewer := calGuestUser(t, env.app, "share-viewer@test.local", "member")
	calAuthzMember(t, env.app, env.cal, viewer, "viewer")
	viewerToken, err := viewer.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	postMembership(t, env, viewerToken, env.invitee.Id, "viewer", http.StatusBadRequest,
		`"message":"Failed to create record."`)
}

// An editor must not be able to add a THIRD PARTY to the calendar they edit.
//
// This is the case that isolates `role ?= "owner"`. Two nearby framings both
// pass for reasons that have nothing to do with authorization, and neither is
// a real guard:
//   - editor adds THEMSELVES to their own calendar → `UNIQUE(calendar, user)`
//     rejects the duplicate row whatever the rule says;
//   - editor targets a calendar they hold no row on → the membership half of
//     the predicate denies it, so the role half is never consulted.
//
// Here the editor DOES hold a row on the target calendar and the new row is
// for someone else, so the only thing standing in the way is that their role
// is not "owner". Verified by neutering: deleting the role clause turns this
// red.
func TestCalShareRLS_EditorCannotAddAThirdParty(t *testing.T) {
	env := setupCalShareApp(t)
	editor := calGuestUser(t, env.app, "share-editor@test.local", "member")
	calAuthzMember(t, env.app, env.cal, editor, "editor")
	editorToken, err := editor.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	postMembership(t, env, editorToken, env.invitee.Id, "viewer", http.StatusBadRequest,
		`"message":"Failed to create record."`)
}

// The shipped rule must keep requiring calendar ownership. Naming the clause
// makes a future restatement that drops it fail here rather than in
// production — the drift that produced this whole class of finding.
func TestCalShareRLS_ShippedCreateRuleRequiresCalendarOwnership(t *testing.T) {
	env := setupCalShareApp(t)
	rlstest.RequireRuleContains(t, env.app, "calendar_members", "create",
		`calendar.calendar_members_via_calendar.role ?= "owner"`)
}
