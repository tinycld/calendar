package cli

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
	"tinycld.org/cli/ui"
)

// validRecurrence is the stored vocabulary (types.ts `Recurrence`). Checked
// here so a typo fails naming the accepted values, rather than as a server
// error about a field the user never typed.
var validRecurrence = []string{"daily", "weekly", "monthly", "yearly"}

func newAddCmd(c *client.Client) *cobra.Command {
	var (
		calendarRef string
		title       string
		start       string
		end         string
		allDay      bool
		location    string
		description string
		guests      []string
		recurrence  string
		reminder    int
		busy        string
	)
	cmd := &cobra.Command{
		Use:     "add",
		Short:   "Add an event",
		Args:    cobra.NoArgs,
		Aliases: []string{"new", "create"},
		Long: "Add an event.\n\n" +
			"Times accept 2026-08-20, \"2026-08-20 14:30\", or an RFC3339 timestamp.\n" +
			"Without --end an event lasts an hour, or the whole day with --all-day.\n\n" +
			"You must be an owner or editor of the calendar — see the ROLE column\n" +
			"in `tinycld calendar list`.",
		Example: "  tinycld calendar add --calendar Work --title Standup --start \"2026-08-20 09:30\"\n" +
			"  tinycld calendar add --calendar Work --title Offsite --start 2026-09-01 --all-day \\\n" +
			"      --guest ada@example.com --guest grace@example.com",
		RunE: func(cmd *cobra.Command, _ []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()

			if title == "" {
				return fmt.Errorf("--title is required")
			}
			if start == "" {
				return fmt.Errorf("--start is required")
			}
			if calendarRef == "" {
				return fmt.Errorf("--calendar is required (a calendar id or name; see `tinycld calendar list`)")
			}
			if recurrence != "" && !slices.Contains(validRecurrence, recurrence) {
				return fmt.Errorf("--recurrence must be one of %s", strings.Join(validRecurrence, ", "))
			}
			if busy != "busy" && busy != "free" {
				return fmt.Errorf("--busy must be busy or free")
			}

			cal, err := resolveCalendar(ctx, c, calendarRef)
			if err != nil {
				return err
			}

			startAt, err := parseWhen(start)
			if err != nil {
				return err
			}
			endAt, err := resolveEnd(end, startAt, allDay)
			if err != nil {
				return err
			}

			body := map[string]any{
				"calendar":    cal.ID,
				"title":       title,
				"start":       startAt.UTC().Format(pbTimeLayout),
				"end":         endAt.UTC().Format(pbTimeLayout),
				"all_day":     allDay,
				"location":    location,
				"description": description,
				"recurrence":  recurrence,
				"reminder":    reminder,
				// Required selects with no schema default — omitting either is
				// rejected as "cannot be blank".
				"busy_status": busy,
				"visibility":  "default",
			}
			// created_by is set explicitly: it is a required relation, and the
			// events create rule reaches through the calendar rather than
			// defaulting this.
			userID, err := c.UserID(ctx)
			if err != nil {
				return err
			}
			body["created_by"] = userID
			if len(guests) > 0 {
				body["guests"] = buildGuests(guests)
			}

			created, err := client.CreateRecord[event](ctx, c, eventsCollection, body)
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "added %q to %s", created.Title, cal.Name)
			return o.Write(cmd.OutOrStdout(),
				[]string{"WHEN", "EVENT", "ID"},
				[][]string{{formatWhen(created), created.Title, created.ID}},
				created)
		},
	}
	fl := cmd.Flags()
	fl.StringVar(&calendarRef, "calendar", "", "calendar to add to (id or name)")
	fl.StringVar(&title, "title", "", "event title")
	fl.StringVar(&start, "start", "", "when it starts")
	fl.StringVar(&end, "end", "", "when it ends (default: one hour after start)")
	fl.BoolVar(&allDay, "all-day", false, "an all-day event")
	fl.StringVar(&location, "location", "", "where it is")
	fl.StringVar(&description, "description", "", "longer notes")
	fl.StringArrayVar(&guests, "guest", nil, "invite an email address (repeatable)")
	fl.StringVar(&recurrence, "recurrence", "", "daily|weekly|monthly|yearly")
	fl.IntVar(&reminder, "reminder", 0, "minutes before the start to remind")
	fl.StringVar(&busy, "busy", "busy", "busy|free — how the time shows to others")
	return cmd
}

// resolveEnd picks the end time. An all-day event runs to the next midnight,
// matching how the app stores one; anything else defaults to an hour.
func resolveEnd(end string, startAt time.Time, allDay bool) (time.Time, error) {
	if end != "" {
		endAt, err := parseWhen(end)
		if err != nil {
			return time.Time{}, err
		}
		if !endAt.After(startAt) {
			return time.Time{}, fmt.Errorf("--end must be after --start")
		}
		return endAt, nil
	}
	if allDay {
		return startAt.AddDate(0, 0, 1), nil
	}
	return startAt.Add(time.Hour), nil
}

// buildGuests turns --guest flags into the stored guest shape. Everyone starts
// pending; the organizer is whoever created the event, which the record's
// created_by already records, so no guest is marked organizer here.
func buildGuests(emails []string) []guest {
	out := make([]guest, 0, len(emails))
	for _, email := range emails {
		email = strings.TrimSpace(email)
		if email == "" {
			continue
		}
		out = append(out, guest{Email: email, RSVP: "pending", Role: "attendee"})
	}
	return out
}

func newRmCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "rm <id>",
		Short: "Delete an event",
		Long: "Delete an event.\n\n" +
			"Calendar events have no trash — this removes the record. You must be\n" +
			"an owner or editor of the event's calendar.",
		Args:    cobra.ExactArgs(1),
		Aliases: []string{"delete", "remove"},
		RunE: func(cmd *cobra.Command, args []string) error {
			o, yes, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			e, err := fetchEvent(ctx, c, args[0])
			if err != nil {
				return err
			}

			// Named and dated in the prompt: an id alone gives a person no way
			// to tell they are about to delete the wrong meeting. And there is
			// no trash to recover from.
			ok, err := ui.Confirm(o, yes, cmd.InOrStdin(), cmd.ErrOrStderr(),
				fmt.Sprintf("Delete %q on %s? This cannot be undone.", e.Title, formatWhen(e)))
			if err != nil {
				return err
			}
			if !ok {
				return nil
			}

			if err := client.DeleteRecord(ctx, c, eventsCollection, e.ID); err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "deleted %q", e.Title)
			return nil
		},
	}
	return cmd
}

// rsvpValues maps what a person types to what the schema stores. "maybe" is
// the word people use; "tentative" is what iCalendar and the app call it.
var rsvpValues = map[string]string{
	"yes":       "accepted",
	"accepted":  "accepted",
	"no":        "declined",
	"declined":  "declined",
	"maybe":     "tentative",
	"tentative": "tentative",
}

// newRSVPCmd answers an invitation by rewriting the caller's own entry in the
// event's guest list.
//
// The guest list is a JSON column, so this is a read-modify-write rather than
// a targeted update. That is a lost-update race if two guests answer at the
// same instant — acceptable here because the app has the same shape and the
// blast radius is one RSVP, but it is the reason this does not silently create
// a guest entry: a caller who is not on the list gets told so.
func newRSVPCmd(c *client.Client) *cobra.Command {
	return &cobra.Command{
		Use:   "rsvp <id> yes|no|maybe",
		Short: "Answer an invitation",
		Args:  cobra.ExactArgs(2),
		Example: "  tinycld calendar rsvp evt123 yes\n" +
			"  tinycld calendar rsvp evt123 maybe",
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()

			answer, ok := rsvpValues[strings.ToLower(args[1])]
			if !ok {
				return fmt.Errorf("answer must be yes, no, or maybe (got %q)", args[1])
			}

			e, err := fetchEvent(ctx, c, args[0])
			if err != nil {
				return err
			}
			email, err := myEmail(ctx, c)
			if err != nil {
				return err
			}

			updated := make([]guest, len(e.Guests))
			copy(updated, e.Guests)
			found := false
			for i := range updated {
				if strings.EqualFold(updated[i].Email, email) {
					updated[i].RSVP = answer
					found = true
				}
			}
			if !found {
				return fmt.Errorf("you (%s) are not on the guest list for %q", email, e.Title)
			}

			if _, err := client.UpdateRecord[event](ctx, c, eventsCollection, e.ID,
				map[string]any{"guests": updated}); err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "replied %s to %q", answer, e.Title)
			return nil
		},
	}
}

// myEmail reads the caller's own address, which is how they are identified in
// a guest list (the list stores addresses, not user ids).
func myEmail(ctx context.Context, c *client.Client) (string, error) {
	userID, err := c.UserID(ctx)
	if err != nil {
		return "", err
	}
	type userRow struct {
		Email string `json:"email"`
	}
	u, err := client.GetRecord[userRow](ctx, c, "users", userID)
	if err != nil {
		return "", err
	}
	if u.Email == "" {
		return "", fmt.Errorf("your account has no email address to match against a guest list")
	}
	return u.Email, nil
}
