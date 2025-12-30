// Modelos de datos para MultiDesktopFlow

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface NoteImage {
  id: string;
  data: string; // Base64
  originalName?: string;
  size: Size;
  position: Position;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  images: NoteImage[];
  position: Position;
  size: Size;
  color?: string;
  zIndex: number;
  minimized: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Connection {
  id: string;
  fromNoteId: string;
  toNoteId: string;
  color?: string;
}

export interface Folder {
  id: string;
  name: string;
  icon?: string;
  position: Position;
  desktopId: string; // ID del escritorio que contiene
  color?: string;
}

export interface Desktop {
  id: string;
  name: string;
  parentId: string | null; // null = escritorio raíz
  notes: Note[];
  folders: Folder[];
  connections: Connection[];
  createdAt: Date;
}

export interface AppState {
  desktops: Desktop[];
  currentDesktopId: string;
  theme: ThemeConfig;
}

export interface ThemeConfig {
  primaryColor: string;
  glowIntensity: number;
  particlesEnabled: boolean;
  animationsEnabled: boolean;
}

export const DEFAULT_THEMES: { [key: string]: string } = {
  'matrix': '#00ff41',
  'cyber-green': '#0d7337',
  'neon-blue': '#00d4ff',
  'neon-red': '#ff0040',
  'neon-purple': '#bf00ff',
  'neon-orange': '#ff6600',
  'ice-white': '#e0ffff',
  'gold': '#ffd700'
};

export const createDefaultDesktop = (id: string, name: string, parentId: string | null = null): Desktop => ({
  id,
  name,
  parentId,
  notes: [],
  folders: [],
  connections: [],
  createdAt: new Date()
});

export const createDefaultNote = (id: string, position: Position): Note => ({
  id,
  title: 'Nueva Nota',
  content: '',
  images: [],
  position,
  size: { width: 300, height: 200 },
  zIndex: 1,
  minimized: false,
  createdAt: new Date(),
  updatedAt: new Date()
});

export const createDefaultFolder = (id: string, name: string, position: Position, desktopId: string): Folder => ({
  id,
  name,
  position,
  desktopId
});
