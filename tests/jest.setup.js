const pool = require('../db');

afterAll(async () => {
  try {
    await pool.end();
  } catch (_err) {
    // ignore if already closed
  }
});
