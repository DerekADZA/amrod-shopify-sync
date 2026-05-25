# Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Test with `DRY_RUN=true` before touching production
5. Commit: `git commit -m "feat: describe your change"`
6. Push and open a Pull Request

## Guidelines

- Always use `DRY_RUN=true` to validate changes before writing to Shopify
- Keep API calls rate-limit safe (the existing `sleep()` helpers help with this)
- Document any new environment variables in `.env.example`
- New sync scripts should follow the existing pattern: auth → fetch → transform → push
