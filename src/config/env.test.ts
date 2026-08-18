import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const validBase: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  MINDLOGIC_API_KEY: 'super-secret-key',
  APP_SHARED_PASSWORD: 'a-shared-password',
  SESSION_SECRET: 'a-session-secret-at-least-32-characters-long',
};

describe('parseEnv', () => {
  it('applies documented defaults when only required fields are set', () => {
    const result = parseEnv(validBase);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3001);
    expect(result.HOST).toBe('127.0.0.1');
    expect(result.FRONTEND_ORIGIN).toBe('http://localhost:5173');
    expect(result.MINDLOGIC_BASE_URL).toBe('https://factchat-cloud.mindlogic.ai/v1/gateway');
    expect(result.MINDLOGIC_MODEL).toBe('claude-haiku-4-5-20251001');
    expect(result.MINDLOGIC_MONTHLY_CREDIT_LIMIT).toBe(5000);
    expect(result.SESSION_MAX_AGE_SECONDS).toBe(2592000);
  });

  it('throws when APP_SHARED_PASSWORD is missing', () => {
    const { APP_SHARED_PASSWORD: _omit, ...rest } = validBase;
    expect(() => parseEnv(rest)).toThrow(/APP_SHARED_PASSWORD/);
  });

  it('throws when APP_SHARED_PASSWORD is too short', () => {
    expect(() => parseEnv({ ...validBase, APP_SHARED_PASSWORD: 'abc' })).toThrow(
      /APP_SHARED_PASSWORD/,
    );
  });

  it('throws when SESSION_SECRET is missing', () => {
    const { SESSION_SECRET: _omit, ...rest } = validBase;
    expect(() => parseEnv(rest)).toThrow(/SESSION_SECRET/);
  });

  it('throws when SESSION_SECRET is shorter than 32 characters', () => {
    expect(() => parseEnv({ ...validBase, SESSION_SECRET: 'too-short' })).toThrow(/SESSION_SECRET/);
  });

  it('never includes the offending secret value in the error message for APP_SHARED_PASSWORD/SESSION_SECRET', () => {
    try {
      parseEnv({ ...validBase, SESSION_SECRET: 'short' });
      throw new Error('expected parseEnv to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('SESSION_SECRET');
      expect(message).not.toContain(validBase.APP_SHARED_PASSWORD);
    }
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validBase;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when MINDLOGIC_API_KEY is missing', () => {
    const { MINDLOGIC_API_KEY: _omit, ...rest } = validBase;
    expect(() => parseEnv(rest)).toThrow(/MINDLOGIC_API_KEY/);
  });

  it('never includes the offending secret value in the error message', () => {
    try {
      parseEnv({ ...validBase, MINDLOGIC_API_KEY: '' });
      throw new Error('expected parseEnv to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('MINDLOGIC_API_KEY');
      expect(message).not.toContain(validBase.DATABASE_URL);
    }
  });

  it('rejects a wildcard FRONTEND_ORIGIN', () => {
    expect(() => parseEnv({ ...validBase, FRONTEND_ORIGIN: '*' })).toThrow(/FRONTEND_ORIGIN/);
  });

  it('rejects a MINDLOGIC_MODEL that is not in the allow list', () => {
    expect(() => parseEnv({ ...validBase, MINDLOGIC_MODEL: 'gpt-4o' })).toThrow(/MINDLOGIC_MODEL/);
  });

  it('coerces numeric fields from string env values', () => {
    const result = parseEnv({
      ...validBase,
      PORT: '4000',
      MINDLOGIC_MONTHLY_CREDIT_LIMIT: '10000',
    });
    expect(result.PORT).toBe(4000);
    expect(result.MINDLOGIC_MONTHLY_CREDIT_LIMIT).toBe(10000);
  });
});
