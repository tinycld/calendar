package cli

import (
	"context"
	"time"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
)

// newAgendaCmd answers "what is coming up" — the question a calendar CLI is
// most often opened for. Deliberately a separate command from `events` rather
// than a flag on it: a relative window from now is a different question from
// an explicit date range, and collapsing them makes both harder to type.
func newAgendaCmd(c *client.Client) *cobra.Command {
	var (
		days        int
		calendarRef string
	)
	cmd := &cobra.Command{
		Use:     "agenda",
		Short:   "What is coming up, across your calendars",
		Args:    cobra.NoArgs,
		Aliases: []string{"next"},
		Example: "  tinycld calendar agenda\n" +
			"  tinycld calendar agenda --days 30 --calendar Work",
		RunE: func(cmd *cobra.Command, _ []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()

			calendarID, err := optionalCalendarID(ctx, c, calendarRef)
			if err != nil {
				return err
			}

			// From now, not from midnight: an agenda that leads with meetings
			// already over is the thing a person has to read past every time.
			now := time.Now()
			events, err := eventsBetween(ctx, c, calendarID, now, now.AddDate(0, 0, days))
			if err != nil {
				return err
			}

			names, err := calendarNames(ctx, c)
			if err != nil {
				return err
			}
			rows := make([][]string, len(events))
			for i, e := range events {
				rows[i] = []string{
					formatWhen(e), e.Title, names[e.Calendar], e.Location, guestSummary(e), e.ID,
				}
			}
			if err := o.Write(cmd.OutOrStdout(),
				[]string{"WHEN", "EVENT", "CALENDAR", "WHERE", "GUESTS", "ID"}, rows, events); err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "%d event(s) in the next %d day(s)", len(events), days)
			return nil
		},
	}
	fl := cmd.Flags()
	fl.IntVar(&days, "days", 7, "how many days ahead to look")
	fl.StringVar(&calendarRef, "calendar", "", "restrict to one calendar (id or name)")
	return cmd
}

func newListCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list",
		Short:   "List the calendars you can see",
		Args:    cobra.NoArgs,
		Aliases: []string{"ls", "calendars"},
		RunE: func(cmd *cobra.Command, _ []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			calendars, err := visibleCalendars(ctx, c)
			if err != nil {
				return err
			}

			// A calendar's role decides whether writes will be accepted, so it
			// belongs in the listing rather than being discovered by a failed
			// `add`.
			roles, err := myRoles(ctx, c)
			if err != nil {
				return err
			}
			rows := make([][]string, len(calendars))
			for i, cal := range calendars {
				kind := "calendar"
				if cal.SubscriptionURL != "" {
					kind = "subscription"
				}
				rows[i] = []string{cal.Name, roles[cal.ID], kind, cal.Color, cal.ID}
			}
			return o.Write(cmd.OutOrStdout(),
				[]string{"NAME", "ROLE", "KIND", "COLOR", "ID"}, rows, calendars)
		},
	}
	return cmd
}

// newEventsCmd is the explicit-range read, for scripting and for looking back.
func newEventsCmd(c *client.Client) *cobra.Command {
	var from, to, calendarRef string
	cmd := &cobra.Command{
		Use:   "events",
		Short: "List events in a date range",
		Long: "List events in a date range.\n\n" +
			"--from defaults to today and --to to 30 days after it. The range is\n" +
			"half-open: an event starting exactly at --to is not included.",
		Args: cobra.NoArgs,
		Example: "  tinycld calendar events --from 2026-08-01 --to 2026-09-01\n" +
			"  tinycld calendar events --calendar Work --json",
		RunE: func(cmd *cobra.Command, _ []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()

			start := time.Now().Truncate(24 * time.Hour)
			if from != "" {
				if start, err = parseWhen(from); err != nil {
					return err
				}
			}
			end := start.AddDate(0, 0, 30)
			if to != "" {
				if end, err = parseWhen(to); err != nil {
					return err
				}
			}
			if !end.After(start) {
				return errRangeOrder
			}

			calendarID, err := optionalCalendarID(ctx, c, calendarRef)
			if err != nil {
				return err
			}
			events, err := eventsBetween(ctx, c, calendarID, start, end)
			if err != nil {
				return err
			}

			names, err := calendarNames(ctx, c)
			if err != nil {
				return err
			}
			rows := make([][]string, len(events))
			for i, e := range events {
				rows[i] = []string{
					formatWhen(e), e.Title, names[e.Calendar], e.Location, guestSummary(e), e.ID,
				}
			}
			return o.Write(cmd.OutOrStdout(),
				[]string{"WHEN", "EVENT", "CALENDAR", "WHERE", "GUESTS", "ID"}, rows, events)
		},
	}
	fl := cmd.Flags()
	fl.StringVar(&from, "from", "", "start of the range (default: today)")
	fl.StringVar(&to, "to", "", "end of the range, exclusive (default: 30 days out)")
	fl.StringVar(&calendarRef, "calendar", "", "restrict to one calendar (id or name)")
	return cmd
}

// newShowCmd renders one event as a field/value table rather than a row, so
// the description and the full guest list stay readable.
func newShowCmd(c *client.Client) *cobra.Command {
	return &cobra.Command{
		Use:     "show <id>",
		Short:   "Show one event in full",
		Args:    cobra.ExactArgs(1),
		Aliases: []string{"view"},
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			e, err := fetchEvent(ctx, c, args[0])
			if err != nil {
				return err
			}
			names, err := calendarNames(ctx, c)
			if err != nil {
				return err
			}

			rows := [][]string{
				{"Title", e.Title},
				{"Calendar", names[e.Calendar]},
				{"Start", formatWhen(e)},
				{"End", e.End},
				{"All day", yesNo(e.AllDay)},
				{"Location", e.Location},
				{"Recurrence", orDash(e.Recurrence)},
				{"Busy", e.BusyStatus},
				{"Visibility", e.Visibility},
				{"Description", e.Description},
				{"ID", e.ID},
			}
			for _, g := range e.Guests {
				rows = append(rows, []string{"Guest", guestLine(g)})
			}
			return o.Write(cmd.OutOrStdout(), []string{"FIELD", "VALUE"}, rows, e)
		},
	}
}

// optionalCalendarID resolves a --calendar reference, or "" when unset.
func optionalCalendarID(ctx context.Context, c *client.Client, ref string) (string, error) {
	if ref == "" {
		return "", nil
	}
	cal, err := resolveCalendar(ctx, c, ref)
	if err != nil {
		return "", err
	}
	return cal.ID, nil
}

// calendarNames maps calendar id → name so a table can print the name against
// an event. One read, not one per event.
func calendarNames(ctx context.Context, c *client.Client) (map[string]string, error) {
	calendars, err := visibleCalendars(ctx, c)
	if err != nil {
		return nil, err
	}
	names := make(map[string]string, len(calendars))
	for _, cal := range calendars {
		names[cal.ID] = cal.Name
	}
	return names, nil
}

// myRoles maps calendar id → the caller's role on it. The membership list rule
// already restricts the rows to the caller's own, so this needs no filter.
func myRoles(ctx context.Context, c *client.Client) (map[string]string, error) {
	userID, err := c.UserID(ctx)
	if err != nil {
		return nil, err
	}
	members, err := client.ListAll[member](ctx, c, membersCollection,
		client.Filter("user = {:u}", map[string]any{"u": userID}), "id")
	if err != nil {
		return nil, err
	}
	roles := make(map[string]string, len(members))
	for _, m := range members {
		roles[m.Calendar] = m.Role
	}
	return roles, nil
}

func guestLine(g guest) string {
	label := g.Email
	if g.Name != "" {
		label = g.Name + " <" + g.Email + ">"
	}
	rsvp := g.RSVP
	if rsvp == "" {
		rsvp = "pending"
	}
	return label + " — " + rsvp
}

func yesNo(v bool) string {
	if v {
		return "yes"
	}
	return "no"
}

func orDash(v string) string {
	if v == "" {
		return "-"
	}
	return v
}
