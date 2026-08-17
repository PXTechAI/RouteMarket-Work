# Security Policy

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in a public issue.

Use GitHub's **Report a vulnerability** option in the repository Security tab. Include the affected version or commit, operating system, reproduction steps, expected impact, and any suggested mitigation. Remove credentials, access tokens, cookies, personal files, and other user data from screenshots and logs.

If private vulnerability reporting is temporarily unavailable, open a public issue containing no exploit details or sensitive data and ask a maintainer for a private reporting channel.

## Scope

Security reports are especially useful for issues involving:

- Electron main/preload/renderer privilege boundaries;
- project path traversal or access outside an approved project folder;
- command, MCP, skill, browser, or native-application execution without approval;
- credential storage, authentication, or token exposure;
- cloud redaction failures or unintended upload of local content;
- update integrity and code-signing validation.

## Secrets in contributions

Do not commit `.env` files, credentials, cookies, access tokens, private keys, signing certificates, runtime databases, dumps, logs, user profiles, or packaged release output. If a real secret is committed, revoke or rotate it immediately; deleting it in a later commit is not sufficient.
