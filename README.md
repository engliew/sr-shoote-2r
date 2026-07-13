# SR Shooter 2

LAN multiplayer water-gun game: players stand on the bottom floor, aim upward (−90°…90°), and blast named flying saucers for seniority points. Shared arena, 60-second rounds, up to **4 phones** on Wi‑Fi against a Node server on your MacBook.

## Feasibility

Yes — an M1 MacBook Air easily hosts 4 browser clients over local Wi‑Fi. The server runs a light 20 Hz simulation; phones only send input and render snapshots.

## Quick start

```bash
cd ~/Projects/sr-shoote-2r
npm install
npm start
```

| Who | URL |
|-----|-----|
| Organiser (this Mac) | http://localhost:3000/admin.html |
| Players (phones) | http://&lt;your-lan-ip&gt;:3000 |

LAN URLs are printed in the terminal and on the admin page.

**Requirements:** Node 18+, phones and Mac on the same Wi‑Fi. Allow Node through the macOS firewall if prompted.

## Controls (phones, portrait)

- Guns stay fixed on each seat (no walking).
- **Bottom left pad:** aim stick — direction sets gun angle (−90°…90°, 0° straight up).
- **Bottom right:** round **Shoot** button — hold for water spurts.
- Desktop test: `A`/`D` or `Q`/`E` aim, `Space` shoot.

## Organiser

On `/admin.html`:

- **Start / End / Reset** rounds
- **Bullet speed / fire rate / spawn rate**
- **Targets roster** — add/remove people (name, points, optional face file); saved to `data/roster.json`
- **4 player columns** during the round: targets hit + points; at the end: target, qty, total points
- **Winner banner** when the round ends (also shown on all player phones)

Optional face files: `public/assets/faces/` matching the face filename.

## Architecture

- **Server-authoritative** Node + Express + WebSocket (`ws`)
- Shared room: lobby → countdown → 60s play → results
- Saucer paths: linear, sine/zigzag, spiral; spawn from top/left/right
- On hit: spiral down, floor blob splat, points under each gun

## Project layout

```
server/          # Express, WS, simulation
public/          # player + admin web clients
data/roster.json # saucer people
```

## Tips for party night

1. Start the server on the host Mac first.
2. Open admin, confirm LAN URL, start a test round alone.
3. Players join on phones; wait for 2–4 seats.
4. Tune water speed if shots feel too strong/weak for the room.
5. Hit **Start round** for each 60s match.
