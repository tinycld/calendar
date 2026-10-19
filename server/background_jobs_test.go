package calendar

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"tinycld.org/core/readonly/readonlytest"
)

// The invite notification runs as a background job. A panic in it (here, in
// the save of the notification row) must be logged through the calendar
// logger, not end the process, and the app's terminate must wait for the job
// so it never runs against a closed database.
func TestInviteNotification_PanicRecoveredAndTerminateWaits(t *testing.T) {
	logs := readonlytest.CaptureLogs(t)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	calendars := core.NewBaseCollection("calendar_calendars")
	calendars.Fields.Add(&core.TextField{Name: "name"})
	members := core.NewBaseCollection("calendar_members")
	members.Fields.Add(
		&core.TextField{Name: "calendar"},
		&core.TextField{Name: "user"},
		&core.TextField{Name: "role"},
	)
	for _, c := range []*core.Collection{calendars, members} {
		if err := app.Save(c); err != nil {
			t.Fatalf("create %s: %v", c.Name, err)
		}
	}
	addNotificationsCollection(t, app)

	entered := make(chan struct{})
	release := make(chan struct{})
	app.OnRecordCreate("notifications").BindFunc(func(*core.RecordEvent) error {
		close(entered)
		<-release
		panic("notification save exploded")
	})
	registerInviteNotification(app)

	calendar := core.NewRecord(calendars)
	calendar.Set("name", "Team")
	if err := app.Save(calendar); err != nil {
		t.Fatal(err)
	}
	member := core.NewRecord(members)
	member.Set("calendar", calendar.Id)
	member.Set("user", "invitee0000001")
	member.Set("role", "viewer")
	if err := app.Save(member); err != nil {
		t.Fatal(err)
	}

	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the invite notification job never ran")
	}
	cleaned := make(chan struct{})
	go func() {
		app.Cleanup()
		close(cleaned)
	}()
	select {
	case <-cleaned:
		t.Fatal("the terminate finished while the invite notification was still running")
	case <-time.After(50 * time.Millisecond):
	}

	close(release)
	select {
	case <-cleaned:
	case <-time.After(10 * time.Second):
		t.Fatal("the terminate did not finish after the job returned")
	}
	r, ok := readonlytest.Find(logs(), "background job panicked")
	if !ok {
		t.Fatal("the panic was not logged")
	}
	if r.Attrs["pkg"] != "calendar" || r.Attrs["job"] != "calendar invite notification" {
		t.Fatalf("the log must name calendar and the job, got %v", r.Attrs)
	}
}
