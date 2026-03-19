const request = require('supertest');
const app = require('../index');

function uniqueEmail() {
  return `branch-${Date.now()}@example.com`;
}

describe('Branch coverage', () => {
  it('rejects invalid email on register', async () => {
    const res = await request(app)
      .post('/register')
      .send({ email: 'bad-email', name: 'User', password: 'StrongPass#123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid email');
  });

  it('rejects logout without token', async () => {
    const res = await request(app).post('/logout').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('refresh_token is required');
  });

  it('refreshes via cookie when enabled', async () => {
    process.env.USE_REFRESH_COOKIE = 'true';
    process.env.EXPOSE_REFRESH_TOKEN = 'false';

    let cookieApp;
    let cookiePool;
    jest.isolateModules(() => {
      cookieApp = require('../index');
      cookiePool = require('../db');
    });

    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(cookieApp)
      .post('/register')
      .send({ email, name: 'CookieUser', password });

    await request(cookieApp).get(`/verify?token=${registerRes.body.verification_token}`);

    const loginRes = await request(cookieApp)
      .post('/login')
      .send({ email, password });

    const setCookie = loginRes.headers['set-cookie'] || [];
    expect(setCookie.length).toBeGreaterThan(0);
    const csrfToken = loginRes.body.csrf_token;
    expect(csrfToken).toBeTruthy();

    const refreshRes = await request(cookieApp)
      .post('/refresh')
      .set('Cookie', setCookie)
      .set('x-csrf-token', csrfToken)
      .send({});

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.access_token).toBeTruthy();

    process.env.USE_REFRESH_COOKIE = 'false';
    process.env.EXPOSE_REFRESH_TOKEN = 'true';
    if (cookiePool) {
      await cookiePool.end();
    }
  });
});
