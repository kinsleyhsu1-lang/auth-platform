const request = require('supertest');
const app = require('../index');
const pool = require('../db');

function uniqueEmail() {
  return `extra2-${Date.now()}@example.com`;
}

describe('More branch coverage', () => {
  it('refresh/logout without cookie when cookies disabled', async () => {
    process.env.USE_REFRESH_COOKIE = 'false';
    process.env.EXPOSE_REFRESH_TOKEN = 'true';

    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'NoCookie', password });

    await request(app).get(`/verify?token=${registerRes.body.verification_token}`);

    const loginRes = await request(app)
      .post('/login')
      .send({ email, password });

    const refreshToken = loginRes.body.refresh_token;

    const refreshRes = await request(app)
      .post('/refresh')
      .send({ refresh_token: refreshToken });

    expect(refreshRes.status).toBe(200);

    const logoutRes = await request(app)
      .post('/logout')
      .send({ refresh_token: refreshRes.body.refresh_token });

    expect(logoutRes.status).toBe(200);
  });

  it('verify returns already verified', async () => {
    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'AlreadyVerified', password });

    const token = registerRes.body.verification_token;

    const first = await request(app).get(`/verify?token=${token}`);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('verified');

    const second = await request(app).get(`/verify?token=${token}`);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('already verified');
  });

  it('reset rejects expired token without DB mutation', async () => {
    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'ExpireReset', password });

    await request(app).get(`/verify?token=${registerRes.body.verification_token}`);

    const resetReq = await request(app)
      .post('/request-reset')
      .send({ email });

    const resetToken = resetReq.body.reset_token;

    // Force expire
    await pool.query(
      'UPDATE password_resets SET expires_at = NOW() - INTERVAL \'1 hour\' WHERE token_hash = $1',
      [require('crypto').createHash('sha256').update(resetToken).digest('hex')]
    );

    const expired = await request(app)
      .post('/reset')
      .send({ token: resetToken, new_password: 'NewStrongPass#123' });

    expect(expired.status).toBe(400);
    expect(expired.body.error).toBe('Token expired');
  });
});
