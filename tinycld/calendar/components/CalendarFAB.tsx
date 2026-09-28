import { FAB } from '@tinycld/core/components/FAB'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useGlobalSearchParams, useRouter } from 'expo-router'
import { Plus } from 'lucide-react-native'
import { eventEditorParams } from '../lib/editor-return'

interface CalendarFABProps {
    isVisible: boolean
}

export function CalendarFAB({ isVisible }: CalendarFABProps) {
    const router = useRouter()
    const orgHref = useOrgHref()
    // The calendar's view/date live in the URL; read them globally so they
    // resolve from any depth and carry them into the editor push.
    const { view, date } = useGlobalSearchParams<{ view?: string; date?: string }>()

    return (
        <FAB
            icon={Plus}
            onPress={() =>
                router.push(orgHref('calendar/[id]', eventEditorParams('new', { view, date })))
            }
            accessibilityLabel="Create event"
            isVisible={isVisible}
            iconSize={24}
        />
    )
}
