const request = require('supertest');
const app = require('../index');
const pool = require('../db');

describe('DB error paths', () => {
  it('db-test returns 500 when query fails', async () => {
    const spy = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/db-test');
    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
    spy.mockRestore();
  });

  it('users returns 500 when query fails', async () => {
    const spy = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/users');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Database error');
    spy.mockRestore();
  });
});
