import { Injectable, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { IndexedDBService, LocalVersion } from './indexeddb.service';
import { AuthService } from './auth.service';
import { Version, VersionDiff } from '../models/database.model';

@Injectable({
  providedIn: 'root'
})
export class VersionService {
  private versions = signal<Version[]>([]);
  private currentVersionNumber = signal<number>(0);
  private isLoading = signal<boolean>(false);

  readonly versionHistory = computed(() => this.versions());
  readonly currentVersion = computed(() => this.currentVersionNumber());
  readonly loading = computed(() => this.isLoading());

  constructor(
    private supabase: SupabaseService,
    private indexedDB: IndexedDBService,
    private auth: AuthService
  ) {}

  // ==================== VERSION METHODS ====================

  /**
   * Get version history for the current workspace
   */
  async loadVersionHistory(workspaceId?: string, limit = 50): Promise<Version[]> {
    this.isLoading.set(true);

    try {
      if (this.supabase.isConfigured() && !this.auth.isOfflineMode()) {
        // Load from Supabase
        const user = this.auth.currentUser();
        if (!user) return [];

        // Get workspace if not provided
        if (!workspaceId) {
          const { data: workspace } = await this.supabase
            .from('workspaces')
            .select('id')
            .eq('user_id', user.id)
            .eq('is_default', true)
            .single();
          workspaceId = workspace?.id;
        }

        if (!workspaceId) return [];

        const { data, error } = await this.supabase
          .from('versions')
          .select('*')
          .eq('workspace_id', workspaceId)
          .order('version_number', { ascending: false })
          .limit(limit);

        if (error) throw error;

        const versions: Version[] = (data || []).map(v => ({
          id: v.id,
          workspaceId: v.workspace_id,
          versionNumber: v.version_number,
          snapshot: v.snapshot,
          changeSummary: v.change_summary,
          createdAt: new Date(v.created_at)
        }));

        this.versions.set(versions);
        if (versions.length > 0) {
          this.currentVersionNumber.set(versions[0].versionNumber);
        }

        return versions;
      } else {
        // Load from IndexedDB
        const workspace = await this.indexedDB.getDefaultWorkspace();
        if (!workspace) return [];

        const localVersions = await this.indexedDB.getVersions(workspace.id, limit);
        const versions: Version[] = localVersions.map(v => ({
          id: v.id,
          workspaceId: v.workspaceId,
          versionNumber: v.versionNumber,
          snapshot: v.snapshot,
          changeSummary: v.changeSummary,
          createdAt: v.createdAt
        }));

        this.versions.set(versions);
        if (versions.length > 0) {
          this.currentVersionNumber.set(versions[0].versionNumber);
        }

        return versions;
      }
    } catch (error) {
      console.error('Error loading version history:', error);
      return [];
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Get a specific version
   */
  async getVersion(versionId: string): Promise<Version | null> {
    try {
      if (this.supabase.isConfigured() && !this.auth.isOfflineMode()) {
        const { data, error } = await this.supabase
          .from('versions')
          .select('*')
          .eq('id', versionId)
          .single();

        if (error) throw error;

        return {
          id: data.id,
          workspaceId: data.workspace_id,
          versionNumber: data.version_number,
          snapshot: data.snapshot,
          changeSummary: data.change_summary,
          createdAt: new Date(data.created_at)
        };
      } else {
        const localVersion = await this.indexedDB.getVersion(versionId);
        if (!localVersion) return null;

        return {
          id: localVersion.id,
          workspaceId: localVersion.workspaceId,
          versionNumber: localVersion.versionNumber,
          snapshot: localVersion.snapshot,
          changeSummary: localVersion.changeSummary,
          createdAt: localVersion.createdAt
        };
      }
    } catch (error) {
      console.error('Error getting version:', error);
      return null;
    }
  }

  /**
   * Save a new version snapshot (local only)
   */
  async saveLocalVersion(changeSummary?: string): Promise<Version | null> {
    try {
      const workspace = await this.indexedDB.getDefaultWorkspace();
      if (!workspace) return null;

      // Get current state
      const data = await this.indexedDB.exportWorkspace(workspace.id);

      // Convert assets to base64 for snapshot
      const snapshotData = {
        ...data,
        assets: await Promise.all(data.assets.map(async (asset: any) => ({
          ...asset,
          data: await this.indexedDB.blobToBase64(asset.data)
        })))
      };

      const summary = changeSummary || this.generateChangeSummary(data);
      const localVersion = await this.indexedDB.createVersion(
        workspace.id,
        JSON.stringify(snapshotData),
        summary
      );

      const version: Version = {
        id: localVersion.id,
        workspaceId: localVersion.workspaceId,
        versionNumber: localVersion.versionNumber,
        snapshot: localVersion.snapshot,
        changeSummary: localVersion.changeSummary,
        createdAt: localVersion.createdAt
      };

      // Update local state
      this.versions.update(versions => [version, ...versions]);
      this.currentVersionNumber.set(version.versionNumber);

      return version;
    } catch (error) {
      console.error('Error saving local version:', error);
      return null;
    }
  }

  /**
   * Restore a previous version
   */
  async restoreVersion(versionId: string): Promise<boolean> {
    try {
      const version = await this.getVersion(versionId);
      if (!version) return false;

      const snapshot = JSON.parse(version.snapshot);

      // Clear current data
      await this.indexedDB.clearAllData();

      // Restore workspace
      const workspace = await this.indexedDB.createWorkspace(
        snapshot.workspace?.name || 'Restored Workspace',
        true
      );

      // Restore desktops
      const desktopIdMap = new Map<string, string>();
      for (const desktop of snapshot.desktops || []) {
        const newDesktop = await this.indexedDB.createDesktop(
          workspace.id,
          desktop.name,
          desktop.parentId ? desktopIdMap.get(desktop.parentId) || null : null
        );
        desktopIdMap.set(desktop.id, newDesktop.id);
      }

      // Restore notes
      const noteIdMap = new Map<string, string>();
      for (const note of snapshot.notes || []) {
        const desktopId = desktopIdMap.get(note.desktopId);
        if (desktopId) {
          const newNote = await this.indexedDB.createNote(desktopId, {
            x: note.positionX,
            y: note.positionY
          });
          newNote.title = note.title;
          newNote.content = note.content;
          newNote.width = note.width;
          newNote.height = note.height;
          newNote.color = note.color;
          newNote.zIndex = note.zIndex;
          newNote.minimized = note.minimized;
          await this.indexedDB.saveNote(newNote);
          noteIdMap.set(note.id, newNote.id);
        }
      }

      // Restore assets
      for (const asset of snapshot.assets || []) {
        const noteId = noteIdMap.get(asset.noteId);
        if (noteId && asset.data) {
          const blob = this.indexedDB.base64ToBlob(asset.data, asset.mimeType);
          await this.indexedDB.createAsset(
            noteId,
            blob,
            asset.originalName || '',
            asset.mimeType,
            { width: asset.width, height: asset.height },
            { x: asset.positionX, y: asset.positionY }
          );
        }
      }

      // Restore folders
      for (const folder of snapshot.folders || []) {
        const desktopId = desktopIdMap.get(folder.desktopId);
        const targetId = desktopIdMap.get(folder.targetDesktopId);
        if (desktopId && targetId) {
          await this.indexedDB.createFolder(
            desktopId,
            targetId,
            folder.name,
            { x: folder.positionX, y: folder.positionY }
          );
        }
      }

      // Restore connections
      for (const connection of snapshot.connections || []) {
        const desktopId = desktopIdMap.get(connection.desktopId);
        const fromId = noteIdMap.get(connection.fromNoteId);
        const toId = noteIdMap.get(connection.toNoteId);
        if (desktopId && fromId && toId) {
          await this.indexedDB.createConnection(
            desktopId,
            fromId,
            toId,
            connection.color
          );
        }
      }

      return true;
    } catch (error) {
      console.error('Error restoring version:', error);
      return false;
    }
  }

  /**
   * Compare two versions
   */
  async compareVersions(versionId1: string, versionId2: string): Promise<VersionDiff | null> {
    try {
      const v1 = await this.getVersion(versionId1);
      const v2 = await this.getVersion(versionId2);

      if (!v1 || !v2) return null;

      const snapshot1 = JSON.parse(v1.snapshot);
      const snapshot2 = JSON.parse(v2.snapshot);

      const diff: VersionDiff = {
        added: {
          desktops: 0,
          notes: 0,
          folders: 0,
          connections: 0
        },
        modified: {
          desktops: 0,
          notes: 0,
          folders: 0,
          connections: 0
        },
        deleted: {
          desktops: 0,
          notes: 0,
          folders: 0,
          connections: 0
        }
      };

      // Compare desktops
      const desktopIds1 = new Set((snapshot1.desktops || []).map((d: any) => d.id));
      const desktopIds2 = new Set((snapshot2.desktops || []).map((d: any) => d.id));
      diff.added.desktops = [...desktopIds2].filter(id => !desktopIds1.has(id)).length;
      diff.deleted.desktops = [...desktopIds1].filter(id => !desktopIds2.has(id)).length;

      // Compare notes
      const noteIds1 = new Set((snapshot1.notes || []).map((n: any) => n.id));
      const noteIds2 = new Set((snapshot2.notes || []).map((n: any) => n.id));
      diff.added.notes = [...noteIds2].filter(id => !noteIds1.has(id)).length;
      diff.deleted.notes = [...noteIds1].filter(id => !noteIds2.has(id)).length;

      // Compare folders
      const folderIds1 = new Set((snapshot1.folders || []).map((f: any) => f.id));
      const folderIds2 = new Set((snapshot2.folders || []).map((f: any) => f.id));
      diff.added.folders = [...folderIds2].filter(id => !folderIds1.has(id)).length;
      diff.deleted.folders = [...folderIds1].filter(id => !folderIds2.has(id)).length;

      // Compare connections
      const connIds1 = new Set((snapshot1.connections || []).map((c: any) => c.id));
      const connIds2 = new Set((snapshot2.connections || []).map((c: any) => c.id));
      diff.added.connections = [...connIds2].filter(id => !connIds1.has(id)).length;
      diff.deleted.connections = [...connIds1].filter(id => !connIds2.has(id)).length;

      return diff;
    } catch (error) {
      console.error('Error comparing versions:', error);
      return null;
    }
  }

  // ==================== HELPERS ====================

  private generateChangeSummary(data: any): string {
    const parts: string[] = [];

    if (data.notes?.length) {
      parts.push(`${data.notes.length} nota${data.notes.length > 1 ? 's' : ''}`);
    }
    if (data.folders?.length) {
      parts.push(`${data.folders.length} carpeta${data.folders.length > 1 ? 's' : ''}`);
    }
    if (data.assets?.length) {
      parts.push(`${data.assets.length} imagen${data.assets.length > 1 ? 'es' : ''}`);
    }
    if (data.connections?.length) {
      parts.push(`${data.connections.length} conexi${data.connections.length > 1 ? 'ones' : 'ón'}`);
    }

    return parts.length > 0 ? parts.join(', ') : 'Sin cambios';
  }

  formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Hace un momento';
    if (minutes < 60) return `Hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    if (hours < 24) return `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
    if (days < 7) return `Hace ${days} día${days > 1 ? 's' : ''}`;

    return date.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}
