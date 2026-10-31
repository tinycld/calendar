package calendar

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/readonly"
	"tinycld.org/core/readonly/readonlytest"
)

// These tests cover calendar's background writes in read-only mode. A row
// written while the server is read-only is lost if the next build rolls back,
// so a write that follows an accepted request waits for the mode to end, and
// a ticker skips its run. None of them may run in parallel: the mode is
// process-wide.

// loopbackFeedURL fails the fetch at once, with no network: the SSRF guard
// refuses a loopback address before it dials. A failed fetch is the cheapest
// sync that writes (the failure is stored on the calendar).
const loopbackFeedURL = "https://127.0.0.1/cal.ics"

// addNotificationsCollection adds core's notifications collection, which the
// calendar migrations do not carry, with the fields notify writes.
func addNotificationsCollection(t *testing.T, app core.App) {
	t.Helper()
	notifications := core.NewBaseCollection("notifications")
	notifications.Fields.Add(
		&core.TextField{Name: "user"},
		&core.TextField{Name: "type"},
		&core.TextField{Name: "package"},
		&core.TextField{Name: "title"},
		&core.TextField{Name: "body"},
		&core.TextField{Name: "url"},
		&core.JSONField{Name: "metadata"},
		&core.BoolField{Name: "read"},
		&core.BoolField{Name: "dismissed"},
	)
	if err := app.Save(notifications); err != nil {
		t.Fatalf("create notifications: %v", err)
	}
}

func setupReadOnlyEnv(t *testing.T) *calTenantEnv {
	t.Helper()
	env := setupCalTenantApp(t)
	addNotificationsCollection(t, env.app)
	return env
}

func countNotifications(t *testing.T, app core.App, notifType string) int {
	t.Helper()
	rows, err := app.FindRecordsByFilter("notifications",
		"type = {:type}", "", 0, 0, map[string]any{"type": notifType})
	if err != nil {
		t.Fatalf("read notifications: %v", err)
	}
	return len(rows)
}

func viewerMembership(t *testing.T, env *calTenantEnv) *core.Record {
	t.Helper()
	member, err := env.app.FindFirstRecordByFilter("calendar_members",
		"calendar = {:cal} && user = {:user}",
		map[string]any{"cal": env.calendar.Id, "user": env.member.Id})
	if err != nil {
		t.Fatalf("find viewer membership: %v", err)
	}
	return member
}

func subscribe(t *testing.T, env *calTenantEnv) {
	t.Helper()
	env.calendar.Set("subscription_url", loopbackFeedURL)
	if err := env.app.Save(env.calendar); err != nil {
		t.Fatalf("subscribe calendar: %v", err)
	}
}

func subscriptionError(t *testing.T, env *calTenantEnv) string {
	t.Helper()
	rec, err := env.app.FindRecordById("calendar_calendars", env.calendar.Id)
	if err != nil {
		t.Fatal(err)
	}
	return rec.GetString("subscription_error")
}

func enterReadOnly(t *testing.T, app core.App) {
	t.Helper()
	readonly.Enter(app)
	t.Cleanup(func() { readonly.Leave(app) })
}

// runUntilWaiting starts fn and returns once fn has reached the read-only
// wait, or fails the test if fn returns first.
func runUntilWaiting(t *testing.T, what string, fn func(ctx context.Context)) <-chan struct{} {
	t.Helper()
	probe, waiting := readonlytest.WaitProbe(t)
	done := make(chan struct{})
	go func() {
		defer close(done)
		fn(probe)
	}()
	select {
	case <-waiting:
	case <-done:
		t.Fatalf("the %s was written without waiting for read-only mode to end", what)
	case <-time.After(5 * time.Second):
		t.Fatalf("the %s never reached the read-only wait", what)
	}
	return done
}

func waitDone(t *testing.T, what string, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("the %s was not written after read-only mode ended", what)
	}
}

func assertDroppedLog(t *testing.T, logs func() []readonlytest.Record, msg, key, want string) {
	t.Helper()
	r, ok := readonlytest.Find(logs(), msg)
	if !ok {
		t.Fatalf("no %q log for the dropped write", msg)
	}
	if r.Level != slog.LevelWarn {
		t.Fatalf("want Warn for a dropped write, got %v", r.Level)
	}
	if r.Attrs[key] != want || !strings.Contains(r.Attrs["pkg"], "calendar") {
		t.Fatalf("the log must name calendar and %s=%s, got %v", key, want, r.Attrs)
	}
}

func TestInviteNotify_WaitsForReadOnlyToEnd(t *testing.T) {
	env := setupReadOnlyEnv(t)
	member := viewerMembership(t, env)
	enterReadOnly(t, env.app)

	done := runUntilWaiting(t, "invite notification", func(ctx context.Context) {
		notifyCalendarInviteWhenWritable(ctx, env.app, member)
	})
	if countNotifications(t, env.app, "calendar_invite") != 0 {
		t.Fatal("an invite notification was written while read-only")
	}

	readonly.Leave(env.app)
	waitDone(t, "invite notification", done)
	if countNotifications(t, env.app, "calendar_invite") != 1 {
		t.Fatal("expected the invite notification after read-only mode ended")
	}
}

func TestInviteNotify_DroppedAndLoggedWhenReadOnlyOutlastsTheWait(t *testing.T) {
	env := setupReadOnlyEnv(t)
	member := viewerMembership(t, env)
	logs := readonlytest.CaptureLogs(t)
	enterReadOnly(t, env.app)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	notifyCalendarInviteWhenWritable(ctx, env.app, member)

	if countNotifications(t, env.app, "calendar_invite") != 0 {
		t.Fatal("an invite notification was written while read-only")
	}
	assertDroppedLog(t, logs, inviteNotifyDroppedMsg, "memberID", member.Id)
}

// The sync a URL change or a refresh asks for follows an accepted request,
// so it waits for the mode to end instead of being skipped.
func TestImmediateSync_WaitsForReadOnlyToEnd(t *testing.T) {
	env := setupReadOnlyEnv(t)
	subscribe(t, env)
	enterReadOnly(t, env.app)

	done := runUntilWaiting(t, "subscription sync", func(ctx context.Context) {
		syncSubscriptionNowWhenWritable(ctx, env.app, env.calendar.Id)
	})
	if got := subscriptionError(t, env); got != "" {
		t.Fatalf("the sync stored %q while read-only", got)
	}

	readonly.Leave(env.app)
	waitDone(t, "subscription sync", done)
	if got := subscriptionError(t, env); !strings.Contains(got, "private/internal") {
		t.Fatalf("expected the failed fetch stored after read-only mode ended, got %q", got)
	}
	if countNotifications(t, env.app, "calendar_subscription_error") != 1 {
		t.Fatal("expected the owner told of the failed sync")
	}
}

func TestImmediateSync_DroppedAndLoggedWhenReadOnlyOutlastsTheWait(t *testing.T) {
	env := setupReadOnlyEnv(t)
	subscribe(t, env)
	logs := readonlytest.CaptureLogs(t)
	enterReadOnly(t, env.app)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	syncSubscriptionNowWhenWritable(ctx, env.app, env.calendar.Id)

	if got := subscriptionError(t, env); got != "" {
		t.Fatalf("the sync stored %q while read-only", got)
	}
	assertDroppedLog(t, logs, immediateSyncDroppedMsg, "calendar", env.calendar.Id)
}

// The ticker skips its run while read-only, and the next run after the mode
// ends syncs as usual.
func TestSubscriptionTicker_SkipsWhileReadOnly(t *testing.T) {
	env := setupReadOnlyEnv(t)
	subscribe(t, env)
	enterReadOnly(t, env.app)

	syncAllSubscriptions(context.Background(), env.app)
	if got := subscriptionError(t, env); got != "" {
		t.Fatalf("the ticker stored %q while read-only", got)
	}

	readonly.Leave(env.app)
	syncAllSubscriptions(context.Background(), env.app)
	if got := subscriptionError(t, env); !strings.Contains(got, "private/internal") {
		t.Fatalf("expected the next run after read-only to sync, got %q", got)
	}
}

// The mode can begin during a fetch, so the writes after it check again: a
// feed is not applied, and a failure is not stored, while read-only.
func TestSyncWrites_SkippedWhenReadOnlyBeginsMidSync(t *testing.T) {
	env := setupReadOnlyEnv(t)
	subscribe(t, env)
	enterReadOnly(t, env.app)

	if err := applyFeed(env.app, env.calendar, feedWith(t, "feed-1")); !errors.Is(err, errSyncSkippedReadOnly) {
		t.Fatalf("applyFeed while read-only = %v, want errSyncSkippedReadOnly", err)
	}
	if eventUIDs(t, env.app, env.calendar.Id)["feed-1"] {
		t.Fatal("a feed event was written while read-only")
	}

	err := recordSyncFailure(context.Background(), env.app, env.calendar, errors.New("HTTP 500"))
	if !errors.Is(err, errSyncSkippedReadOnly) {
		t.Fatalf("recordSyncFailure while read-only = %v, want errSyncSkippedReadOnly", err)
	}
	if got := subscriptionError(t, env); got != "" {
		t.Fatalf("a sync failure %q was stored while read-only", got)
	}
	if countNotifications(t, env.app, "calendar_subscription_error") != 0 {
		t.Fatal("the owner was told of a sync failure while read-only")
	}
}

// seedReminderEvent adds an event whose 10-minute reminder fires at fire.
func seedReminderEvent(t *testing.T, env *calTenantEnv, fire time.Time) {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("calendar_events")
	if err != nil {
		t.Fatal(err)
	}
	start := fire.Add(10 * time.Minute)
	r := core.NewRecord(col)
	r.Set("calendar", env.calendar.Id)
	r.Set("created_by", env.owner.Id)
	r.Set("title", "Standup")
	r.Set("start", start.Format(reminderTimeFormat))
	r.Set("end", start.Add(30*time.Minute).Format(reminderTimeFormat))
	r.Set("busy_status", "busy")
	r.Set("visibility", "default")
	r.Set("reminder", 10)
	if err := env.app.Save(r); err != nil {
		t.Fatalf("seed reminder event: %v", err)
	}
}

// A tick while read-only sends nothing. The first tick after the mode ends
// sends the reminder that fell due in the pause, though a plain window from
// that tick's own time would have passed it by.
func TestReminders_SkippedWhileReadOnlyAndSentAfter(t *testing.T) {
	env := setupReadOnlyEnv(t)
	t0 := time.Now().UTC().Truncate(time.Second)
	seedReminderEvent(t, env, t0.Add(30*time.Second))
	s := newReminderScheduler(t0)
	enterReadOnly(t, env.app)

	s.tick(env.app, t0)
	if countNotifications(t, env.app, "calendar_reminder") != 0 {
		t.Fatal("a reminder was written while read-only")
	}

	readonly.Leave(env.app)
	s.tick(env.app, t0.Add(60*time.Second))
	// The owner and the viewer are both members.
	if got := countNotifications(t, env.app, "calendar_reminder"); got != 2 {
		t.Fatalf("want the reminder sent to both members after the pause, got %d", got)
	}
}

// A reminder that fell due longer ago than reminderMaxCatchUp is not sent
// late: its "starts in" text would be wrong.
func TestReminders_CatchUpIsBounded(t *testing.T) {
	env := setupReadOnlyEnv(t)
	t0 := time.Now().UTC().Truncate(time.Second)
	seedReminderEvent(t, env, t0.Add(30*time.Second))
	s := newReminderScheduler(t0)
	enterReadOnly(t, env.app)

	s.tick(env.app, t0)
	readonly.Leave(env.app)
	s.tick(env.app, t0.Add(30*time.Second+reminderMaxCatchUp+time.Minute))
	if got := countNotifications(t, env.app, "calendar_reminder"); got != 0 {
		t.Fatalf("a reminder past the catch-up bound was sent, got %d", got)
	}
}
