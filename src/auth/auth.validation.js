export function validateRegistration(body = {}) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email) || email.length > 191) {
    return { error: 'Enter a valid email address.' };
  }

  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return { error: 'Username must be 3-20 letters, numbers, or underscores.' };
  }

  if (
    password.length < 8 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return { error: 'Password must be 8+ characters with uppercase, lowercase, and a number.' };
  }

  return { value: { username, email, password } };
}

export function validateLogin(body = {}) {
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!identifier || !password) {
    return { error: 'Invalid username, email, or password.' };
  }

  return { value: { identifier, password } };
}

