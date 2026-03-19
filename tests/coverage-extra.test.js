const request = require('supertest');
const app = require('../index');
const pool = require('../db');
const crypto = require('crypto');

function uniqueEmail() {
  return `extra-${Date.now()}@example.com`;
}

describe('Extra coverage', () => {
  it('status endpoint returns ok', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db_time).toBeTruthy();
  });

  it('status endpoint returns error on db failure', async () => {
    const spy = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/status');
    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
    spy.mockRestore();
  });

  it('reset rejects invalid and used tokens', async () => {
    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'ResetUser', password });

    await request(app).get(`/verify?token=${registerRes.body.verification_token}`);

    // invalid token
    const bad = await request(app)
      .post('/reset')
      .send({ token: 'not-a-real-token', new_password: 'NewStrongPass#123' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Invalid token');

    // used token
    const resetReq = await request(app)
      .post('/request-reset')
      .send({ email });

    const resetToken = resetReq.body.reset_token;
    await request(app)
      .post('/reset')
      .send({ token: resetToken, new_password: 'NewStrongPass#123' });

    const used = await request(app)
      .post('/reset')
      .send({ token: resetToken, new_password: 'NewStrongPass#123' });

    expect(used.status).toBe(400);
    expect(used.body.error).toBe('Token already used');
  });

  it('refresh rejects invalid and expired tokens', async () => {
    // invalid token
    const invalid = await request(app)
      .post('/refresh')
      .send({ refresh_token: 'not-a-real-token' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error).toBe('Invalid refresh token');

    // expired token
    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'RefreshUser', password });

    await request(app).get(`/verify?token=${registerRes.body.verification_token}`);

    const loginRes = await request(app)
      .post('/login')
      .send({ email, password });

    const refreshToken = loginRes.body.refresh_token;
    const tokenHash = crypto.createHmac('sha256', process.env.REFRESH_TOKEN_SECRET)
      .update(refreshToken)
      .digest('hex');

    await pool.query(
      'UPDATE sessions SET expires_at = NOW() - INTERVAL \'1 hour\' WHERE refresh_token_lookup = $1',
      [tokenHash]
    );

    const expired = await request(app)
      .post('/refresh')
      .send({ refresh_token: refreshToken });

    expect(expired.status).toBe(401);
    expect(expired.body.error).toBe('Refresh token expired');
  });
});
