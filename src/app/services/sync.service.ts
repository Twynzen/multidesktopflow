import { Injectable, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { IndexedDBService, LocalWorkspace, LocalDesktop, LocalNote, LocalAsset, LocalFolder, LocalConnection } from './indexeddb.service';
import { AuthService } from './auth.service';
import { SyncStatus, SyncState, SyncResult } from '../models/database.model';

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
    private indexedDB: IndexedDBService,
    private auth: AuthService
  ) {
    this.initializeSync();
  }

  private async initializeSync(): Promise<void> {
    // Update pending changes count periodically
    setInterval(async () => {
      const count = await this.indexedDB.getPendingChangesCount();
      this.syncState.update(state => ({
        ...state,
        pendingChangesCount: count
      }));
    }, 5000);

    // Initial count
    const count = await this.indexedDB.getPendingChangesCount();
    this.syncState.update(state => ({
      ...state,
      pendingChangesCount: count
    }));
  }

  // ==================== MAIN SYNC METHODS ====================

  /**
   * "Guardar Partida" - Push local changes to cloud
   */
  async saveToCloud(): Promise<SyncResult> {
    if (!this.supabase.isConfigured()) {
      return {
        success: false,
        versionNumber: 0,
        changesUploaded: 0,
        assetsUploaded: 0,
        timestamp: new Date(),
        errors: ['Supabase no está configurado']
      };
    }

    const user = this.auth.currentUser();
    if (!user || this.auth.isOfflineMode()) {
      return {
        success: false,
        versionNumber: 0,
        changesUploaded: 0,
        assetsUploaded: 0,
        timestamp: new Date(),
        errors: ['Usuario no autenticado']
      };
    }

    this.syncState.update(state => ({ ...state, status: 'syncing' }));

    try {
      // Get default workspace
      let workspace = await this.indexedDB.getDefaultWorkspace();
      if (!workspace) {
        throw new Error('No hay workspace local');
      }

      // Get all local data
      const localData = await this.indexedDB.exportWorkspace(workspace.id);

      // Sync workspace
      const workspaceResult = await this.syncWorkspace(workspace, user.id);
      const remoteWorkspaceId = workspaceResult.id;

      // Sync desktops
      const desktopIdMap = new Map<string, string>();
      for (const desktop of localData.desktops) {
        const remoteId = await this.syncDesktop(desktop, remoteWorkspaceId, desktopIdMap);
        desktopIdMap.set(desktop.id, remoteId);
      }

      // Sync notes
      const noteIdMap = new Map<string, string>();
      for (const note of localData.notes) {
        const remoteDesktopId = desktopIdMap.get(note.desktopId);
        if (remoteDesktopId) {
          const remoteId = await this.syncNote(note, remoteDesktopId);
          noteIdMap.set(note.id, remoteId);
        }
      }

      // Sync assets
      let assetsUploaded = 0;
      for (const asset of localData.assets) {
        const remoteNoteId = noteIdMap.get(asset.noteId);
        if (remoteNoteId) {
          await this.syncAsset(asset, remoteNoteId, user.id);
          assetsUploaded++;
        }
      }

      // Sync folders
      for (const folder of localData.folders) {
        const remoteDesktopId = desktopIdMap.get(folder.desktopId);
        const remoteTargetId = desktopIdMap.get(folder.targetDesktopId);
        if (remoteDesktopId && remoteTargetId) {
          await this.syncFolder(folder, remoteDesktopId, remoteTargetId);
        }
      }

      // Sync connections
      for (const connection of localData.connections) {
        const remoteDesktopId = desktopIdMap.get(connection.desktopId);
        const remoteFromNoteId = noteIdMap.get(connection.fromNoteId);
        const remoteToNoteId = noteIdMap.get(connection.toNoteId);
        if (remoteDesktopId && remoteFromNoteId && remoteToNoteId) {
          await this.syncConnection(connection, remoteDesktopId, remoteFromNoteId, remoteToNoteId);
        }
      }

      // Create version snapshot
      const versionNumber = await this.createVersionSnapshot(remoteWorkspaceId, localData);

      // Clear pending changes
      await this.indexedDB.clearPendingChanges();

      const result: SyncResult = {
        success: true,
        versionNumber,
        changesUploaded: localData.notes.length + localData.folders.length + localData.connections.length,
        assetsUploaded,
        timestamp: new Date()
      };

      this.syncState.update(state => ({
        ...state,
        status: 'success',
        pendingChangesCount: 0,
        lastSyncedAt: new Date(),
        lastSyncedVersion: versionNumber
      }));

      // Reset status after 3 seconds
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

      return {
        success: false,
        versionNumber: 0,
        changesUploaded: 0,
        assetsUploaded: 0,
        timestamp: new Date(),
        errors: [error.message]
      };
    }
  }

  /**
   * Load data from cloud to local
   */
  async loadFromCloud(): Promise<boolean> {
    if (!this.supabase.isConfigured() || this.auth.isOfflineMode()) {
      return false;
    }

    const user = this.auth.currentUser();
    if (!user) return false;

    this.syncState.update(state => ({ ...state, status: 'syncing' }));

    try {
      // Get user's default workspace from Supabase
      const { data: workspaces, error: wsError } = await this.supabase
        .from('workspaces')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single();

      if (wsError || !workspaces) {
        // No remote workspace, nothing to load
        this.syncState.update(state => ({ ...state, status: 'idle' }));
        return true;
      }

      // Get all desktops
      const { data: desktops, error: dsError } = await this.supabase
        .from('desktops')
        .select('*')
        .eq('workspace_id', workspaces.id);

      if (dsError) throw dsError;

      // Get all notes
      const desktopIds = desktops?.map(d => d.id) || [];
      let notes: any[] = [];
      let assets: any[] = [];
      let folders: any[] = [];
      let connections: any[] = [];

      if (desktopIds.length > 0) {
        const { data: notesData } = await this.supabase
          .from('notes')
          .select('*')
          .in('desktop_id', desktopIds);
        notes = notesData || [];

        const { data: foldersData } = await this.supabase
          .from('folders')
          .select('*')
          .in('desktop_id', desktopIds);
        folders = foldersData || [];

        const { data: connectionsData } = await this.supabase
          .from('connections')
          .select('*')
          .in('desktop_id', desktopIds);
        connections = connectionsData || [];

        // Get assets for notes
        const noteIds = notes.map(n => n.id);
        if (noteIds.length > 0) {
          const { data: assetsData } = await this.supabase
            .from('assets')
            .select('*')
            .in('note_id', noteIds);
          assets = assetsData || [];
        }
      }

      // Clear local data and import from cloud
      await this.indexedDB.clearAllData();

      // Create local workspace
      const localWorkspace = await this.indexedDB.createWorkspace(workspaces.name, true);

      // Create local desktops
      const desktopIdMap = new Map<string, string>();
      for (const desktop of desktops || []) {
        const localDesktop: LocalDesktop = {
          id: this.generateId(),
          workspaceId: localWorkspace.id,
          parentId: desktop.parent_id ? desktopIdMap.get(desktop.parent_id) || null : null,
          name: desktop.name,
          positionOrder: desktop.position_order || 0,
          createdAt: new Date(desktop.created_at),
          updatedAt: new Date(desktop.updated_at),
          syncedAt: new Date()
        };
        await this.indexedDB.saveDesktop(localDesktop);
        desktopIdMap.set(desktop.id, localDesktop.id);
      }

      // Create local notes
      const noteIdMap = new Map<string, string>();
      for (const note of notes) {
        const localDesktopId = desktopIdMap.get(note.desktop_id);
        if (localDesktopId) {
          const localNote: LocalNote = {
            id: this.generateId(),
            desktopId: localDesktopId,
            title: note.title,
            content: note.content || '',
            positionX: note.position_x,
            positionY: note.position_y,
            width: note.width,
            height: note.height,
            color: note.color,
            zIndex: note.z_index,
            minimized: note.minimized,
            createdAt: new Date(note.created_at),
            updatedAt: new Date(note.updated_at),
            syncedAt: new Date()
          };
          await this.indexedDB.saveNote(localNote);
          noteIdMap.set(note.id, localNote.id);
        }
      }

      // Create local folders
      for (const folder of folders) {
        const localDesktopId = desktopIdMap.get(folder.desktop_id);
        const localTargetId = desktopIdMap.get(folder.target_desktop_id);
        if (localDesktopId && localTargetId) {
          const localFolder: LocalFolder = {
            id: this.generateId(),
            desktopId: localDesktopId,
            targetDesktopId: localTargetId,
            name: folder.name,
            icon: folder.icon,
            color: folder.color,
            positionX: folder.position_x,
            positionY: folder.position_y,
            createdAt: new Date(folder.created_at),
            syncedAt: new Date()
          };
          await this.indexedDB.saveFolder(localFolder);
        }
      }

      // Create local connections
      for (const connection of connections) {
        const localDesktopId = desktopIdMap.get(connection.desktop_id);
        const localFromId = noteIdMap.get(connection.from_note_id);
        const localToId = noteIdMap.get(connection.to_note_id);
        if (localDesktopId && localFromId && localToId) {
          const localConnection: LocalConnection = {
            id: this.generateId(),
            desktopId: localDesktopId,
            fromNoteId: localFromId,
            toNoteId: localToId,
            color: connection.color,
            label: connection.label,
            createdAt: new Date(connection.created_at),
            syncedAt: new Date()
          };
          await this.indexedDB.saveConnection(localConnection);
        }
      }

      // Download assets
      for (const asset of assets) {
        const localNoteId = noteIdMap.get(asset.note_id);
        if (localNoteId && asset.storage_path) {
          try {
            const { data: blob } = await this.supabase.downloadFile('assets', asset.storage_path);
            if (blob) {
              const localAsset: LocalAsset = {
                id: this.generateId(),
                noteId: localNoteId,
                data: blob,
                originalName: asset.original_name,
                mimeType: asset.mime_type,
                width: asset.width,
                height: asset.height,
                positionX: asset.position_x,
                positionY: asset.position_y,
                createdAt: new Date(asset.created_at),
                syncedAt: new Date()
              };
              await this.indexedDB.saveAsset(localAsset);
            }
          } catch (e) {
            console.error('Error downloading asset:', e);
          }
        }
      }

      // Clear pending changes since we just synced
      await this.indexedDB.clearPendingChanges();

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

  // ==================== SYNC HELPERS ====================

  private async syncWorkspace(workspace: LocalWorkspace, userId: string): Promise<{ id: string }> {
    // Check if workspace exists in Supabase
    const { data: existing } = await this.supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .single();

    if (existing) {
      // Update existing
      await this.supabase
        .from('workspaces')
        .update({
          name: workspace.name,
          theme_config: workspace.themeConfig,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      return { id: existing.id };
    } else {
      // Create new
      const { data, error } = await this.supabase
        .from('workspaces')
        .insert({
          user_id: userId,
          name: workspace.name,
          is_default: workspace.isDefault,
          theme_config: workspace.themeConfig
        })
        .select('id')
        .single();

      if (error) throw error;
      return { id: data.id };
    }
  }

  private async syncDesktop(desktop: LocalDesktop, workspaceId: string, idMap: Map<string, string>): Promise<string> {
    const parentId = desktop.parentId ? idMap.get(desktop.parentId) : null;

    const { data, error } = await this.supabase
      .from('desktops')
      .upsert({
        workspace_id: workspaceId,
        parent_id: parentId,
        name: desktop.name,
        position_order: desktop.positionOrder,
        local_id: desktop.id
      }, {
        onConflict: 'local_id'
      })
      .select('id')
      .single();

    if (error) {
      // If upsert fails, try insert
      const { data: insertData, error: insertError } = await this.supabase
        .from('desktops')
        .insert({
          workspace_id: workspaceId,
          parent_id: parentId,
          name: desktop.name,
          position_order: desktop.positionOrder,
          local_id: desktop.id
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      return insertData.id;
    }

    return data.id;
  }

  private async syncNote(note: LocalNote, desktopId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('notes')
      .upsert({
        desktop_id: desktopId,
        title: note.title,
        content: note.content,
        position_x: note.positionX,
        position_y: note.positionY,
        width: note.width,
        height: note.height,
        color: note.color,
        z_index: note.zIndex,
        minimized: note.minimized,
        local_id: note.id
      }, {
        onConflict: 'local_id'
      })
      .select('id')
      .single();

    if (error) {
      const { data: insertData, error: insertError } = await this.supabase
        .from('notes')
        .insert({
          desktop_id: desktopId,
          title: note.title,
          content: note.content,
          position_x: note.positionX,
          position_y: note.positionY,
          width: note.width,
          height: note.height,
          color: note.color,
          z_index: note.zIndex,
          minimized: note.minimized,
          local_id: note.id
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      return insertData.id;
    }

    return data.id;
  }

  private async syncAsset(asset: LocalAsset, noteId: string, userId: string): Promise<void> {
    // Upload file to storage
    const filePath = `${userId}/${asset.id}`;
    const { error: uploadError } = await this.supabase.uploadFile(
      'assets',
      filePath,
      asset.data,
      { contentType: asset.mimeType, upsert: true }
    );

    if (uploadError) throw uploadError;

    // Save metadata to database
    await this.supabase
      .from('assets')
      .upsert({
        note_id: noteId,
        storage_path: filePath,
        original_name: asset.originalName,
        mime_type: asset.mimeType,
        width: asset.width,
        height: asset.height,
        position_x: asset.positionX,
        position_y: asset.positionY,
        local_id: asset.id
      }, {
        onConflict: 'local_id'
      });
  }

  private async syncFolder(folder: LocalFolder, desktopId: string, targetDesktopId: string): Promise<void> {
    await this.supabase
      .from('folders')
      .upsert({
        desktop_id: desktopId,
        target_desktop_id: targetDesktopId,
        name: folder.name,
        icon: folder.icon,
        color: folder.color,
        position_x: folder.positionX,
        position_y: folder.positionY,
        local_id: folder.id
      }, {
        onConflict: 'local_id'
      });
  }

  private async syncConnection(
    connection: LocalConnection,
    desktopId: string,
    fromNoteId: string,
    toNoteId: string
  ): Promise<void> {
    await this.supabase
      .from('connections')
      .upsert({
        desktop_id: desktopId,
        from_note_id: fromNoteId,
        to_note_id: toNoteId,
        color: connection.color,
        label: connection.label,
        local_id: connection.id
      }, {
        onConflict: 'local_id'
      });
  }

  private async createVersionSnapshot(workspaceId: string, data: any): Promise<number> {
    // Get latest version number
    const { data: latest } = await this.supabase
      .from('versions')
      .select('version_number')
      .eq('workspace_id', workspaceId)
      .order('version_number', { ascending: false })
      .limit(1)
      .single();

    const versionNumber = (latest?.version_number ?? 0) + 1;

    // Create summary
    const summary = `${data.notes.length} notas, ${data.folders.length} carpetas, ${data.assets.length} imágenes`;

    // Save version
    await this.supabase
      .from('versions')
      .insert({
        workspace_id: workspaceId,
        version_number: versionNumber,
        snapshot: JSON.stringify(data),
        change_summary: summary
      });

    return versionNumber;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ==================== STATUS HELPERS ====================

  getStatusText(): string {
    switch (this.status()) {
      case 'idle':
        return this.hasPendingChanges() ? `${this.pendingChangesCount()} cambios pendientes` : 'Sincronizado';
      case 'pending':
        return `${this.pendingChangesCount()} cambios pendientes`;
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
        return this.hasPendingChanges() ? '○' : '●';
      case 'pending':
        return '○';
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
