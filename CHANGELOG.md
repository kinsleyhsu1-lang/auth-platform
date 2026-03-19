# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
- Add CSRF protection for refresh/logout when cookies are used
- Add account lockout after repeated login failures
- Add per-user refresh token salt and lookup hash
- Add SendGrid reset email support (with sandbox mode)
- Add more tests to increase coverage
- Add CI coverage gate and tighten thresholds
- Add .env.example and packaging files whitelist
- Add release script and MIT license

## [1.0.0] - 2026-03-18
- Initial auth service with register/login/refresh/logout
- Email verification + password reset
- Session rotation and cleanup
- Basic CI, tests, and docs
