package cli

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"tinycld.org/cli/client"
)

const (
	calendarsCollection = "calendar_calendars"
	eventsCollection    = "calendar_events"
	membersCollection   = "calendar_members"
)

// errRangeOrder rejects an inverted window. Left to the server it would come
// back as an empty result, which reads as "nothing scheduled" rather than as
// the typo it is.
var errRangeOrder = errors.New("--to must be after --from")

// pbTimeLayout is how PocketBase stores and returns a date field. Parsing is
// tolerant (see parseEventTime) because the API has historically returned both
// this and RFC3339 depending on the path.
const pbTimeLayout = "2006-01-02 15:04:05.000Z"

// calendar mirrors the `calendar_calendars` collection; event mirrors
// `calendar_events`. Hand-mirrored rather than imported: the generated TS
// types are not reachable from Go, and this module deliberately does not
// depend on tinycld.org/core (see gen-cli.ts). A field renamed in a migration
// and not here fails at RUNTIME, which is why the tests assert on the wire
// body rather than on the struct.
type calendar struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Color       string `json:"color"`
	// A subscribed calendar is read-only in practice: the sync overwrites it.
	SubscriptionURL string `json:"subscription_url"`
	Updated         string `json:"updated"`
}

// guest mirrors the EventGuest shape stored in the events `guests` JSON
// column. RSVP is the field `calendar rsvp` writes.
type guest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	RSVP  string `json:"rsvp"`
	Role  string `json:"role"`
}

type event struct {
	ID          string  `json:"id"`
	Calendar    string  `json:"calendar"`
	CreatedBy   string  `json:"created_by"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Location    string  `json:"location"`
	Start       string  `json:"start"`
	End         string  `json:"end"`
	AllDay      bool    `json:"all_day"`
	Recurrence  string  `json:"recurrence"`
	Guests      []guest `json:"guests"`
	Reminder    int     `json:"reminder"`
	BusyStatus  string  `json:"busy_status"`
	Visibility  string  `json:"visibility"`
	Updated     string  `json:"updated"`
}

// member mirrors `calendar_members`. Only the fields the CLI reads.
type member struct {
	ID       string `json:"id"`
	Calendar string `json:"calendar"`
	User     string `json:"user"`
	Role     string `json:"role"`
}

// visibleCalendars lists every calendar the caller can see. Unfiltered: the
// list rule already scopes the result to the caller's memberships, so a filter
// here would be a second, drifting copy of that boundary.
func visibleCalendars(ctx context.Context, c *client.Client) ([]calendar, error) {
	return client.ListAll[calendar](ctx, c, calendarsCollection, "", "name,id")
}

// resolveCalendar turns a user-supplied reference into one calendar. Ids are
// tried first, then an exact name, then a case-insensitive one — the sidebar
// shows names and never ids, so requiring an id would mean opening the app to
// use the CLI.
func resolveCalendar(ctx context.Context, c *client.Client, ref string) (calendar, error) {
	calendars, err := visibleCalendars(ctx, c)
	if err != nil {
		return calendar{}, err
	}
	for _, cal := range calendars {
		if cal.ID == ref {
			return cal, nil
		}
	}
	for _, cal := range calendars {
		if cal.Name == ref {
			return cal, nil
		}
	}
	lower := strings.ToLower(ref)
	for _, cal := range calendars {
		if strings.ToLower(cal.Name) == lower {
			return cal, nil
		}
	}
	return calendar{}, fmt.Errorf(
		"no calendar matching %q (see `tinycld calendar list`)", ref)
}

// fetchEvent reads one event by id, turning the API's 404 into a message
// naming what the user actually typed.
func fetchEvent(ctx context.Context, c *client.Client, id string) (event, error) {
	found, err := client.GetRecord[event](ctx, c, eventsCollection, id)
	if err != nil {
		return event{}, fmt.Errorf("%s: %w", id, err)
	}
	return found, nil
}

// eventsBetween reads the caller's events in a half-open window [from, to).
//
// Unscoped by calendar on purpose: the list rule already limits the rows to
// calendars the caller belongs to, and an agenda spanning every calendar is
// what a person means by "what's next". Pass calendarID to narrow it.
func eventsBetween(
	ctx context.Context,
	c *client.Client,
	calendarID string,
	from, to time.Time,
) ([]event, error) {
	filter := client.Filter("start >= {:from} && start < {:to}", map[string]any{
		"from": from.UTC().Format(pbTimeLayout),
		"to":   to.UTC().Format(pbTimeLayout),
	})
	if calendarID != "" {
		filter += client.Filter(" && calendar = {:cal}", map[string]any{"cal": calendarID})
	}
	return client.ListAll[event](ctx, c, eventsCollection, filter, "start,id")
}

// parseEventTime reads a stored timestamp. PocketBase returns the space-
// separated form, but an RFC3339 value survives a round trip through some
// paths, so both are accepted rather than rendering a raw string on mismatch.
func parseEventTime(v string) (time.Time, bool) {
	for _, layout := range []string{pbTimeLayout, "2006-01-02 15:04:05Z", time.RFC3339} {
		if t, err := time.Parse(layout, v); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// formatWhen renders an event's time for a table cell.
//
// An all-day event has a meaningless clock component — showing "00:00" for
// every one of them is noise a reader has to learn to ignore — so only the
// date is shown.
func formatWhen(e event) string {
	start, ok := parseEventTime(e.Start)
	if !ok {
		return e.Start
	}
	if e.AllDay {
		return start.Local().Format("2006-01-02") + " (all day)"
	}
	return start.Local().Format("2006-01-02 15:04")
}

// parseWhen reads a user-supplied time. A bare date is accepted so
// `--start 2026-08-20` works for an all-day event without the user having to
// type a midnight clock time.
func parseWhen(v string) (time.Time, error) {
	v = strings.TrimSpace(v)
	for _, layout := range []string{
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
	} {
		if t, err := time.ParseInLocation(layout, v, time.Local); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf(
		"cannot read %q as a time: use 2026-08-20, \"2026-08-20 14:30\", or an RFC3339 timestamp", v)
}

// guestSummary renders the guest list for a table cell: who, and how many have
// not answered, since that is the part a person acts on.
func guestSummary(e event) string {
	if len(e.Guests) == 0 {
		return "-"
	}
	pending := 0
	for _, g := range e.Guests {
		if g.RSVP == "pending" || g.RSVP == "" {
			pending++
		}
	}
	if pending == 0 {
		return fmt.Sprintf("%d", len(e.Guests))
	}
	return fmt.Sprintf("%d (%d pending)", len(e.Guests), pending)
}
