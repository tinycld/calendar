import type { EventSourceModule, EventSourceRange } from '@tinycld/core/lib/event-sources/types'
import { useEventSourceModule } from '@tinycld/core/lib/event-sources/use-event-source-module'
import { useEffect, useMemo } from 'react'
import { CALENDAR_EVENT_SOURCES } from '../hooks/useSourceEvents'
import { useEventSourcesStore } from '../stores/event-sources-store'

/**
 * Renderless host for contributed event sources. One collector component per
 * registered source rather than a loop of hook calls: a source's
 * `useEventSource` is a hook, and the module resolves asynchronously — a
 * component may mount conditionally, a hook may not be called conditionally.
 * Mirrors SearchPalette's PackageActions/ResolvedPackageActions split, and
 * the same split repeats inside each collector for the module resolution.
 *
 * A hidden source's collector stays UNMOUNTED, so its live query does not run
 * for a feed nobody is looking at; unmount clears its items via the effect
 * cleanup below.
 */
export function EventSourcesHost() {
    const hiddenSourceIds = useEventSourcesStore(s => s.hiddenSourceIds)
    return (
        <>
            {CALENDAR_EVENT_SOURCES.filter(s => !hiddenSourceIds.includes(s.id)).map(source => (
                <SourceLoader key={source.id} sourceId={source.id} />
            ))}
        </>
    )
}

function SourceLoader({ sourceId }: { sourceId: string }) {
    const module = useEventSourceModule('calendar', sourceId)
    const range = useEventSourcesStore(s => s.range)
    if (!module || !range) return null
    return <SourceCollector sourceId={sourceId} module={module} range={range} />
}

function SourceCollector({
    sourceId,
    module,
    range,
}: {
    sourceId: string
    module: EventSourceModule
    range: { startIso: string; endIso: string }
}) {
    const sourceRange: EventSourceRange = useMemo(
        () => ({ start: new Date(range.startIso), end: new Date(range.endIso) }),
        [range.startIso, range.endIso]
    )
    const { items, isLoading } = module.useEventSource(sourceRange)

    const setSourceItems = useEventSourcesStore(s => s.setSourceItems)
    const clearSource = useEventSourcesStore(s => s.clearSource)

    // Store writes belong in an effect, not render — this is the same
    // imperative-handle pattern as ResolvedPackageActions' onReady.
    useEffect(() => {
        setSourceItems(sourceId, items, isLoading)
    }, [setSourceItems, sourceId, items, isLoading])

    useEffect(() => () => clearSource(sourceId), [clearSource, sourceId])

    return null
}
