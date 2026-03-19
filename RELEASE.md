# Release Checklist

## Before Release
- [ ] All tests pass (`npm test`)
- [ ] Coverage meets target (`npm run test:coverage`)
- [ ] Lint passes (`npm run lint`)
- [ ] Migrations applied in staging
- [ ] `.env` values confirmed for target environment
- [ ] SendGrid verified sender configured (if enabled)
- [ ] CI pipeline green on main branch

## Release Steps
- [ ] Update `CHANGELOG.md`
- [ ] Bump version in `package.json`
- [ ] Tag release in git
- [ ] Deploy to target environment

### Automated

```bash
npm run release -- x.y.z
```

## Post Release
- [ ] Smoke test: register → verify → login → refresh → logout
- [ ] Validate reset email delivery (if enabled)
- [ ] Monitor logs for errors
