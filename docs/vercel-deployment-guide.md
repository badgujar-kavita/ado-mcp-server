# Vercel Deployment Guide 

This guide explains how to deploy VortexADO MCP to Vercel for distribution via a simple curl command.

---

## Overview 

Once deployed, users can install VortexADO MCP with:

```bash
curl https://vortexado.vercel.app/install -fsS | bash
```

The setup includes:

* **Landing Page** \- Beautiful marketing page at the root URL
* **Install Script** \- Served to CLI tools (curl/wget)
* **Uninstall Script** \- For clean removal
* **Distribution Tarball** \- Pre\-built package for installation
* **Browser Protection** \- Redirects browsers to landing page (scripts only served to CLI)

---

## Prerequisites

* Vercel account (free tier works)
* GitHub account
* Access to this repository

---

## Deployment Steps

### Step 1: Import Repository to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New..."** → **"Project"**
3. Click **"Import Git Repository"**
4. Connect your GitHub account if not already connected
5. Select the `ado-mcp-server` repository

### Step 2: Configure Project Settings

On the configuration screen, set:

| Setting | Value |
|---------|-------|
| **Project Name** | `ado-mcp` |
| **Framework Preset** | Other |
| **Root Directory** | `./ ` (leave default) |
| **Build Command** | `bash scripts/build-website.sh` |
| **Output Directory** | `website/public` |
| **Install Command** | `npm install` |

> **Important:** The project name determines your URL. Using `vortexado` gives you `vortexado.vercel.app`

### Step 3: Deploy

1. Click **"Deploy"**
2. Wait for the build to complete (usually 1\-2 minutes)
3. Vercel will show the deployment URL when done

### Step 4: Verify Deployment

Test these URLs:

| URL | Expected Behavior |
|-----|-------------------|
| `https://vortexado.vercel.app` | Landing page loads |
| `https://vortexado.vercel.app/install` | Redirects to landing page (in browser) |
| `curl https://vortexado.vercel.app/install` | Returns bash script (in terminal) |

Test the full install:

```bash
curl https://vortexado.vercel.app/install -fsS | bash
```

---

## How It Works

### Build Process

When Vercel builds the project:

1. Runs `npm install` to install dependencies
2. Runs `bash scripts/build-website.sh` which:
   * Runs `npm run build:dist` to create the distribution package
   * Creates `vortex-ado.tar.gz` from `dist-package/`
   * Places it in `website/public/`

### Middleware (Browser Protection)

The `middleware.js` file at the repository root:

* Detects if request comes from CLI tool (curl, wget, etc.) or browser
* CLI tools get the actual script/tarball content
* Browsers get redirected to the landing page

This prevents users from accidentally viewing raw script code in their browser.

---

## Updating the Deployment

### Automatic Updates

Every push to the `main` branch automatically triggers a new deployment.

```bash
git add .
git commit -m "Update feature X"
git push
```

### Manual Redeploy

1. Go to Vercel Dashboard
2. Select the `ado-mcp` project
3. Click **"Deployments"** tab
4. Click **"Redeploy"** on the latest deployment

---

## Customizing the URL

If `vortexado.vercel.app` is unavailable, you'll need to:

1. Choose a different project name (e.g., `vortex-ado`)
2. Update these files with the new URL:

**`website/public/install`** (line 12):

```bash
TARBALL_URL="https://YOUR-PROJECT-NAME.vercel.app/vortex-ado.tar.gz"
```

**`website/public/index.html`** (search for the install command):

```html
<span class="command-text" id="installCmd">curl https://YOUR-PROJECT-NAME.vercel.app/install -fsS | bash</span>
```

---

## File Structure

```
ado-mcp-server/
├── middleware.js              # Browser redirect logic
├── vercel.json                # Vercel configuration
├── website/
│   └── public/
│       ├── index.html         # Landing page
│       ├── install            # Install script
│       └── uninstall          # Uninstall script
├── scripts/
│   └── build-website.sh       # Creates the tarball
├── src/                       # MCP source code
├── bin/
│   └── bootstrap.mjs          # MCP bootstrap
└── package.json
```

---

## Troubleshooting

### Build Fails: "build-website.sh not found"

Ensure the script has correct path in `vercel.json`:

```json
"buildCommand": "bash scripts/build-website.sh"
```

### Build Fails: "npm run build:dist failed"

Check that `build-dist.mjs` exists and `package.json` has the script:

```json
"scripts": {
  "build:dist": "node build-dist.mjs"
}
```

### Middleware Not Working

Ensure `middleware.js` is at the **repository root** (not inside `website/`).

### Install Script Shows in Browser

Clear Vercel cache and redeploy:

1. Go to Project Settings → Functions
2. Click "Purge Cache"
3. Redeploy

---

## Support

For issues with:

* **Vercel deployment** \- Check [Vercel Docs](https://vercel.com/docs)
* **MCP functionality** \- See [README.md](../README.md)
* **Installation issues** \- Check [Setup Guide](setup-guide.md)
