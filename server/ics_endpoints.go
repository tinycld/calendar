package calendar

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/emersion/go-ical"
	"github.com/google/uuid"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"tinycld.org/core/caldav"
)

// ics_endpoints.go serves a calendar as an iCalendar FILE, for the CLI's
// `calendar export` / `calendar import`.
//
// CalDAV already speaks iCalendar, but it cannot be the CLI's transport: it is
// Basic-Auth only and mounted outside the API router, while the CLI carries an
// OAuth bearer token. So these are ordinary API routes that reuse the CalDAV
// codec (caldav.EncodeVEvent / caldav.ApplyVEvent) and calDAVSource's field
// map, so one mapping stays behind both protocols instead of drifting into two.
//
// SECURITY: these are RAW routes. PocketBase evaluates collection rules for
// /api/collections/... and for nothing bound on e.Router, so the shipped
// calendar rules do NOT run here.
//
// Authorization is therefore made explicitly below — and, unlike contacts,
// NOT by copying a filter string. calDAVSource deliberately carries no
// ListFilter; its header explains that the collection rules are the single
// definition, evaluated with app.CanAccessRecord. These handlers do the same,
// so there is no second copy of the membership predicate to drift:
//
//   - export requires the calendar's LIST rule to pass (membership, any role)
//   - import requires the events collection's CREATE rule to pass
//     (owner or editor — a viewer may read a calendar but not write to it)
//   - both re-check the suspension flag, which the rule engine would have
//     applied via `@request.auth.disabled != true`
//   - OAuth scope (calendar:read / calendar:write) comes from core's
//     route→scope table
//
// Drop any one and a token reads or writes a calendar it does not belong to.
// ics_endpoints_test.go pins all of them, including the viewer/editor split.

// maxImportBytes caps an uploaded .ics. Our mapping embeds no media, so a real
// calendar is well under this; the cap is here so a malicious upload cannot be
// streamed into memory unbounded.
const maxImportBytes = 10 << 20 // 10 MiB

// icsImportResult is the JSON body of a successful import. Counts are reported
// per-event because import is deliberately fault tolerant: a malformed event is
// skipped, not fatal. Errors names each skipped one so nothing is dropped
// silently — a count alone would let a user believe a file imported cleanly
// when half of it did not.
type icsImportResult struct {
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Failed  int      `json:"failed"`
	Errors  []string `json:"errors,omitempty"`
}

// bindICalUIDHook auto-generates ical_uid for events created via the web UI.
//
// Named (rather than inline in registerShared) so the endpoint tests bind the
// REAL hook: export/import match events on this field, so a fixture that
// stamped UIDs by hand would hide a regression in the identity the whole
// feature depends on.
func bindICalUIDHook(app core.App) {
	app.OnRecordCreate("calendar_events").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("ical_uid") == "" {
			e.Record.Set("ical_uid", "urn:uuid:"+uuid.NewString())
		}
		return e.Next()
	})
}

// bindICSEndpoints registers the file export/import routes. Split from
// registerShared so the test can bind exactly these two onto its own app.
func bindICSEndpoints(app core.App, e *core.ServeEvent) {
	e.Router.GET("/api/calendar/export", func(re *core.RequestEvent) error {
		return handleICSExport(app, re)
	}).BindFunc(requireEnabledCalendarAuth)

	e.Router.POST("/api/calendar/import", func(re *core.RequestEvent) error {
		return handleICSImport(app, re)
	}).BindFunc(requireEnabledCalendarAuth)
}

// registerICSEndpoints wires the routes into the app's serve lifecycle.
func registerICSEndpoints(app *pocketbase.PocketBase) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		bindICSEndpoints(app, e)
		return e.Next()
	})
}

// requireEnabledCalendarAuth rejects an anonymous caller and a suspended one.
//
// The suspension half is the part that is easy to miss: coreserver's guard
// blocks token ISSUANCE, not use, so a token minted before an account was
// disabled keeps working until it expires. For REST the collection rules close
// that (migration 1830000004's `@request.auth.disabled != true`); a raw route
// has no rule engine, so it re-checks the flag on the live record here.
func requireEnabledCalendarAuth(re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}
	if re.Auth.GetBool("disabled") {
		return re.ForbiddenError("Account is disabled", nil)
	}
	return re.Next()
}

// authorizeCalendar loads a calendar and evaluates one of its own collection
// rules for the caller. Returns a not-found error in every failure case — an
// existence oracle would tell an outsider which calendar ids are real.
//
// ruleOf picks the rule to apply, so a caller asks for the operation it is
// about to perform rather than re-deriving "who may do this" in Go.
func authorizeCalendar(
	app core.App,
	re *core.RequestEvent,
	calendarID string,
	ruleOf func(*core.Collection) *string,
) (*core.Record, error) {
	record, err := app.FindRecordById(calDAVSource.CalendarCollection, calendarID)
	if err != nil {
		return nil, re.NotFoundError("Calendar not found", nil)
	}

	info := &core.RequestInfo{
		Auth:    re.Auth,
		Method:  re.Request.Method,
		Context: core.RequestInfoContextDefault,
	}
	ok, err := app.CanAccessRecord(record, info, ruleOf(record.Collection()))
	if err != nil {
		// An unevaluable rule must not fail open.
		app.Logger().Warn("calendar ics: access rule evaluation failed",
			"calendar", calendarID, "error", err)
		return nil, re.NotFoundError("Calendar not found", nil)
	}
	if !ok {
		return nil, re.NotFoundError("Calendar not found", nil)
	}
	return record, nil
}

// canWriteEvents reports whether the caller may create events on a calendar.
//
// This is the check that separates calendar from contacts: read access is
// membership in ANY role, but writing an event requires owner or editor, so
// passing authorizeCalendar's list-rule check is NOT sufficient to import.
//
// Asking the question requires a saved row. CanAccessRecord evaluates a rule
// as a query filtered to `id = record.Id`, so an unsaved record matches
// nothing and EVERY create rule denies — and a rule that traverses a relation
// (as calendar_events' does, through its calendar's memberships) cannot be
// evaluated any other way. So a throwaway event is saved inside a transaction,
// the rule is asked, and the transaction is always rolled back. This mirrors
// caldav.Backend's own create path, which documents the same constraint.
func canWriteEvents(app core.App, re *core.RequestEvent, calendarID string) (bool, error) {
	collection, err := app.FindCollectionByNameOrId(calDAVSource.EventCollection)
	if err != nil {
		return false, err
	}

	var allowed bool
	probeErr := app.RunInTransaction(func(txApp core.App) error {
		probe := core.NewRecord(collection)
		probe.Set(calDAVSource.Event.Calendar, calendarID)
		probe.Set(calDAVSource.Event.Owner, re.Auth.Id)
		probe.Set(calDAVSource.Event.Title, "permission probe")
		probe.Set(calDAVSource.Event.Start, types.NowDateTime())
		probe.Set(calDAVSource.Event.End, types.NowDateTime())
		for field, value := range calDAVSource.Event.Defaults {
			probe.Set(field, value)
		}
		if err := txApp.SaveNoValidate(probe); err != nil {
			return err
		}

		info := &core.RequestInfo{
			Auth:    re.Auth,
			Method:  http.MethodPost,
			Context: core.RequestInfoContextDefault,
		}
		ok, err := txApp.CanAccessRecord(probe, info, collection.CreateRule)
		if err != nil {
			return err
		}
		allowed = ok

		// Always roll back: the probe row must never survive, whatever the
		// answer was.
		return errProbeRollback
	})
	if probeErr != nil && !errors.Is(probeErr, errProbeRollback) {
		app.Logger().Warn("calendar ics: create rule evaluation failed",
			"calendar", calendarID, "error", probeErr)
		return false, nil
	}
	return allowed, nil
}

// errProbeRollback unwinds the permission probe's transaction. It is a control
// signal, never surfaced to a caller.
var errProbeRollback = errors.New("calendar ics: rollback permission probe")

// handleICSExport streams one calendar as a single VCALENDAR document.
//
// One document, not one per event: a client parses the first VCALENDAR it sees
// and would silently drop everything after it.
func handleICSExport(app core.App, re *core.RequestEvent) error {
	calendarID := strings.TrimSpace(re.Request.URL.Query().Get("calendar"))
	if calendarID == "" {
		return re.BadRequestError("a calendar id is required (?calendar=<id>)", nil)
	}

	// The LIST rule, not View: this is a collection read, and it is the rule
	// whose membership predicate matches what "may see this calendar" means.
	if _, err := authorizeCalendar(app, re, calendarID,
		func(c *core.Collection) *string { return c.ListRule }); err != nil {
		return err
	}

	events, err := app.FindRecordsByFilter(
		calDAVSource.EventCollection,
		calDAVSource.Event.Calendar+" = {:calendarId}",
		calDAVSource.Event.Start,
		0, 0,
		map[string]any{"calendarId": calendarID},
	)
	if err != nil {
		return re.InternalServerError("failed to load events", err)
	}

	out := ical.NewCalendar()
	out.Props.SetText(ical.PropProductID, "-//TinyCld//Calendar//EN")
	out.Props.SetText(ical.PropVersion, "2.0")
	for _, event := range events {
		// EncodeVEvent renders a whole VCALENDAR per record; we want its
		// children folded into the one document above.
		encoded, err := caldav.EncodeVEvent(event, calDAVSource.Event)
		if err != nil {
			return re.InternalServerError("failed to encode event", err)
		}
		out.Children = append(out.Children, encoded.Children...)
	}

	var buf bytes.Buffer
	if err := ical.NewEncoder(&buf).Encode(out); err != nil {
		return re.InternalServerError("failed to encode calendar", err)
	}

	re.Response.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	re.Response.Header().Set("Content-Disposition", `attachment; filename="calendar.ics"`)
	return re.String(http.StatusOK, buf.String())
}

// handleICSImport reads an .ics and upserts each VEVENT into one calendar.
//
// Upsert, not insert: re-importing your own export must not duplicate every
// event. The match key is ical_uid — the only identity an iCalendar file
// carries, since (unlike CalDAV) there is no URL path to address an object by.
// The lookup is scoped to the target calendar, matching how the subscription
// importer already matches events.
func handleICSImport(app core.App, re *core.RequestEvent) error {
	body, calendarID, err := readICSUpload(re)
	if err != nil {
		return re.BadRequestError(err.Error(), nil)
	}
	if calendarID == "" {
		return re.BadRequestError("a calendar id is required (the `calendar` form field)", nil)
	}

	// Membership first, so a non-member gets "not found" rather than a
	// permission error that confirms the calendar exists.
	if _, err := authorizeCalendar(app, re, calendarID,
		func(c *core.Collection) *string { return c.ListRule }); err != nil {
		return err
	}
	// Then the write check: a viewer may read this calendar but must not be
	// able to add events to it.
	mayWrite, err := canWriteEvents(app, re, calendarID)
	if err != nil {
		return re.InternalServerError("failed to check permissions", err)
	}
	if !mayWrite {
		return re.ForbiddenError("You do not have permission to add events to this calendar", nil)
	}

	collection, err := app.FindCollectionByNameOrId(calDAVSource.EventCollection)
	if err != nil {
		return re.InternalServerError("events collection unavailable", err)
	}

	result := icsImportResult{}
	for index, cal := range decodeICSDocuments(body, &result) {
		for _, child := range cal.Children {
			if child.Name != ical.CompEvent {
				continue
			}
			// ApplyVEvent takes the whole VCALENDAR and reads its first
			// VEVENT, so each event is handed over in its own wrapper.
			single := ical.NewCalendar()
			single.Children = append(single.Children, child)

			created, err := upsertEvent(app, re, collection, calendarID, single)
			if err != nil {
				result.Failed++
				result.Errors = append(result.Errors,
					fmt.Sprintf("document %d, event %s: %v", index+1, eventLabel(child), err))
				continue
			}
			if created {
				result.Created++
			} else {
				result.Updated++
			}
		}
	}

	return re.JSON(http.StatusOK, result)
}

// decodeICSDocuments reads every VCALENDAR in the upload, recording a parse
// failure rather than aborting.
//
// A file may legitimately hold more than one VCALENDAR (concatenated exports),
// and a parse failure consumes the rest of the stream — the decoder cannot
// resynchronize mid-document — so a failure is reported and decoding stops.
// Events already applied stand.
func decodeICSDocuments(body []byte, result *icsImportResult) []*ical.Calendar {
	var out []*ical.Calendar
	dec := ical.NewDecoder(bytes.NewReader(body))
	for {
		cal, err := dec.Decode()
		if errors.Is(err, io.EOF) {
			return out
		}
		if err != nil {
			result.Failed++
			result.Errors = append(result.Errors,
				fmt.Sprintf("document %d: malformed iCalendar: %v", len(out)+1, err))
			return out
		}
		out = append(out, cal)
	}
}

// upsertEvent applies one VEVENT, returning whether it created a new record.
func upsertEvent(
	app core.App,
	re *core.RequestEvent,
	collection *core.Collection,
	calendarID string,
	cal *ical.Calendar,
) (bool, error) {
	uid := icsUID(cal)

	record, err := findEventByUID(app, calendarID, uid)
	if err != nil {
		return false, err
	}

	created := record == nil
	if created {
		record = core.NewRecord(collection)
		record.Set(calDAVSource.Event.Calendar, calendarID)
		record.Set(calDAVSource.Event.Owner, re.Auth.Id)
		// busy_status and visibility are required selects with no schema
		// default, and a minimal VEVENT carries neither TRANSP nor CLASS — so
		// without these the save fails with "cannot be blank". Applied before
		// the codec so a file that DOES carry them still wins.
		for field, value := range calDAVSource.Event.Defaults {
			record.Set(field, value)
		}
	}

	if err := caldav.ApplyVEvent(cal, record, calDAVSource.Event); err != nil {
		return false, err
	}

	// Re-stamp the calendar AFTER applying: a crafted file must not be able to
	// move an event onto a calendar the caller did not authorize against.
	record.Set(calDAVSource.Event.Calendar, calendarID)

	if created {
		// A VEVENT with no UID is unmatchable, so it creates — and gets one
		// now, mirroring the create hook, so the NEXT export/import of this
		// event matches instead of duplicating.
		//
		// A UID already held by ANOTHER calendar is regenerated for the same
		// practical reason. iCalendar UIDs are unique within a calendar, not
		// globally — two people are routinely sent the same invite — but
		// idx_cal_events_ical_uid is a global unique index. Keeping the UID
		// would fail the save, letting whoever imported an event first
		// permanently block everyone else from importing it.
		if uid == "" || uidTakenByAnotherCalendar(app, calendarID, uid) {
			uid = "urn:uuid:" + uuid.NewString()
		}
		record.Set(calDAVSource.Event.UID, uid)
	}

	if err := app.Save(record); err != nil {
		return false, err
	}
	return created, nil
}

// icsUID reads the UID of a single-VEVENT document.
func icsUID(cal *ical.Calendar) string {
	for _, child := range cal.Children {
		if child.Name != ical.CompEvent {
			continue
		}
		if prop := child.Props.Get(ical.PropUID); prop != nil {
			return strings.TrimSpace(prop.Value)
		}
	}
	return ""
}

// findEventByUID looks up an existing event by UID WITHIN one calendar.
// Returns (nil, nil) when there is no match — including for an event with no
// UID, which is unmatchable by definition and must therefore create.
//
// Scoped to the calendar, matching how the subscription importer matches: a
// UID lookup across calendars would let a crafted file overwrite an event on
// a calendar the caller may not write to.
func findEventByUID(app core.App, calendarID, uid string) (*core.Record, error) {
	if uid == "" {
		return nil, nil
	}
	records, err := app.FindRecordsByFilter(
		calDAVSource.EventCollection,
		calDAVSource.Event.UID+" = {:uid} && "+calDAVSource.Event.Calendar+" = {:calendarId}",
		"", 1, 0,
		map[string]any{"uid": uid, "calendarId": calendarID},
	)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}
	return records[0], nil
}

// uidTakenByAnotherCalendar reports whether a UID is already held by an event
// on a different calendar.
//
// On a lookup error it answers true: regenerating a UID costs only the file's
// ability to re-match that one event later, while guessing wrong the other way
// fails the import outright.
func uidTakenByAnotherCalendar(app core.App, calendarID, uid string) bool {
	records, err := app.FindRecordsByFilter(
		calDAVSource.EventCollection,
		calDAVSource.Event.UID+" = {:uid} && "+calDAVSource.Event.Calendar+" != {:calendarId}",
		"", 1, 0,
		map[string]any{"uid": uid, "calendarId": calendarID},
	)
	if err != nil {
		return true
	}
	return len(records) > 0
}

// readICSUpload pulls the .ics and its target calendar out of either a
// multipart upload (the CLI posts a file) or a raw body with ?calendar=.
func readICSUpload(re *core.RequestEvent) ([]byte, string, error) {
	limited := http.MaxBytesReader(re.Response, re.Request.Body, maxImportBytes)
	calendarID := strings.TrimSpace(re.Request.URL.Query().Get("calendar"))

	contentType := re.Request.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		if err := re.Request.ParseMultipartForm(maxImportBytes); err != nil {
			return nil, "", fmt.Errorf("invalid multipart upload: %w", err)
		}
		// Read the parsed form directly rather than through FormValue: on a
		// multipart request FormValue also consults the URL query and can
		// disturb the body reader that FormFile is about to use, which
		// corrupted the uploaded document.
		if re.Request.MultipartForm != nil {
			if v := re.Request.MultipartForm.Value["calendar"]; len(v) > 0 {
				if trimmed := strings.TrimSpace(v[0]); trimmed != "" {
					calendarID = trimmed
				}
			}
		}
		file, _, err := re.Request.FormFile("file")
		if err != nil {
			return nil, "", errors.New("missing 'file' upload field")
		}
		defer file.Close()

		body, err := io.ReadAll(io.LimitReader(file, maxImportBytes))
		if err != nil {
			return nil, "", fmt.Errorf("failed to read upload: %w", err)
		}
		return body, calendarID, nil
	}

	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, "", fmt.Errorf("failed to read request body: %w", err)
	}
	if len(body) == 0 {
		return nil, "", errors.New("empty request body")
	}
	return body, calendarID, nil
}

// eventLabel names an event in an error message so the user can find it in
// their file. Falls back to the UID, then a placeholder, since the event that
// failed may be exactly the one missing a summary.
func eventLabel(event *ical.Component) string {
	if prop := event.Props.Get(ical.PropSummary); prop != nil {
		if v := strings.TrimSpace(prop.Value); v != "" {
			return v
		}
	}
	if prop := event.Props.Get(ical.PropUID); prop != nil {
		if v := strings.TrimSpace(prop.Value); v != "" {
			return v
		}
	}
	return "unnamed"
}
