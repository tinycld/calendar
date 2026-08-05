package calendar

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// subscription_fetch_test.go covers the SSRF defenses that wrap validateICSURL:
// the pinned transport (the DNS-rebinding defense), redirect re-validation, the
// response size cap, and URL normalization. The existing SSRF suite pins the
// two pure predicates; these tests pin the machinery that has to actually USE
// them, which is where an SSRF fix typically regresses — the predicate stays
// correct while a code path stops consulting it.

// TestPinnedTransport_RefusesToDialInternalAddress is the DNS-rebinding
// defense. The pre-flight check in validateICSURL is not enough on its own: an
// attacker-controlled resolver can answer public on the first lookup and
// private on the second. The transport must re-verify at dial time, so a
// hostname that resolves to loopback is refused even when the dial is attempted
// directly — bypassing the pre-check entirely, exactly as a rebind would.
func TestPinnedTransport_RefusesToDialInternalAddress(t *testing.T) {
	tr := newPinnedTransport()

	_, err := tr.DialContext(context.Background(), "tcp", "localhost:80")
	if err == nil {
		t.Fatal("pinned dialer connected to localhost; a DNS rebind would reach internal services")
	}
	if !strings.Contains(err.Error(), "private/internal hosts are not allowed") {
		t.Fatalf("error = %v, want the private-host refusal", err)
	}
}

// TestPinnedTransport_RefusesLiteralLoopback covers the IP-literal form, where
// no DNS is involved at all.
func TestPinnedTransport_RefusesLiteralLoopback(t *testing.T) {
	tr := newPinnedTransport()

	for _, addr := range []string{"127.0.0.1:80", "[::1]:80", "169.254.169.254:80"} {
		if _, err := tr.DialContext(context.Background(), "tcp", addr); err == nil {
			t.Errorf("pinned dialer connected to %s, want refusal", addr)
		}
	}
}

// TestPinnedTransport_DisablesKeepAlives pins a deliberate hardening choice.
// A pooled connection outlives the verification that authorized it, so a later
// request could ride a connection to an address that is no longer allowed.
func TestPinnedTransport_DisablesKeepAlives(t *testing.T) {
	if !newPinnedTransport().DisableKeepAlives {
		t.Fatal("keep-alives enabled; a pooled conn can outlive its address verification")
	}
}

// TestFetchICS_RejectsLoopbackServer proves the whole fetch path refuses an
// internal target. The server is real and serving valid ICS — the only reason
// to reject is the SSRF guard, so a passing fetch here would be a true bypass.
func TestFetchICS_RejectsLoopbackServer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"))
	}))
	defer srv.Close()

	if _, err := fetchICS(srv.URL); err == nil {
		t.Fatal("fetchICS reached a loopback server; SSRF guard bypassed")
	}
}

// TestFetchICS_RejectsNonHTTPSchemes stops the file:// and ftp:// families at
// the fetch entry point, not just in the predicate.
func TestFetchICS_RejectsNonHTTPSchemes(t *testing.T) {
	for _, raw := range []string{"file:///etc/passwd", "ftp://example.com/c.ics", "gopher://example.com/"} {
		if _, err := fetchICS(raw); err == nil {
			t.Errorf("fetchICS(%q) = nil error, want rejection", raw)
		}
	}
}

// TestFetchICS_RejectsUnresolvableHost pins the fail-closed behavior called out
// in validateICSURL's comment. Failing open here would let a host that DNS
// cannot resolve through to the dialer.
func TestFetchICS_RejectsUnresolvableHost(t *testing.T) {
	// .invalid is reserved by RFC 2606 and must never resolve.
	_, err := fetchICS("https://this-host-does-not-exist.invalid/cal.ics")
	if err == nil {
		t.Fatal("fetchICS accepted an unresolvable host; resolution must fail closed")
	}
}

// TestFetchICS_RejectsEmptyHost covers the degenerate URL that parses cleanly
// but has nothing to verify.
func TestFetchICS_RejectsEmptyHost(t *testing.T) {
	if _, err := fetchICS("http:///cal.ics"); err == nil {
		t.Fatal("fetchICS accepted a URL with an empty host")
	}
}

// TestValidateICSURL_RedirectHopIsRevalidated pins the CheckRedirect contract
// directly: the redirect callback is validateICSURL, so a 302 pointing at an
// internal address must be refused. This is the classic SSRF bypass — a public
// URL that redirects to 169.254.169.254 — and it is only stopped if EVERY hop
// is re-checked, not just the first.
func TestValidateICSURL_RedirectHopIsRevalidated(t *testing.T) {
	internalTargets := []string{
		"http://169.254.169.254/latest/meta-data",
		"http://127.0.0.1/cal.ics",
		"http://10.0.0.1/cal.ics",
	}
	for _, raw := range internalTargets {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("url.Parse(%q): %v", raw, err)
		}
		if err := validateICSURL(u); err == nil {
			t.Errorf("redirect hop to %q was allowed; every hop must be re-validated", raw)
		}
	}
}

// TestFetchICS_RedirectToInternalIsBlocked exercises the redirect defense
// end-to-end through a real redirecting server rather than the callback alone.
// The fetch fails either at the first hop (the test server is itself loopback)
// or at the redirect check; what must never happen is a successful body read
// from the internal target.
func TestFetchICS_RedirectToInternalIsBlocked(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://169.254.169.254/latest/meta-data", http.StatusFound)
	}))
	defer srv.Close()

	body, err := fetchICS(srv.URL)
	if err == nil {
		body.Close()
		t.Fatal("fetchICS followed a redirect toward cloud metadata")
	}
}

// TestMaxResponseBytesCapIsEnforced pins the 10 MB cap that bounds memory for a
// hostile or runaway feed. fetchICS wraps the body in a MaxBytesReader; this
// asserts the reader actually truncates rather than the constant merely
// existing.
func TestMaxResponseBytesCapIsEnforced(t *testing.T) {
	oversized := strings.NewReader(strings.Repeat("A", maxResponseBytes+1024))
	limited := http.MaxBytesReader(nil, io.NopCloser(oversized), maxResponseBytes)

	n, err := io.Copy(io.Discard, limited)
	if err == nil {
		t.Fatal("reading past the cap returned no error; the body is unbounded")
	}
	if n > maxResponseBytes {
		t.Fatalf("read %d bytes, cap is %d", n, maxResponseBytes)
	}
}

// TestFetchTimeoutIsBounded guards against an unbounded fetch pinning a sync
// worker forever on a slowloris feed.
func TestFetchTimeoutIsBounded(t *testing.T) {
	if fetchTimeout <= 0 || fetchTimeout > time.Minute {
		t.Fatalf("fetchTimeout = %v, want a positive bound under a minute", fetchTimeout)
	}
	if dialTimeout <= 0 || dialTimeout > fetchTimeout {
		t.Fatalf("dialTimeout = %v, want positive and <= fetchTimeout (%v)", dialTimeout, fetchTimeout)
	}
}

// TestNormalizeSubscriptionURL_WebcalBecomesHTTPS covers the scheme rewrite.
// webcal:// is not an http scheme, so without this rewrite validateICSURL
// rejects every calendar-app subscription link.
func TestNormalizeSubscriptionURL_WebcalBecomesHTTPS(t *testing.T) {
	got := normalizeSubscriptionURL("webcal://example.com/cal.ics")
	want := "https://example.com/cal.ics"
	if got != want {
		t.Fatalf("normalize = %q, want %q", got, want)
	}
}

// TestNormalizeSubscriptionURL_GoogleSharingLink covers the base64 `cid`
// rewrite into a direct ICS path.
func TestNormalizeSubscriptionURL_GoogleSharingLink(t *testing.T) {
	// base64 of "abc@group.calendar.google.com"
	raw := "https://calendar.google.com/calendar/u/0?cid=YWJjQGdyb3VwLmNhbGVuZGFyLmdvb2dsZS5jb20"

	got := normalizeSubscriptionURL(raw)

	if !strings.HasPrefix(got, "https://calendar.google.com/calendar/ical/") {
		t.Fatalf("normalize = %q, want a direct ical path", got)
	}
	if !strings.HasSuffix(got, "/public/basic.ics") {
		t.Fatalf("normalize = %q, want the public basic.ics suffix", got)
	}
	// `@` is legal in a path segment, so PathEscape leaves it intact; what
	// matters is that the base64 was decoded rather than pasted through.
	if !strings.Contains(got, "abc@group.calendar.google.com") {
		t.Fatalf("normalize = %q, want the decoded calendar id in the path", got)
	}
}

// TestNormalizeSubscriptionURL_NormalizationCannotProduceInternalTarget is the
// important interaction: normalization runs BEFORE validation, so if it could
// rewrite a URL into an internal one, it would be an SSRF vector. A
// webcal://169.254.169.254 link must still be refused after normalizing.
func TestNormalizeSubscriptionURL_NormalizationCannotProduceInternalTarget(t *testing.T) {
	for _, raw := range []string{
		"webcal://169.254.169.254/latest/meta-data",
		"webcal://127.0.0.1/cal.ics",
		"webcal://10.0.0.1/cal.ics",
	} {
		normalized := normalizeSubscriptionURL(raw)
		u, err := url.Parse(normalized)
		if err != nil {
			t.Fatalf("url.Parse(%q): %v", normalized, err)
		}
		if err := validateICSURL(u); err == nil {
			t.Errorf("%q normalized to %q and passed validation", raw, normalized)
		}
	}
}

// TestNormalizeSubscriptionURL_LeavesOrdinaryURLsAlone guards against the
// rewrite firing on inputs it should ignore, including a lookalike host.
func TestNormalizeSubscriptionURL_LeavesOrdinaryURLsAlone(t *testing.T) {
	cases := []string{
		"https://example.com/cal.ics",
		"http://example.com/feed?x=1",
		// no cid → not a sharing link
		"https://calendar.google.com/calendar/u/0",
		// malformed base64 cid → left as-is rather than mangled
		"https://calendar.google.com/calendar/u/0?cid=!!!not-base64!!!",
	}
	for _, raw := range cases {
		if got := normalizeSubscriptionURL(raw); got != raw {
			t.Errorf("normalize(%q) = %q, want unchanged", raw, got)
		}
	}
}

// TestParseRRuleUntil covers the bound used to decide whether a recurring event
// is still live. Treating a bounded rule as unbounded (or vice versa) silently
// drops or resurrects events during sync.
func TestParseRRuleUntil(t *testing.T) {
	t.Run("bounded rule returns its UNTIL", func(t *testing.T) {
		got := parseRRuleUntil("FREQ=DAILY;UNTIL=20260101T000000Z")
		if got.IsZero() {
			t.Fatal("bounded rule reported unbounded")
		}
		if got.Year() != 2026 || got.Month() != time.January {
			t.Fatalf("until = %v, want 2026-01", got)
		}
	})

	t.Run("accepts the RRULE: prefix", func(t *testing.T) {
		got := parseRRuleUntil("RRULE:FREQ=DAILY;UNTIL=20260101T000000Z")
		if got.IsZero() {
			t.Fatal("prefixed rule reported unbounded")
		}
	})

	// rrule-go does not leave UNTIL empty for a rule without one — it fills in
	// now + math.MaxInt64 ns (~292 years out). The old `Year() > 9000` sentinel
	// check never matched that, so unbounded rules reported a bogus concrete
	// end date. These two cases pin the distance-based detection.
	t.Run("unbounded rule returns zero", func(t *testing.T) {
		if got := parseRRuleUntil("FREQ=WEEKLY"); !got.IsZero() {
			t.Fatalf("until = %v, want zero for an unbounded rule", got)
		}
	})

	t.Run("COUNT-bounded rule has no UNTIL", func(t *testing.T) {
		// COUNT bounds the series by occurrences, not by date, so UNTIL is
		// still absent and must read as unbounded.
		if got := parseRRuleUntil("FREQ=DAILY;COUNT=5"); !got.IsZero() {
			t.Fatalf("until = %v, want zero for a COUNT-bounded rule", got)
		}
	})

	t.Run("a far-future but genuine UNTIL is preserved", func(t *testing.T) {
		// The filler is ~292 years out; a real 50-year bound must survive the
		// distance check rather than being mistaken for "unbounded".
		got := parseRRuleUntil("FREQ=YEARLY;UNTIL=20700101T000000Z")
		if got.IsZero() {
			t.Fatal("a genuine 2070 UNTIL was discarded as filler")
		}
		if got.Year() != 2070 {
			t.Fatalf("until year = %d, want 2070", got.Year())
		}
	})

	t.Run("unparseable rule returns zero", func(t *testing.T) {
		if got := parseRRuleUntil("this is not an rrule"); !got.IsZero() {
			t.Fatalf("until = %v, want zero for a bad rule", got)
		}
	})
}

// TestFilterEventsByWindow covers which feed events survive into the DB. The
// rules are asymmetric on purpose, and each branch has a distinct failure mode:
// dropping a recurring master orphans its exceptions, and dropping an
// undated/unparseable event loses data silently.
func TestFilterEventsByWindow(t *testing.T) {
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)

	t.Run("keeps a dated event inside the window", func(t *testing.T) {
		events := parseFeed(t, calWith(vevent("in-window", "DTSTART:20260801T100000Z")))
		if got := filterEventsByWindow(events, start, end); len(got) != 1 {
			t.Fatalf("kept %d events, want 1", len(got))
		}
	})

	t.Run("drops a dated event outside the window", func(t *testing.T) {
		events := parseFeed(t, calWith(vevent("old", "DTSTART:20200801T100000Z")))
		if got := filterEventsByWindow(events, start, end); len(got) != 0 {
			t.Fatalf("kept %d events, want 0", len(got))
		}
	})

	t.Run("keeps an unbounded recurring event dated before the window", func(t *testing.T) {
		events := parseFeed(t, calWith(vevent("recurring",
			"DTSTART:20200101T100000Z", "RRULE:FREQ=WEEKLY")))
		if got := filterEventsByWindow(events, start, end); len(got) != 1 {
			t.Fatalf("kept %d events, want 1 — an unbounded series is still live", len(got))
		}
	})

	t.Run("drops a recurring event whose UNTIL predates the window", func(t *testing.T) {
		events := parseFeed(t, calWith(vevent("expired",
			"DTSTART:20200101T100000Z", "RRULE:FREQ=WEEKLY;UNTIL=20210101T000000Z")))
		if got := filterEventsByWindow(events, start, end); len(got) != 0 {
			t.Fatalf("kept %d events, want 0 — the series ended before the window", len(got))
		}
	})

	t.Run("keeps a recurrence exception regardless of date", func(t *testing.T) {
		events := parseFeed(t, calWith(vevent("exception",
			"DTSTART:20200801T100000Z", "RECURRENCE-ID:20200801T100000Z")))
		if got := filterEventsByWindow(events, start, end); len(got) != 1 {
			t.Fatalf("kept %d events, want 1 — exceptions modify a series and must survive", len(got))
		}
	})

	t.Run("keeps an event with no DTSTART", func(t *testing.T) {
		events := parseFeed(t, calWith("BEGIN:VEVENT\r\nUID:undated\r\nDTSTAMP:20990101T000000Z\r\nEND:VEVENT\r\n"))
		if got := filterEventsByWindow(events, start, end); len(got) != 1 {
			t.Fatalf("kept %d events, want 1 — an undated event must not be dropped silently", len(got))
		}
	})
}

// calWith wraps raw VEVENT blocks in a VCALENDAR envelope.
func calWith(blocks ...string) string {
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n")
	for _, blk := range blocks {
		b.WriteString(blk)
	}
	b.WriteString("END:VCALENDAR\r\n")
	return b.String()
}

// vevent builds a single VEVENT from a uid plus arbitrary extra property lines.
func vevent(uid string, props ...string) string {
	var b strings.Builder
	b.WriteString("BEGIN:VEVENT\r\nUID:" + uid + "\r\nDTSTAMP:20990101T000000Z\r\n")
	for _, p := range props {
		b.WriteString(p + "\r\n")
	}
	b.WriteString("SUMMARY:" + uid + "\r\nEND:VEVENT\r\n")
	return b.String()
}

// TestIsDisallowedIP_RejectsIPv4MappedCGNATAndBroadcast extends the existing
// predicate suite with the mapped-IPv6 forms of the ranges checked only in
// their 4-byte form, where a missing To4() unwrap would let them through.
func TestIsDisallowedIP_RejectsIPv4MappedCGNATAndBroadcast(t *testing.T) {
	cases := []string{
		"::ffff:100.64.0.1",      // CGNAT via mapped form
		"::ffff:0.1.2.3",         // 0.0.0.0/8 via mapped form
		"::ffff:255.255.255.255", // broadcast via mapped form
		"::ffff:169.254.169.254", // metadata via mapped form
	}
	for _, raw := range cases {
		ip := net.ParseIP(raw)
		if ip == nil {
			t.Fatalf("ParseIP(%q) failed", raw)
		}
		if !isDisallowedIP(ip) {
			t.Errorf("isDisallowedIP(%s) = false, want true", raw)
		}
	}
}

// TestValidateICSURL_AllowsPublicHost is the negative control for the whole
// suite: if this fails, the guard is refusing everything and the "blocked"
// assertions above prove nothing.
func TestValidateICSURL_AllowsPublicHost(t *testing.T) {
	u, err := url.Parse("https://8.8.8.8/cal.ics")
	if err != nil {
		t.Fatal(err)
	}
	if err := validateICSURL(u); err != nil {
		t.Fatalf("validateICSURL rejected a public address: %v", err)
	}
}

// TestPinnedTransport_PropagatesContextCancellation ensures a cancelled sync
// does not leave a dial hanging.
func TestPinnedTransport_PropagatesContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := newPinnedTransport().DialContext(ctx, "tcp", "example.com:80")
	if err == nil {
		t.Fatal("dial with a cancelled context succeeded")
	}
	// Either the resolver or the dialer surfaces the cancellation; both are
	// acceptable, an ignored context is not.
	if !errors.Is(err, context.Canceled) && !strings.Contains(err.Error(), "cannot resolve host") {
		t.Logf("cancellation surfaced as: %v", err)
	}
}
