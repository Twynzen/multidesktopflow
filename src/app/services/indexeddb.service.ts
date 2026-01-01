import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import {
  Desktop,
  Note,
  Folder,
  Connection,
  NoteImage,
  AppState,
  ThemeConfig
} from '../models/desktop.model';
import { PendingChange, Version, Workspace } from '../models/database.model';

// ==================== DATABASE SCHEMA ====================

export interface LocalWorkspace {
  id: string;
  userId?: string;
  name: string;
  description?: string;
  isDefault: boolean;
  themeConfig: ThemeConfig;
  createdAt: Date;
  updatedAt: Date;
  syncedAt?: Date;
}

export interface LocalDesktop {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  positionOrder: number;
  createdAt: Date;
  updatedAt: Date;
  syncedAt?: Date;
}

export interface LocalNote {
  id: string;
  desktopId: string;
  title: string;
  content: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  color?: string;
  zIndex: number;
  minimized: boolean;
  createdAt: Date;
  updatedAt: Date;
  syncedAt?: Date;
}

export interface LocalAsset {
  id: string;
  noteId: string;
  data: Blob; // Store as Blob instead of Base64
  originalName?: string;
  mimeType: string;
  width: number;
  height: number;
  positionX: number;
  positionY: number;
  createdAt: Date;
  syncedAt?: Date;
}

export interface LocalFolder {
  id: string;
  desktopId: string;
  targetDesktopId: string;
  name: string;
  icon?: string;
  color?: string;
  positionX: number;
  positionY: number;
  createdAt: Date;
  syncedAt?: Date;
}

export interface LocalConnection {
  id: string;
  desktopId: string;
  fromNoteId: string;
  toNoteId: string;
  color?: string;
  label?: string;
  createdAt: Date;
  syncedAt?: Date;
}

export interface LocalVersion {
  id: string;
  workspaceId: string;
  versionNumber: number;
  snapshot: string; // JSON string
  changeSummary: string;
  createdAt: Date;
}

export interface LocalPendingChange {
  id: string;
  type: 'create' | 'update' | 'delete';
  entity: 'workspace' | 'desktop' | 'note' | 'folder' | 'connection' | 'asset';
  entityId: string;
  data?: any;
  timestamp: Date;
}

// ==================== DEXIE DATABASE ====================

class MultiDesktopFlowDB extends Dexie {
  workspaces!: Table<LocalWorkspace, string>;
  desktops!: Table<LocalDesktop, string>;
  notes!: Table<LocalNote, string>;
  assets!: Table<LocalAsset, string>;
  folders!: Table<LocalFolder, string>;
  connections!: Table<LocalConnection, string>;
  versions!: Table<LocalVersion, string>;
  pendingChanges!: Table<LocalPendingChange, string>;

  constructor() {
    super('MultiDesktopFlowDB');

    this.version(1).stores({
      workspaces: 'id, userId, name, isDefault, createdAt',
      desktops: 'id, workspaceId, parentId, name, createdAt',
      notes: 'id, desktopId, title, createdAt, updatedAt',
      assets: 'id, noteId, createdAt',
      folders: 'id, desktopId, targetDesktopId, name, createdAt',
      connections: 'id, desktopId, fromNoteId, toNoteId, createdAt',
      versions: 'id, workspaceId, versionNumber, createdAt',
      pendingChanges: 'id, type, entity, entityId, timestamp'
    });
  }
}

// ==================== SERVICE ====================

@Injectable({
  providedIn: 'root'
})
export class IndexedDBService {
  private db: MultiDesktopFlowDB;

  constructor() {
    this.db = new MultiDesktopFlowDB();
  }

  // ==================== WORKSPACE METHODS ====================

  async getWorkspaces(): Promise<LocalWorkspace[]> {
    return await this.db.workspaces.toArray();
  }

  async getWorkspace(id: string): Promise<LocalWorkspace | undefined> {
    return await this.db.workspaces.get(id);
  }

  async getDefaultWorkspace(): Promise<LocalWorkspace | undefined> {
    return await this.db.workspaces.where('isDefault').equals(1).first();
  }

  async saveWorkspace(workspace: LocalWorkspace): Promise<string> {
    await this.db.workspaces.put(workspace);
    await this.addPendingChange('update', 'workspace', workspace.id, workspace);
    return workspace.id;
  }

  async createWorkspace(name: string, isDefault = false, skipPendingChange = false): Promise<LocalWorkspace> {
    const workspace: LocalWorkspace = {
      id: this.generateId(),
      name,
      isDefault,
      themeConfig: {
        primaryColor: '#0d7337',
        glowIntensity: 0.7,
        particlesEnabled: true,
        animationsEnabled: true
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await this.db.workspaces.add(workspace);
    if (!skipPendingChange) {
      await this.addPendingChange('create', 'workspace', workspace.id, workspace);
    }
    return workspace;
  }

  async deleteWorkspace(id: string): Promise<void> {
    // Delete all related data
    const desktops = await this.db.desktops.where('workspaceId').equals(id).toArray();
    for (const desktop of desktops) {
      await this.deleteDesktop(desktop.id);
    }
    await this.db.versions.where('workspaceId').equals(id).delete();
    await this.db.workspaces.delete(id);
    await this.addPendingChange('delete', 'workspace', id);
  }

  // ==================== DESKTOP METHODS ====================

  async getDesktops(workspaceId: string): Promise<LocalDesktop[]> {
    return await this.db.desktops.where('workspaceId').equals(workspaceId).toArray();
  }

  async getDesktop(id: string): Promise<LocalDesktop | undefined> {
    return await this.db.desktops.get(id);
  }

  async getRootDesktop(workspaceId: string): Promise<LocalDesktop | undefined> {
    return await this.db.desktops
      .where('workspaceId')
      .equals(workspaceId)
      .filter(d => d.parentId === null)
      .first();
  }

  async getChildDesktops(parentId: string): Promise<LocalDesktop[]> {
    return await this.db.desktops.where('parentId').equals(parentId).toArray();
  }

  async saveDesktop(desktop: LocalDesktop): Promise<string> {
    desktop.updatedAt = new Date();
    await this.db.desktops.put(desktop);
    await this.addPendingChange('update', 'desktop', desktop.id, desktop);
    return desktop.id;
  }

  async createDesktop(workspaceId: string, name: string, parentId: string | null = null, skipPendingChange = false): Promise<LocalDesktop> {
    const desktop: LocalDesktop = {
      id: this.generateId(),
      workspaceId,
      parentId,
      name,
      positionOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await this.db.desktops.add(desktop);
    if (!skipPendingChange) {
      await this.addPendingChange('create', 'desktop', desktop.id, desktop);
    }
    return desktop;
  }

  async deleteDesktop(id: string): Promise<void> {
    // Delete child desktops recursively
    const children = await this.getChildDesktops(id);
    for (const child of children) {
      await this.deleteDesktop(child.id);
    }

    // Delete related entities
    const notes = await this.db.notes.where('desktopId').equals(id).toArray();
    for (const note of notes) {
      await this.deleteNote(note.id);
    }
    await this.db.folders.where('desktopId').equals(id).delete();
    await this.db.connections.where('desktopId').equals(id).delete();
    await this.db.desktops.delete(id);
    await this.addPendingChange('delete', 'desktop', id);
  }

  // ==================== NOTE METHODS ====================

  async getNotes(desktopId: string): Promise<LocalNote[]> {
    return await this.db.notes.where('desktopId').equals(desktopId).toArray();
  }

  async getNote(id: string): Promise<LocalNote | undefined> {
    return await this.db.notes.get(id);
  }

  async saveNote(note: LocalNote): Promise<string> {
    note.updatedAt = new Date();
    await this.db.notes.put(note);
    await this.addPendingChange('update', 'note', note.id, note);
    return note.id;
  }

  async createNote(desktopId: string, position: { x: number; y: number }): Promise<LocalNote> {
    const note: LocalNote = {
      id: this.generateId(),
      desktopId,
      title: 'Nueva Nota',
      content: '',
      positionX: position.x,
      positionY: position.y,
      width: 300,
      height: 200,
      zIndex: 1,
      minimized: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await this.db.notes.add(note);
    await this.addPendingChange('create', 'note', note.id, note);
    return note;
  }

  async deleteNote(id: string): Promise<void> {
    await this.db.assets.where('noteId').equals(id).delete();
    await this.db.notes.delete(id);
    await this.addPendingChange('delete', 'note', id);
  }

  // ==================== ASSET METHODS ====================

  async getAssets(noteId: string): Promise<LocalAsset[]> {
    return await this.db.assets.where('noteId').equals(noteId).toArray();
  }

  async getAsset(id: string): Promise<LocalAsset | undefined> {
    return await this.db.assets.get(id);
  }

  async saveAsset(asset: LocalAsset): Promise<string> {
    await this.db.assets.put(asset);
    await this.addPendingChange('update', 'asset', asset.id, { ...asset, data: '[Blob]' });
    return asset.id;
  }

  async createAsset(
    noteId: string,
    data: Blob,
    originalName: string,
    mimeType: string,
    size: { width: number; height: number },
    position: { x: number; y: number }
  ): Promise<LocalAsset> {
    const asset: LocalAsset = {
      id: this.generateId(),
      noteId,
      data,
      originalName,
      mimeType,
      width: size.width,
      height: size.height,
      positionX: position.x,
      positionY: position.y,
      createdAt: new Date()
    };
    await this.db.assets.add(asset);
    await this.addPendingChange('create', 'asset', asset.id, { ...asset, data: '[Blob]' });
    return asset;
  }

  async deleteAsset(id: string): Promise<void> {
    await this.db.assets.delete(id);
    await this.addPendingChange('delete', 'asset', id);
  }

  // ==================== FOLDER METHODS ====================

  async getFolders(desktopId: string): Promise<LocalFolder[]> {
    return await this.db.folders.where('desktopId').equals(desktopId).toArray();
  }

  async getFolder(id: string): Promise<LocalFolder | undefined> {
    return await this.db.folders.get(id);
  }

  async saveFolder(folder: LocalFolder): Promise<string> {
    await this.db.folders.put(folder);
    await this.addPendingChange('update', 'folder', folder.id, folder);
    return folder.id;
  }

  async createFolder(desktopId: string, targetDesktopId: string, name: string, position: { x: number; y: number }): Promise<LocalFolder> {
    const folder: LocalFolder = {
      id: this.generateId(),
      desktopId,
      targetDesktopId,
      name,
      positionX: position.x,
      positionY: position.y,
      createdAt: new Date()
    };
    await this.db.folders.add(folder);
    await this.addPendingChange('create', 'folder', folder.id, folder);
    return folder;
  }

  async deleteFolder(id: string): Promise<void> {
    await this.db.folders.delete(id);
    await this.addPendingChange('delete', 'folder', id);
  }

  // ==================== CONNECTION METHODS ====================

  async getConnections(desktopId: string): Promise<LocalConnection[]> {
    return await this.db.connections.where('desktopId').equals(desktopId).toArray();
  }

  async getConnection(id: string): Promise<LocalConnection | undefined> {
    return await this.db.connections.get(id);
  }

  async saveConnection(connection: LocalConnection): Promise<string> {
    await this.db.connections.put(connection);
    await this.addPendingChange('update', 'connection', connection.id, connection);
    return connection.id;
  }

  async createConnection(desktopId: string, fromNoteId: string, toNoteId: string, color?: string): Promise<LocalConnection> {
    const connection: LocalConnection = {
      id: this.generateId(),
      desktopId,
      fromNoteId,
      toNoteId,
      color,
      createdAt: new Date()
    };
    await this.db.connections.add(connection);
    await this.addPendingChange('create', 'connection', connection.id, connection);
    return connection;
  }

  async deleteConnection(id: string): Promise<void> {
    await this.db.connections.delete(id);
    await this.addPendingChange('delete', 'connection', id);
  }

  // ==================== VERSION METHODS ====================

  async getVersions(workspaceId: string, limit = 50): Promise<LocalVersion[]> {
    return await this.db.versions
      .where('workspaceId')
      .equals(workspaceId)
      .reverse()
      .sortBy('versionNumber')
      .then(versions => versions.slice(0, limit));
  }

  async getVersion(id: string): Promise<LocalVersion | undefined> {
    return await this.db.versions.get(id);
  }

  async getLatestVersion(workspaceId: string): Promise<LocalVersion | undefined> {
    return await this.db.versions
      .where('workspaceId')
      .equals(workspaceId)
      .reverse()
      .sortBy('versionNumber')
      .then(versions => versions[0]);
  }

  async saveVersion(version: LocalVersion): Promise<string> {
    await this.db.versions.put(version);
    return version.id;
  }

  async createVersion(workspaceId: string, snapshot: string, changeSummary: string): Promise<LocalVersion> {
    const latest = await this.getLatestVersion(workspaceId);
    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const version: LocalVersion = {
      id: this.generateId(),
      workspaceId,
      versionNumber,
      snapshot,
      changeSummary,
      createdAt: new Date()
    };
    await this.db.versions.add(version);
    return version;
  }

  // ==================== PENDING CHANGES METHODS ====================

  async getPendingChanges(): Promise<LocalPendingChange[]> {
    return await this.db.pendingChanges.orderBy('timestamp').toArray();
  }

  async getPendingChangesCount(): Promise<number> {
    return await this.db.pendingChanges.count();
  }

  async addPendingChange(
    type: 'create' | 'update' | 'delete',
    entity: 'workspace' | 'desktop' | 'note' | 'folder' | 'connection' | 'asset',
    entityId: string,
    data?: any
  ): Promise<void> {
    // Remove existing pending change for same entity (coalesce)
    await this.db.pendingChanges
      .where('entityId')
      .equals(entityId)
      .delete();

    const change: LocalPendingChange = {
      id: this.generateId(),
      type,
      entity,
      entityId,
      data,
      timestamp: new Date()
    };
    await this.db.pendingChanges.add(change);
  }

  async clearPendingChanges(): Promise<void> {
    await this.db.pendingChanges.clear();
  }

  async removePendingChange(id: string): Promise<void> {
    await this.db.pendingChanges.delete(id);
  }

  // ==================== UTILITY METHODS ====================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async clearAllData(): Promise<void> {
    await this.db.pendingChanges.clear();
    await this.db.versions.clear();
    await this.db.connections.clear();
    await this.db.folders.clear();
    await this.db.assets.clear();
    await this.db.notes.clear();
    await this.db.desktops.clear();
    await this.db.workspaces.clear();
  }

  async exportWorkspace(workspaceId: string): Promise<any> {
    const workspace = await this.getWorkspace(workspaceId);
    const desktops = await this.getDesktops(workspaceId);

    const notes: LocalNote[] = [];
    const assets: LocalAsset[] = [];
    const folders: LocalFolder[] = [];
    const connections: LocalConnection[] = [];

    for (const desktop of desktops) {
      notes.push(...await this.getNotes(desktop.id));
      folders.push(...await this.getFolders(desktop.id));
      connections.push(...await this.getConnections(desktop.id));
    }

    for (const note of notes) {
      assets.push(...await this.getAssets(note.id));
    }

    return {
      workspace,
      desktops,
      notes,
      assets,
      folders,
      connections
    };
  }

  // Convert Blob to Base64 for export
  async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Convert Base64 to Blob for import
  base64ToBlob(base64: string, mimeType: string): Blob {
    const byteString = atob(base64.split(',')[1]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeType });
  }
}
