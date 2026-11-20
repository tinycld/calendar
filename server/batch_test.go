package calendar

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// A batch runs its operations in one transaction, and a hook that reads
// through the outer app sees none of the batch's earlier writes. These tests
// drive the real /api/batch endpoint against the shipped guards.

func calEnableBatch(t *testing.T, app core.App) {
	t.Helper()
	settings := app.Settings()
	settings.Batch.Enabled = true
	settings.Batch.MaxRequests = 50
	settings.Batch.Timeout = 3
	if err := app.Save(settings); err != nil {
		t.Fatalf("enable batch: %v", err)
	}
}

// A superuser passes every API rule, so a test with this token measures the
// Go guard alone.
func calSuperuserToken(t *testing.T, app core.App) string {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	su := core.NewRecord(col)
	su.SetEmail("batch-su@test.local")
	su.SetPassword("1234567890")
	if err := app.Save(su); err != nil {
		t.Fatalf("create superuser: %v", err)
	}
	token, err := su.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func calBatchScenario(app *tests.TestApp, token, body string, status int, content ...string) *tests.ApiScenario {
	return &tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/batch",
		Body:                  strings.NewReader(body),
		Headers:               map[string]string{"Authorization": token, "Content-Type": "application/json"},
		ExpectedStatus:        status,
		ExpectedContent:       content,
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}
}

func calMemberRole(t *testing.T, app core.App, id string) string {
	t.Helper()
	row, err := app.FindRecordById("calendar_members", id)
	if err != nil {
		t.Fatalf("membership %s is gone: %v", id, err)
	}
	return row.GetString("role")
}

func TestCalBatch_CannotDeleteEveryOwner(t *testing.T) {
	env := setupCalAuthzApp(t)
	calEnableBatch(t, env.app)
	second := calAuthzMember(t, env.app, env.calendar,
		calGuestUser(t, env.app, "owner2@test.local", "member"), "owner")

	body := fmt.Sprintf(`{"requests":[
		{"method":"DELETE","url":"/api/collections/calendar_members/records/%s"},
		{"method":"DELETE","url":"/api/collections/calendar_members/records/%s"}]}`,
		env.ownerMember.Id, second.Id)
	calBatchScenario(env.app, calSuperuserToken(t, env.app), body, http.StatusBadRequest,
		"A calendar must have at least one owner.").Test(t)

	if calMemberRole(t, env.app, env.ownerMember.Id) != "owner" || calMemberRole(t, env.app, second.Id) != "owner" {
		t.Fatal("the refused batch changed an owner membership")
	}
}

func TestCalBatch_CannotDemoteEveryOwner(t *testing.T) {
	env := setupCalAuthzApp(t)
	calEnableBatch(t, env.app)
	second := calAuthzMember(t, env.app, env.calendar,
		calGuestUser(t, env.app, "owner2@test.local", "member"), "owner")

	body := fmt.Sprintf(`{"requests":[
		{"method":"PATCH","url":"/api/collections/calendar_members/records/%s","body":{"role":"editor"}},
		{"method":"PATCH","url":"/api/collections/calendar_members/records/%s","body":{"role":"editor"}}]}`,
		env.ownerMember.Id, second.Id)
	calBatchScenario(env.app, calSuperuserToken(t, env.app), body, http.StatusBadRequest,
		"A calendar must have at least one owner.").Test(t)

	if calMemberRole(t, env.app, env.ownerMember.Id) != "owner" || calMemberRole(t, env.app, second.Id) != "owner" {
		t.Fatal("the refused batch demoted an owner")
	}
}

// One owner may leave when another stays. That must still work in a batch.
func TestCalBatch_OneOwnerOfTwoMayLeave(t *testing.T) {
	env := setupCalAuthzApp(t)
	calEnableBatch(t, env.app)
	second := calAuthzMember(t, env.app, env.calendar,
		calGuestUser(t, env.app, "owner2@test.local", "member"), "owner")

	body := fmt.Sprintf(`{"requests":[
		{"method":"DELETE","url":"/api/collections/calendar_members/records/%s"}]}`, env.ownerMember.Id)
	calBatchScenario(env.app, calSuperuserToken(t, env.app), body, http.StatusOK, `"status":204`).Test(t)

	if _, err := env.app.FindRecordById("calendar_members", env.ownerMember.Id); err == nil {
		t.Fatal("the membership was not deleted")
	}
	if calMemberRole(t, env.app, second.Id) != "owner" {
		t.Fatal("the other owner changed")
	}
}

// An owner who gives up ownership earlier in a batch is not an owner for the
// rest of it.
func TestCalBatch_FormerOwnerCannotAddMembers(t *testing.T) {
	env := setupCalAuthzApp(t)
	calEnableBatch(t, env.app)
	registerCalendarMemberCreateAuthz(env.app)

	// Fixture rules: the shipped create and delete rules are owner checks of
	// their own. They are opened here so the request reaches the Go guard,
	// which is the code under test.
	members, err := env.app.FindCollectionByNameOrId("calendar_members")
	if err != nil {
		t.Fatal(err)
	}
	signedIn := `@request.auth.id != ""`
	members.CreateRule = &signedIn
	members.DeleteRule = &signedIn
	if err := env.app.Save(members); err != nil {
		t.Fatal(err)
	}
	calAuthzMember(t, env.app, env.calendar,
		calGuestUser(t, env.app, "owner2@test.local", "member"), "owner")
	newcomer := calGuestUser(t, env.app, "newcomer@test.local", "member")

	body := fmt.Sprintf(`{"requests":[
		{"method":"DELETE","url":"/api/collections/calendar_members/records/%s"},
		{"method":"POST","url":"/api/collections/calendar_members/records","body":{"calendar":"%s","user":"%s","role":"viewer"}}]}`,
		env.ownerMember.Id, env.calendar.Id, newcomer.Id)
	calBatchScenario(env.app, env.ownerToken, body, http.StatusBadRequest,
		"Only calendar owners can add members.").Test(t)

	if calMemberRole(t, env.app, env.ownerMember.Id) != "owner" {
		t.Fatal("the refused batch removed the owner membership")
	}
}

func calOwnerRows(t *testing.T, app core.App, calendarName string) (calendars int, owners []*core.Record) {
	t.Helper()
	cals, err := app.FindRecordsByFilter("calendar_calendars", "name = {:n}", "", 0, 0,
		map[string]any{"n": calendarName})
	if err != nil {
		t.Fatal(err)
	}
	if len(cals) == 0 {
		return 0, nil
	}
	rows, err := app.FindRecordsByFilter("calendar_members", "calendar = {:c}", "", 0, 0,
		map[string]any{"c": cals[0].Id})
	if err != nil {
		t.Fatal(err)
	}
	return len(cals), rows
}

func TestCalBatch_CreatorOwnsACalendarCreatedInABatch(t *testing.T) {
	app, user, token := setupCalTenantWithHooks(t)
	calEnableBatch(t, app)

	body := `{"requests":[{"method":"POST","url":"/api/collections/calendar_calendars/records","body":{"name":"Batch Cal","color":"blue"}}]}`
	calBatchScenario(app, token, body, http.StatusOK, `"name":"Batch Cal"`).Test(t)

	calendars, owners := calOwnerRows(t, app, "Batch Cal")
	if calendars != 1 || len(owners) != 1 {
		t.Fatalf("got %d calendars and %d memberships, want 1 and 1", calendars, len(owners))
	}
	if owners[0].GetString("user") != user.Id || owners[0].GetString("role") != "owner" {
		t.Fatalf("membership is %s/%s, want the creator as owner",
			owners[0].GetString("user"), owners[0].GetString("role"))
	}
}

// A calendar with no owner is manageable by nobody, so a create whose owner
// membership cannot be saved must not leave the calendar behind.
func TestCalCreate_FailsWhenTheOwnerMembershipCannotBeSaved(t *testing.T) {
	app, _, token := setupCalTenantWithHooks(t)
	app.OnRecordCreate("calendar_members").BindFunc(func(*core.RecordEvent) error {
		return errors.New("membership refused by the test")
	})

	(&tests.ApiScenario{
		Method:                http.MethodPost,
		URL:                   "/api/collections/calendar_calendars/records",
		Body:                  strings.NewReader(`{"name":"Orphan Cal","color":"blue"}`),
		Headers:               map[string]string{"Authorization": token, "Content-Type": "application/json"},
		ExpectedStatus:        http.StatusBadRequest,
		ExpectedContent:       []string{`"message"`},
		TestAppFactory:        func(_ testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}).Test(t)

	if calendars, _ := calOwnerRows(t, app, "Orphan Cal"); calendars != 0 {
		t.Fatal("the calendar was created with no owner membership")
	}
}
