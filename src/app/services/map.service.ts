import { Injectable } from '@angular/core';
import { IndexedDBService, LocalDesktop, LocalNote, LocalFolder, LocalConnection, LocalAsset } from './indexeddb.service';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import {
  MapFile,
  MapDesktop,
  MapNote,
  MapFolder,
  MapConnection,
  MapAsset,
  ImportResult,
  ExportResult,
  ShareResult,
  SharedMap,
  SharedMapInfo
} from '../models/database.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class MapService {
  constructor(
    private indexedDB: IndexedDBService,
    private supabase: SupabaseService,
    private auth: AuthService
  ) {}

  // ==================== EXPORT METHODS ====================

  /**
   * Export a desktop and all its children as a MapFile
   */
  async exportDesktopAsMap(desktopId: string): Promise<ExportResult> {
    try {
      const desktop = await this.indexedDB.getDesktop(desktopId);
      if (!desktop) {
        throw new Error('Desktop no encontrado');
      }

      // Collect all desktops in the tree
      const allDesktops: LocalDesktop[] = [desktop];
      await this.collectChildDesktops(desktopId, allDesktops);

      // Collect all content
      const allNotes: LocalNote[] = [];
      const allAssets: LocalAsset[] = [];
      const allFolders: LocalFolder[] = [];
      const allConnections: LocalConnection[] = [];

      for (const d of allDesktops) {
        const notes = await this.indexedDB.getNotes(d.id);
        allNotes.push(...notes);

        for (const note of notes) {
          const assets = await this.indexedDB.getAssets(note.id);
          allAssets.push(...assets);
        }

        const folders = await this.indexedDB.getFolders(d.id);
        allFolders.push(...folders);

        const connections = await this.indexedDB.getConnections(d.id);
        allConnections.push(...connections);
      }

      // Build hierarchy
      const hierarchy: { [key: string]: { parentLocalId: string | null; childrenLocalIds: string[] } } = {};
      for (const d of allDesktops) {
        hierarchy[d.id] = {
          parentLocalId: d.parentId,
          childrenLocalIds: allDesktops
            .filter(child => child.parentId === d.id)
            .map(child => child.id)
        };
      }

      // Convert to MapFile format
      const mapDesktops: MapDesktop[] = [];
      const mapAssets: MapAsset[] = [];

      for (const d of allDesktops) {
        const desktopNotes = allNotes.filter(n => n.desktopId === d.id);
        const desktopFolders = allFolders.filter(f => f.desktopId === d.id);
        const desktopConnections = allConnections.filter(c => c.desktopId === d.id);

        const mapNotes: MapNote[] = desktopNotes.map(note => {
          const noteAssets = allAssets.filter(a => a.noteId === note.id);
          return {
            localId: note.id,
            title: note.title,
            content: note.content,
            position: { x: note.positionX, y: note.positionY },
            size: { width: note.width, height: note.height },
            color: note.color,
            zIndex: note.zIndex,
            minimized: note.minimized,
            assetLocalIds: noteAssets.map(a => a.id)
          };
        });

        const mapFolders: MapFolder[] = desktopFolders.map(folder => ({
          localId: folder.id,
          name: folder.name,
          icon: folder.icon,
          color: folder.color,
          position: { x: folder.positionX, y: folder.positionY },
          targetDesktopLocalId: folder.targetDesktopId
        }));

        const mapConnections: MapConnection[] = desktopConnections.map(conn => ({
          localId: conn.id,
          fromNoteLocalId: conn.fromNoteId,
          toNoteLocalId: conn.toNoteId,
          color: conn.color
        }));

        mapDesktops.push({
          localId: d.id,
          name: d.name,
          notes: mapNotes,
          folders: mapFolders,
          connections: mapConnections
        });
      }

      // Convert assets to base64
      for (const asset of allAssets) {
        const base64 = await this.indexedDB.blobToBase64(asset.data);
        mapAssets.push({
          localId: asset.id,
          noteLocalId: asset.noteId,
          data: base64,
          originalName: asset.originalName,
          mimeType: asset.mimeType,
          size: { width: asset.width, height: asset.height },
          position: { x: asset.positionX, y: asset.positionY }
        });
      }

      // Build MapFile
      const mapFile: MapFile = {
        format: 'mdflow',
        version: '1.0.0',
        metadata: {
          name: desktop.name,
          exportedAt: new Date().toISOString(),
          sourceApp: 'MultiDesktopFlow',
          sourceVersion: environment.app.version,
          checksum: this.generateChecksum(mapDesktops, mapAssets)
        },
        content: {
          desktops: mapDesktops,
          assets: mapAssets
        },
        structure: {
          rootDesktopLocalId: desktopId,
          hierarchy
        }
      };

      const jsonString = JSON.stringify(mapFile, null, 2);

      return {
        success: true,
        fileName: `${desktop.name.replace(/[^a-zA-Z0-9]/g, '_')}.mdflow`,
        fileSize: new Blob([jsonString]).size,
        mapFile
      };
    } catch (error: any) {
      console.error('Error exporting map:', error);
      return {
        success: false,
        fileName: '',
        fileSize: 0,
        mapFile: null as any
      };
    }
  }

  /**
   * Download a map as a file
   */
  async downloadMap(desktopId: string): Promise<void> {
    const result = await this.exportDesktopAsMap(desktopId);
    if (!result.success) {
      throw new Error('Error al exportar el mapa');
    }

    const jsonString = JSON.stringify(result.mapFile, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==================== IMPORT METHODS ====================

  /**
   * Import a map file and create independent copy
   */
  async importMap(file: File): Promise<ImportResult> {
    try {
      const text = await file.text();
      const mapFile = JSON.parse(text) as MapFile;

      // Validate format
      if (mapFile.format !== 'mdflow') {
        throw new Error('Formato de archivo inválido');
      }

      return await this.importMapData(mapFile);
    } catch (error: any) {
      console.error('Error importing map:', error);
      return {
        success: false,
        desktopsImported: 0,
        notesImported: 0,
        foldersImported: 0,
        assetsImported: 0,
        rootDesktopId: '',
        errors: [error.message]
      };
    }
  }

  /**
   * Import map data into a specific desktop
   */
  async importMapToDesktop(mapFile: MapFile, targetDesktopId: string): Promise<ImportResult> {
    return await this.importMapData(mapFile, targetDesktopId);
  }

  private async importMapData(mapFile: MapFile, parentDesktopId?: string): Promise<ImportResult> {
    try {
      const workspace = await this.indexedDB.getDefaultWorkspace();
      if (!workspace) {
        throw new Error('No hay workspace activo');
      }

      // Create ID mapping (old -> new)
      const desktopIdMap = new Map<string, string>();
      const noteIdMap = new Map<string, string>();
      const assetIdMap = new Map<string, string>();

      // Sort desktops by hierarchy (parents first)
      const sortedDesktops = this.sortDesktopsByHierarchy(
        mapFile.content.desktops,
        mapFile.structure
      );

      // Create desktops
      let rootDesktopId = '';
      for (const mapDesktop of sortedDesktops) {
        const isRoot = mapDesktop.localId === mapFile.structure.rootDesktopLocalId;
        const parentInfo = mapFile.structure.hierarchy[mapDesktop.localId];

        let parentId: string | null = null;
        if (isRoot && parentDesktopId) {
          // If importing into a specific desktop, use that as parent
          parentId = parentDesktopId;
        } else if (parentInfo.parentLocalId) {
          parentId = desktopIdMap.get(parentInfo.parentLocalId) || null;
        }

        const newDesktop = await this.indexedDB.createDesktop(
          workspace.id,
          mapDesktop.name,
          parentId
        );
        desktopIdMap.set(mapDesktop.localId, newDesktop.id);

        if (isRoot) {
          rootDesktopId = newDesktop.id;
        }
      }

      // Create notes
      let notesImported = 0;
      for (const mapDesktop of mapFile.content.desktops) {
        const newDesktopId = desktopIdMap.get(mapDesktop.localId);
        if (!newDesktopId) continue;

        for (const mapNote of mapDesktop.notes) {
          const newNote = await this.indexedDB.createNote(newDesktopId, {
            x: mapNote.position.x,
            y: mapNote.position.y
          });

          newNote.title = mapNote.title;
          newNote.content = mapNote.content;
          newNote.width = mapNote.size.width;
          newNote.height = mapNote.size.height;
          newNote.color = mapNote.color;
          newNote.zIndex = mapNote.zIndex;
          newNote.minimized = mapNote.minimized;

          await this.indexedDB.saveNote(newNote);
          noteIdMap.set(mapNote.localId, newNote.id);
          notesImported++;
        }
      }

      // Create assets
      let assetsImported = 0;
      for (const mapAsset of mapFile.content.assets) {
        const newNoteId = noteIdMap.get(mapAsset.noteLocalId);
        if (!newNoteId) continue;

        const blob = this.indexedDB.base64ToBlob(mapAsset.data, mapAsset.mimeType);
        const newAsset = await this.indexedDB.createAsset(
          newNoteId,
          blob,
          mapAsset.originalName || '',
          mapAsset.mimeType,
          { width: mapAsset.size.width, height: mapAsset.size.height },
          { x: mapAsset.position.x, y: mapAsset.position.y }
        );
        assetIdMap.set(mapAsset.localId, newAsset.id);
        assetsImported++;
      }

      // Create folders
      let foldersImported = 0;
      for (const mapDesktop of mapFile.content.desktops) {
        const newDesktopId = desktopIdMap.get(mapDesktop.localId);
        if (!newDesktopId) continue;

        for (const mapFolder of mapDesktop.folders) {
          const targetId = desktopIdMap.get(mapFolder.targetDesktopLocalId);
          if (!targetId) continue;

          const newFolder = await this.indexedDB.createFolder(
            newDesktopId,
            targetId,
            mapFolder.name,
            { x: mapFolder.position.x, y: mapFolder.position.y }
          );

          if (mapFolder.icon || mapFolder.color) {
            const folder = await this.indexedDB.getFolder(newFolder.id);
            if (folder) {
              folder.icon = mapFolder.icon;
              folder.color = mapFolder.color;
              await this.indexedDB.saveFolder(folder);
            }
          }
          foldersImported++;
        }
      }

      // Create connections
      for (const mapDesktop of mapFile.content.desktops) {
        const newDesktopId = desktopIdMap.get(mapDesktop.localId);
        if (!newDesktopId) continue;

        for (const mapConn of mapDesktop.connections) {
          const fromId = noteIdMap.get(mapConn.fromNoteLocalId);
          const toId = noteIdMap.get(mapConn.toNoteLocalId);
          if (!fromId || !toId) continue;

          await this.indexedDB.createConnection(
            newDesktopId,
            fromId,
            toId,
            mapConn.color
          );
        }
      }

      return {
        success: true,
        desktopsImported: sortedDesktops.length,
        notesImported,
        foldersImported,
        assetsImported,
        rootDesktopId
      };
    } catch (error: any) {
      console.error('Error importing map data:', error);
      return {
        success: false,
        desktopsImported: 0,
        notesImported: 0,
        foldersImported: 0,
        assetsImported: 0,
        rootDesktopId: '',
        errors: [error.message]
      };
    }
  }

  // ==================== SHARE METHODS ====================

  /**
   * Share a map (upload to Supabase)
   */
  async shareMap(desktopId: string, isPublic: boolean, description?: string): Promise<ShareResult> {
    if (!this.supabase.isConfigured() || this.auth.isOfflineMode()) {
      return {
        success: false,
        shareToken: '',
        shareUrl: '',
        isPublic: false
      };
    }

    const user = this.auth.currentUser();
    if (!user) {
      return {
        success: false,
        shareToken: '',
        shareUrl: '',
        isPublic: false
      };
    }

    try {
      const exportResult = await this.exportDesktopAsMap(desktopId);
      if (!exportResult.success) {
        throw new Error('Error al exportar el mapa');
      }

      const shareToken = this.generateShareToken();

      const { data, error } = await this.supabase
        .from('shared_maps')
        .insert({
          owner_id: user.id,
          name: exportResult.mapFile.metadata.name,
          description,
          map_data: exportResult.mapFile,
          is_public: isPublic,
          share_token: shareToken
        })
        .select('id')
        .single();

      if (error) throw error;

      return {
        success: true,
        shareToken,
        shareUrl: `${window.location.origin}/map/${shareToken}`,
        isPublic
      };
    } catch (error: any) {
      console.error('Error sharing map:', error);
      return {
        success: false,
        shareToken: '',
        shareUrl: '',
        isPublic: false
      };
    }
  }

  /**
   * Get a shared map by token
   */
  async getSharedMap(token: string): Promise<MapFile | null> {
    if (!this.supabase.isConfigured()) {
      return null;
    }

    try {
      const { data, error } = await this.supabase
        .from('shared_maps')
        .select('map_data, download_count')
        .eq('share_token', token)
        .single();

      if (error || !data) return null;

      // Increment download count
      await this.supabase
        .from('shared_maps')
        .update({ download_count: (data.download_count || 0) + 1 })
        .eq('share_token', token);

      return data.map_data as MapFile;
    } catch (error) {
      console.error('Error getting shared map:', error);
      return null;
    }
  }

  /**
   * List public shared maps
   */
  async listPublicMaps(limit = 20): Promise<SharedMapInfo[]> {
    if (!this.supabase.isConfigured()) {
      return [];
    }

    try {
      const { data, error } = await this.supabase
        .from('shared_maps')
        .select(`
          id,
          name,
          description,
          download_count,
          created_at,
          profiles!owner_id(display_name)
        `)
        .eq('is_public', true)
        .order('download_count', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        authorName: (item.profiles as any)?.display_name || 'Anónimo',
        downloadCount: item.download_count,
        createdAt: new Date(item.created_at)
      }));
    } catch (error) {
      console.error('Error listing public maps:', error);
      return [];
    }
  }

  // ==================== HELPERS ====================

  private async collectChildDesktops(parentId: string, collection: LocalDesktop[]): Promise<void> {
    const children = await this.indexedDB.getChildDesktops(parentId);
    for (const child of children) {
      collection.push(child);
      await this.collectChildDesktops(child.id, collection);
    }
  }

  private sortDesktopsByHierarchy(
    desktops: MapDesktop[],
    structure: { rootDesktopLocalId: string; hierarchy: any }
  ): MapDesktop[] {
    const sorted: MapDesktop[] = [];
    const visited = new Set<string>();

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const parentId = structure.hierarchy[id]?.parentLocalId;
      if (parentId && !visited.has(parentId)) {
        visit(parentId);
      }

      const desktop = desktops.find(d => d.localId === id);
      if (desktop) {
        sorted.push(desktop);
      }
    };

    // Start with root
    visit(structure.rootDesktopLocalId);

    // Visit any remaining
    for (const desktop of desktops) {
      visit(desktop.localId);
    }

    return sorted;
  }

  private generateChecksum(desktops: MapDesktop[], assets: MapAsset[]): string {
    const content = JSON.stringify({ desktops, assets });
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `simple:${Math.abs(hash).toString(16)}`;
  }

  private generateShareToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 16; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
}
