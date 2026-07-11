package calendar

import (
	"testing"
	"time"
)

// TestExpandOccurrenceStartsNonRecurring verifies a non-recurring event only
// contributes its single start, and only when that start is inside the window.
func TestExpandOccurrenceStartsNonRecurring(t *testing.T) {
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	lookahead := now.Add(24 * time.Hour)

	// Start inside the window → returned.
	inside := now.Add(2 * time.Hour)
	got, err := expandOccurrenceStarts("", inside, now, lookahead)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || !got[0].Equal(inside) {
		t.Fatalf("expected single start %v, got %v", inside, got)
	}

	// Start already in the past → nothing.
	past := now.Add(-2 * time.Hour)
	got, _ = expandOccurrenceStarts("", past, now, lookahead)
	if len(got) != 0 {
		t.Fatalf("expected no occurrences for past start, got %v", got)
	}

	// Start beyond the lookahead → nothing.
	future := now.Add(48 * time.Hour)
	got, _ = expandOccurrenceStarts("", future, now, lookahead)
	if len(got) != 0 {
		t.Fatalf("expected no occurrences beyond lookahead, got %v", got)
	}
}

// TestExpandOccurrenceStartsRecurring is the regression for the bug where
// server reminders never fired for recurring events: the base start is far in
// the past, but a daily rule must still yield tomorrow's occurrence inside the
// reminder window.
func TestExpandOccurrenceStartsRecurring(t *testing.T) {
	// A daily 09:00 UTC standup that began months ago.
	baseStart := time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC)

	// "Now" is well after the base start; window opens just before the next
	// 09:00 occurrence and closes 24h later.
	now := time.Date(2026, 4, 10, 8, 55, 0, 0, time.UTC)
	lookahead := now.Add(24 * time.Hour)

	got, err := expandOccurrenceStarts("daily", baseStart, now, lookahead)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// The 2026-04-10 09:00 occurrence falls in the window; 2026-04-11 09:00 is
	// just past lookahead (now+24h = 08:55 next day).
	if len(got) != 1 {
		t.Fatalf("expected exactly one occurrence in window, got %d: %v", len(got), got)
	}
	want := time.Date(2026, 4, 10, 9, 0, 0, 0, time.UTC)
	if !got[0].Equal(want) {
		t.Fatalf("expected occurrence %v, got %v", want, got[0])
	}
}

// TestExpandOccurrenceStartsRRuleString confirms a full RRULE string (as
// stored by CalDAV clients) is expanded the same way as a legacy keyword.
func TestExpandOccurrenceStartsRRuleString(t *testing.T) {
	baseStart := time.Date(2026, 1, 5, 14, 0, 0, 0, time.UTC) // a Monday

	now := time.Date(2026, 4, 5, 0, 0, 0, 0, time.UTC)
	lookahead := now.Add(48 * time.Hour)

	// Weekly on Monday. Monday in this window is 2026-04-06 14:00.
	got, err := expandOccurrenceStarts("FREQ=WEEKLY;BYDAY=MO", baseStart, now, lookahead)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected one Monday occurrence, got %d: %v", len(got), got)
	}
	want := time.Date(2026, 4, 6, 14, 0, 0, 0, time.UTC)
	if !got[0].Equal(want) {
		t.Fatalf("expected %v, got %v", want, got[0])
	}
}

// TestExpandOccurrenceStartsBadRule returns an error (so the caller can log and
// skip) rather than panicking on an unparseable recurrence value.
func TestExpandOccurrenceStartsBadRule(t *testing.T) {
	baseStart := time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC)
	now := time.Date(2026, 4, 10, 0, 0, 0, 0, time.UTC)
	lookahead := now.Add(24 * time.Hour)

	if _, err := expandOccurrenceStarts("FREQ=NONSENSE", baseStart, now, lookahead); err == nil {
		t.Fatal("expected an error for an invalid recurrence rule")
	}
}
