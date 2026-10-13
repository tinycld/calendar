import { describe, expect, it } from 'vitest'
import {
    addMemberDefaults,
    addMemberSchema,
} from '~/tinycld/calendar/components/sharing/add-member-schema'

describe('addMemberSchema', () => {
    it('defaults to the viewer role', () => {
        expect(addMemberSchema.parse(addMemberDefaults)).toEqual({ query: '', role: 'viewer' })
    })

    it('accepts every calendar role', () => {
        for (const role of ['owner', 'editor', 'viewer']) {
            expect(addMemberSchema.safeParse({ query: '', role }).success).toBe(true)
        }
    })

    it('rejects a role calendar_members does not have', () => {
        expect(addMemberSchema.safeParse({ query: '', role: 'admin' }).success).toBe(false)
    })
})
