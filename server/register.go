package calendar

import (
	"context"
	"net/http"

	"github.com/emersion/go-webdav/caldav"
	"github.com/google/uuid"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/audit"
)

func Register(app *pocketbase.PocketBase) {
	// Audit logging for calendar collections
	audit.RegisterCollection(app, "calendar_calendars", &audit.CollectionConfig{
		ExtractLabel: audit.LabelFromField("name"),
	})
	audit.RegisterCollection(app, "calendar_events", &audit.CollectionConfig{
		ResolveOrg: func(a core.App, record *core.Record) string {
			calendarID := record.GetString("calendar")
			if calendarID == "" {
				return ""
			}
			return audit.ResolveViaRelation(a, "calendar_calendars", calendarID, "org")
		},
		ExtractLabel: audit.LabelFromField("title"),
	})
	audit.RegisterCollection(app, "calendar_members", &audit.CollectionConfig{
		ResolveOrg: func(a core.App, record *core.Record) string {
			calendarID := record.GetString("calendar")
			if calendarID == "" {
				return ""
			}
			return audit.ResolveViaRelation(a, "calendar_calendars", calendarID, "org")
		},
	})

	// Auto-create personal calendar when a user joins an org
	app.OnRecordAfterCreateSuccess("user_org").BindFunc(func(e *core.RecordEvent) error {
		handleUserOrgCreated(app, e.Record)
		return e.Next()
	})

	// Clean up orphaned calendars when a user leaves an org
	app.OnRecordAfterDeleteSuccess("user_org").BindFunc(func(e *core.RecordEvent) error {
		handleUserOrgDeleted(app, e.Record)
		return e.Next()
	})

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		backend := &CalDAVBackend{app: app}
		handler := caldav.Handler{Backend: backend, Prefix: "/caldav"}

		serveCalDAV := func(re *core.RequestEvent) error {
			_, _, ok := re.Request.BasicAuth()
			if !ok {
				re.Response.Header().Set("WWW-Authenticate", `Basic realm="TinyCld CalDAV"`)
				http.Error(re.Response, "Authentication required", http.StatusUnauthorized)
				return nil
			}

			ctx := context.WithValue(re.Request.Context(), httpRequestKey, re.Request)
			handler.ServeHTTP(re.Response, re.Request.WithContext(ctx))
			return nil
		}

		e.Router.Any("/caldav/{path...}", serveCalDAV)
		e.Router.Any("/caldav", serveCalDAV)

		e.Router.Any("/.well-known/caldav", func(re *core.RequestEvent) error {
			http.Redirect(re.Response, re.Request, "/caldav/", http.StatusMovedPermanently)
			return nil
		})

		return e.Next()
	})

	// Auto-generate ical_uid for events created via the web UI
	app.OnRecordCreate("calendar_events").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("ical_uid") == "" {
			e.Record.Set("ical_uid", "urn:uuid:"+uuid.NewString())
		}
		return e.Next()
	})
}
