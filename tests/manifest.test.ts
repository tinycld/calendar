import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

describe('calendar manifest', () => {
    it('declares required identifiers', () => {
        expect(manifest.name).toBe('Calendar')
        expect(manifest.slug).toBe('calendar')
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('points routes directory at screens', () => {
        expect(manifest.routes?.directory).toBe('screens')
    })

    it('declares migrations, collections, and seed', () => {
        expect(manifest.migrations?.directory).toBe('pb-migrations')
        expect(manifest.collections?.register).toBe('collections')
        expect(manifest.collections?.types).toBe('types')
        expect(manifest.seed?.script).toBe('seed')
    })

    it('hosts event-source contributions', () => {
        // Cards' due-date source (and any future feed) targets this flag; the
        // generator refuses a contribution aimed at a non-host package.
        expect(manifest.eventSourceHost).toBe(true)
    })

    it('declares a nav entry', () => {
        expect(manifest.nav?.label).toBe('Calendar')
        expect(manifest.nav?.icon).toBe('calendar')
        expect(typeof manifest.nav?.order).toBe('number')
    })

    it('declares a server module', () => {
        expect(manifest.server?.package).toBe('server')
        expect(manifest.server?.module).toBe('tinycld.org/packages/calendar')
    })
})
