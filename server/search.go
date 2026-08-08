package calendar

import (
	"fmt"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/fts"
	"tinycld.org/core/search"
)

// ftsConfig is the calendar FTS index/search config. The fts_calendar_events
// virtual table is created by pb-migrations/1830000009; this only reads and
// writes it.
//
// location is indexed alongside title and description because "where" is often
// the only thing a person remembers about a meeting.
var ftsConfig = fts.Config{
	Slug:       "calendar",
	Collection: "calendar_events",
	Table:      "fts_calendar_events",
	Columns: []fts.Column{
		{FTS: "title", Field: "title"},
		{FTS: "description", Field: "description"},
		{FTS: "location", Field: "location"},
	},
	// An event is visible to the members of its calendar, which is the same
	// membership shape cards uses: calendar_members(calendar, user).
	Scope: fts.MemberScope{
		Table:       "calendar_members",
		MemberField: "calendar",
		UserField:   "user",
		RecordField: "calendar",
	},
	Output: []fts.OutputColumn{
		{Name: "title"},
		{Name: "calendar"},
		{Name: "start"},
		{Name: "location"},
	},
}

// registerSearch wires the FTS index-sync hooks and calendar's contribution to
// the federated GET /api/search.
//
// Deliberately fts.RegisterSync rather than fts.Register: the latter also mounts
// GET /api/calendar/search, and calendar has no in-app search box to serve.
// Federation is the only consumer, so a per-package route would be dead on
// arrival — the same dead endpoint cards is in the process of losing.
func registerSearch(app *pocketbase.PocketBase) {
	fts.RegisterSync(app, ftsConfig)
	search.RegisterSources(searchSource())
}

func searchSource() search.Source {
	return search.Source{
		Slug:  "calendar",
		Label: "Calendar",
		// Mirrors manifest.ts nav.order, the cross-package ranking tie-break.
		Order:  8,
		Scopes: []string{"calendar:read"},
		Search: searchEvents,
	}
}

func searchEvents(app core.App, userID string, q search.Query) (search.Result, error) {
	hits, total, err := fts.Search(app, ftsConfig, userID, fts.SearchOpts{
		Query:   joinTerms(q.Include),
		Exclude: joinTerms(q.Exclude),
		Limit:   q.Limit,
		Offset:  q.Offset,
	})
	if err != nil {
		return search.Result{}, err
	}

	rows := make([]search.Row, 0, len(hits))
	for _, hit := range hits {
		rows = append(rows, search.Row{
			ID: hit.ID,
			// title is `required, min: 1`, so no validated write yields an empty
			// one — but a direct SQL write or a half-applied migration can, and
			// a blank row is unreadable and unclickable in both the palette and
			// the CLI. Cheap insurance against a state the schema alone cannot
			// rule out.
			Title: titleOr(str(hit.Columns["title"]), "Untitled event"),
			// When an event happens is the detail that distinguishes it from
			// the four other standups with the same name.
			Meta: str(hit.Columns["start"]),
			// Location is the other thing people search by, so surface it when
			// the event has one rather than leaving the row bare.
			Subtitle: str(hit.Columns["location"]),
			Fields: map[string]any{
				"calendar": str(hit.Columns["calendar"]),
				"start":    str(hit.Columns["start"]),
			},
		})
	}
	return search.Result{Rows: rows, Total: total}, nil
}

// joinTerms flattens parsed terms back into the space-separated string
// fts.Search sanitizes. The aggregator's contract is parsed terms; fts owns the
// FTS5 quoting, so the round trip keeps that boundary in one place.
func joinTerms(terms []string) string {
	out := ""
	for i, t := range terms {
		if i > 0 {
			out += " "
		}
		out += t
	}
	return out
}

func titleOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// str coerces an Output column to a string. fts.coerce already types columns per
// their declared Type, so this only guards a config change that turns a text
// column into something else.
func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}
