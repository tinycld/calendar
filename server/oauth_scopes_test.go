package calendar

import (
	"testing"

	"tinycld.org/core/oauth"
)

// Every route the calendar CLI drives must resolve to a scope. An unclassified
// route 403s for OAuth callers only — sessions still work — so the CLI's fake
// server never notices; this is the test that does. calendar_members was
// exactly this once: unclassified, it took `calendar list` down for tokens
// while the fake server saw nothing.
func TestOAuthClassifiesCLIRoutes(t *testing.T) {
	oauth.RegisterPackage(oauthPackage())

	for _, r := range []struct{ method, path, scope string }{
		{"GET", "/api/collections/calendar_events/records", scopeRead},
		{"POST", "/api/collections/calendar_events/records", scopeWrite},
		{"PATCH", "/api/collections/calendar_events/records/abc123", scopeWrite},
		{"GET", "/api/collections/calendar_calendars/records", scopeRead},
		{"GET", "/api/collections/calendar_members/records", scopeRead},
		{"GET", "/api/calendar/export", scopeRead},
		{"POST", "/api/calendar/import", scopeWrite},
	} {
		rule := oauth.ScopeForRoute(r.method, r.path)
		if len(rule) == 0 {
			t.Errorf("%s %s is default-denied for OAuth callers", r.method, r.path)
			continue
		}
		if !rule.SatisfiedBy([]string{r.scope}) {
			t.Errorf("%s %s: %q must admit it (got %v)", r.method, r.path, r.scope, rule)
		}
	}
}

// Export must not be reachable with a write-only grant, nor import with a
// read-only one. A viewer legitimately holds calendar:read and must still not
// be able to import.
func TestOAuthTransferRoutesAreAsymmetric(t *testing.T) {
	oauth.RegisterPackage(oauthPackage())

	if oauth.ScopeForRoute("GET", "/api/calendar/export").SatisfiedBy([]string{scopeWrite}) {
		t.Error("calendar export must NOT be satisfied by calendar:write alone")
	}
	if oauth.ScopeForRoute("POST", "/api/calendar/import").SatisfiedBy([]string{scopeRead}) {
		t.Error("calendar import must NOT be satisfied by calendar:read alone")
	}
}

// calendar_members is a sharing surface: a write adds a person to a calendar,
// which no token may do under either scope.
func TestOAuthMembershipIsReadOnly(t *testing.T) {
	oauth.RegisterPackage(oauthPackage())

	for _, m := range []string{"POST", "PATCH", "DELETE"} {
		p := "/api/collections/calendar_members/records"
		if m != "POST" {
			p += "/abc"
		}
		if got := oauth.ScopeForRoute(m, p); got.SatisfiedBy([]string{scopeRead, scopeWrite}) {
			t.Errorf("%s %s must stay denied — a token must not be able to share a calendar, got %v", m, p, got)
		}
	}
}

// The search source's scopes must be scopes this package actually registers,
// or the federated search would admit a scope no grant can carry.
func TestSearchSourceScopesAreRegistered(t *testing.T) {
	oauth.RegisterPackage(oauthPackage())
	registered := oauth.PackageScopes("calendar")
	for _, s := range searchSource().Scopes {
		if !oauth.HasScope(registered, s) {
			t.Errorf("search source names scope %q, which calendar does not register (%v)", s, registered)
		}
	}
}
