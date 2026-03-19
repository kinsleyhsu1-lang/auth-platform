const request = require('supertest');
const app = require('../index');

describe('Request reset for non-existent email', () => {
  it('returns ok without token', async () => {
    const res = await request(app)
      .post('/request-reset')
      .send({ email: 'no-such-user@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.reset_token).toBeUndefined();
  });
});
