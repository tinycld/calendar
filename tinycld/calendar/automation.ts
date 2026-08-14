import type { AutomationDefinitions } from '@tinycld/core/lib/automation/types'
import type { CalendarSchema } from './types'

// calendar_events has no user/owner/author column — the creator is
// `created_by`, which the engine's owner auto-detection does not look for.
// Hence the explicit ownerField.
//
// On its own that scopes personal rules to whoever created the event, which is
// wrong for a shared calendar: a member should have their rules fire for
// events a colleague added. server/automation.go registers an owner resolver
// over calendar_members that supersedes this ownerField; the declaration keeps
// it so the trigger still resolves an owner in a deployment where calendar's
// Go isn't linked (a multi-org tenant).
const automation = {
    triggers: [
        {
            id: 'event-added',
            label: 'An event is added',
            collection: 'calendar_events',
            on: 'create',
            ownerField: 'created_by',
            fields: [
                'title',
                'location',
                'start',
                'end',
                { key: 'all_day', label: 'All day' },
                'calendar',
                // Lets a rule tell an event the user authored from one a
                // subscribed feed imported — "notify me about new events, but
                // not the 200 my work calendar just synced".
                { key: 'from_subscription', label: 'From a subscribed feed' },
            ],
        },
    ],
    // Native, not a record-op: v1 params carry no date math, so "three days
    // from now" has to be computed somewhere. The handler takes plain numbers
    // and does the arithmetic.
    actions: [
        {
            id: 'create-event',
            label: 'Create an event',
            kind: 'native',
            params: [
                // NOT a relation param: relationTarget is only resolved for
                // record-op params that name a real column (catalog.go's
                // resolveParam), so a native `type: 'relation'` renders a
                // picker with no target — an empty, unusable menu. Left out
                // entirely instead: the handler files the event on the rule
                // owner's own calendar, which is what the recipes want and
                // needs no input at all.
                { key: 'title', type: 'text', label: 'Title' },
                { key: 'description', type: 'text', label: 'Description' },
                { key: 'starts_in_days', type: 'number', label: 'Starts in (days)' },
                { key: 'duration_minutes', type: 'number', label: 'Duration (minutes)' },
                { key: 'all_day', type: 'boolean', label: 'All day' },
                { key: 'reminder_minutes', type: 'number', label: 'Remind before (minutes)' },
            ],
        },
    ],
} satisfies AutomationDefinitions<CalendarSchema>

export default automation
