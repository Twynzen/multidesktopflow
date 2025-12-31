// Database models for MultiDesktopFlow
// These models represent the structure used in Supabase and IndexedDB

// ==================== AUTH MODELS ====================

export interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// ==================== SYNC MODELS ====================

export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'success' | 'error';

export interface SyncState {
  status: SyncStatus;
  pendingChangesCount: number;
  lastSyncedAt: Date | null;
  lastSyncedVersion: number;
  error?: string;
}

export interface PendingChange {
  id: string;
  type: 'create' | 'update' | 'delete';
  entity: 'desktop' | 'note' | 'folder' | 'connection' | 'asset';
  entityId: string;
  data?: any;
  timestamp: Date;
}

// ==================== VERSION MODELS ====================

export interface Version {
  id: string;
  workspaceId: string;
  versionNumber: number;
  snapshot: string; // JSON stringified AppState
  changeSummary: string;
  createdAt: Date;
}

export interface VersionDiff {
  added: {
    desktops: number;
    notes: number;
    folders: number;
    connections: number;
  };
  modified: {
    desktops: number;
    notes: number;
    folders: number;
    connections: number;
  };
  deleted: {
    desktops: number;
    notes: number;
    folders: number;
    connections: number;
  };
}

// ==================== WORKSPACE MODELS ====================

export interface Workspace {
  id: string;
  userId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  themeConfig: ThemeConfig;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface ThemeConfig {
  primaryColor: string;
  glowIntensity: number;
  particlesEnabled: boolean;
  animationsEnabled: boolean;
}

// ==================== MAP MODELS ====================

export interface MapFile {
  format: 'mdflow';
  version: '1.0.0';
  metadata: MapMetadata;
  content: MapContent;
  structure: MapStructure;
}

export interface MapMetadata {
  name: string;
  description?: string;
  author?: string;
  exportedAt: string;
  sourceApp: 'MultiDesktopFlow';
  sourceVersion: string;
  checksum: string;
}

export interface MapContent {
  desktops: MapDesktop[];
  assets: MapAsset[];
}

export interface MapStructure {
  rootDesktopLocalId: string;
  hierarchy: {
    [desktopLocalId: string]: {
      parentLocalId: string | null;
      childrenLocalIds: string[];
    };
  };
}

export interface MapDesktop {
  localId: string;
  name: string;
  notes: MapNote[];
  folders: MapFolder[];
  connections: MapConnection[];
}

export interface MapNote {
  localId: string;
  title: string;
  content: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  color?: string;
  zIndex: number;
  minimized: boolean;
  assetLocalIds: string[];
}

export interface MapAsset {
  localId: string;
  noteLocalId: string;
  data: string; // Base64
  originalName?: string;
  mimeType: string;
  size: { width: number; height: number };
  position: { x: number; y: number };
}

export interface MapFolder {
  localId: string;
  name: string;
  icon?: string;
  color?: string;
  position: { x: number; y: number };
  targetDesktopLocalId: string;
}

export interface MapConnection {
  localId: string;
  fromNoteLocalId: string;
  toNoteLocalId: string;
  color?: string;
}

// ==================== SHARED MAP MODELS ====================

export interface SharedMap {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  mapData: MapFile;
  isPublic: boolean;
  shareToken?: string;
  downloadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SharedMapInfo {
  id: string;
  name: string;
  description?: string;
  authorName: string;
  downloadCount: number;
  createdAt: Date;
}

// ==================== IMPORT/EXPORT RESULTS ====================

export interface ImportResult {
  success: boolean;
  desktopsImported: number;
  notesImported: number;
  foldersImported: number;
  assetsImported: number;
  rootDesktopId: string;
  errors?: string[];
}

export interface ExportResult {
  success: boolean;
  fileName: string;
  fileSize: number;
  mapFile: MapFile;
}

export interface ShareResult {
  success: boolean;
  shareToken: string;
  shareUrl: string;
  isPublic: boolean;
}

export interface SyncResult {
  success: boolean;
  versionNumber: number;
  changesUploaded: number;
  assetsUploaded: number;
  timestamp: Date;
  errors?: string[];
}
