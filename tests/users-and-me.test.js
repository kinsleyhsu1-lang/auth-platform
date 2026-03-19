const request = require('supertest');
const app = require('../index');

function uniqueEmail() {
  return `me-${Date.now()}@example.com`;
}

describe('Users and /me paths', () => {
  it('returns /users list', async () => {
    const res = await request(app).get('/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 404 for /me when user not found', async () => {
    const fakeToken = require('jsonwebtoken').sign(
      { sub: '00000000-0000-0000-0000-000000000000', email: 'none@example.com', name: 'None' },
      process.env.JWT_SECRET,
      { expiresIn: '15m', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE }
    );

    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${fakeToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('returns /me for valid user', async () => {
    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'MeUser', password });

    await request(app).get(`/verify?token=${registerRes.body.verification_token}`);

    const loginRes = await request(app)
      .post('/login')
      .send({ email, password });

    const token = loginRes.body.access_token;

    const res = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });
});
