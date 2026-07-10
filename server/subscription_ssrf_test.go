package calendar

import (
	"net"
	"net/url"
	"testing"
)

// All hosts here are literals so net.LookupIP resolves them without touching
// DNS — the tests stay hermetic.
func TestValidateICSURLBlocksInternalTargets(t *testing.T) {
	blocked := []string{
		"http://[::1]/cal.ics",                    // IPv6 loopback literal
		"http://user@127.0.0.1/cal.ics",           // userinfo must not confuse host parsing
		"http://169.254.169.254/latest/meta-data", // cloud metadata (link-local)
		"http://10.0.0.5/cal.ics",                 // RFC 1918
		"http://192.168.1.1/cal.ics",              // RFC 1918
		"http://100.64.0.10/cal.ics",              // CGNAT
		"http://[fc00::1]/cal.ics",                // IPv6 ULA
		"http://[fe80::1]/cal.ics",                // IPv6 link-local
		"http://[::ffff:127.0.0.1]/cal.ics",       // IPv4-mapped loopback
		"http://0.0.0.0/cal.ics",                  // unspecified
		"ftp://example.com/cal.ics",               // scheme
		"file:///etc/passwd",                      // scheme
	}
	for _, raw := range blocked {
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("url.Parse(%q): %v", raw, err)
		}
		if err := validateICSURL(u); err == nil {
			t.Errorf("validateICSURL(%q) = nil, want error", raw)
		}
	}
}

func TestIsDisallowedIP(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
	}{
		{"127.0.0.1", true},
		{"10.1.2.3", true},
		{"172.16.0.1", true},
		{"192.168.0.1", true},
		{"169.254.169.254", true},
		{"100.64.0.1", true}, // CGNAT lower bound
		{"100.127.255.255", true},
		{"100.63.255.255", false}, // just below CGNAT
		{"100.128.0.0", false},    // just above CGNAT
		{"0.1.2.3", true},
		{"255.255.255.255", true},
		{"::1", true},
		{"fc00::1", true},
		{"fd12::1", true},
		{"fe80::1", true},
		{"::ffff:192.168.1.1", true},
		{"8.8.8.8", false},
		{"1.1.1.1", false},
		{"2607:f8b0::1", false},
	}
	for _, tc := range cases {
		ip := net.ParseIP(tc.ip)
		if ip == nil {
			t.Fatalf("ParseIP(%q) failed", tc.ip)
		}
		if got := isDisallowedIP(ip); got != tc.want {
			t.Errorf("isDisallowedIP(%s) = %v, want %v", tc.ip, got, tc.want)
		}
	}
}
