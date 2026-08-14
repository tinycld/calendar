/**
 * Contributed events masquerade as CalendarEvents rows. Their synthetic ids
 * carry the source they came from so the press path can route to the item's
 * href instead of the event-detail popover, and their synthetic calendar FK
 * points at a pseudo-calendar entry that supplies the source's color.
 *
 * Source ids are validated to [a-z0-9-] at generate time, so ':' is a safe
 * delimiter — the first two segments can never contain one. The ITEM id is
 * everything after the second ':' (it is foreign data and may contain any
 * character).
 */
const PREFIX = 'src:'

export function sourceEventId(sourceId: string, itemId: string): string {
    return `${PREFIX}${sourceId}:${itemId}`
}

export function sourceCalendarId(sourceId: string): string {
    return `${PREFIX}${sourceId}`
}

export function isSourceEventId(eventId: string): boolean {
    return eventId.startsWith(PREFIX)
}

export function parseSourceEventId(eventId: string): { sourceId: string; itemId: string } | null {
    if (!eventId.startsWith(PREFIX)) return null
    const rest = eventId.slice(PREFIX.length)
    const sep = rest.indexOf(':')
    if (sep <= 0 || sep === rest.length - 1) return null
    return { sourceId: rest.slice(0, sep), itemId: rest.slice(sep + 1) }
}
