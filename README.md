# Multiplayer Tic-Tac-Toe (Firebase Realtime Database)

A real-time, room-based multiplayer Tic-Tac-Toe web app built with plain HTML, CSS, and JavaScript.

## Features

- Real-time multiplayer (2 players) using Firebase Realtime Database
- Create room / join room with room ID or shareable link
- Persistent room state across refresh
- Turn lock with transaction-based move writes
- Winner and draw detection
- Winning line highlight
- Restart round button
- Waiting for opponent screen
- Player names
- Scoreboard
- Responsive modern UI with move animation

## Project Structure

- index.html
- style.css
- app.js
- config.example.js
- config.js (local only, gitignored)

## 1) Firebase Setup

1. Go to https://console.firebase.google.com and create a project.
2. In your project, open Build > Realtime Database.
3. Create database (for testing, start in test mode).
4. Project Settings > General > Your Apps > Web App.
5. Copy `config.example.js` to `config.js` and paste your Firebase config into `config.js`.

Inside config.js, update:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

## 2) Recommended Realtime Database Rules

Use these basic rules for local development.

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

## 3) Run Locally

Because ES modules are used, run with a local server.

Option A (VS Code Live Server extension):

- Open project folder
- Run Live Server on index.html

Option B (Node):

```bash
npx serve .
```

Then open the shown local URL in two browser windows and test multiplayer.

## 4) Deploy (Netlify / Vercel)

This is a static app, so deployment is direct.

### Netlify

- Drag and drop project folder in Netlify dashboard, or connect Git repo.
- Publish directory: project root.

### Vercel

- Import project repo.
- Framework preset: Other.
- Build command: none.
- Output directory: project root.

After deployment:

- Ensure Firebase Realtime Database rules allow your deployed domain flow.
- Keep Firebase config in your local `config.js` for development only.

## Security

- Never commit real credentials to git.
- Keep real Firebase values only in local `config.js` (already gitignored).
- Rotate/revoke any key immediately if it was ever committed.
- This repo runs Gitleaks in GitHub Actions on push and pull requests.

## Notes

- If two players click at once, Firebase transactions prevent invalid state.
- Filled cells cannot be overwritten.
- Refreshing a page keeps the board state from database.
- Leaving a room resets round state if one player remains.

## Troubleshooting Cross-Device Join

- If room code starts with `L`, it is a Local Mode room and only works in the same browser profile.
- For cross-device play, ensure room code starts with `F`.
- If you see Firebase permission errors, verify Realtime Database rules allow read/write at `rooms/$roomId`.
- Ensure `config.js` has real Firebase values (not `YOUR_*` placeholders), then hard refresh both devices.
