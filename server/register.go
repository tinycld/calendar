package calendar

import (
	"context"
	"fmt"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/google/uuid"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/audit"
	"tinycld.org/core/caldav"
	"tinycld.org/core/coreserver"
	"tinycld.org/core/notify"
	"tinycld.org/core/offboard"
)

// calDAVSource maps the calendar collections onto core's CalDAV server.
//
// This literal mirrors the manifest's `caldav` block, which is what a multi-org
// tenant serves: the router materializes the manifest block into the tenant's
// runtime config and core mounts CalDAV from it, so the mount below is
// host-only (see Register vs RegisterTenant). Keep the two in sync.
//
// There are no permission callbacks here on purpose. Authorization comes from
// the calendar_calendars / calendar_events access rules the migrations ship,
// which core evaluates with app.CanAccessRecord — one definition, shared by the
// REST API, the web UI, and this protocol path.
var calDAVSource = caldav.Source{
	Slug:               "calendar",
	Prefix:             "/caldav",
	CalendarCollection: "calendar_calendars",
	EventCollection:    "calendar_events",
	Calendar: caldav.CalendarMap{
		Name:        "name",
		Description: "description",
	},
	Event: caldav.EventMap{
		Calendar:    "calendar",
		UID:         "ical_uid",
		Owner:       "created_by",
		Title:       "title",
		Description: "description",
		Location:    "location",
		Start:       "start",
		End:         "end",
		AllDay:      "all_day",
		Recurrence:  "recurrence",
		Guests:      "guests",
		Reminder:    "reminder",
		BusyStatus:  "busy_status",
		Visibility:  "visibility",
		Updated:     "updated",
		Created:     "created",
		// busy_status and visibility are required selects with no schema
		// default, and a minimal VEVENT carries neither TRANSP nor CLASS — so
		// without these a client PUT is rejected with "cannot be blank".
		Defaults: map[string]any{
			"busy_status": "busy",
			"visibility":  "default",
		},
	},
	// go-webdav turns a backend error into an http.Error and returns nil, so
	// the error never reaches the router's Sentry middleware — which sees only
	// the response status. This is the one seam where the real error and its
	// stack survive. Not-found (which every unauthorized probe resolves to) is
	// filtered by core before it gets here.
	OnError: func(ctx context.Context, op string, err error) {
		hub := sentry.GetHubFromContext(ctx)
		if hub == nil {
			hub = sentry.CurrentHub()
		}
		hub.WithScope(func(scope *sentry.Scope) {
			scope.SetTag("caldav.op", op)
			hub.CaptureException(err)
		})
	},
}

// appIsLive reports whether the app still has an open database connection.
// The invite notifier and the reminder/subscription schedulers run in
// background goroutines that can outlive the app instance — e.g. the test
// harness resets the dev DB while a job is in flight. Once the app is torn
// down, ConcurrentDB() is nil and any record query (PocketBase v0.38
// RecordQuery) panics on the nil DB instead of returning an error. Bail out
// instead of touching the DB in that window.
func appIsLive(app core.App) bool {
	return app != nil && app.ConcurrentDB() != nil
}

// Register composes the calendar server — the package's single entry point,
// called by the generator's package_extensions.go in BOTH the single-org app
// and a multi-org tenant. The CalDAV mount runs in both: a per-org tenant
// build links exactly the org's features, so the artifact is the gate.
// Registered outside OnServe because caldav.Register binds its own OnServe
// handler, and the caldavHook TS binding must exist before jsvm runs the hook
// files (jsvm executes them synchronously, so a later registration dies at
// boot with "caldavHook is not defined").
func Register(app *pocketbase.PocketBase) {
	registerShared(app)
	caldav.Register(app, []caldav.Source{calDAVSource}, coreserver.CalDAVHostBindings())
}

// registerShared is the single source of truth for what BOTH compositions run:
// record hooks, request-scoped authorization, endpoints, audit/quota/notify
// registrations, and the per-org background schedulers.
func registerShared(app *pocketbase.PocketBase) {
	// Reassignable authorship FKs surfaced to core's account-offboarding
	// transaction. Without this, deleting a user who created calendar_events
	// fails: the required FK blocks the users delete.
	offboard.RegisterReassignable(offboard.ReassignableRef{Collection: "calendar_events", Field: "created_by"})

	// Audit logging for calendar collections. Single-org: audit rows carry no
	// org, so only the display label is customized.
	audit.RegisterCollection(app, "calendar_calendars", &audit.CollectionConfig{
		ExtractLabel: audit.LabelFromField("name"),
	})
	audit.RegisterCollection(app, "calendar_events", &audit.CollectionConfig{
		ExtractLabel: audit.LabelFromField("title"),
	})
	audit.RegisterCollection(app, "calendar_members", &audit.CollectionConfig{})

	// Auto-create a personal calendar for every new user. Single-org: the
	// deployment IS the org, so this binds to users rather than the former
	// user_org junction. The teardown side is core's (offboard.OffboardUser).
	app.OnRecordAfterCreateSuccess("users").BindFunc(func(e *core.RecordEvent) error {
		handleUserCreated(app, e.Record)
		return e.Next()
	})

	// Normalize webcal:// URLs on create/update
	app.OnRecordCreate("calendar_calendars").BindFunc(func(e *core.RecordEvent) error {
		if url := e.Record.GetString("subscription_url"); url != "" {
			e.Record.Set("subscription_url", normalizeSubscriptionURL(url))
		}
		return e.Next()
	})

	app.OnRecordUpdate("calendar_calendars").BindFunc(func(e *core.RecordEvent) error {
		if url := e.Record.GetString("subscription_url"); url != "" {
			e.Record.Set("subscription_url", normalizeSubscriptionURL(url))
		}
		return e.Next()
	})

	// Trigger immediate sync when subscription_url changes or a refresh is requested
	// (refresh clears subscription_last_sync to signal the hook)
	app.OnRecordAfterUpdateSuccess("calendar_calendars").BindFunc(func(e *core.RecordEvent) error {
		newURL := e.Record.GetString("subscription_url")
		if newURL == "" {
			return e.Next()
		}
		oldURL := e.Record.Original().GetString("subscription_url")
		oldSync := e.Record.Original().GetString("subscription_last_sync")
		newSync := e.Record.GetString("subscription_last_sync")
		urlChanged := newURL != oldURL
		refreshRequested := oldSync != "" && newSync == ""
		if urlChanged || refreshRequested {
			calId := e.Record.Id
			go func() {
				rec, err := app.FindRecordById("calendar_calendars", calId)
				if err != nil {
					return
				}
				if err := syncSubscription(app, rec); err != nil {
					app.Logger().Warn("subscription: immediate sync failed",
						"calendar", calId,
						"url", rec.GetString("subscription_url"),
						"error", err)
					errMsg := err.Error()
					if len(errMsg) > 500 {
						errMsg = errMsg[:500]
					}
					rec.Set("subscription_error", errMsg)
					rec.Set("subscription_last_sync", time.Now().UTC().Format(pbTimeFormat))
					_ = app.Save(rec)
					notifySubscriptionError(app, rec, errMsg)
				}
			}()
		}
		return e.Next()
	})

	// Trigger immediate sync when a new subscription is created
	app.OnRecordAfterCreateSuccess("calendar_calendars").BindFunc(func(e *core.RecordEvent) error {
		if url := e.Record.GetString("subscription_url"); url != "" {
			calId := e.Record.Id
			go func() {
				rec, err := app.FindRecordById("calendar_calendars", calId)
				if err != nil {
					return
				}
				if err := syncSubscription(app, rec); err != nil {
					app.Logger().Warn("subscription: immediate sync failed",
						"calendar", calId,
						"url", rec.GetString("subscription_url"),
						"error", err)
					errMsg := err.Error()
					if len(errMsg) > 500 {
						errMsg = errMsg[:500]
					}
					rec.Set("subscription_error", errMsg)
					rec.Set("subscription_last_sync", time.Now().UTC().Format(pbTimeFormat))
					_ = app.Save(rec)
					notifySubscriptionError(app, rec, errMsg)
				}
			}()
		}
		return e.Next()
	})

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		go startSubscriptionSync(app)
		go startReminderScheduler(app)
		return e.Next()
	})

	registerOwnerMembershipBootstrap(app)

	// Notify invited user when a new calendar membership is created
	app.OnRecordAfterCreateSuccess("calendar_members").BindFunc(func(e *core.RecordEvent) error {
		go notifyCalendarInvite(app, e.Record)
		return e.Next()
	})

	// Authorize calendar_members create at the Go layer. An owner-check PB rule
	// has to traverse the calendar_members back-relation, which PocketBase
	// evaluated inconsistently for non-superuser creates (always 400, even when
	// the auth user IS an owner) — that is why migration 1715400000 relaxed the
	// rule to a bare authenticated check. This hook is the real gate: only
	// owners of the calendar can add members.
	app.OnRecordCreateRequest("calendar_members").BindFunc(func(e *core.RecordRequestEvent) error {
		auth := e.Auth
		if auth == nil {
			return apis.NewUnauthorizedError("Authentication required.", nil)
		}
		// Superusers bypass: the seed script and admin tooling create
		// memberships without going through the calendar-owner flow.
		if auth.Collection().Name == core.CollectionNameSuperusers {
			return e.Next()
		}
		calendarID := e.Record.GetString("calendar")
		if calendarID == "" {
			return apis.NewBadRequestError("calendar is required.", nil)
		}
		isOwner, err := userIsOwner(app, calendarID, auth.Id)
		if err != nil {
			return err
		}
		if !isOwner {
			return apis.NewForbiddenError("Only calendar owners can add members.", nil)
		}
		return e.Next()
	})

	registerCalendarMemberAuthz(app)

	// Auto-generate ical_uid for events created via the web UI
	app.OnRecordCreate("calendar_events").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("ical_uid") == "" {
			e.Record.Set("ical_uid", "urn:uuid:"+uuid.NewString())
		}
		return e.Next()
	})

	registerRecurrenceUntilHooks(app)
}

// registerOwnerMembershipBootstrap auto-creates the creator's owner membership
// when a calendar is created via the API. The calendar_members create rule
// (migration 1830000004) admits a membership only when the caller ALREADY owns
// the calendar — which the very first membership on a new calendar cannot
// satisfy — so something privileged has to write that first row. This hook is
// it, in the single-org app and in a tenant alike (calendar's Go links into
// tenants via RegisterTenant; the interim pb-hook that duplicated this while
// tenants ran no feature Go has been deleted). Without it a calendar comes out
// with zero members: owned by nobody, manageable by nobody.
//
// Split out from registerShared so tenant-shaped tests can bind it in
// isolation (same rationale as registerCalendarMemberAuthz). Takes core.App so
// a tests.TestApp can bind it directly.
func registerOwnerMembershipBootstrap(app core.App) {
	app.OnRecordCreateRequest("calendar_calendars").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}

		auth := e.Auth
		if auth == nil {
			return nil
		}

		memberCollection, err := app.FindCollectionByNameOrId("calendar_members")
		if err != nil {
			return nil
		}

		member := core.NewRecord(memberCollection)
		member.Set("calendar", e.Record.Id)
		member.Set("user", auth.Id)
		member.Set("role", "owner")
		if err := app.Save(member); err != nil {
			app.Logger().Warn("calendar: failed to auto-create owner membership",
				"calendar", e.Record.Id, "error", err)
		}

		return nil
	})
}

// registerCalendarMemberAuthz binds the request-scoped authorization guards for
// calendar_members: the last-owner protection (delete + demotion) and the
// field-scoped role/calendar guard that blocks privilege escalation on a
// self-update. It's split out from Register so it can be exercised in isolation
// by unit tests without also binding the audit/notify/scheduler hooks (whose
// fire-and-forget goroutines race a test app's teardown). Takes core.App so a
// tests.TestApp can bind it directly.
func registerCalendarMemberAuthz(app core.App) {
	// Refuse to remove the last owner of a calendar — otherwise no one can
	// manage members or change subscriptions, and the calendar becomes
	// orphaned. Catches both delete and demotion (role-update away from
	// "owner") on the same membership.
	app.OnRecordDeleteRequest("calendar_members").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.GetString("role") == "owner" {
			calId := e.Record.GetString("calendar")
			if err := guardLastOwner(app, calId, e.Record.Id); err != nil {
				return err
			}
		}
		return e.Next()
	})

	app.OnRecordUpdateRequest("calendar_members").BindFunc(func(e *core.RecordRequestEvent) error {
		original := e.Record.Original()

		// Block demotion away from owner when it would leave zero owners.
		if original.GetString("role") == "owner" && e.Record.GetString("role") != "owner" {
			calId := original.GetString("calendar")
			if err := guardLastOwner(app, calId, e.Record.Id); err != nil {
				return err
			}
		}

		// The PB update rule lets members PATCH their own row so they can pick
		// a personal color, but PB rules are not field-scoped — without this
		// guard a viewer/editor could self-promote via {"role":"owner"} or
		// repoint the membership at another calendar. Restrict role and
		// calendar changes to calendar owners (superusers bypass, matching the
		// create hook above).
		roleChanged := e.Record.GetString("role") != original.GetString("role")
		calendarChanged := e.Record.GetString("calendar") != original.GetString("calendar")
		if roleChanged || calendarChanged {
			auth := e.Auth
			if auth == nil {
				return apis.NewUnauthorizedError("Authentication required.", nil)
			}
			if auth.Collection().Name != core.CollectionNameSuperusers {
				isOwner, err := userIsOwner(app, original.GetString("calendar"), auth.Id)
				if err != nil {
					return err
				}
				if !isOwner {
					return apis.NewForbiddenError("Only calendar owners can change member roles or calendars.", nil)
				}
				if calendarChanged {
					ownsTarget, err := userIsOwner(app, e.Record.GetString("calendar"), auth.Id)
					if err != nil {
						return err
					}
					if !ownsTarget {
						return apis.NewForbiddenError("Only calendar owners can change member roles or calendars.", nil)
					}
				}
			}
		}

		return e.Next()
	})
}

func notifyCalendarInvite(app *pocketbase.PocketBase, memberRecord *core.Record) {
	if !appIsLive(app) {
		return
	}

	role := memberRecord.GetString("role")

	// Skip notifications for owner memberships (auto-created)
	if role == "owner" {
		return
	}

	userID := memberRecord.GetString("user")
	if userID == "" {
		return
	}

	calendar, err := app.FindRecordById("calendar_calendars", memberRecord.GetString("calendar"))
	if err != nil {
		return
	}

	notify.NotifyUser(app, notify.NotifyParams{
		UserID:  userID,
		Type:    "calendar_invite",
		Package: "calendar",
		Title:   fmt.Sprintf("You were added to calendar: %s", calendar.GetString("name")),
		Body:    fmt.Sprintf("You now have %s access", role),
		URL:     "/calendar",
	})
}

// userIsOwner reports whether the given user holds an "owner" calendar_members
// row for the given calendar.
//
// Single-org: memberships point at users directly, so this is one query. It
// used to fan out over every user_org row the user held.
func userIsOwner(app core.App, calendarID, userID string) (bool, error) {
	owners, err := app.FindRecordsByFilter(
		"calendar_members",
		"calendar = {:calId} && user = {:userId} && role = 'owner'",
		"", 1, 0,
		map[string]any{"calId": calendarID, "userId": userID},
	)
	if err != nil {
		return false, err
	}
	return len(owners) > 0, nil
}

// guardLastOwner returns an error if removing or demoting the membership
// identified by excludeMemberID would leave the calendar with zero owners.
// excludeMemberID is the row about to be deleted/demoted; it's excluded from
// the count so the caller's own record doesn't keep itself alive.
func guardLastOwner(app core.App, calendarID, excludeMemberID string) error {
	owners, err := app.FindRecordsByFilter(
		"calendar_members",
		"calendar = {:calId} && role = 'owner' && id != {:excludeId}",
		"", 0, 0,
		map[string]any{"calId": calendarID, "excludeId": excludeMemberID},
	)
	if err != nil {
		return err
	}
	if len(owners) == 0 {
		return apis.NewBadRequestError("A calendar must have at least one owner.", nil)
	}
	return nil
}
