package cli

import (
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
	"tinycld.org/cli/ui"
)

// transfer.go holds the two commands that move a calendar as an iCalendar
// FILE. Unlike every other command here they call typed routes rather than the
// record API, and they have to: the iCalendar codec lives in core's caldav
// package and takes a *core.Record, which this module cannot reach (the CLI
// deliberately does not depend on tinycld.org/core — see gen-cli.ts), and
// CalDAV itself is Basic-Auth only and mounted outside the API router. So the
// conversion happens server-side in calendar/server/ics_endpoints.go, and
// these commands only move bytes.

// icsImportResult mirrors calendar/server/ics_endpoints.go's icsImportResult.
// Duplicated for the module-boundary reason above; only the fields this
// command reports are declared.
type icsImportResult struct {
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Failed  int      `json:"failed"`
	Errors  []string `json:"errors,omitempty"`
}

func newExportCmd(c *client.Client) *cobra.Command {
	var (
		calendarRef string
		out         string
	)
	cmd := &cobra.Command{
		Use:   "export",
		Short: "Export a calendar as an iCalendar (.ics) file",
		Long: "Export a calendar as an iCalendar (.ics) file.\n\n" +
			"Writes to stdout unless --out is given.",
		Args: cobra.NoArgs,
		Example: "  tinycld calendar export --calendar Work --out work.ics\n" +
			"  tinycld calendar export --calendar Work > backup.ics",
		RunE: func(cmd *cobra.Command, _ []string) error {
			o, yes, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()

			if calendarRef == "" {
				return fmt.Errorf("--calendar is required (a calendar id or name; see `tinycld calendar list`)")
			}
			cal, err := resolveCalendar(ctx, c, calendarRef)
			if err != nil {
				return err
			}

			q := url.Values{"calendar": {cal.ID}}
			// Streamed, not buffered: a calendar is unbounded, and the endpoint
			// already hands back a finished document.
			body, _, err := c.Get(ctx, "/api/calendar/export?"+q.Encode())
			if err != nil {
				return err
			}
			defer body.Close()

			if out == "" {
				_, err := io.Copy(cmd.OutOrStdout(), body)
				return err
			}

			if err := ui.ConfirmOverwrite(o, yes, cmd.InOrStdin(), cmd.OutOrStdout(), out); err != nil {
				return err
			}
			file, err := os.Create(out)
			if err != nil {
				return err
			}
			// Closed explicitly rather than only deferred: a write error that
			// surfaces at Close would otherwise be swallowed, reporting a
			// truncated export as a success.
			if _, err := io.Copy(file, body); err != nil {
				file.Close()
				return err
			}
			if err := file.Close(); err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "saved %s", out)
			return nil
		},
	}
	fl := cmd.Flags()
	fl.StringVar(&calendarRef, "calendar", "", "calendar to export (id or name)")
	fl.StringVar(&out, "out", "", "write to this file instead of stdout")
	return cmd
}

func newImportCmd(c *client.Client) *cobra.Command {
	var calendarRef string
	cmd := &cobra.Command{
		Use:   "import <file.ics>",
		Short: "Import events from an iCalendar (.ics) file",
		Long: "Import events from an iCalendar (.ics) file.\n\n" +
			"Events are matched on their UID, so re-importing a file you exported\n" +
			"updates those events rather than duplicating them. An event that\n" +
			"cannot be read is reported and skipped, not fatal.\n\n" +
			"You must be an owner or editor of the calendar — being able to read\n" +
			"it is not enough.",
		Args:    cobra.ExactArgs(1),
		Example: "  tinycld calendar import --calendar Work work.ics",
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()

			if calendarRef == "" {
				return fmt.Errorf("--calendar is required (a calendar id or name; see `tinycld calendar list`)")
			}
			cal, err := resolveCalendar(ctx, c, calendarRef)
			if err != nil {
				return err
			}
			// Checked before the upload so a typo'd path fails immediately with
			// a filesystem error rather than as a server-side 400.
			if _, err := os.Stat(args[0]); err != nil {
				return err
			}

			// The target calendar rides in the query string rather than as a
			// form field: PostMultipart's non-file part is a JSON document
			// (the shape /api/mail/send takes), and the endpoint accepts
			// either, so this avoids a core helper existing for one caller.
			q := url.Values{"calendar": {cal.ID}}
			result, err := client.PostMultipart[icsImportResult](ctx, c,
				"/api/calendar/import?"+q.Encode(), "", nil,
				[]client.FilePart{{Field: "file", Name: "calendar.ics", Path: args[0]}}, nil)
			if err != nil {
				return err
			}

			w := cmd.ErrOrStderr()
			o.Info(w, "imported into %s: %d created, %d updated, %d failed",
				cal.Name, result.Created, result.Updated, result.Failed)
			// Not routed through Info: a partially-applied import must not be
			// hideable with --quiet. A count alone would let a user believe a
			// file imported cleanly when half of it did not.
			if len(result.Errors) > 0 {
				fmt.Fprintf(w, "%d event(s) skipped:\n  %s\n",
					len(result.Errors), strings.Join(result.Errors, "\n  "))
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&calendarRef, "calendar", "", "calendar to import into (id or name)")
	return cmd
}
