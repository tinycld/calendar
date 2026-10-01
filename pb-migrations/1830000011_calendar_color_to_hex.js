/// <reference path="../../../server/pb_data/types.d.ts" />
// Calendar colours move from a 17-name palette to a raw hex string, matching
// labels and calc cells.
//
// CalDAV forced it: a client sets calendar-color to an arbitrary hex (macOS
// Calendar sends #RRGGBBAA), and a fixed palette could only snap that to its
// nearest entry — the user picks orange and the calendar comes back red. Hex
// also keeps the server out of the palette business entirely.
//
// Existing rows are reset to the default blue rather than mapped name-by-name:
// a calendar's colour is cosmetic and per-member, so re-picking one is cheap,
// and a mapping table would have to be kept correct forever for a one-time
// conversion.
const DEFAULT_COLOR = '#3b82f6'

migrate(
    app => {
        for (const [name, fieldId] of [
            ['calendar_calendars', 'cal_calendars_hex'],
            ['calendar_members', 'cal_members_hex'],
        ]) {
            const collection = app.findCollectionByNameOrId(name)
            // PocketBase refuses to change a field's type in place, so the
            // replacement carries a new id and the select is dropped first.
            const existing = collection.fields.getByName('color')

            collection.fields.removeById(existing.id)
            collection.fields.add(
                new TextField({
                    id: fieldId,
                    name: 'color',
                    required: false,
                    max: 9, // #RRGGBBAA
                })
            )
            app.save(collection)

            app.db().newQuery(`UPDATE ${name} SET color = {:color}`).bind({ color: DEFAULT_COLOR }).execute()
        }
    },
    app => {
        const allColors = [
            'blue',
            'green',
            'red',
            'teal',
            'purple',
            'orange',
            'tomato',
            'flamingo',
            'tangerine',
            'banana',
            'sage',
            'basil',
            'peacock',
            'blueberry',
            'lavender',
            'grape',
            'graphite',
        ]

        for (const [name, fieldId] of [
            ['calendar_calendars', 'cal_calendars_color'],
            ['calendar_members', 'cal_members_color'],
        ]) {
            const collection = app.findCollectionByNameOrId(name)
            const existing = collection.fields.getByName('color')

            collection.fields.removeById(existing.id)
            collection.fields.add(
                new SelectField({
                    id: fieldId,
                    name: 'color',
                    required: false,
                    values: allColors,
                    maxSelect: 1,
                })
            )
            app.save(collection)

            app.db().newQuery(`UPDATE ${name} SET color = 'blue'`).execute()
        }
    }
)
