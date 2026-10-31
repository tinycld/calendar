package calendar

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/teambition/rrule-go"
	"tinycld.org/core/appstate"
	"tinycld.org/core/caldav"
	"tinycld.org/core/notify"
	"tinycld.org/core/readonly"
)

// sentRemindersKey holds the app's dedupe of sent reminders, so the same
// event-fire-minute isn't notified twice across overlapping ticker windows.
// key: "eventID-fireMinute" → time.Time. Per app: an event id is unique only
// in its app.
var sentRemindersKey = appstate.NewKey[*sync.Map]("calendar.sentReminders")

func sentRemindersFor(app core.App) *sync.Map {
	return sentRemindersKey.GetOrInit(app, func() *sync.Map { return &sync.Map{} })
}

// reminderWindow is how far past each check a reminder may fire and still be
// sent by it: wider than the ticker's interval, so consecutive windows
// overlap (sentReminders removes the duplicates).
const reminderWindow = 90 * time.Second

// reminderMaxCatchUp bounds how late a reminder that fell due while the
// server was read-only is still sent: the same bound a tail write waits for
// the mode to end. Past it, "starts in 10 minutes" would be wrong.
const reminderMaxCatchUp = readonly.TailWait

// startReminderScheduler sends due reminders every minute until ctx ends
// (the app's terminate).
func startReminderScheduler(ctx context.Context, app core.App) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	s := newReminderScheduler(time.Now().UTC())
	s.tick(app, time.Now().UTC())

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.tick(app, time.Now().UTC())
			cleanExpiredReminderEntries(app)
		}
	}
}

// reminderScheduler skips a tick while the server is read-only, as core's
// cron guard skips a due cron job, rather than wait: a waiting tick would
// send nothing sooner. Skipping alone would lose every reminder that falls
// due in the pause, so the first tick after it also checks from where the
// last full check stopped, at most reminderMaxCatchUp back.
type reminderScheduler struct {
	// coveredUntil is the end of the last window checked in full.
	coveredUntil time.Time
}

func newReminderScheduler(start time.Time) *reminderScheduler {
	return &reminderScheduler{coveredUntil: start}
}

func (s *reminderScheduler) tick(app core.App, now time.Time) {
	if readonly.Active(app) {
		return
	}
	from := now
	if s.coveredUntil.Before(now) {
		from = s.coveredUntil
		if oldest := now.Add(-reminderMaxCatchUp); from.Before(oldest) {
			from = oldest
		}
	}
	if windowEnd, done := checkReminders(app, from, now); done {
		s.coveredUntil = windowEnd
	}
}

// checkReminders sends the reminders that fire in [from, now+reminderWindow].
// It returns the window's end, and whether it checked the whole window: it
// stops when the server turns read-only, before the next reminder's write.
func checkReminders(app core.App, from, now time.Time) (time.Time, bool) {
	windowEnd := now.Add(reminderWindow)
	lookahead := now.Add(24 * time.Hour)

	fromStr := from.Format(reminderTimeFormat)
	lookaheadStr := lookahead.Format(reminderTimeFormat)

	// Two kinds of events can have a reminder fire in the next window:
	//   - a non-recurring event whose single start lands in [from, lookahead];
	//   - a recurring event whose base start is already at/before lookahead and
	//     whose series hasn't ended — one of its EXPANDED occurrences may fall
	//     in the window even though the base start is far in the past. Windowing
	//     only on `start` (the old filter) meant recurring reminders never fired
	//     server-side; it was masked on web because the client expands the rule.
	records, err := app.FindRecordsByFilter(
		"calendar_events",
		"reminder > 0 && ("+
			"(recurrence = '' && start >= {:from} && start <= {:lookahead}) || "+
			"(recurrence != '' && start <= {:lookahead} && "+
			"(recurrence_until = '' || recurrence_until >= {:from}))"+
			")",
		"",
		0,
		0,
		map[string]any{
			"from":      fromStr,
			"lookahead": lookaheadStr,
		},
	)
	if err != nil {
		app.Logger().Warn("calendar/reminders: failed to query events", "error", err)
		return windowEnd, false
	}

	for _, event := range records {
		reminderMinutes := event.GetFloat("reminder")
		if reminderMinutes <= 0 {
			continue
		}

		for _, occStart := range occurrenceStartsInWindow(app, event, from, lookahead) {
			fireTime := occStart.Add(-time.Duration(reminderMinutes) * time.Minute)
			if fireTime.Before(from) || fireTime.After(windowEnd) {
				continue
			}

			// Before the dedup mark: a reminder skipped here must still be
			// sent by the catch-up after the pause.
			if readonly.Active(app) {
				return windowEnd, false
			}
			dedup := fmt.Sprintf("%s-%d", event.Id, fireTime.Unix()/60)
			if _, loaded := sentRemindersFor(app).LoadOrStore(dedup, time.Now()); loaded {
				continue
			}

			notifyReminderMembers(app, event, reminderMinutes)
		}
	}
	return windowEnd, true
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

	rule := caldav.RecurrenceToRRule(rec)
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
		userID := member.GetString("user")
		if userID == "" {
			continue
		}

		notify.NotifyUser(app, notify.NotifyParams{
			UserID:  userID,
			Type:    "calendar_reminder",
			Package: "calendar",
			Title:   title,
			Body:    fmt.Sprintf("Starts in %.0f minutes", reminderMinutes),
			URL:     fmt.Sprintf("/calendar/%s", event.Id),
		})
	}
}

func cleanExpiredReminderEntries(app core.App) {
	cutoff := time.Now().Add(-24 * time.Hour)
	sent := sentRemindersFor(app)
	sent.Range(func(key, value any) bool {
		if t, ok := value.(time.Time); ok && t.Before(cutoff) {
			sent.Delete(key)
		}
		return true
	})
}
