const request = require('supertest');

function uniqueEmail() {
  return `sg-${Date.now()}@example.com`;
}

describe('SendGrid paths', () => {
  it('returns reset_token when SendGrid disabled', async () => {
    const app = require('../index');
    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'SGUser', password });

    await request(app).get(`/verify?token=${registerRes.body.verification_token}`);

    const resetReq = await request(app)
      .post('/request-reset')
      .send({ email });

    expect(resetReq.status).toBe(200);
    expect(resetReq.body.reset_token).toBeTruthy();
  });

  it('sends email and hides reset_token when SendGrid enabled', async () => {
    process.env.SENDGRID_ENABLED = 'true';
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.SENDGRID_FROM_EMAIL = 'from@example.com';
    process.env.APP_BASE_URL = 'http://localhost:3000';

    let sendMock;
    let app;
    let pool;

    jest.isolateModules(() => {
      jest.doMock('@sendgrid/mail', () => {
        sendMock = jest.fn().mockResolvedValue([]);
        return {
          setApiKey: jest.fn(),
          send: sendMock,
        };
      });
      app = require('../index');
      pool = require('../db');
    });

    const email = uniqueEmail();
    const password = 'StrongPass#123';

    const registerRes = await request(app)
      .post('/register')
      .send({ email, name: 'SGUser2', password });

    await request(app).get(`/verify?token=${registerRes.body.verification_token}`);

    const resetReq = await request(app)
      .post('/request-reset')
      .send({ email });

    expect(resetReq.status).toBe(200);
    expect(resetReq.body.reset_token).toBeUndefined();
    expect(sendMock).toHaveBeenCalled();

    if (pool) {
      await pool.end();
    }

    process.env.SENDGRID_ENABLED = 'false';
  });
});
