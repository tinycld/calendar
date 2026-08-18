package calendar

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/automation"
)

// registerAutomation installs calendar's owner resolver and its one native
// action. Called from registerShared before hooks load.
func registerAutomation() {
	automation.RegisterOwnerResolver("calendar:event-added", eventOwnerResolver)
	// Reschedules and removals belong to the same people the event does.
	automation.RegisterOwnerResolver("calendar:event-rescheduled", eventOwnerResolver)
	automation.RegisterOwnerResolver("calendar:event-removed", eventOwnerResolver)

	// calendar_calendars has no owner column of any kind, so this trigger
	// cannot auto-detect and has no ownerField to fall back on — without a
	// resolver, personal rules would never fire for it.
	automation.RegisterOwnerResolver("calendar:feed-sync-failed", calendarOwnerResolver)
	automation.RegisterTriggerFilter("calendar:feed-sync-failed", calendarSyncFailed)

	automation.RegisterAction("calendar:create-event", actionCreateEvent)
}

// calendarOwnerResolver maps a calendar_calendars row to its members.
//
// Unlike eventOwnerResolver, which reaches the calendar through the event's
// `calendar` relation, here the record IS the calendar.
func calendarOwnerResolver(app core.App, record *core.Record) []string {
	if record == nil {
		return nil
	}
	return calendarMemberIDs(app, record.Id)
}

// calendarSyncFailed is the TriggerFilter for "calendar:feed-sync-failed".
//
// The declaration watches subscription_error, which changes in BOTH
// directions: the sync path clears it on every success (subscription.go's
// "Mark success" block). Without this gate, a feed recovering would fire a
// rule meant for failures.
func calendarSyncFailed(app core.App, record *core.Record) bool {
	if record == nil {
		return false
	}
	return strings.TrimSpace(record.GetString("subscription_error")) != ""
}

// eventOwnerResolver maps a new calendar_events row to the users the event
// belongs to: every member of its calendar.
//
// The declaration carries ownerField: 'created_by' as a fallback for a
// deployment where this Go isn't linked, but created_by alone is too narrow —
// it scopes personal rules to whoever happened to create the event, so a
// colleague adding something to a shared calendar would never fire the other
// members' rules. Membership is the honest answer to "whose event is this".
//
// Returns nil (never an error) on absent or malformed data so org-scoped rules
// still fire when a personal owner can't be determined — same contract as
// mail's resolver.
func eventOwnerResolver(app core.App, record *core.Record) []string {
	if record == nil {
		return nil
	}

	calendarID := record.GetString("calendar")
	if calendarID == "" {
		return nil
	}
	return calendarMemberIDs(app, calendarID)
}

// calendarMemberIDs lists the users who belong to a calendar. Shared by both
// resolvers: one arrives via an event's `calendar` relation, the other with
// the calendar record itself.
func calendarMemberIDs(app core.App, calendarID string) []string {
	if calendarID == "" {
		return nil
	}

	members, err := app.FindRecordsByFilter(
		"calendar_members",
		"calendar = {:calendar}",
		"",
		0,
		0,
		map[string]any{"calendar": calendarID},
	)
	if err != nil || len(members) == 0 {
		return nil
	}

	var owners []string
	for _, member := range members {
		if userID := member.GetString("user"); userID != "" {
			owners = append(owners, userID)
		}
	}
	return owners
}

// writableCalendarRoles are the memberships that permit creating an event.
// Mirrors calendar_events' own create rule, which admits any member whose role
// is not "viewer" (migration 1715000000). The engine writes with a superuser
// Save, so that rule never runs for a rule-created event and this is the only
// thing enforcing it.
var writableCalendarRoles = map[string]bool{
	"owner":  true,
	"editor": true,
}

// ownedCalendarFor returns the calendar a rule-created event should land in:
// the one the rule's owner owns, or failing that one they can actually write
// to.
//
// Membership alone is NOT enough. Falling back to any membership put events
// into calendars where the owner is only a viewer — someone else's calendar,
// shared read-only. Resolving from memberships does make it impossible to
// write somewhere the owner has no relationship with, but belonging as a
// viewer is not permission to write, and the events collection's own create
// rule says so.
//
// Returning an error rather than picking a viewer calendar is deliberate: the
// run is recorded as failed and the author can see why, which is a better
// outcome than an event silently appearing on a colleague's calendar.
func ownedCalendarFor(app core.App, userID string) (string, error) {
	if userID == "" {
		return "", fmt.Errorf("no user to resolve a calendar for")
	}

	members, err := app.FindRecordsByFilter(
		"calendar_members",
		"user = {:user}",
		"",
		0,
		0,
		map[string]any{"user": userID},
	)
	if err != nil {
		return "", fmt.Errorf("calendar membership lookup: %w", err)
	}
	if len(members) == 0 {
		return "", fmt.Errorf("user %s belongs to no calendar", userID)
	}

	for _, member := range members {
		if member.GetString("role") == "owner" {
			if calID := member.GetString("calendar"); calID != "" {
				return calID, nil
			}
		}
	}
	for _, member := range members {
		if !writableCalendarRoles[member.GetString("role")] {
			continue
		}
		if calID := member.GetString("calendar"); calID != "" {
			return calID, nil
		}
	}
	return "", fmt.Errorf(
		"user %s has no calendar they can write to (viewer-only memberships cannot receive rule-created events)",
		userID,
	)
}

// paramInt reads a numeric param, tolerating an empty or malformed value by
// returning the supplied default. Params arrive as strings after template
// substitution, and the builder leaves an untouched number field empty.
func paramInt(params map[string]string, key string, fallback int) int {
	raw := strings.TrimSpace(params[key])
	if raw == "" {
		return fallback
	}
	// A template that resolved to a non-number ("{{subject}}" in a number
	// field) is the author's mistake, but a failed event is a worse outcome
	// than a defaulted one — and the run log records what was produced.
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}

// paramBool reads a boolean param. The builder emits "true"/"false".
func paramBool(params map[string]string, key string) bool {
	return strings.EqualFold(strings.TrimSpace(params[key]), "true")
}

const (
	defaultEventDurationMinutes = 30
	// A rule that fires "now" almost always means today, so 0 days is the
	// right default rather than an error.
	defaultStartsInDays = 0
)

// actionCreateEvent creates a calendar event on the rule owner's calendar.
//
// Native rather than a record-op because v1 params carry no date math: the
// author supplies offsets as plain numbers and this computes the actual
// start/end. The existing reminder scheduler (reminders.go) picks the row up
// from the `reminder` column with no extra wiring.
//
// Not pkgaccess-gated — native handlers receive a superuser app — so the
// calendar is resolved from the OWNER's own memberships rather than taken as
// a parameter. That is the access check: a rule can only ever create an event
// somewhere its owner already belongs.
func actionCreateEvent(app core.App, req automation.ActionRequest) error {
	if req.OwnerID == "" {
		return fmt.Errorf("calendar:create-event: no rule owner")
	}

	title := strings.TrimSpace(req.Params["title"])
	if title == "" {
		title = "(untitled)"
	}

	calendarID, err := ownedCalendarFor(app, req.OwnerID)
	if err != nil {
		return fmt.Errorf("calendar:create-event: %w", err)
	}

	collection, err := app.FindCollectionByNameOrId("calendar_events")
	if err != nil {
		return fmt.Errorf("calendar:create-event: calendar_events collection not found: %w", err)
	}

	allDay := paramBool(req.Params, "all_day")
	startsInDays := paramInt(req.Params, "starts_in_days", defaultStartsInDays)
	durationMinutes := paramInt(req.Params, "duration_minutes", defaultEventDurationMinutes)
	if durationMinutes < 0 {
		durationMinutes = defaultEventDurationMinutes
	}

	start := time.Now().UTC().AddDate(0, 0, startsInDays)
	if allDay {
		// An all-day event is a date, not a moment: anchor it to midnight so
		// it renders on the intended day rather than "now, N days later".
		start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	}
	end := start.Add(time.Duration(durationMinutes) * time.Minute)

	record := core.NewRecord(collection)
	// An explicit id up front is what lets the write be stamped below: the
	// provenance sentinel is keyed by record id, so it has to exist before Save.
	record.Set("id", core.GenerateDefaultRandomId())
	record.Set("calendar", calendarID)
	record.Set("created_by", req.OwnerID)
	record.Set("title", title)
	record.Set("description", req.Params["description"])
	record.Set("start", start.Format(pbTimeFormat))
	record.Set("end", end.Format(pbTimeFormat))
	record.Set("all_day", allDay)
	record.Set("guests", []any{})
	// Schema-required fields the codec would otherwise leave empty, matching
	// the subscription importer's create path.
	for field, value := range calDAVSource.Event.Defaults {
		if record.Get(field) == nil || record.GetString(field) == "" {
			record.Set(field, value)
		}
	}
	if reminder := paramInt(req.Params, "reminder_minutes", 0); reminder > 0 {
		record.Set("reminder", reminder)
	}

	// calendar:event-added watches calendar_events, so this create fires the
	// very trigger that can invoke this action. Stamping provenance carries the
	// firing's depth onto the new row, which is what makes such a rule stop at
	// the chain-depth cap instead of creating events forever.
	if err := automation.MarkEngineWrite(req, record.Id, func() error { return app.Save(record) }); err != nil {
		return fmt.Errorf("calendar:create-event: %w", err)
	}
	return nil
}
