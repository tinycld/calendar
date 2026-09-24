package calendar

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/offboard"
)

// offboard_test.go covers what happens to calendars when their owner leaves:
// the offboard handler that hands a sole-owned calendar over (offboard.go),
// and the guard that stops a direct users delete from stripping a shared
// calendar of its only owner. Both run against the SHIPPED schema (real
// migrations, so the unique (calendar, user) index is present).
//
// The env from setupCalTenantApp: env.owner is the only owner of
// env.calendar, env.member is a viewer on it, env.outsider has no calendar.

type calOffboardEnv struct {
	*calTenantEnv
	event *core.Record
	admin *core.Record
}

func setupCalOffboardApp(t *testing.T) *calOffboardEnv {
	t.Helper()
	env := setupCalTenantApp(t)
	offboard.ResetHandlersForTesting()
	t.Cleanup(offboard.ResetHandlersForTesting)
	offboard.RegisterHandler("calendar", handOverSoleOwnedCalendars)
	registerSoleOwnerDeleteGuard(env.app)

	return &calOffboardEnv{
		calTenantEnv: env,
		event:        seedAnonEvent(t, env, env.calendar, "Team standup", "default"),
		admin:        calGuestUser(t, env.app, "t-admin@test.local", "admin"),
	}
}

func membershipOf(t *testing.T, app core.App, cal, user *core.Record) *core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter("calendar_members",
		"calendar = {:c} && user = {:u}", "", 0, 0,
		map[string]any{"c": cal.Id, "u": user.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) > 1 {
		t.Fatalf("%d memberships for one (calendar, user)", len(rows))
	}
	if len(rows) == 0 {
		return nil
	}
	return rows[0]
}

func requireRole(t *testing.T, app core.App, cal, user *core.Record, want string) {
	t.Helper()
	m := membershipOf(t, app, cal, user)
	got := ""
	if m != nil {
		got = m.GetString("role")
	}
	if got != want {
		t.Errorf("role of %s on %q = %q, want %q", user.Email(), cal.GetString("name"), got, want)
	}
}

func requireEventKept(t *testing.T, env *calOffboardEnv) {
	t.Helper()
	if _, err := env.app.FindRecordById("calendar_events", env.event.Id); err != nil {
		t.Errorf("event on the handed-over calendar is gone: %v", err)
	}
}

func requireAnonymized(t *testing.T, app core.App, user *core.Record, want bool) {
	t.Helper()
	fresh, err := app.FindRecordById("users", user.Id)
	if err != nil {
		t.Fatalf("users row of %s is gone: %v", user.Email(), err)
	}
	if got := fresh.GetString("name") == "Deleted user"; got != want {
		t.Errorf("anonymized = %v, want %v", got, want)
	}
}

func TestCalOffboard_ReassignMovesSoleOwnedCalendarToSuccessor(t *testing.T) {
	env := setupCalOffboardApp(t)

	if _, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: env.outsider.Id,
	}, env.admin.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}

	requireRole(t, env.app, env.calendar, env.outsider, "owner")
	requireRole(t, env.app, env.calendar, env.member, "viewer")
	requireEventKept(t, env)
	requireAnonymized(t, env.app, env.owner, true)
}

// The successor is already a viewer: the row is upgraded, not duplicated
// (the unique index would fail an insert).
func TestCalOffboard_ReassignUpgradesExistingMembership(t *testing.T) {
	env := setupCalOffboardApp(t)
	before := membershipOf(t, env.app, env.calendar, env.member)

	if _, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: env.member.Id,
	}, env.owner.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}

	after := membershipOf(t, env.app, env.calendar, env.member)
	if after == nil || after.Id != before.Id || after.GetString("role") != "owner" {
		t.Errorf("membership not upgraded in place: before=%v after=%v", before, after)
	}
	requireEventKept(t, env)
}

// A calendar with another owner does not need the leaver, so the successor
// gets nothing on it. The leaver's own rows stay: memberships where the
// leaver is not the only owner follow the existing behavior.
func TestCalOffboard_LeavesCoOwnedAndNonOwnerMembershipsAlone(t *testing.T) {
	env := setupCalOffboardApp(t)
	coOwned := calAuthzCalendar(t, env.app, "Co-owned")
	calAuthzMember(t, env.app, coOwned, env.owner, "owner")
	calAuthzMember(t, env.app, coOwned, env.admin, "owner")
	viewed := calAuthzCalendar(t, env.app, "Someone else's")
	calAuthzMember(t, env.app, viewed, env.admin, "owner")
	calAuthzMember(t, env.app, viewed, env.owner, "viewer")

	if _, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: env.outsider.Id,
	}, env.owner.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}

	requireRole(t, env.app, coOwned, env.outsider, "")
	requireRole(t, env.app, viewed, env.outsider, "")
	requireRole(t, env.app, coOwned, env.owner, "owner")
	requireRole(t, env.app, viewed, env.owner, "viewer")
	requireRole(t, env.app, env.calendar, env.outsider, "owner")
}

func TestCalOffboard_DeleteMyDataByAdminMovesToAdmin(t *testing.T) {
	env := setupCalOffboardApp(t)

	if _, err := offboard.OffboardUser(env.app, env.owner.Id,
		offboard.Plan{Mode: offboard.ModeDeleteMyData}, env.admin.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}

	requireRole(t, env.app, env.calendar, env.admin, "owner")
	requireRole(t, env.app, env.calendar, env.member, "viewer")
	requireEventKept(t, env)
	requireAnonymized(t, env.app, env.owner, true)
}

// A self-delete has no one to hand a shared calendar to. Like core's
// last-owner guard, it is refused with instructions, and nothing changes.
func TestCalOffboard_SelfDeleteMyDataRefusedForSharedCalendar(t *testing.T) {
	env := setupCalOffboardApp(t)

	_, err := offboard.OffboardUser(env.app, env.owner.Id,
		offboard.Plan{Mode: offboard.ModeDeleteMyData}, env.owner.Id)
	if !errors.Is(err, offboard.ErrInvalidPlan) {
		t.Fatalf("err = %v, want ErrInvalidPlan", err)
	}
	requireRole(t, env.app, env.calendar, env.owner, "owner")
	requireRole(t, env.app, env.calendar, env.member, "viewer")
	requireEventKept(t, env)
	requireAnonymized(t, env.app, env.owner, false)
}

// A calendar only the leaver uses costs nobody access, so a self-delete in
// delete-my-data mode goes through and leaves it as it is.
func TestCalOffboard_SelfDeleteMyDataAllowedForPersonalCalendar(t *testing.T) {
	env := setupCalOffboardApp(t)
	personal := calAuthzCalendar(t, env.app, "Personal")
	calAuthzMember(t, env.app, personal, env.outsider, "owner")

	if _, err := offboard.OffboardUser(env.app, env.outsider.Id,
		offboard.Plan{Mode: offboard.ModeDeleteMyData}, env.outsider.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}
	requireRole(t, env.app, personal, env.outsider, "owner")
	requireAnonymized(t, env.app, env.outsider, true)
}

func TestCalOffboard_GuestSuccessorRefused(t *testing.T) {
	env := setupCalOffboardApp(t)
	guest := calGuestUser(t, env.app, "t-guest@test.local", "guest")

	_, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: guest.Id,
	}, env.admin.Id)
	if !errors.Is(err, offboard.ErrInvalidPlan) {
		t.Fatalf("err = %v, want ErrInvalidPlan", err)
	}
	requireRole(t, env.app, env.calendar, guest, "")
	requireAnonymized(t, env.app, env.owner, false)
}

// D: a direct REST delete of your own account, while you are the only owner of
// a calendar other people use, is refused and points at account settings.
func TestCalUserDeleteGuard_RefusesSoleOwnerOfSharedCalendar(t *testing.T) {
	env := setupCalOffboardApp(t)
	// The event's created_by would block the delete on its own; remove it so
	// the guard is the only thing that can refuse.
	if err := env.app.Delete(env.event); err != nil {
		t.Fatal(err)
	}

	(&tests.ApiScenario{
		Method:                http.MethodDelete,
		URL:                   "/api/collections/users/records/" + env.owner.Id,
		Headers:               map[string]string{"Authorization": env.ownerToken},
		ExpectedStatus:        http.StatusForbidden,
		ExpectedContent:       []string{`account settings`, `Team Cal`},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)

	requireRole(t, env.app, env.calendar, env.owner, "owner")
	requireRole(t, env.app, env.calendar, env.member, "viewer")
}

func TestCalUserDeleteGuard_AllowsDeleteWithoutSharedSoleOwnedCalendar(t *testing.T) {
	cases := []struct {
		name  string
		setup func(t *testing.T, env *calOffboardEnv) (*core.Record, string)
	}{
		{
			name: "no calendars",
			setup: func(_ *testing.T, env *calOffboardEnv) (*core.Record, string) {
				return env.outsider, env.outsiderToken
			},
		},
		{
			name: "personal calendar only",
			setup: func(t *testing.T, env *calOffboardEnv) (*core.Record, string) {
				personal := calAuthzCalendar(t, env.app, "Personal")
				calAuthzMember(t, env.app, personal, env.outsider, "owner")
				return env.outsider, env.outsiderToken
			},
		},
		{
			name: "shared calendar with another owner",
			setup: func(t *testing.T, env *calOffboardEnv) (*core.Record, string) {
				calAuthzMember(t, env.app, env.calendar, env.outsider, "owner")
				return env.outsider, env.outsiderToken
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := setupCalOffboardApp(t)
			user, token := tc.setup(t, env)
			(&tests.ApiScenario{
				Method:                http.MethodDelete,
				URL:                   "/api/collections/users/records/" + user.Id,
				Headers:               map[string]string{"Authorization": token},
				ExpectedStatus:        http.StatusNoContent,
				TestAppFactory:        func(testing.TB) *tests.TestApp { return env.app },
				DisableTestAppCleanup: true,
			}).Test(t)
			if _, err := env.app.FindRecordById("users", user.Id); err == nil {
				t.Error("users row still exists after an allowed delete")
			}
		})
	}
}

// The guard does not reach the offboard path: offboarding the sole owner of a
// shared calendar anonymizes the users row (it is never deleted) and hands the
// calendar over.
func TestCalUserDeleteGuard_OffboardUnaffected(t *testing.T) {
	env := setupCalOffboardApp(t)

	if _, err := offboard.OffboardUser(env.app, env.owner.Id, offboard.Plan{
		Mode: offboard.ModeReassign, SuccessorUserID: env.member.Id,
	}, env.owner.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}
	requireAnonymized(t, env.app, env.owner, true)
	requireRole(t, env.app, env.calendar, env.member, "owner")
}

// Decision: an account delete with no plan (ModeKeep) is refused while the
// user is the only owner of a calendar other people use, and nothing changes;
// the message says what to do.
func TestCalNoPlanDelete_RefusedForSoleOwnedSharedCalendar(t *testing.T) {
	env := setupCalOffboardApp(t)

	_, err := offboard.OffboardUser(env.app, env.owner.Id,
		offboard.Plan{Mode: offboard.ModeKeep}, env.owner.Id)
	if !errors.Is(err, offboard.ErrInvalidPlan) {
		t.Fatalf("err = %v, want ErrInvalidPlan", err)
	}
	for _, want := range []string{env.calendar.GetString("name"), "Make one of them an owner or delete the calendar"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not mention %q", err, want)
		}
	}
	requireRole(t, env.app, env.calendar, env.owner, "owner")
	requireRole(t, env.app, env.calendar, env.member, "viewer")
	requireEventKept(t, env)
	requireAnonymized(t, env.app, env.owner, false)
}

// With no sole-owned calendar that other people use, a no-plan delete goes
// through and leaves every calendar as it is.
func TestCalNoPlanDelete_AllowedWithoutSoleOwnedSharedCalendar(t *testing.T) {
	env := setupCalOffboardApp(t)
	personal := calAuthzCalendar(t, env.app, "Personal")
	calAuthzMember(t, env.app, personal, env.outsider, "owner")
	calAuthzMember(t, env.app, env.calendar, env.outsider, "viewer")

	if _, err := offboard.OffboardUser(env.app, env.outsider.Id,
		offboard.Plan{Mode: offboard.ModeKeep}, env.outsider.Id); err != nil {
		t.Fatalf("OffboardUser: %v", err)
	}
	requireRole(t, env.app, personal, env.outsider, "owner")
	requireRole(t, env.app, env.calendar, env.owner, "owner")
	requireAnonymized(t, env.app, env.outsider, true)
}
