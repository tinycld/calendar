// Package cli contributes the `tinycld calendar` command group.
//
// Most commands are pure HTTP clients over the PocketBase record REST API —
// calendar has no bespoke CRUD endpoint, and should not grow one: the
// calendar_calendars / calendar_events access rules are the whole
// authorization for any caller that does not pass through a hook, so a Go
// endpoint could only ADD to what the rules already enforce.
//
// Three things a reader should know before extending this package:
//
//   - ACCESS IS BY MEMBERSHIP, IN TWO TIERS. Reading a calendar means being a
//     member in any role; writing an event means being an owner or an editor.
//     Nothing in this package enforces that — the rules do, server-side — but
//     it explains why a command can list a calendar and still be refused when
//     it writes, and why `rm` on someone else's event returns not-found rather
//     than a permission error.
//
//   - SEARCH IS FEDERATED. Calendar contributes a source to core's
//     /api/search, so `tinycld search "pkg:calendar standup"` already works.
//     There is deliberately no `calendar search` here that duplicates it.
//
//   - EXPORT/IMPORT ARE THE ONLY TYPED ROUTES, and they must be. The iCalendar
//     codec lives in core's caldav package and takes a *core.Record, which
//     this module cannot reach (the CLI deliberately does not depend on
//     tinycld.org/core — see gen-cli.ts), and CalDAV itself is Basic-Auth only
//     and mounted outside the API router. So the file conversion happens
//     server-side, in calendar/server/ics_endpoints.go.
package cli

import (
	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
)

func Register(root *cobra.Command, c *client.Client) {
	calendar := &cobra.Command{
		Use:     "calendar",
		Short:   "Calendars: agenda, events, and iCalendar files",
		Aliases: []string{"cal"},
	}
	calendar.AddCommand(
		newAgendaCmd(c),
		newListCmd(c),
		newEventsCmd(c),
		newShowCmd(c),
		newAddCmd(c),
		newRmCmd(c),
		newRSVPCmd(c),
		newExportCmd(c),
		newImportCmd(c),
	)
	root.AddCommand(calendar)
}
