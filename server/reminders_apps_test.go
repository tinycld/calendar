package calendar

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
)

// Event ids are unique only in their app: a reminder sent for one app's
// event must not suppress another app's reminder.
func TestSentRemindersArePerApp(t *testing.T) {
	newApp := func() *tests.TestApp {
		app, err := tests.NewTestApp()
		if err != nil {
			t.Fatalf("NewTestApp: %v", err)
		}
		t.Cleanup(app.Cleanup)
		return app
	}
	a, b := newApp(), newApp()

	if _, loaded := sentRemindersFor(a).LoadOrStore("event-1-100", time.Now()); loaded {
		t.Fatal("first mark on app A found an entry")
	}
	if _, loaded := sentRemindersFor(b).LoadOrStore("event-1-100", time.Now()); loaded {
		t.Fatal("app A's sent reminder suppressed app B's")
	}
}
