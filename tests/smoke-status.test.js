const request = require('supertest');
const app = require('../index');

const APP_VERSION = process.env.APP_VERSION || '0.0.0';

describe('Status smoke', () => {
  it('includes version', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(APP_VERSION);
  });
});
