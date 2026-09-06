package calendar

import "tinycld.org/core/oauth"

const (
	scopeRead  = "calendar:read"
	scopeWrite = "calendar:write"
)

// oauthPackage declares what an OAuth token may reach in calendar. Registered
// from registerShared; the catalog, the consent screen and the CLI's login
// request are all derived from it. A route or collection missing here is
// default-denied for OAuth callers only — sessions still work — so the CLI's
// surface is pinned in oauth_scopes_test.go.
func oauthPackage() oauth.Package {
	rw := oauth.Access{Read: []string{scopeRead}, Write: []string{scopeWrite}}
	return oauth.Package{
		Slug: "calendar",
		Scopes: []oauth.Scope{
			{ID: scopeRead, Label: "Read your calendar"},
			{ID: scopeWrite, Label: "Create and modify calendar events"},
		},
		Collections: map[string]oauth.Access{
			"calendar_events":    rw,
			"calendar_calendars": rw,
			// calendar_members carries the caller's ROLE per calendar, which
			// `calendar list` renders — a viewer learns their role from a
			// column rather than from a failed write. READ-ONLY because it is
			// a SHARING surface: a write here grants another person access to
			// a calendar, which is not what "change my calendar events" means
			// on the consent screen.
			"calendar_members": {Read: []string{scopeRead}},
		},
		Endpoints: map[string][]string{
			// iCalendar transfer. The read/write split matters more here than
			// for contacts: read access is membership in ANY role, so a viewer
			// legitimately holds calendar:read — and must still not import.
			"GET /api/calendar/export":  {scopeRead},
			"POST /api/calendar/import": {scopeWrite},
		},
	}
}
