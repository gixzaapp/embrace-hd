# Embrace HD website

Static marketing site:

| Page | File |
|------|------|
| Home | `index.html` |
| About | `about.html` |
| Privacy Policy | `privacy.html` |
| Delete account | `delete-account.html` |
| Terms of Service | `terms.html` |
| Contact | `contact.html` |

## Preview locally

```bash
cd website
npx --yes serve .
```

Open the URL shown (usually `http://localhost:3000`).

## Deploy

Upload the `website/` folder to any static host (Cloudflare Pages, Netlify, S3, or nginx on Hetzner).

Point `embraceapp.co.uk` (or `www`) at that host. Play Console / AdMob privacy links can use:

- `https://embraceapp.co.uk/privacy.html`
- `https://embraceapp.co.uk/terms.html`
- `https://embraceapp.co.uk/delete-account.html` (Play Console account deletion URL)

Contact email used on the site: `info@embraceapp.co.uk`.
