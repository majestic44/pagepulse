import nodemailer from 'nodemailer';

import type { Environment } from '@pagepulse/config';

const developmentSender = 'PagePulse <pagepulse@example.test>';

export type VerificationEmail = Readonly<{
  email: string;
  token: string;
}>;

export type VerificationEmailDelivery = Readonly<{
  enabled: boolean;
  sendVerification: (message: VerificationEmail) => Promise<void>;
}>;

export class EmailDeliveryUnavailableError extends Error {
  constructor() {
    super('Verification email delivery is not configured');
    this.name = 'EmailDeliveryUnavailableError';
  }
}

export function createEmailVerificationUrl(appBaseUrl: string, token: string) {
  const url = new URL(appBaseUrl);
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/verify-email`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('token', token);
  return url.toString();
}

export function createVerificationEmailDelivery(
  environment: Environment,
): VerificationEmailDelivery {
  if (environment.AUTH_EMAIL_DELIVERY_MODE === 'disabled') {
    return {
      enabled: false,
      sendVerification() {
        return Promise.reject(new EmailDeliveryUnavailableError());
      },
    };
  }

  const appBaseUrl = environment.APP_BASE_URL;
  if (!appBaseUrl) {
    throw new EmailDeliveryUnavailableError();
  }

  const transport = nodemailer.createTransport({
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    host: 'mailpit',
    port: 1025,
    secure: false,
    socketTimeout: 5_000,
  });
  return {
    enabled: true,
    async sendVerification({ email, token }) {
      await transport.sendMail({
        from: developmentSender,
        subject: 'Verify your PagePulse email address',
        text: [
          'Complete your PagePulse account setup by verifying your email address:',
          '',
          createEmailVerificationUrl(appBaseUrl, token),
          '',
          'This link expires after 24 hours and can be used once.',
        ].join('\n'),
        to: email,
      });
    },
  };
}
