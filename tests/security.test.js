const request = require('supertest');

function uniqueEmail() {
  return `lock-${Date.now()}@example.com`;
}

describe('Security hardening', () => {
  it('locks account after repeated failed logins', async () => {
    process.env.LOCKOUT_THRESHOLD = '2';
    process.env.LOCKOUT_WINDOW_MINUTES = '15';
    process.env.LOCKOUT_DURATION_MINUTES = '15';

    let app;
    let pool;
    jest.isolateModules(() => {
      app = require('../index');
      pool = require('../db');
    });

    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'LockUser', password });

    await request(app).get(`/verify?token=${registerRes.body.verification_token}`);

    // Fail twice
    await request(app)
      .post('/login')
      .send({ email, password: 'WrongPass#123' });

    await request(app)
      .post('/login')
      .send({ email, password: 'WrongPass#123' });

    const locked = await request(app)
      .post('/login')
      .send({ email, password });

    expect(locked.status).toBe(423);
    expect(locked.body.error).toBe('Account locked');

    if (pool) {
      await pool.end();
    }
  });

  it('rejects refresh when CSRF header missing (cookie mode)', async () => {
    process.env.USE_REFRESH_COOKIE = 'true';
    process.env.EXPOSE_REFRESH_TOKEN = 'false';

    let cookieApp;
    let pool;
    jest.isolateModules(() => {
      cookieApp = require('../index');
      pool = require('../db');
    });

    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(cookieApp)
      .post('/register')
      .send({ email, name: 'CsrfUser', password });

    await request(cookieApp).get(`/verify?token=${registerRes.body.verification_token}`);

    const loginRes = await request(cookieApp)
      .post('/login')
      .send({ email, password });

    const setCookie = loginRes.headers['set-cookie'] || [];
    expect(setCookie.length).toBeGreaterThan(0);

    const refreshRes = await request(cookieApp)
      .post('/refresh')
      .set('Cookie', setCookie)
      .send({});

    expect(refreshRes.status).toBe(403);
    expect(refreshRes.body.error).toBe('CSRF token invalid');

    if (pool) {
      await pool.end();
    }

    process.env.USE_REFRESH_COOKIE = 'false';
    process.env.EXPOSE_REFRESH_TOKEN = 'true';
  });
});
