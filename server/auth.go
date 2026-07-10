package calendar

import (
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// authenticateRequest validates HTTP Basic credentials against the users
// auth collection. The identifier may be either a bare username (e.g.
// "joe") or a full email (e.g. "joe@tinycld.org"); the discriminator is
// whether it contains '@'. This mirrors PocketBase's own identityFields
// = ['username', 'email'] for the users collection and matches drive's
// WebDAV authentication.
func authenticateRequest(app *pocketbase.PocketBase, r *http.Request) (*core.Record, error) {
	identifier, password, ok := r.BasicAuth()
	if !ok || identifier == "" {
		return nil, errUnauthorized
	}

	var record *core.Record
	var err error
	if strings.Contains(identifier, "@") {
		record, err = app.FindAuthRecordByEmail("users", identifier)
	} else {
		record, err = app.FindFirstRecordByFilter(
			"users",
			"username = {:u}",
			map[string]any{"u": identifier},
		)
	}
	if err != nil || record == nil {
		return nil, errUnauthorized
	}

	if !record.ValidatePassword(password) {
		return nil, errUnauthorized
	}

	return record, nil
}

type authError struct{}

func (e *authError) Error() string { return "unauthorized" }

var errUnauthorized = &authError{}
