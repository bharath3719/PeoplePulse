import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { MailService, escapeHtml } from './mail.service';
import { invitationMail } from '../../modules/user/invitation-mail';

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as unknown as ConfigService;
}

describe('the mail service', () => {
  it('refuses to start in production without SMTP, rather than log invitation links', () => {
    expect(() => new MailService(config({ NODE_ENV: 'production' }))).toThrow(/SMTP_URL/);
    expect(() => new MailService(config({ NODE_ENV: 'development' }))).not.toThrow();
  });
});

describe('the invitation email', () => {
  const mail = invitationMail({
    to: 'ravi@ca-firm.in',
    companyName: 'Acme <Textiles> & "Sons"',
    roles: ['Accountant (external)'],
    invitedBy: 'priya@acme.in',
    link: 'https://app.peoplepulse.in/invite#t.s',
    expiresAt: new Date('2026-10-21T06:00:00Z'),
  });

  it('escapes the company name in HTML: it is whatever the founder typed at signup', () => {
    expect(mail.html).not.toContain('<Textiles>');
    expect(mail.html).toContain(escapeHtml('Acme <Textiles> & "Sons"'));
  });

  it('says who, where, as what, and until when — in IST', () => {
    expect(mail.text).toContain('priya@acme.in has invited you to Acme <Textiles> & "Sons" on PeoplePulse');
    expect(mail.text).toContain('as Accountant (external)');
    expect(mail.text).toContain('https://app.peoplepulse.in/invite#t.s');
    expect(mail.text).toContain('only for ravi@ca-firm.in, until 2026-10-21');
  });
});
