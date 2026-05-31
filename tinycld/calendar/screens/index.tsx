import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { DayView } from '../components/DayView'
import { MonthView } from '../components/MonthView'
import { ScheduleView } from '../components/ScheduleView'
import { WeekView } from '../components/WeekView'
import { useCalendarView } from '../hooks/useCalendarView'

function pickView(viewMode: ReturnType<typeof useCalendarView>['viewMode']) {
    if (viewMode === 'day') return <DayView />
    if (viewMode === 'week') return <WeekView />
    if (viewMode === 'schedule') return <ScheduleView />
    return <MonthView />
}

export default function CalendarScreen() {
    const { viewMode } = useCalendarView()
    return (
        <>
            <DocumentTitle pkg="Calendar" />
            {pickView(viewMode)}
        </>
    )
}
