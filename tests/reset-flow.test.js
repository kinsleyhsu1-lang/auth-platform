const request = require('supertest');
const app = require('../index');

function uniqueEmail() {
  return `reset-${Date.now()}@example.com`;
}

describe('Password reset flow', () => {
  it('requests reset, resets password, and logs in with new password', async () => {
    const email = uniqueEmail();
    const password = 'StrongPass#123';
    const newPassword = 'NewStrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'ResetUser', password });

    expect(registerRes.status).toBe(200);
    expect(registerRes.body.verification_token).toBeTruthy();

    const verifyRes = await request(app).get(`/verify?token=${registerRes.body.verification_token}`);
    expect(verifyRes.status).toBe(200);

    const resetReq = await request(app)
      .post('/request-reset')
      .send({ email });

    expect(resetReq.status).toBe(200);
    expect(resetReq.body.reset_token).toBeTruthy();

    const resetRes = await request(app)
      .post('/reset')
      .send({ token: resetReq.body.reset_token, new_password: newPassword });

    expect(resetRes.status).toBe(200);

    const loginRes = await request(app)
      .post('/login')
      .send({ email, password: newPassword });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.access_token).toBeTruthy();
  });
});
