import { Injectable, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
import { SyncStatus, SyncState, SyncResult } from '../models/database.model';
import { AppState, Desktop, Note, Folder, Connection, NoteImage } from '../models/desktop.model';

const STORAGE_KEY = 'multidesktop_data';

@Injectable({
  providedIn: 'root'
})
export class SyncService {
  // State
  private syncState = signal<SyncState>({
    status: 'idle',
    pendingChangesCount: 0,
    lastSyncedAt: null,
    lastSyncedVersion: 0
  });

  // Public computed signals
  readonly status = computed(() => this.syncState().status);
  readonly pendingChangesCount = computed(() => this.syncState().pendingChangesCount);
  readonly lastSyncedAt = computed(() => this.syncState().lastSyncedAt);
  readonly lastSyncedVersion = computed(() => this.syncState().lastSyncedVersion);
  readonly hasPendingChanges = computed(() => this.syncState().pendingChangesCount > 0);

  constructor(
    private supabase: SupabaseService,
    private storage: StorageService,
    private auth: AuthService
  ) {}

  // ==================== MAIN SYNC METHODS ====================

  /**
   * "Guardar Partida" - Push localStorage data to Supabase
   */
  async saveToCloud(): Promise<SyncResult> {
    if (!this.supabase.isConfigured()) {
      return this.errorResult(['Supabase no está configurado']);
    }

    const user = this.auth.currentUser();
    if (!user || this.auth.isOfflineMode()) {
      return this.errorResult(['Usuario no autenticado']);
    }

    this.syncState.update(state => ({ ...state, status: 'syncing' }));

    try {
      // Get current state from localStorage
      const appState = this.storage.appState();

      if (!appState || !appState.desktops || appState.desktops.length === 0) {
        return this.errorResult(['No hay datos para sincronizar']);
      }

      // Get or create workspace in Supabase
      const workspaceId = await this.getOrCreateWorkspace(user.id, appState.theme);

      // Clear existing data in Supabase for this workspace
      await this.clearRemoteWorkspaceData(workspaceId);

      // Upload all desktops
      const desktopIdMap = new Map<string, string>();

      // First pass: create all desktops to get their IDs
      for (const desktop of appState.desktops) {
        const remoteId = await this.uploadDesktop(desktop, workspaceId, null);
        desktopIdMap.set(desktop.id, remoteId);
      }

      // Second pass: update parent relationships
      for (const desktop of appState.desktops) {
        if (desktop.parentId) {
          const remoteId = desktopIdMap.get(desktop.id);
          const remoteParentId = desktopIdMap.get(desktop.parentId);
          if (remoteId && remoteParentId) {
            await this.supabase
              .from('desktops')
              .update({ parent_id: remoteParentId })
              .eq('id', remoteId);
          }
        }
      }

      // Upload notes, folders, connections for each desktop
      let totalNotes = 0;
      let totalAssets = 0;

      for (const desktop of appState.desktops) {
        const remoteDesktopId = desktopIdMap.get(desktop.id);
        if (!remoteDesktopId) continue;

        // Upload notes
        const noteIdMap = new Map<string, string>();
        for (const note of desktop.notes) {
          const remoteNoteId = await this.uploadNote(note, remoteDesktopId);
          noteIdMap.set(note.id, remoteNoteId);
          totalNotes++;

          // Upload images for this note
          for (const image of note.images) {
            await this.uploadImage(image, remoteNoteId, user.id);
            totalAssets++;
          }
        }

        // Upload folders
        for (const folder of desktop.folders) {
          const targetRemoteId = desktopIdMap.get(folder.desktopId);
          if (targetRemoteId) {
            await this.uploadFolder(folder, remoteDesktopId, targetRemoteId);
          }
        }

        // Upload connections
        for (const connection of desktop.connections) {
          const fromRemoteId = noteIdMap.get(connection.fromNoteId);
          const toRemoteId = noteIdMap.get(connection.toNoteId);
          if (fromRemoteId && toRemoteId) {
            await this.uploadConnection(connection, remoteDesktopId, fromRemoteId, toRemoteId);
          }
        }
      }

      // Create version snapshot
      const versionNumber = await this.createVersionSnapshot(workspaceId, appState);

      const result: SyncResult = {
        success: true,
        versionNumber,
        changesUploaded: totalNotes + appState.desktops.length,
        assetsUploaded: totalAssets,
        timestamp: new Date()
      };

      this.syncState.update(state => ({
        ...state,
        status: 'success',
        pendingChangesCount: 0,
        lastSyncedAt: new Date(),
        lastSyncedVersion: versionNumber
      }));

      setTimeout(() => {
        this.syncState.update(state => ({ ...state, status: 'idle' }));
      }, 3000);

      return result;
    } catch (error: any) {
      console.error('Sync error:', error);
      this.syncState.update(state => ({
        ...state,
        status: 'error',
        error: error.message
      }));
      return this.errorResult([error.message]);
    }
  }

  /**
   * "Cargar Partida" - Download from Supabase to localStorage
   */
  async loadFromCloud(): Promise<boolean> {
    if (!this.supabase.isConfigured() || this.auth.isOfflineMode()) {
      return false;
    }

    const user = this.auth.currentUser();
    if (!user) return false;

    this.syncState.update(state => ({ ...state, status: 'syncing' }));

    try {
      // Get user's workspace from Supabase
      const { data: workspace, error: wsError } = await this.supabase
        .from('workspaces')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single();

      if (wsError || !workspace) {
        console.log('No remote workspace found');
        this.syncState.update(state => ({ ...state, status: 'idle' }));
        return false;
      }

      // Get all desktops
      const { data: remoteDesktops, error: dsError } = await this.supabase
        .from('desktops')
        .select('*')
        .eq('workspace_id', workspace.id)
        .order('position_order');

      if (dsError) throw dsError;

      if (!remoteDesktops || remoteDesktops.length === 0) {
        console.log('No remote desktops found');
        this.syncState.update(state => ({ ...state, status: 'idle' }));
        return false;
      }

      // Build the AppState from remote data
      const desktops: Desktop[] = [];
      const desktopIdMap = new Map<string, string>(); // remote -> local

      // Create local IDs for each desktop
      for (const rd of remoteDesktops) {
        const localId = this.generateId();
        desktopIdMap.set(rd.id, localId);
      }

      // Build desktops with their content
      for (const rd of remoteDesktops) {
        const localId = desktopIdMap.get(rd.id)!;
        const localParentId = rd.parent_id ? desktopIdMap.get(rd.parent_id) || null : null;

        // Get notes for this desktop
        const { data: remoteNotes } = await this.supabase
          .from('notes')
          .select('*')
          .eq('desktop_id', rd.id);

        const notes: Note[] = [];
        const noteIdMap = new Map<string, string>(); // remote -> local

        for (const rn of remoteNotes || []) {
          const localNoteId = this.generateId();
          noteIdMap.set(rn.id, localNoteId);

          // Get images for this note
          const { data: remoteAssets } = await this.supabase
            .from('assets')
            .select('*')
            .eq('note_id', rn.id);

          const images: NoteImage[] = [];
          for (const ra of remoteAssets || []) {
            if (ra.storage_path) {
              try {
                const { data: blob } = await this.supabase.downloadFile('assets', ra.storage_path);
                if (blob) {
                  const base64 = await this.blobToBase64(blob);
                  images.push({
                    id: this.generateId(),
                    data: base64,
                    originalName: ra.original_name,
                    size: { width: ra.width || 100, height: ra.height || 100 },
                    position: { x: ra.position_x || 0, y: ra.position_y || 0 }
                  });
                }
              } catch (e) {
                console.error('Error downloading image:', e);
              }
            }
          }

          notes.push({
            id: localNoteId,
            title: rn.title || 'Sin título',
            content: rn.content || '',
            images,
            position: { x: rn.position_x || 100, y: rn.position_y || 100 },
            size: { width: rn.width || 300, height: rn.height || 200 },
            color: rn.color,
            zIndex: rn.z_index || 1,
            minimized: rn.minimized || false,
            createdAt: new Date(rn.created_at),
            updatedAt: new Date(rn.updated_at)
          });
        }

        // Get folders for this desktop
        const { data: remoteFolders } = await this.supabase
          .from('folders')
          .select('*')
          .eq('desktop_id', rd.id);

        const folders: Folder[] = [];
        for (const rf of remoteFolders || []) {
          const targetLocalId = desktopIdMap.get(rf.target_desktop_id);
          if (targetLocalId) {
            folders.push({
              id: this.generateId(),
              name: rf.name,
              icon: rf.icon,
              position: { x: rf.position_x || 100, y: rf.position_y || 100 },
              desktopId: targetLocalId,
              color: rf.color
            });
          }
        }

        // Get connections for this desktop
        const { data: remoteConnections } = await this.supabase
          .from('connections')
          .select('*')
          .eq('desktop_id', rd.id);

        const connections: Connection[] = [];
        for (const rc of remoteConnections || []) {
          const fromLocalId = noteIdMap.get(rc.from_note_id);
          const toLocalId = noteIdMap.get(rc.to_note_id);
          if (fromLocalId && toLocalId) {
            connections.push({
              id: this.generateId(),
              fromNoteId: fromLocalId,
              toNoteId: toLocalId,
              color: rc.color
            });
          }
        }

        desktops.push({
          id: localId,
          name: rd.name || 'Escritorio',
          parentId: localParentId,
          notes,
          folders,
          connections,
          createdAt: new Date(rd.created_at)
        });
      }

      // Find root desktop (no parent) or first desktop
      const rootDesktop = desktops.find(d => !d.parentId) || desktops[0];

      // Build new AppState
      const newState: AppState = {
        desktops,
        currentDesktopId: rootDesktop?.id || 'root',
        theme: workspace.theme_config || {
          primaryColor: '#0d7337',
          glowIntensity: 0.7,
          particlesEnabled: true,
          animationsEnabled: true
        }
      };

      // Save to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));

      // Notify StorageService to reload from localStorage
      this.storage.reloadFromStorage();

      this.syncState.update(state => ({
        ...state,
        status: 'success',
        lastSyncedAt: new Date()
      }));

      setTimeout(() => {
        this.syncState.update(state => ({ ...state, status: 'idle' }));
      }, 3000);

      return true;
    } catch (error: any) {
      console.error('Load from cloud error:', error);
      this.syncState.update(state => ({
        ...state,
        status: 'error',
        error: error.message
      }));
      return false;
    }
  }

  // ==================== HELPER METHODS ====================

  private async getOrCreateWorkspace(userId: string, theme: any): Promise<string> {
    const { data: existing } = await this.supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .single();

    if (existing) {
      await this.supabase
        .from('workspaces')
        .update({
          theme_config: theme,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      return existing.id;
    }

    const { data, error } = await this.supabase
      .from('workspaces')
      .insert({
        user_id: userId,
        name: 'Mi Workspace',
        is_default: true,
        theme_config: theme
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  private async clearRemoteWorkspaceData(workspaceId: string): Promise<void> {
    // Get all desktop IDs
    const { data: desktops } = await this.supabase
      .from('desktops')
      .select('id')
      .eq('workspace_id', workspaceId);

    if (desktops && desktops.length > 0) {
      const desktopIds = desktops.map(d => d.id);

      // Delete connections
      await this.supabase
        .from('connections')
        .delete()
        .in('desktop_id', desktopIds);

      // Delete folders
      await this.supabase
        .from('folders')
        .delete()
        .in('desktop_id', desktopIds);

      // Get all note IDs
      const { data: notes } = await this.supabase
        .from('notes')
        .select('id')
        .in('desktop_id', desktopIds);

      if (notes && notes.length > 0) {
        const noteIds = notes.map(n => n.id);

        // Delete assets
        await this.supabase
          .from('assets')
          .delete()
          .in('note_id', noteIds);
      }

      // Delete notes
      await this.supabase
        .from('notes')
        .delete()
        .in('desktop_id', desktopIds);

      // Delete desktops
      await this.supabase
        .from('desktops')
        .delete()
        .eq('workspace_id', workspaceId);
    }
  }

  private async uploadDesktop(desktop: Desktop, workspaceId: string, parentId: string | null): Promise<string> {
    const { data, error } = await this.supabase
      .from('desktops')
      .insert({
        workspace_id: workspaceId,
        parent_id: parentId,
        name: desktop.name,
        position_order: 0,
        local_id: desktop.id
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  private async uploadNote(note: Note, desktopId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('notes')
      .insert({
        desktop_id: desktopId,
        title: note.title,
        content: note.content,
        position_x: note.position.x,
        position_y: note.position.y,
        width: note.size.width,
        height: note.size.height,
        color: note.color,
        z_index: note.zIndex,
        minimized: note.minimized,
        local_id: note.id
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  private async uploadImage(image: NoteImage, noteId: string, userId: string): Promise<void> {
    try {
      // Convert base64 to blob
      const blob = this.base64ToBlob(image.data);
      const filePath = `${userId}/${image.id}`;

      await this.supabase.uploadFile('assets', filePath, blob, {
        contentType: this.getMimeType(image.data),
        upsert: true
      });

      await this.supabase
        .from('assets')
        .insert({
          note_id: noteId,
          storage_path: filePath,
          original_name: image.originalName,
          mime_type: this.getMimeType(image.data),
          width: image.size.width,
          height: image.size.height,
          position_x: image.position.x,
          position_y: image.position.y,
          local_id: image.id
        });
    } catch (e) {
      console.error('Error uploading image:', e);
    }
  }

  private async uploadFolder(folder: Folder, desktopId: string, targetDesktopId: string): Promise<void> {
    await this.supabase
      .from('folders')
      .insert({
        desktop_id: desktopId,
        target_desktop_id: targetDesktopId,
        name: folder.name,
        icon: folder.icon,
        color: folder.color,
        position_x: folder.position.x,
        position_y: folder.position.y,
        local_id: folder.id
      });
  }

  private async uploadConnection(
    connection: Connection,
    desktopId: string,
    fromNoteId: string,
    toNoteId: string
  ): Promise<void> {
    await this.supabase
      .from('connections')
      .insert({
        desktop_id: desktopId,
        from_note_id: fromNoteId,
        to_note_id: toNoteId,
        color: connection.color,
        local_id: connection.id
      });
  }

  private async createVersionSnapshot(workspaceId: string, appState: AppState): Promise<number> {
    const { data: latest } = await this.supabase
      .from('versions')
      .select('version_number')
      .eq('workspace_id', workspaceId)
      .order('version_number', { ascending: false })
      .limit(1)
      .single();

    const versionNumber = (latest?.version_number ?? 0) + 1;

    const totalNotes = appState.desktops.reduce((sum, d) => sum + d.notes.length, 0);
    const summary = `${appState.desktops.length} escritorios, ${totalNotes} notas`;

    await this.supabase
      .from('versions')
      .insert({
        workspace_id: workspaceId,
        version_number: versionNumber,
        snapshot: JSON.stringify(appState),
        change_summary: summary
      });

    return versionNumber;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private errorResult(errors: string[]): SyncResult {
    return {
      success: false,
      versionNumber: 0,
      changesUploaded: 0,
      assetsUploaded: 0,
      timestamp: new Date(),
      errors
    };
  }

  private base64ToBlob(base64: string): Blob {
    const parts = base64.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const bstr = atob(parts[1] || parts[0]);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mime });
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private getMimeType(base64: string): string {
    const match = base64.match(/data:([^;]+);/);
    return match ? match[1] : 'image/png';
  }

  // ==================== STATUS HELPERS ====================

  getStatusText(): string {
    switch (this.status()) {
      case 'idle':
        return 'Listo';
      case 'syncing':
        return 'Sincronizando...';
      case 'success':
        return `Guardado (v${this.lastSyncedVersion()})`;
      case 'error':
        return 'Error de sincronización';
      default:
        return '';
    }
  }

  getStatusIcon(): string {
    switch (this.status()) {
      case 'idle':
        return '●';
      case 'syncing':
        return '◐';
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      default:
        return '●';
    }
  }
}
