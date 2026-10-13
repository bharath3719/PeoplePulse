import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Outbound email, over SMTP.
 *
 * SMTP rather than one provider's HTTP API: every candidate — SES in Mumbai,
 * Postmark, Zoho, a company relay — speaks it, and the provider follows the
 * cloud-region decision (OPEN.md D-6), which is not made yet. `SMTP_URL` names
 * it, e.g. `smtps://user:pass@email-smtp.ap-south-1.amazonaws.com:465`.
 *
 * With no `SMTP_URL`, mail is written to the log instead, so a developer can
 * follow an invitation link without a mail server. Never in production: what
 * this sends includes invitation links, which are credentials until used, and
 * a log line is a copy of every one of them. Production refuses to start
 * rather than fall back.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const url = config.get<string>('SMTP_URL');
    if (!url && config.get<string>('NODE_ENV') === 'production') {
      throw new Error(
        'SMTP_URL is not set. In production, mail is never written to the log instead: it carries '
          + 'invitation links, and a log line would be a working copy of each one.',
      );
    }
    this.transport = url ? createTransport(url) : null;
    this.from = config.get<string>('MAIL_FROM', 'PeoplePulse <no-reply@peoplepulse.in>');
  }

  async send(mail: Mail): Promise<void> {
    if (!this.transport) {
      this.logger.log(`[dev mail — set SMTP_URL to send] to ${mail.to}: ${mail.subject}\n${mail.text}`);
      return;
    }
    await this.transport.sendMail({ from: this.from, ...mail });
  }
}

/** For anything user-supplied — a company's name — going into an HTML email. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
