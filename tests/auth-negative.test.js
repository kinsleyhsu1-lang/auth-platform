const request = require('supertest');
const app = require('../index');
const pool = require('../db');

function uniqueEmail() {
  return `neg-${Date.now()}@example.com`;
}

describe('Auth negative cases', () => {
  it('rejects invalid login', async () => {
    const res = await request(app)
      .post('/login')
      .send({ email: 'missing@example.com', password: 'BadPass#123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('rejects refresh reuse', async () => {
    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'ReuseUser', password });

    const verifyRes = await request(app)
      .get(`/verify?token=${registerRes.body.verification_token}`);
    expect(verifyRes.status).toBe(200);

    const loginRes = await request(app)
      .post('/login')
      .send({ email, password });

    const refreshToken = loginRes.body.refresh_token;

    const refreshRes = await request(app)
      .post('/refresh')
      .send({ refresh_token: refreshToken });

    expect(refreshRes.status).toBe(200);

    const reuseRes = await request(app)
      .post('/refresh')
      .send({ refresh_token: refreshToken });

    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error).toBe('Refresh token reused');
  });

  it('rejects expired reset token', async () => {
    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'ResetUser', password });

    const verifyRes = await request(app)
      .get(`/verify?token=${registerRes.body.verification_token}`);
    expect(verifyRes.status).toBe(200);

    const resetReq = await request(app)
      .post('/request-reset')
      .send({ email });

    const resetToken = resetReq.body.reset_token;

    // Force expire token directly
    await pool.query(
      'UPDATE password_resets SET expires_at = NOW() - INTERVAL \'1 hour\' WHERE token_hash = $1',
      [require('crypto').createHash('sha256').update(resetToken).digest('hex')]
    );

    const resetRes = await request(app)
      .post('/reset')
      .send({ token: resetToken, new_password: 'NewStrongPass#123' });

    expect(resetRes.status).toBe(400);
    expect(resetRes.body.error).toBe('Token expired');
  });
});
