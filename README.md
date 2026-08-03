# Cube Eat — Two-Player Online

You can play this game with a friend on the same local network.

## Before you start

This needs **Node.js** to run the server. If you don't have it:

```bash
brew install node
```

Or download it from https://nodejs.org

## Start the server (host laptop)

Open a terminal in this folder (`/Users/jeremiahtran/Documents/cube eat`) and run:

```bash
npm install
node server.js
```

Leave that terminal window open. The server is now running.

## Find the host laptop's local IP

On the host laptop, run:

```bash
ifconfig | grep "inet "
```

Look for an address that starts with `192.168.` or `10.0.`. For example: `192.168.1.42`.

## Open the game on both laptops

- **Host laptop:** open `http://localhost:3000`
- **Other laptop:** open `http://<host-ip>:3000`

Replace `<host-ip>` with the address from the step above. Example: `http://192.168.1.42:3000`

Both players click **JOIN GAME**. The game starts when at least one player joins.

## Important

- The two laptops must be on the **same Wi-Fi / same network**.
- The terminal running `node server.js` must stay open.
- `localhost:3000` only works on the host. The other laptop must use the host's IP address.
- If you see "link not found" or "can't reach the page", the server is not running or the IP is wrong.
