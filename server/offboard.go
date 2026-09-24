package calendar

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/offboard"
)

// Offboarding anonymizes a users row and never deletes it, so a leaver's
// calendar_members rows survive. A calendar whose only owner leaves is then
// owned by an account nobody can sign in to, and nobody can manage its members
// again. core's flat FK rewrite (RegisterReassignable) cannot fix that: it
// would hand the successor every membership the leaver held, viewer rows on
// other people's calendars included, and it fails on the unique
// (calendar, user) index when the successor is already a member. So calendar
// settles ownership itself, calendar by calendar, inside the offboard
// transaction.

// soleOwnedCalendar is a calendar where the user is the only owner.
// OtherMembers counts the members that are not the user: when it is zero,
// nobody else can see the calendar.
type soleOwnedCalendar struct {
	ID           string `db:"id"`
	Name         string `db:"name"`
	OtherMembers int    `db:"other_members"`
}

func findSoleOwnedCalendars(app core.App, userID string) ([]soleOwnedCalendar, error) {
	var out []soleOwnedCalendar
	err := app.DB().NewQuery(`
		SELECT c.id AS id, c.name AS name,
			(SELECT COUNT(*) FROM calendar_members o
				WHERE o.calendar = m.calendar AND o.user != {:user}) AS other_members
		FROM calendar_members m
		JOIN calendar_calendars c ON c.id = m.calendar
		WHERE m.user = {:user} AND m.role = 'owner'
			AND NOT EXISTS (SELECT 1 FROM calendar_members o
				WHERE o.calendar = m.calendar AND o.role = 'owner' AND o.user != {:user})
		ORDER BY c.name, c.id`,
	).Bind(dbx.Params{"user": userID}).All(&out)
	if err != nil {
		return nil, fmt.Errorf("find sole-owned calendars: %w", err)
	}
	return out, nil
}

// calendarHeir picks who takes over the leaver's sole-owned calendars: the
// successor in reassign mode, the acting admin in delete-my-data mode. It
// returns "" when there is nobody: a self-delete (the actor is the leaver) or
// a system offboard with no actor.
func calendarHeir(leaverID string, plan offboard.Plan, actorUserID string) string {
	if plan.Mode == offboard.ModeReassign {
		return plan.SuccessorUserID
	}
	if actorUserID == "" || actorUserID == leaverID {
		return ""
	}
	return actorUserID
}

// handOverSoleOwnedCalendars is calendar's offboard.Handler. It only adds or
// upgrades the heir's membership: it never deletes a calendar, an event or a
// membership, and it leaves every calendar that has another owner alone.
//
// With no heir (a self-delete in delete-my-data or keep mode, keep being an
// account delete with no plan) it follows core's last-owner guard: refuse,
// and tell the user what to do first. A calendar
// nobody else uses is left as it is, because no one loses access to it.
func handOverSoleOwnedCalendars(txApp core.App, leaver *core.Record, plan offboard.Plan, actorUserID string) error {
	owned, err := findSoleOwnedCalendars(txApp, leaver.Id)
	if err != nil {
		return err
	}
	if len(owned) == 0 {
		return nil
	}

	heirID := calendarHeir(leaver.Id, plan, actorUserID)
	if heirID == "" {
		for _, cal := range owned {
			if cal.OtherMembers > 0 {
				return fmt.Errorf("%w: you are the only owner of the calendar %q, which other people use. "+
					"Make one of them an owner or delete the calendar, or choose a successor for your content, "+
					"before you delete your account",
					offboard.ErrInvalidPlan, cal.Name)
			}
		}
		return nil
	}

	heir, err := txApp.FindRecordById("users", heirID)
	if err != nil {
		return fmt.Errorf("load calendar heir %s: %w", heirID, err)
	}
	// Guests may not own calendars (1830000003 keeps them from creating one),
	// so ownership must not reach them through the back door either.
	if heir.GetString("role") == "guest" {
		return fmt.Errorf("%w: a guest cannot take over calendars; choose a member as the successor",
			offboard.ErrInvalidPlan)
	}

	for _, cal := range owned {
		if err := makeCalendarOwner(txApp, cal.ID, heirID); err != nil {
			return err
		}
	}
	return nil
}

// makeCalendarOwner gives the user an owner membership on the calendar,
// upgrading the existing row when there is one: the unique (calendar, user)
// index allows only one.
func makeCalendarOwner(txApp core.App, calendarID, userID string) error {
	existing, err := txApp.FindFirstRecordByFilter("calendar_members",
		"calendar = {:calendar} && user = {:user}",
		dbx.Params{"calendar": calendarID, "user": userID})
	if err == nil {
		if existing.GetString("role") == "owner" {
			return nil
		}
		existing.Set("role", "owner")
		if err := txApp.Save(existing); err != nil {
			return fmt.Errorf("upgrade membership on calendar %s: %w", calendarID, err)
		}
		return nil
	}

	col, err := txApp.FindCollectionByNameOrId("calendar_members")
	if err != nil {
		return fmt.Errorf("calendar_members collection: %w", err)
	}
	member := core.NewRecord(col)
	member.Set("calendar", calendarID)
	member.Set("user", userID)
	member.Set("role", "owner")
	if err := txApp.Save(member); err != nil {
		return fmt.Errorf("add owner to calendar %s: %w", calendarID, err)
	}
	return nil
}

// registerSoleOwnerDeleteGuard refuses a direct users delete (the REST
// DELETE that PocketBase's default rule allows on your own account) while the
// user is the only owner of a calendar other people use. The
// calendar_members.user cascade would remove every membership of that
// calendar's owner, and leave its members with a calendar nobody can manage.
// The offboard path is not affected: it anonymizes the users row and never
// deletes it.
//
// Superusers step aside, as in core's last-owner guard: they can add an owner
// back from the superuser console.
func registerSoleOwnerDeleteGuard(app core.App) {
	app.OnRecordDeleteRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Auth != nil && e.Auth.IsSuperuser() {
			return e.Next()
		}
		owned, err := findSoleOwnedCalendars(e.App, e.Record.Id)
		if err != nil {
			return e.InternalServerError("calendar ownership check failed", err)
		}
		for _, cal := range owned {
			if cal.OtherMembers > 0 {
				return e.ForbiddenError(fmt.Sprintf(
					"This account is the only owner of the calendar %q, which other people use. "+
						"Make one of them an owner first, or delete the account through "+
						"/api/account/delete, which hands the calendar over.", cal.Name), nil)
			}
		}
		return e.Next()
	})
}
