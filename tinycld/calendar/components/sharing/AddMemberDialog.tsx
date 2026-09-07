import { MemberAvatar } from '@tinycld/core/components/settings/members/MemberAvatar'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Dialog } from '@tinycld/core/ui/dialog'
import { Search } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { type CalendarRole, ROLE_OPTIONS } from './roles'

interface AddMemberDialogProps {
    isVisible: boolean
    calendarId: string
    existingUserIds: Set<string>
    onClose: () => void
}

interface Candidate {
    userId: string
    name: string | null | undefined
    email: string | null | undefined
}

export function AddMemberDialog({
    isVisible,
    calendarId,
    existingUserIds,
    onClose,
}: AddMemberDialogProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const fgColor = useThemeColor('foreground')
    const [query, setQuery] = useState('')
    const [role, setRole] = useState<CalendarRole>('viewer')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    const [usersCollection, membersCollection] = useStore('users', 'calendar_members')

    const { data: candidatesRaw } = useOrgLiveQuery(q =>
        q.from({ u: usersCollection }).select(({ u }) => ({
            userId: u.id,
            name: u.name,
            email: u.email,
        }))
    )

    const filteredCandidates = useMemo(() => {
        const all = candidatesRaw ?? []
        const q = query.trim().toLowerCase()
        return all
            .filter(c => !existingUserIds.has(c.userId))
            .filter(c => {
                if (!q) return true
                return (
                    (c.name ?? '').toLowerCase().includes(q) ||
                    (c.email ?? '').toLowerCase().includes(q)
                )
            })
            .slice(0, 20)
    }, [candidatesRaw, existingUserIds, query])

    const addMember = useMutation({
        mutationFn: mutation(function* (input: { userId: string; role: CalendarRole }) {
            yield membersCollection.insert({
                id: newRecordId(),
                calendar: calendarId,
                user: input.userId,
                role: input.role,
                // color is select-with-no-default — pbtsdb's generated type
                // marks it required, and PB's create-rule may stricter-check
                // it than the schema suggests. Pick a sensible default.
                color: 'blue',
            })
        }),
        onSuccess: () => {
            setQuery('')
            setRole('viewer')
            setErrorMessage(null)
            onClose()
        },
        onError: error => {
            const msg = error instanceof Error ? error.message : 'Failed to add member'
            setErrorMessage(msg)
        },
    })

    const handleAdd = (userId: string) => {
        setErrorMessage(null)
        addMember.mutate({ userId, role })
    }

    const handleClose = () => {
        setQuery('')
        setRole('viewer')
        setErrorMessage(null)
        onClose()
    }

    return (
        <Dialog isOpen={isVisible} onClose={handleClose} title="Add people" size="lg">
            <View className="px-5 pb-2 gap-3">
                <View className="flex-row items-center gap-2 px-3 py-2 rounded-md border border-border bg-background">
                    <Search size={16} color={mutedColor} />
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Search by name or email"
                        className="flex-1 text-foreground"
                        style={{ fontSize: 14, color: fgColor, outlineWidth: 0 } as object}
                        placeholderTextColor={mutedColor}
                        autoFocus
                    />
                </View>

                <RolePicker role={role} onChange={setRole} />
                <ErrorBanner message={errorMessage} />
            </View>

            <Dialog.Body contentClassName="pb-3">
                <CandidateList
                    candidates={filteredCandidates}
                    hasQuery={!!query}
                    isAdding={addMember.isPending}
                    onAdd={handleAdd}
                />
            </Dialog.Body>
        </Dialog>
    )
}

function RolePicker({
    role,
    onChange,
}: {
    role: CalendarRole
    onChange: (role: CalendarRole) => void
}) {
    return (
        <View className="flex-row gap-1.5 items-center">
            <Text className="text-xs text-muted-foreground">Role:</Text>
            {ROLE_OPTIONS.map(opt => (
                <RoleChip
                    key={opt.value}
                    label={opt.label}
                    isSelected={role === opt.value}
                    onPress={() => onChange(opt.value)}
                />
            ))}
        </View>
    )
}

function RoleChip({
    label,
    isSelected,
    onPress,
}: {
    label: string
    isSelected: boolean
    onPress: () => void
}) {
    return (
        <Pressable
            onPress={onPress}
            className={
                isSelected
                    ? 'px-2.5 py-1 rounded-md bg-primary'
                    : 'px-2.5 py-1 rounded-md border border-border'
            }
        >
            <Text
                className={
                    isSelected ? 'text-primary-foreground text-xs' : 'text-foreground text-xs'
                }
            >
                {label}
            </Text>
        </Pressable>
    )
}

function ErrorBanner({ message }: { message: string | null }) {
    if (!message) return null
    return (
        <View className="px-3 py-2 rounded-md bg-danger-soft">
            <Text className="text-danger text-xs">{message}</Text>
        </View>
    )
}

function CandidateList({
    candidates,
    hasQuery,
    isAdding,
    onAdd,
}: {
    candidates: Candidate[]
    hasQuery: boolean
    isAdding: boolean
    onAdd: (userId: string) => void
}) {
    if (candidates.length === 0) {
        return (
            <View className="py-4">
                <Text className="text-muted-foreground text-sm">
                    {hasQuery
                        ? 'No matching people'
                        : 'Everyone is already a member of this calendar'}
                </Text>
            </View>
        )
    }
    return (
        <>
            {candidates.map(c => (
                <CandidateRow
                    key={c.userId}
                    candidate={c}
                    isAdding={isAdding}
                    onAdd={() => onAdd(c.userId)}
                />
            ))}
        </>
    )
}

function CandidateRow({
    candidate,
    isAdding,
    onAdd,
}: {
    candidate: Candidate
    isAdding: boolean
    onAdd: () => void
}) {
    const name = candidate.name ?? ''
    const email = candidate.email ?? ''
    return (
        <View className="flex-row items-center gap-3 py-1">
            <MemberAvatar name={name} email={email} size={32} />
            <View className="flex-1">
                <Text className="text-foreground font-medium" style={{ fontSize: 14 }}>
                    {name || email}
                </Text>
                <SecondaryLine isVisible={!!name} text={email} />
            </View>
            <Button size="sm" onPress={onAdd} isDisabled={isAdding}>
                <ButtonText>{isAdding ? 'Adding…' : 'Add'}</ButtonText>
            </Button>
        </View>
    )
}

function SecondaryLine({ isVisible, text }: { isVisible: boolean; text: string }) {
    if (!isVisible) return null
    return (
        <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
            {text}
        </Text>
    )
}
