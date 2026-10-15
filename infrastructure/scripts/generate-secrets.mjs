// Menghasilkan nilai acak untuk JWT_ACCESS_SECRET dan ENCRYPTION_KEY.
// Pemakaian: node infrastructure/scripts/generate-secrets.mjs
import { randomBytes } from 'node:crypto';

console.log(`JWT_ACCESS_SECRET=${randomBytes(48).toString('base64url')}`);
console.log(`ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
