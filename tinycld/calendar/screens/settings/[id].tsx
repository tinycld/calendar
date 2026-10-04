import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { PromptDialog } from '@tinycld/core/ui/PromptDialog'
import { useLocalSearchParams } from 'expo-router'
import { ArrowLeft, Pencil } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { CalendarMemberRowData } from '../../components/sharing/MemberRow'
import { MembersSection } from '../../components/sharing/MembersSection'
import type { CalendarRole } from '../../components/sharing/roles'

export default function CalendarSettingsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>()
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('calendar'))
    const fgColor = useThemeColor('foreground')

    const { user } = useAuth()

    const [calendarsCollection, membersCollection, usersCollection] = useStore(
        'calendar_calendars',
        'calendar_members',
        'users'
    )

    const { data: calendars } = useLiveQuery({
        query: query =>
            query.from({ cal: calendarsCollection }).where(({ cal }) => eq(cal.id, id ?? '')),
    })
    const calendar = calendars?.[0]

    const { data: memberRows } = useLiveQuery({
        query: query =>
            query
                .from({ m: membersCollection })
                .join({ u: usersCollection }, ({ m, u }) => eq(m.user, u.id))
                .where(({ m }) => eq(m.calendar, id ?? ''))
                .select(({ m, u }) => ({
                    membershipId: m.id,
                    userId: m.user,
                    role: m.role,
                    name: u.name,
                    email: u.email,
                })),
    })

    const members: CalendarMemberRowData[] = (memberRows ?? []).map(r => ({
        membershipId: r.membershipId,
        userId: r.userId ?? '',
        name: r.name ?? '',
        email: r.email ?? '',
        role: r.role as CalendarRole,
        isCurrentUser: r.userId === user.id,
    }))

    const currentMember = members.find(m => m.isCurrentUser)
    const currentUserRole: CalendarRole | null = currentMember?.role ?? null

    const [actionError, setActionError] = useState<string | null>(null)

    const updateRoleMutation = useMutation({
        mutationFn: mutation(function* (input: { membershipId: string; role: CalendarRole }) {
            yield membersCollection.update(input.membershipId, draft => {
                draft.role = input.role
            })
        }),
        onSuccess: () => setActionError(null),
        onError: error => {
            setActionError(error instanceof Error ? error.message : 'Failed to change role')
        },
    })

    const removeMemberMutation = useMutation({
        mutationFn: mutation(function* (membershipId: string) {
            yield membersCollection.delete(membershipId)
        }),
        onSuccess: () => setActionError(null),
        onError: error => {
            setActionError(error instanceof Error ? error.message : 'Failed to remove member')
        },
    })

    const [isRenaming, setIsRenaming] = useState(false)

    const renameMutation = useMutation({
        mutationFn: mutation(function* (name: string) {
            yield calendarsCollection.update(id ?? '', draft => {
                draft.name = name
            })
        }),
        onSuccess: () => {
            setActionError(null)
            setIsRenaming(false)
        },
        onError: error => {
            setActionError(error instanceof Error ? error.message : 'Failed to rename calendar')
        },
    })

    if (!id || !calendars) {
        // Live query still loading or no id at all — render nothing rather
        // than flashing a "not found" message that's wrong.
        return null
    }

    if (!calendar) {
        return (
            <View className="flex-1 items-center justify-center bg-background">
                <DocumentTitle pkg="Calendar" title="Settings" />
                <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                    Calendar not found
                </Text>
                <Pressable onPress={navigateBack} className="mt-3">
                    <Text className="text-foreground" style={{ fontSize: 14 }}>
                        Go back
                    </Text>
                </Pressable>
            </View>
        )
    }

    return (
        <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            className="bg-background"
            keyboardShouldPersistTaps="handled"
        >
            <DocumentTitle pkg="Calendar" title={`${calendar.name} settings`} />
            <View className="flex-1 p-5 max-w-[760px] gap-6">
                <View className="flex-row items-center gap-3">
                    <Pressable onPress={navigateBack} hitSlop={8}>
                        <ArrowLeft size={22} color={fgColor} />
                    </Pressable>
                    <View className="flex-1 gap-0.5">
                        <Text
                            className="text-muted-foreground"
                            style={{ fontSize: 11, letterSpacing: 0.6 }}
                        >
                            Calendar
                        </Text>
                        <View className="flex-row items-center gap-2">
                            <Text
                                className="text-foreground"
                                style={{ fontSize: 22, fontWeight: '700' }}
                            >
                                {calendar.name}
                            </Text>
                            <RenameButton
                                isVisible={currentUserRole === 'owner'}
                                onPress={() => setIsRenaming(true)}
                            />
                        </View>
                    </View>
                </View>

                <PromptDialog
                    isOpen={isRenaming}
                    onClose={() => setIsRenaming(false)}
                    onSubmit={name => renameMutation.mutate(name)}
                    title="Rename calendar"
                    confirmLabel="Rename"
                    defaultValue={calendar.name}
                    maxLength={100}
                    required
                    isSubmitting={renameMutation.isPending}
                />

                <MembersSection
                    calendarId={calendar.id}
                    members={members}
                    currentUserRole={currentUserRole}
                    actionError={actionError}
                    onRoleChange={(membershipId, role) => {
                        setActionError(null)
                        updateRoleMutation.mutate({ membershipId, role })
                    }}
                    onRemove={membershipId => {
                        setActionError(null)
                        removeMemberMutation.mutate(membershipId)
                    }}
                />
            </View>
        </ScrollView>
    )
}

function RenameButton({ isVisible, onPress }: { isVisible: boolean; onPress: () => void }) {
    const mutedColor = useThemeColor('muted-foreground')
    if (!isVisible) return null
    return (
        <Pressable onPress={onPress} hitSlop={8} testID="calendar-rename-button">
            <Pencil size={16} color={mutedColor} />
        </Pressable>
    )
}
