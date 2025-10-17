import { describe, expect, it } from 'vitest'
import { parseInviteQuery } from '@/lib'

describe('parseInviteQuery', () => {
  it('returns token when invite param is present', () => {
    const result = parseInviteQuery('?invite=abc123')
    expect(result.token).toBe('abc123')
    expect(result.conflict).toBe(false)
    expect(result.needsRedirect).toBe(false)
  })

  it('normalizes legacy token parameter', () => {
    const result = parseInviteQuery('?token=legacy')
    expect(result.token).toBe('legacy')
    expect(result.conflict).toBe(false)
    expect(result.needsRedirect).toBe(true)
    expect(result.canonicalSearch).toBe('invite=legacy')
  })

  it('detects conflicts when multiple keys differ', () => {
    const result = parseInviteQuery('?invite=one&token=two')
    expect(result.token).toBe('one')
    expect(result.conflict).toBe(true)
  })

  it('marks empty values as conflicts', () => {
    const result = parseInviteQuery('?invite=')
    expect(result.token).toBeNull()
    expect(result.conflict).toBe(true)
  })

  it('redirects invite_token to invite', () => {
    const result = parseInviteQuery('?invite_token=xyz')
    expect(result.token).toBe('xyz')
    expect(result.needsRedirect).toBe(true)
    expect(result.canonicalSearch).toBe('invite=xyz')
  })

  it('sanitizes quoted-printable artifacts in invite value', () => {
    const qp = '?invite=3D877ce21c66= b74193a449af7908ddbe0d'
    const result = parseInviteQuery(qp)
    expect(result.token).toBe('877ce21c66b74193a449af7908ddbe0d')
    expect(result.conflict).toBe(false)
    expect(result.needsRedirect).toBe(false)
    expect(result.canonicalSearch).toBeNull()
  })
})