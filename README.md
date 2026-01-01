# MultiDesktopFlow

A cyberpunk-themed virtual desktop application for organizing notes, folders, and connections in a spatial interface.

## Features

- **Virtual Desktops**: Create nested desktops to organize your work
- **Notes**: Drag-and-drop notes with rich text content
- **Folders**: Navigate between desktops using folder shortcuts
- **Connections**: Link notes together visually
- **Offline Mode**: Works without backend, data saved locally
- **Cloud Sync**: Optional Supabase integration for cloud storage

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment (Required for cloud features)

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your Supabase credentials
```

Your `.env` file should contain:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

> **Note**: Without `.env` configuration, the app runs in **Offline Mode** - all data is stored locally in IndexedDB.

### 3. Run the development server

```bash
ng serve
```

Open [http://localhost:4200](http://localhost:4200) in your browser.

## Environment Setup

### Getting Supabase Credentials

1. Create a project at [supabase.com](https://supabase.com)
2. Go to Project Settings → API
3. Copy the **Project URL** and **anon/public key**
4. Add them to your `.env` file

### Environment Files

| File | Purpose | Git |
|------|---------|-----|
| `.env` | Your local credentials | Ignored |
| `.env.example` | Template for developers | Committed |
| `environment.ts` | Reads from `.env` via Vite | Committed |

## Project Structure

```
src/
├── app/
│   ├── components/     # UI components
│   │   ├── desktop/    # Main desktop workspace
│   │   ├── toolbar/    # Top navigation bar
│   │   └── auth/       # Login/Register
│   ├── services/       # Business logic
│   │   ├── auth.service.ts
│   │   ├── supabase.service.ts
│   │   └── indexeddb.service.ts
│   └── models/         # TypeScript interfaces
└── environments/       # Environment config
```

## Build

```bash
# Development
ng serve

# Production build
ng build

# Output: dist/multidesktop-app/
```

## Tech Stack

- **Frontend**: Angular 21, TypeScript, SCSS
- **Database**: Supabase (PostgreSQL) + IndexedDB (local)
- **Build**: Vite (via Angular CLI)
- **Styling**: Custom cyberpunk theme with CSS variables

## License

MIT
