# EcoFi

EcoFi is a sustainable product discovery app with:
- A vanilla HTML/CSS/JS frontend
- A Node.js + Express + MongoDB backend
- Auth, profile, wishlist, and product search/filter support

## Project Structure

- `index.html`, `style.css`, `script.js`: Frontend app
- `images/`: Static assets
- `backend/server.js`: API server
- `backend/models/`: Mongoose models
- `tests/smoke.test.js`: Basic smoke tests

## Prerequisites

- Node.js 18+ (Node 22 is also fine)
- MongoDB Atlas or local MongoDB

## Backend Setup

1. Copy `backend/.env.example` to `backend/.env`.
2. Fill required environment variables:
   - `MONGO_URI`
   - `JWT_SECRET`
   - `ADMIN_SECRET_KEY`
   - `HF_API_KEY`
   - `ZENROWS_API_KEY`
   - `CORS_ORIGIN` (use `*` for dev or your frontend URL in production)
   - `PORT` (optional, default `4000`)
3. Install dependencies:
   - `cd backend`
   - `npm install`
4. Start backend:
   - `node server.js`

## Frontend Setup

Open `index.html` in a browser.

By default, frontend calls `http://localhost:4000`.

To use a deployed backend, set one of these before app usage:
- `window.ECOFI_API_BASE_URL` (highest priority)
- `localStorage.setItem("ecofi_api_base_url", "https://your-api-domain.com")`

## Deployment

### Backend (Render)

- Root includes [render.yaml](/C:/Users/vidus/OneDrive/Desktop/Projects/HTML/render.yaml) for one-click Render setup.
- In Render, set secret env vars:
  - `MONGO_URI`, `JWT_SECRET`, `ADMIN_SECRET_KEY`, `HF_API_KEY`, `ZENROWS_API_KEY`
  - `CORS_ORIGIN` to your frontend URL (for example `https://your-frontend.vercel.app`)

### Frontend (Netlify/Vercel/GitHub Pages)

- Deploy project root as static site.
- Set API endpoint in browser console or in your own bootstrap script:
  - `localStorage.setItem("ecofi_api_base_url", "https://your-backend.onrender.com")`
- Reload the page after setting it.

## Smoke Tests

From `backend/`:
- `npm run test:smoke`

Or from project root:
- `node --test tests/smoke.test.js`

## Notes

- `.gitignore` excludes `backend/node_modules` and env files.
- Favicon and logo paths are now relative and portable.
