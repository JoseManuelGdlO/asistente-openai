const {
  hashInviteToken,
  createInviteToken,
  inviteStatus,
  assertInviteUsable,
  sanitizeClient
} = require('../../src/services/metaInviteService');

describe('metaInviteService', () => {
  it('hashInviteToken es estable', () => {
    expect(hashInviteToken('abc')).toBe(hashInviteToken('abc'));
    expect(hashInviteToken('abc')).not.toBe(hashInviteToken('abd'));
  });

  it('createInviteToken genera hash y vencimiento', () => {
    const invite = createInviteToken(Date.parse('2026-10-02T00:00:00.000Z'));
    expect(invite.token).toHaveLength(64);
    expect(invite.hash).toBe(hashInviteToken(invite.token));
    expect(invite.expiresAt).toBe('2026-10-16T00:00:00.000Z');
  });

  it('inviteStatus distingue pending, expired y connected', () => {
    expect(inviteStatus({ META_PHONE_NUMBER_ID: '1' })).toBe('connected');
    expect(inviteStatus({ META_INVITE_TOKEN_HASH: 'x', META_INVITE_USED_AT: '2026-01-01' })).toBe('used');
    expect(inviteStatus({
      META_INVITE_TOKEN_HASH: 'x',
      META_INVITE_EXPIRES_AT: '2020-01-01T00:00:00.000Z'
    })).toBe('expired');
    expect(inviteStatus({
      META_INVITE_TOKEN_HASH: 'x',
      META_INVITE_EXPIRES_AT: '2099-01-01T00:00:00.000Z'
    })).toBe('pending');
  });

  it('assertInviteUsable lanza 404/410', () => {
    expect(() => assertInviteUsable(null)).toThrow(/no es válido/);
    try {
      assertInviteUsable({ META_PHONE_NUMBER_ID: '99' });
    } catch (error) {
      expect(error.status).toBe(410);
    }
    try {
      assertInviteUsable({
        META_INVITE_TOKEN_HASH: 'x',
        META_INVITE_EXPIRES_AT: '2020-01-01T00:00:00.000Z'
      });
    } catch (error) {
      expect(error.status).toBe(410);
    }
  });

  it('sanitizeClient oculta secretos', () => {
    const clean = sanitizeClient({
      id: 'C1',
      name: 'Bot',
      META_ACCESS_TOKEN: 'secret',
      META_INVITE_TOKEN_HASH: 'hash',
      ULTRAMSG_TOKEN: 'u',
      META_PHONE_NUMBER_ID: 'pn'
    });
    expect(clean.META_ACCESS_TOKEN).toBeUndefined();
    expect(clean.META_INVITE_TOKEN_HASH).toBeUndefined();
    expect(clean.ULTRAMSG_TOKEN).toBeUndefined();
    expect(clean.meta.connected).toBe(true);
  });
});
