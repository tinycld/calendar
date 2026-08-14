import type { EventSourceItem } from '@tinycld/core/lib/event-sources/types'
import { create } from '@tinycld/core/lib/store'

/**
 * Bridge between the mounted calendar view and the event-source collectors
 * (see components/EventSourcesHost.tsx). The view publishes the date range it
 * wants; each collector runs its source's live query for that range and
 * publishes the items back. Kept OUT of calendar-ui-store because nothing
 * here is user UI state except hiddenSourceIds — the rest is a render-cycle
 * handshake.
 *
 * hiddenSourceIds is deliberately parallel to calendar-ui-store's visibleIds,
 * never mixed with it: visibleIds feeds the calendar_events server filter,
 * and a synthetic source id in that array would silently poison the query.
 * The inverted polarity (hidden, not visible) means an empty array shows
 * every source with no init handshake.
 */
interface EventSourcesState {
    /** Range the mounted calendar view wants; null when no view is mounted. */
    range: { startIso: string; endIso: string } | null
    itemsBySource: Record<string, EventSourceItem[]>
    loadingSourceIds: string[]
    hiddenSourceIds: string[]
    setRange: (startIso: string, endIso: string) => void
    clearRange: () => void
    setSourceItems: (sourceId: string, items: EventSourceItem[], isLoading: boolean) => void
    clearSource: (sourceId: string) => void
    toggleSource: (sourceId: string) => void
}

function without(list: string[], id: string): string[] {
    return list.filter(v => v !== id)
}

export const useEventSourcesStore = create<EventSourcesState>(set => ({
    range: null,
    itemsBySource: {},
    loadingSourceIds: [],
    hiddenSourceIds: [],

    setRange: (startIso, endIso) =>
        set(state => {
            if (state.range?.startIso === startIso && state.range?.endIso === endIso) return state
            return { range: { startIso, endIso } }
        }),

    clearRange: () => set({ range: null }),

    setSourceItems: (sourceId, items, isLoading) =>
        set(state => ({
            itemsBySource: { ...state.itemsBySource, [sourceId]: items },
            loadingSourceIds: isLoading
                ? state.loadingSourceIds.includes(sourceId)
                    ? state.loadingSourceIds
                    : [...state.loadingSourceIds, sourceId]
                : without(state.loadingSourceIds, sourceId),
        })),

    clearSource: sourceId =>
        set(state => {
            const { [sourceId]: _gone, ...rest } = state.itemsBySource
            return {
                itemsBySource: rest,
                loadingSourceIds: without(state.loadingSourceIds, sourceId),
            }
        }),

    toggleSource: sourceId =>
        set(state => ({
            hiddenSourceIds: state.hiddenSourceIds.includes(sourceId)
                ? without(state.hiddenSourceIds, sourceId)
                : [...state.hiddenSourceIds, sourceId],
        })),
}))
