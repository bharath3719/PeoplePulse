import { toIstDate } from '@peoplepulse/core';
import { escapeHtml, type Mail } from '../../platform/mail/mail.service';

export interface InvitationMailInput {
  to: string;
  companyName: string;
  roles: string[];
  /** The inviter's address, when known. */
  invitedBy: string | undefined;
  link: string;
  expiresAt: Date;
}

/**
 * The invitation email. The company name is whatever its founder typed at
 * signup, so it is escaped for HTML like any other input.
 */
export function invitationMail(i: InvitationMailInput): Mail {
  const who = i.invitedBy ? `${i.invitedBy} has invited you` : 'You have been invited';
  const roles = i.roles.join(', ');
  const until = toIstDate(i.expiresAt);
  const fine = `The link works once, only for ${i.to}, until ${until}. If you weren’t expecting this, you can `
    + 'ignore it — nothing happens unless the link is used.';

  return {
    to: i.to,
    subject: `Join ${i.companyName} on PeoplePulse`,
    text: [
      `${who} to ${i.companyName} on PeoplePulse, as ${roles}.`,
      '',
      `Accept the invitation: ${i.link}`,
      '',
      fine,
    ].join('\n'),
    html: [
      `<p>${escapeHtml(who)} to <strong>${escapeHtml(i.companyName)}</strong> on PeoplePulse, as ${escapeHtml(roles)}.</p>`,
      `<p><a href="${escapeHtml(i.link)}">Accept the invitation</a></p>`,
      `<p style="color:#666;font-size:13px">${escapeHtml(fine)}</p>`,
    ].join('\n'),
  };
}
