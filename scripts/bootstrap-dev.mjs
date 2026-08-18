import { randomBytes } from 'node:crypto';
console.log(
  JSON.stringify(
    {
      message: 'Development bootstrap placeholder',
      ownerSetupToken: randomBytes(24).toString('base64url'),
      next: 'Implement issue 11 before using this against a database.',
    },
    null,
    2,
  ),
);
