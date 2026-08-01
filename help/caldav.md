---
title: Connecting a calendar client (CalDAV)
summary: Sync your calendars with Apple Calendar, Thunderbird, DAVx5, or GNOME Calendar
tags: [caldav, sync, apple-calendar, davx5, thunderbird, gnome, mobile]
order: 80
---

## What CalDAV gives you

CalDAV is a standard for syncing calendars. Once you connect a CalDAV client to TinyCld:

- **Two-way sync** — an event created on your phone shows up in the web UI within seconds, and vice versa.
- **Every calendar you're a member of** appears in your client — personal and shared. Your role carries over: on a calendar where you're a viewer, clients see the events but writes are refused.
- **Offline access** — most clients cache locally and sync when back online.
- Anything on your OS that reads the system calendar (widgets, meeting joins, notifications) can use your TinyCld events.

## Connection settings

| Setting | Value |
|---|---|
| **Server** | `{{server-host}}` |
| **Endpoint URL** (clients that ask for one) | `https://{{server-host}}/caldav/` |
| **Username** | your TinyCld username or email |
| **Password** | your TinyCld password |

The server is your TinyCld web address — the hostname in your browser's address bar, shown above. Most clients auto-discover the rest via `/.well-known/caldav`; your calendars live under `/caldav/u/cal/`.

## Connecting Apple Calendar (macOS)

1. Open **Calendar**.
2. **Calendar → Settings → Accounts → +**.
3. Pick **Other CalDAV Account…**, click **Continue**.
4. Account Type: **Automatic**.
5. Username: your TinyCld username or email.
6. Password: your TinyCld password.
7. Server address: `{{server-host}}` (no `https://`, no path — Calendar auto-discovers via `/.well-known/caldav`).
8. Click **Sign In**.

Each TinyCld calendar you're a member of appears in the sidebar under the new account.

## Connecting Apple Calendar (iOS / iPadOS)

1. **Settings → Calendar → Accounts → Add Account → Other → Add CalDAV Account**.
2. Server: `{{server-host}}`.
3. User Name: your TinyCld username or email.
4. Password: your TinyCld password.
5. Description: anything you like (e.g. "TinyCld").
6. Tap **Next** — iOS validates and finishes setup.

## Connecting DAVx5 (Android)

DAVx5 is the standard third-party CalDAV/CardDAV client for Android.

1. Open **DAVx5** and tap **+ Add account**.
2. Choose **Login with URL and user name**.
3. Base URL: `https://{{server-host}}/caldav/`.
4. User name: your TinyCld username or email.
5. Password: your TinyCld password.
6. Tap **Login**, then **Create account**.
7. Open the account's **CALDAV** tab and enable the calendars you want synced.

DAVx5 exposes them to Android's system calendar; any calendar app picks them up.

## Connecting Thunderbird

1. **Calendar → New Calendar → On the Network**.
2. Username: your TinyCld username or email.
3. Location: `https://{{server-host}}/caldav/`.
4. Click **Find Calendars**, enter your password when prompted.
5. Tick the calendars to subscribe to, then **Subscribe**.

## Connecting GNOME Calendar / Evolution

1. Open **Evolution** (or **GNOME Online Accounts** in Settings).
2. **Edit → Accounts → Add → CalDAV**.
3. URL: `https://{{server-host}}/caldav/`.
4. Username: your TinyCld username or email.
5. Click **Find** to discover the calendars, then check the ones you want.

GNOME Calendar reads from Evolution's calendars, so they appear there automatically.

## What's synced

Events sync with their title, description, location, start/end times, all-day flag, recurrence rule, guests, reminder, and busy/visibility status. Calendar names and descriptions sync too.

Membership and roles are **not** manageable over CalDAV — invite people and change roles in the web UI. Calendar color is client-side in most CalDAV clients and doesn't sync.

## Troubleshooting

- **Auth failed** — use your TinyCld sign-in credentials (username or email, and your regular password). There is no separate "CalDAV password".
- **Client can't find the account** — enter the server as `{{server-host}}` with no path and let the client auto-discover, or give the full endpoint `https://{{server-host}}/caldav/` in clients that want a URL.
- **Edits are refused on one calendar** — check your role there: viewers can read but not write. A deployment can also [restrict CalDAV writes with a server-side hook](help://calendar:caldav-hooks).

## See also

- [Customizing CalDAV behavior](help://calendar:caldav-hooks) (admin)
- [Dragging events](help://calendar:dragging-events)
