# Serverless Video Chat

A pure frontend, peer-to-peer video chat application built with React, WebRTC (PeerJS), and Tailwind CSS. No backend server required for media streaming.

## Features

- **Peer-to-Peer Video Calls**: Direct connection between users using WebRTC.
- **No Backend Required**: Uses public PeerJS signaling server.
- **Secure**: End-to-end encryption for media streams.
- **Responsive Design**: Works on desktop and mobile.
- **Simple UI**: Create a meeting link and share it to start talking.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS
- **WebRTC**: PeerJS
- **Routing**: React Router DOM
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd ServerlessVideoChat
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:5173`.

## Usage

1. **Start a Call**:
   - Click "New Meeting" on the home page.
   - Allow camera and microphone permissions.
   - Share the generated link with your peer.

2. **Join a Call**:
   - Open the shared link.
   - Allow camera and microphone permissions.
   - You will be connected automatically.

## Deployment

Since this is a static site, you can deploy it to any static hosting service like Vercel, Netlify, or GitHub Pages.

### Build for Production

```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory.

### Deploy to Vercel (Recommended)

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Deploy:
   ```bash
   vercel
   ```

### Deploy to Netlify

1. Drag and drop the `dist/` folder to Netlify Drop.
2. Or connect your repository to Netlify and set the build command to `npm run build` and publish directory to `dist`.

## Troubleshooting

- **Camera/Mic not working**: Ensure you have granted permissions in your browser.
- **Connection failed**: Ensure you are not behind a strict firewall that blocks WebRTC. Try using a different network.
- **Mobile issues**: Ensure you use a supported browser (Chrome/Safari) on mobile.

## License

MIT
