// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import type { EventSourceItem } from '@tinycld/core/lib/event-sources/types'
import { beforeEach, describe, expect, it } from 'vitest'
import { sourceEventHref, useSourceEvents } from '~/tinycld/calendar/hooks/useSourceEvents'
import { useEventSourcesStore } from '~/tinycld/calendar/stores/event-sources-store'

const RANGE_START = new Date('2026-08-02T00:00:00.000Z')
const RANGE_END = new Date('2026-08-09T00:00:00.000Z')

function item(overrides: Partial<EventSourceItem> = {}): EventSourceItem {
    return {
        id: 'card1',
        title: 'Ship the release',
        start: '2026-08-04T00:00:00.000Z',
        end: '2026-08-04T23:59:59.999Z',
        allDay: true,
        href: { pathname: '/cards/[cardId]', params: { cardId: 'card1' } },
        ...overrides,
    }
}

function resetStore() {
    useEventSourcesStore.setState({
        range: null,
        itemsBySource: {},
        loadingSourceIds: [],
        hiddenSourceIds: [],
    })
}

describe('useSourceEvents', () => {
    beforeEach(resetStore)

    it('publishes the range and maps items to CalendarEvents rows', () => {
        const { result } = renderHook(() => useSourceEvents(RANGE_START, RANGE_END))
        expect(useEventSourcesStore.getState().range).toEqual({
            startIso: RANGE_START.toISOString(),
            endIso: RANGE_END.toISOString(),
        })

        act(() => {
            useEventSourcesStore.getState().setSourceItems('cards-due', [item()], false)
        })

        expect(result.current).toHaveLength(1)
        const evt = result.current[0]
        expect(evt.id).toBe('src:cards-due:card1')
        expect(evt.calendar).toBe('src:cards-due')
        expect(evt.title).toBe('Ship the release')
        expect(evt.all_day).toBe(true)
        expect(evt.recurrence).toBe('')
        expect(evt.recurrence_until).toBe('')
        expect(evt.guests).toEqual([])
    })

    it('drops items from hidden sources', () => {
        const { result } = renderHook(() => useSourceEvents(RANGE_START, RANGE_END))
        act(() => {
            useEventSourcesStore.getState().setSourceItems('cards-due', [item()], false)
            useEventSourcesStore.getState().toggleSource('cards-due')
        })
        expect(result.current).toEqual([])

        act(() => {
            useEventSourcesStore.getState().toggleSource('cards-due')
        })
        expect(result.current).toHaveLength(1)
    })

    it('clips items outside the requested range', () => {
        const { result } = renderHook(() => useSourceEvents(RANGE_START, RANGE_END))
        act(() => {
            useEventSourcesStore.getState().setSourceItems(
                'cards-due',
                [
                    item({
                        id: 'stale',
                        start: '2026-07-20T00:00:00.000Z',
                        end: '2026-07-20T23:59:59.999Z',
                    }),
                    item({ id: 'current' }),
                ],
                false
            )
        })
        expect(result.current.map(e => e.id)).toEqual(['src:cards-due:current'])
    })
})

describe('sourceEventHref', () => {
    beforeEach(resetStore)

    it('resolves a source event to its item href', () => {
        useEventSourcesStore.getState().setSourceItems('cards-due', [item()], false)
        expect(sourceEventHref('src:cards-due:card1')).toEqual({
            pathname: '/cards/[cardId]',
            params: { cardId: 'card1' },
        })
    })

    it('returns null for ordinary event ids and unknown items', () => {
        useEventSourcesStore.getState().setSourceItems('cards-due', [item()], false)
        expect(sourceEventHref('r8f3k2m9x1p7q4w')).toBeNull()
        expect(sourceEventHref('src:cards-due:missing')).toBeNull()
    })
})

describe('event-sources store', () => {
    beforeEach(resetStore)

    it('setRange is idempotent for an unchanged range', () => {
        const store = useEventSourcesStore.getState()
        store.setRange('a', 'b')
        const first = useEventSourcesStore.getState().range
        useEventSourcesStore.getState().setRange('a', 'b')
        expect(useEventSourcesStore.getState().range).toBe(first)
    })

    it('tracks loading sources without duplicates and clears them', () => {
        const store = useEventSourcesStore.getState()
        store.setSourceItems('cards-due', [], true)
        store.setSourceItems('cards-due', [], true)
        expect(useEventSourcesStore.getState().loadingSourceIds).toEqual(['cards-due'])
        store.setSourceItems('cards-due', [item()], false)
        expect(useEventSourcesStore.getState().loadingSourceIds).toEqual([])
    })

    it('clearSource removes a source entirely', () => {
        const store = useEventSourcesStore.getState()
        store.setSourceItems('cards-due', [item()], true)
        store.clearSource('cards-due')
        const state = useEventSourcesStore.getState()
        expect(state.itemsBySource).toEqual({})
        expect(state.loadingSourceIds).toEqual([])
    })
})
