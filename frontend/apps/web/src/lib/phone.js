/* A mobile number, checked the way the platform checks it (backend profile.validators.js `phone`,
   hash f3a287c6): spaces, dashes, dots and brackets dropped, then an optional + and 10 to 15
   digits. The cleaned form is what is sent and stored, and what a player signs in with. */
export const cleanPhone = (value) => String(value ?? '').trim().replace(/[\s\-().]/g, '');
export const isValidPhone = (value) => /^\+?\d{10,15}$/.test(cleanPhone(value));
export const PHONE_MESSAGE = 'Enter a valid mobile number (10 to 15 digits).';
