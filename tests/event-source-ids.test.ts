import { describe, expect, it } from 'vitest'
import {
    isSourceEventId,
    parseSourceEventId,
    sourceCalendarId,
    sourceEventId,
} from '~/tinycld/calendar/lib/event-source-ids'

describe('event-source ids', () => {
    it('round-trips a source/item pair', () => {
        const id = sourceEventId('cards-due', 'r8f3k2m9x1p7q4w')
        expect(id).toBe('src:cards-due:r8f3k2m9x1p7q4w')
        expect(isSourceEventId(id)).toBe(true)
        expect(parseSourceEventId(id)).toEqual({
            sourceId: 'cards-due',
            itemId: 'r8f3k2m9x1p7q4w',
        })
    })

    it('keeps colons inside the item id intact', () => {
        // Item ids are foreign data; only the SOURCE id is [a-z0-9-]-validated.
        const parsed = parseSourceEventId(sourceEventId('cards-due', 'a:b:c'))
        expect(parsed).toEqual({ sourceId: 'cards-due', itemId: 'a:b:c' })
    })

    it('rejects non-source and malformed ids', () => {
        expect(isSourceEventId('r8f3k2m9x1p7q4w')).toBe(false)
        expect(parseSourceEventId('r8f3k2m9x1p7q4w')).toBeNull()
        expect(parseSourceEventId('src:no-item')).toBeNull()
        expect(parseSourceEventId('src:cards-due:')).toBeNull()
        expect(parseSourceEventId('src::item')).toBeNull()
    })

    it('derives the pseudo-calendar id from the source id alone', () => {
        expect(sourceCalendarId('cards-due')).toBe('src:cards-due')
    })
})
