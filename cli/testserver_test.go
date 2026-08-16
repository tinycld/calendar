package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
)

// fakeCalendar is an in-memory stand-in for the server: the calendar_*
// collections the commands read and write, plus the two iCalendar file routes.
// Filters are matched against the EXACT shapes the CLI builds — an
// unrecognized filter fails the test rather than returning everything, because
// a silently-ignored date filter is how `agenda` appears to work while showing
// last year.
//
// WHAT THIS HARNESS CANNOT SEE, and it matters more here than for any other
// package: it runs no access rules and no OAuth scope middleware. Calendar's
// authorization is two-tiered — read is membership in any role, write is
// owner-or-editor — and NONE of that exists here. A command that writes to a
// calendar the caller may only read passes against this fake and 403s in
// production. That split is proven server-side by
// calendar/server/ics_endpoints_test.go and the RLS suites; these tests prove
// only that the right REQUESTS are sent.
type fakeCalendar struct {
	t *testing.T

	calendars map[string]*calendar
	events    map[string]*event
	members   map[string]*member
	seq       int

	// Recorded writes, so a test can assert what was SENT rather than only
	// what came back — a fake that echoes its input proves nothing about the
	// body the command built.
	lastCreate map[string]any
	lastPatch  map[string]any
	deleted    []string

	// Export/import transcripts.
	exportQuery url.Values
	importQuery url.Values
	importBody  string
	importResp  icsImportResult
}

func newFakeCalendar(t *testing.T) *fakeCalendar {
	return &fakeCalendar{
		t:         t,
		calendars: map[string]*calendar{},
		events:    map[string]*event{},
		members:   map[string]*member{},
	}
}

func (f *fakeCalendar) nextID(prefix string) string {
	f.seq++
	return fmt.Sprintf("%s%03d", prefix, f.seq)
}

func (f *fakeCalendar) addCalendar(id, name string) *calendar {
	c := &calendar{ID: id, Name: name, Color: "blue", Updated: "2026-08-01 10:00:00Z"}
	f.calendars[id] = c
	return c
}

func (f *fakeCalendar) addMember(id, calendarID, role string) *member {
	m := &member{ID: id, Calendar: calendarID, User: "user1", Role: role}
	f.members[id] = m
	return m
}

func (f *fakeCalendar) addEvent(id, calendarID, title, start string) *event {
	e := &event{
		ID: id, Calendar: calendarID, CreatedBy: "user1", Title: title,
		Start: start, End: start, BusyStatus: "busy", Visibility: "default",
	}
	f.events[id] = e
	return e
}

// The exact filter shapes the commands build. A window read always carries
// both bounds; the calendar-scoped variant appends one equality.
var (
	reWindow = regexp.MustCompile(
		`^start >= "([^"]*)" && start < "([^"]*)"$`)
	reWindowCal = regexp.MustCompile(
		`^start >= "([^"]*)" && start < "([^"]*)" && calendar = "([^"]*)"$`)
	reUserEq = regexp.MustCompile(`^user = "([^"]*)"$`)
)

func listResponse[T any](w http.ResponseWriter, items []T) {
	if items == nil {
		items = []T{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"page": 1, "perPage": 200, "totalItems": len(items), "totalPages": 1,
		"items": items,
	})
}

func decodeBody(r *http.Request) map[string]any {
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	return body
}

func (f *fakeCalendar) serve() (*httptest.Server, *client.Client) {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /oauth/userinfo", func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"sub": "user1"})
	})
	mux.HandleFunc("GET /api/collections/users/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{
			"id": r.PathValue("id"), "email": "user1@example.com",
		})
	})

	mux.HandleFunc("GET /api/collections/calendar_calendars/records", func(w http.ResponseWriter, r *http.Request) {
		// The list rule already scopes calendars to the caller's memberships,
		// so the CLI must NOT send a filter — one here would be a second copy
		// of that boundary.
		if filter := r.URL.Query().Get("filter"); filter != "" {
			f.t.Errorf("calendars must be listed unfiltered (the rules scope them): %q", filter)
		}
		out := make([]calendar, 0, len(f.calendars))
		for _, c := range f.calendars {
			out = append(out, *c)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
		listResponse(w, out)
	})

	mux.HandleFunc("GET /api/collections/calendar_members/records", func(w http.ResponseWriter, r *http.Request) {
		filter := r.URL.Query().Get("filter")
		if !reUserEq.MatchString(filter) {
			f.t.Errorf("unsupported members filter: %q", filter)
			listResponse(w, []member{})
			return
		}
		out := make([]member, 0, len(f.members))
		for _, m := range f.members {
			out = append(out, *m)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		listResponse(w, out)
	})

	mux.HandleFunc("GET /api/collections/calendar_events/records", func(w http.ResponseWriter, r *http.Request) {
		filter := r.URL.Query().Get("filter")
		var from, to, calID string
		switch {
		case reWindowCal.MatchString(filter):
			m := reWindowCal.FindStringSubmatch(filter)
			from, to, calID = m[1], m[2], m[3]
		case reWindow.MatchString(filter):
			m := reWindow.FindStringSubmatch(filter)
			from, to = m[1], m[2]
		default:
			f.t.Errorf("unsupported events filter: %q", filter)
			listResponse(w, []event{})
			return
		}
		var out []event
		for _, e := range f.events {
			if calID != "" && e.Calendar != calID {
				continue
			}
			// Half-open, matching the filter the CLI sends. String comparison
			// is valid here because every timestamp uses the same layout.
			if e.Start < from || e.Start >= to {
				continue
			}
			out = append(out, *e)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Start < out[j].Start })
		listResponse(w, out)
	})

	mux.HandleFunc("GET /api/collections/calendar_events/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		e, ok := f.events[r.PathValue("id")]
		if !ok {
			notFound(w)
			return
		}
		json.NewEncoder(w).Encode(e)
	})

	mux.HandleFunc("POST /api/collections/calendar_events/records", func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(r)
		f.lastCreate = body
		created := &event{
			ID:          f.nextID("evt"),
			Calendar:    str(body["calendar"]),
			CreatedBy:   str(body["created_by"]),
			Title:       str(body["title"]),
			Description: str(body["description"]),
			Location:    str(body["location"]),
			Start:       str(body["start"]),
			End:         str(body["end"]),
			AllDay:      body["all_day"] == true,
			Recurrence:  str(body["recurrence"]),
			BusyStatus:  str(body["busy_status"]),
			Visibility:  str(body["visibility"]),
		}
		f.events[created.ID] = created
		json.NewEncoder(w).Encode(created)
	})

	mux.HandleFunc("PATCH /api/collections/calendar_events/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		e, ok := f.events[r.PathValue("id")]
		if !ok {
			notFound(w)
			return
		}
		body := decodeBody(r)
		f.lastPatch = body
		if raw, ok := body["guests"]; ok {
			// Round-trip through JSON so the stored shape is what the wire
			// carried, not a Go value the command happened to hold.
			encoded, _ := json.Marshal(raw)
			var guests []guest
			json.Unmarshal(encoded, &guests)
			e.Guests = guests
		}
		json.NewEncoder(w).Encode(e)
	})

	mux.HandleFunc("DELETE /api/collections/calendar_events/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		f.deleted = append(f.deleted, id)
		delete(f.events, id)
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /api/calendar/export", func(w http.ResponseWriter, r *http.Request) {
		f.exportQuery = r.URL.Query()
		calID := r.URL.Query().Get("calendar")
		var buf bytes.Buffer
		buf.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TinyCld//Calendar//EN\r\n")
		ids := make([]string, 0, len(f.events))
		for id := range f.events {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			if e := f.events[id]; e.Calendar == calID {
				fmt.Fprintf(&buf, "BEGIN:VEVENT\r\nUID:urn:uuid:%s\r\nSUMMARY:%s\r\nEND:VEVENT\r\n", e.ID, e.Title)
			}
		}
		buf.WriteString("END:VCALENDAR\r\n")
		w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
		w.Write(buf.Bytes())
	})

	mux.HandleFunc("POST /api/calendar/import", func(w http.ResponseWriter, r *http.Request) {
		f.importQuery = r.URL.Query()
		body, err := readUpload(r)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"message": err.Error()})
			return
		}
		f.importBody = string(body)
		json.NewEncoder(w).Encode(f.importResp)
	})

	srv := httptest.NewServer(mux)
	f.t.Cleanup(srv.Close)
	store := &staticStore{tok: client.TokenSet{
		AccessToken: "test-token", RefreshToken: "r", ExpiresAt: time.Now().Add(time.Hour),
	}}
	return srv, client.New(srv.URL, store, srv.Client())
}

// readUpload accepts the same shapes the real endpoint does, so a test cannot
// pass against a fake that is more permissive than the server.
func readUpload(r *http.Request) ([]byte, error) {
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			return nil, fmt.Errorf("invalid multipart upload: %w", err)
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			return nil, fmt.Errorf("missing 'file' upload field")
		}
		defer file.Close()
		var buf bytes.Buffer
		buf.ReadFrom(file)
		return buf.Bytes(), nil
	}
	var buf bytes.Buffer
	buf.ReadFrom(r.Body)
	return buf.Bytes(), nil
}

func notFound(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNotFound)
	json.NewEncoder(w).Encode(map[string]string{"message": "Not found"})
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

type staticStore struct{ tok client.TokenSet }

func (s *staticStore) Load() (client.TokenSet, error) { return s.tok, nil }
func (s *staticStore) Save(t client.TokenSet) error   { s.tok = t; return nil }

// newTestRoot mirrors the shell root's persistent flag set — the contract
// output.FromCommand reads — and registers the calendar group.
func newTestRoot(c *client.Client) *cobra.Command {
	root := &cobra.Command{Use: "tinycld", SilenceUsage: true, SilenceErrors: true}
	pf := root.PersistentFlags()
	pf.String("output", "table", "")
	pf.Bool("json", false, "")
	pf.String("context", "", "")
	pf.Bool("quiet", false, "")
	pf.Bool("no-color", false, "")
	pf.Bool("yes", false, "")
	Register(root, c)
	return root
}

func runCmd(t *testing.T, c *client.Client, args ...string) (string, string, error) {
	t.Helper()
	root := newTestRoot(c)
	var out, errBuf bytes.Buffer
	root.SetOut(&out)
	root.SetErr(&errBuf)
	root.SetIn(strings.NewReader(""))
	root.SetArgs(args)
	err := root.Execute()
	return out.String(), errBuf.String(), err
}
