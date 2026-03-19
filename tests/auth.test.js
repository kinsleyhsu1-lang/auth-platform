const request = require('supertest');
const app = require('../index');

function uniqueEmail() {
  return `test-${Date.now()}@example.com`;
}

describe('Auth flow', () => {
  it('registers, verifies, logs in, refreshes, and logs out', async () => {
    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'TestUser', password });

    expect(registerRes.status).toBe(200);
    expect(registerRes.body.verification_token).toBeTruthy();

    const token = registerRes.body.verification_token;

    const verifyRes = await request(app).get(`/verify?token=${token}`);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.status).toBe('verified');

    const loginRes = await request(app)
      .post('/login')
      .send({ email, password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.access_token).toBeTruthy();
    expect(loginRes.body.refresh_token).toBeTruthy();

    const accessToken = loginRes.body.access_token;
    const refreshToken = loginRes.body.refresh_token;

    const meRes = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe(email);

    const refreshRes = await request(app)
      .post('/refresh')
      .send({ refresh_token: refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.refresh_token).toBeTruthy();

    const logoutRes = await request(app)
      .post('/logout')
      .send({ refresh_token: refreshRes.body.refresh_token });

    expect(logoutRes.status).toBe(200);
  });
});
