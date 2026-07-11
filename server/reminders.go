package calendar

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/teambition/rrule-go"
	"tinycld.org/core/notify"
)

// sentReminders dedups reminders so the same event-fire-minute isn't
// notified twice across overlapping ticker windows.
var sentReminders sync.Map // key: "eventID-fireMinute" → time.Time

func startReminderScheduler(app *pocketbase.PocketBase) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	checkReminders(app)

	for range ticker.C {
		checkReminders(app)
		cleanExpiredReminderEntries()
	}
}

func checkReminders(app *pocketbase.PocketBase) {
	if !appIsLive(app) {
		return
	}

	now := time.Now().UTC()
	windowEnd := now.Add(90 * time.Second)
	lookahead := now.Add(24 * time.Hour)

	nowStr := now.Format(reminderTimeFormat)
	lookaheadStr := lookahead.Format(reminderTimeFormat)

	// Two kinds of events can have a reminder fire in the next window:
	//   - a non-recurring event whose single start lands in [now, lookahead];
	//   - a recurring event whose base start is already at/before lookahead and
	//     whose series hasn't ended — one of its EXPANDED occurrences may fall
	//     in the window even though the base start is far in the past. Windowing
	//     only on `start` (the old filter) meant recurring reminders never fired
	//     server-side; it was masked on web because the client expands the rule.
	records, err := app.FindRecordsByFilter(
		"calendar_events",
		"reminder > 0 && ("+
			"(recurrence = '' && start >= {:now} && start <= {:lookahead}) || "+
			"(recurrence != '' && start <= {:lookahead} && "+
			"(recurrence_until = '' || recurrence_until >= {:now}))"+
			")",
		"",
		0,
		0,
		map[string]any{
			"now":       nowStr,
			"lookahead": lookaheadStr,
		},
	)
	if err != nil {
		app.Logger().Warn("calendar/reminders: failed to query events", "error", err)
		return
	}

	for _, event := range records {
		reminderMinutes := event.GetFloat("reminder")
		if reminderMinutes <= 0 {
			continue
		}

		for _, occStart := range occurrenceStartsInWindow(app, event, now, lookahead) {
			fireTime := occStart.Add(-time.Duration(reminderMinutes) * time.Minute)
			if fireTime.Before(now) || fireTime.After(windowEnd) {
				continue
			}

			dedup := fmt.Sprintf("%s-%d", event.Id, fireTime.Unix()/60)
			if _, loaded := sentReminders.LoadOrStore(dedup, time.Now()); loaded {
				continue
			}

			notifyReminderMembers(app, event, reminderMinutes)
		}
	}
}

// reminderTimeFormat matches how PocketBase stores calendar_events datetimes
// (see pbTimeFormat) so filter binds and Time parsing agree.
const reminderTimeFormat = "2006-01-02 15:04:05.000Z"

// occurrenceStartsInWindow returns the concrete start times of an event that
// fall within [now, lookahead]. A non-recurring event contributes its single
// start; a recurring event is expanded from its rule so reminders fire for the
// upcoming occurrence, not just the base start.
func occurrenceStartsInWindow(
	app core.App,
	event *core.Record,
	now, lookahead time.Time,
) []time.Time {
	baseStart, err := time.Parse(reminderTimeFormat, event.GetString("start"))
	if err != nil {
		return nil
	}

	starts, err := expandOccurrenceStarts(event.GetString("recurrence"), baseStart, now, lookahead)
	if err != nil {
		app.Logger().Warn("calendar/reminders: bad recurrence rule",
			"event", event.Id, "recurrence", event.GetString("recurrence"), "error", err)
		return nil
	}
	return starts
}

// expandOccurrenceStarts is the pure core of occurrenceStartsInWindow: given a
// recurrence value and a base start, it returns the occurrence starts inside
// [now, lookahead]. Non-recurring events yield at most their single start;
// recurring events are expanded via rrule-go anchored at baseStart.
func expandOccurrenceStarts(
	rec string,
	baseStart, now, lookahead time.Time,
) ([]time.Time, error) {
	if strings.TrimSpace(rec) == "" {
		if baseStart.Before(now) || baseStart.After(lookahead) {
			return nil, nil
		}
		return []time.Time{baseStart}, nil
	}

	rule := recurrenceToRRule(rec)
	if rule == "" {
		return nil, nil
	}
	if !strings.HasPrefix(strings.ToUpper(rule), "RRULE:") {
		rule = "RRULE:" + rule
	}
	r, err := rrule.StrToRRule(rule)
	if err != nil {
		return nil, err
	}
	r.DTStart(baseStart.UTC())
	// inc=true so an occurrence exactly at `now` is still considered.
	return r.Between(now, lookahead, true), nil
}

func notifyReminderMembers(app core.App, event *core.Record, reminderMinutes float64) {
	calendarID := event.GetString("calendar")
	title := event.GetString("title")

	members, err := app.FindRecordsByFilter(
		"calendar_members",
		"calendar = {:calendarId}",
		"",
		0,
		0,
		map[string]any{"calendarId": calendarID},
	)
	if err != nil {
		app.Logger().Warn("calendar/reminders: failed to query members",
			"calendar", calendarID, "error", err)
		return
	}

	for _, member := range members {
		userOrgRecord, err := app.FindRecordById("user_org", member.GetString("user_org"))
		if err != nil {
			continue
		}
		userID := userOrgRecord.GetString("user")
		orgID := userOrgRecord.GetString("org")
		orgSlug := lookupOrgSlug(app, orgID)

		notify.NotifyUser(app, notify.NotifyParams{
			UserID:  userID,
			OrgID:   orgID,
			Type:    "calendar_reminder",
			Package: "calendar",
			Title:   title,
			Body:    fmt.Sprintf("Starts in %.0f minutes", reminderMinutes),
			URL:     fmt.Sprintf("/a/%s/calendar/%s", orgSlug, event.Id),
		})
	}
}

func lookupOrgSlug(app core.App, orgID string) string {
	record, err := app.FindRecordById("orgs", orgID)
	if err != nil {
		return ""
	}
	return record.GetString("slug")
}

func cleanExpiredReminderEntries() {
	cutoff := time.Now().Add(-24 * time.Hour)
	sentReminders.Range(func(key, value any) bool {
		if t, ok := value.(time.Time); ok && t.Before(cutoff) {
			sentReminders.Delete(key)
		}
		return true
	})
}
