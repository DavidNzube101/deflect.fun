# Deflect

Deflect is a fast-paced, hypercasual game where survival depends on your reflexes. Defend against incoming threats from all directions in a sleek, cyberpunk-themed arena. The game features both a single-player mode to chase high scores and a real-time PvP mode to challenge other players.

## Gameplay

The core mechanic is simple: deflect projectiles before they reach the center. As you progress, the game intensifies with faster waves and complex patterns.

- **Controls**: Use swipe gestures on mobile or arrow/WASD keys on desktop.
- **Powerups**: Enhance your gameplay with unique abilities like invincibility, teleportation, and extra lives.
- **Leaderboard**: Compete for the top spot on the global leaderboard.
- **Store**: Use in-game points to purchase new characters and powerups.

## Tech Stack

This project combines a React frontend with a Go backend for a responsive and low-latency experience.

- **Frontend**: React (TypeScript), Create React App
- **Backend**: Go (Gin), WebSockets for real-time PvP
- **Database**: Firebase/Firestore for leaderboards and user data
- **Blockchain**: Solana integration for in-game purchases.

## Getting Started

To run the project locally, you'll need Node.js and Go installed.

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/your-username/deflect-game.git
    cd deflect-game
    ```

2.  **Install frontend dependencies:**
    ```sh
    npm install
    ```

3.  **Run the Go server:**
    Navigate to the `server-go` directory and run:
    ```sh
    go run .
    ```

4.  **Start the React app:**
    ```sh
    npm start
    ```

The game will be available at `http://localhost:3000`.